import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        results: {
          length: number;
          [index: number]: { isFinal: boolean; 0: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export default function VoiceInput({
  onDraft,
  disabled,
}: {
  onDraft: (text: string) => void;
  disabled: boolean;
}) {
  const [language, setLanguage] = useState('hi-IN');
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [supported, setSupported] = useState(false);
  const [server, setServer] = useState(false);
  const [uploading, setUploading] = useState(false);
  const recognition = useRef<Recognition | undefined>(undefined);
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    if (import.meta.env.MODE !== 'pages')
      fetch('/api/voice/config')
        .then((r) => r.json())
        .then((d) => setServer(d.enabled))
        .catch(() => {});
    return () => recognition.current?.abort();
  }, []);
  function start() {
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Constructor) return;
    const r = new Constructor();
    recognition.current = r;
    r.lang = language;
    r.continuous = true;
    r.interimResults = true;
    setDraft('');
    setNotice('Listening. Pauses do not submit a request. Press Finish speaking when done.');
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
      setDraft(text.trim());
    };
    r.onerror = (e) => {
      setListening(false);
      setNotice(
        e.error === 'not-allowed'
          ? 'Microphone access was declined. You can type instead.'
          : `Speech recognition stopped (${e.error}). Review what was captured or type your request.`,
      );
    };
    r.onend = () => {
      setListening(false);
      setNotice('Review the complete transcript and order ID. Nothing has been sent to the agent.');
    };
    try {
      r.start();
      setListening(true);
    } catch {
      setNotice('Could not start speech recognition. You can type instead.');
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setNotice('Transcribing with Deepgram. Audio is sent to the configured speech provider.');
    try {
      if (file.size > 4 * 1024 * 1024) throw Error('Use an audio file smaller than 4 MB.');
      const r = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'audio/wav' },
        body: file,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setDraft(data.transcript);
      setNotice(
        `${data.provider} · ${(data.milliseconds / 1000).toFixed(1)} seconds. Review the transcript before using it.`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <details className="voice-input">
      <summary>Speak in Hindi, Hinglish or English</summary>
      <p>
        Finish your thought, then review the transcript. Silence never authorizes an action. Browser
        speech recognition may send audio to your browser’s speech service.
      </p>
      <div className="voice-controls">
        <label>
          Speech language{' '}
          <select
            value={language}
            disabled={listening}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="hi-IN">Hindi / Hinglish</option>
            <option value="en-IN">English (India)</option>
          </select>
        </label>
        {listening ? (
          <button type="button" className="live-quiet" onClick={() => recognition.current?.stop()}>
            <Square size={14} /> Finish speaking
          </button>
        ) : (
          <button
            type="button"
            className="live-quiet"
            disabled={disabled || !supported || uploading}
            onClick={start}
          >
            <Mic size={14} /> Start microphone
          </button>
        )}
      </div>
      {!supported && (
        <p>Voice capture is unavailable in this browser. Use Chrome or type your request.</p>
      )}
      {server && (
        <label className="voice-upload">
          Or transcribe an audio file with Deepgram
          <input
            type="file"
            accept="audio/wav,audio/webm,audio/mpeg,audio/mp4,audio/ogg"
            disabled={disabled || listening || uploading}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      )}
      <p role="status">{notice}</p>
      {draft && (
        <>
          <label htmlFor="voice-transcript">Review transcript and exact order ID</label>
          <textarea
            id="voice-transcript"
            maxLength={1500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={listening}
          />
          <button
            type="button"
            className="live-quiet"
            disabled={disabled || listening || !draft.trim()}
            onClick={() => {
              onDraft(draft);
              setNotice(
                'Transcript copied into Your request. Check the order ID, then press Send request.',
              );
            }}
          >
            Use reviewed transcript
          </button>
        </>
      )}
      <a href={`${import.meta.env.BASE_URL}evidence/hindi-request.mp3`}>
        Listen to the synthetic Hindi sample
      </a>
    </details>
  );
}
