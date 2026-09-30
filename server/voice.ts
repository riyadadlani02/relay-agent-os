import express, { type Express } from 'express';
export async function transcribeAudio(
  audio: Uint8Array,
  type: string,
  key = process.env.DEEPGRAM_API_KEY,
) {
  if (!key) throw Error('Configure DEEPGRAM_API_KEY on the local server.');
  const started = performance.now();
  const r = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true',
    {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Token ${key}`, 'Content-Type': type },
      body: Buffer.from(audio),
    },
  );
  if (!r.ok) throw Error(`Speech provider returned HTTP ${r.status}.`);
  const data = (await r.json()) as {
    metadata: { request_id: string; duration: number };
    results: {
      channels: { alternatives: { transcript: string; confidence: number; words: unknown[] }[] }[];
    };
  };
  const alt = data.results.channels[0]?.alternatives[0];
  if (!alt?.transcript.trim()) throw Error('No speech recognized. Try again or type your request.');
  return {
    transcript: alt.transcript,
    confidence: alt.confidence,
    words: alt.words,
    seconds: data.metadata.duration,
    requestId: data.metadata.request_id,
    milliseconds: Math.round(performance.now() - started),
    provider: 'Deepgram Nova-3 multilingual',
  };
}
export function mountVoice(app: Express) {
  app.get('/api/voice/config', (_req, res) =>
    res.json({ enabled: !!process.env.DEEPGRAM_API_KEY, provider: 'Deepgram Nova-3 multilingual' }),
  );
  app.post(
    '/api/voice/transcribe',
    express.raw({
      type: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
      limit: '4mb',
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ error: 'Send an audio file of up to 4 MB.' });
      try {
        return res.json(await transcribeAudio(req.body, req.get('Content-Type')!));
      } catch (e) {
        return res.status(502).json({ error: (e as Error).message });
      }
    },
  );
}
