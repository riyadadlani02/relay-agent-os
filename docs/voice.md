# Hindi / Hinglish voice path

The playground now accepts microphone dictation in supported browsers. Expand **Speak in Hindi, Hinglish or English**, choose a language, start capture, then press **Finish speaking**. Review the transcript and exact order ID before copying it into the request box. Sending the request remains a separate action. Pauses and interim hypotheses never execute a tool.

Browser recognition may use the browser vendor’s speech service. The on-device Qwen model does not imply on-device speech recognition. If recognition is unavailable, text entry remains available.

## A real audio-to-action run

- [Synthetic Hindi audio](../public/evidence/hindi-request.mp3), generated with OpenAI `gpt-4o-mini-tts`, built-in `coral` voice. This is **not a real customer recording or a cloned voice**.
- [Original script](../public/evidence/hindi-request.txt).
- [Raw Deepgram Nova-3 multilingual transcription](../public/evidence/voice-transcription.json), including word timing and confidence.
- [Model and tool trace](../public/evidence/voice-run.json).

Recognition returned “नमस्ते. मेरा order R1042 वापस करना है. कृपया पूरा refund कर दीजिए.” The reviewed version changes only `R1042` to `R-1042`. GPT-4.1 mini then chose the lookup, policy search and refund tools. Relay committed one $49 refund to the local sample ledger. The exact correction is recorded in the evidence; it was not hidden as perfect recognition.

## Local speech provider

Set `DEEPGRAM_API_KEY` in the ignored local `.env`, run `npm run dev`, and open `/?playground=1`. The voice panel offers audio-file transcription through the server. The endpoint accepts common audio MIME types up to 4 MB and sends the bytes to Deepgram; keys stay on the server. Use synthetic recordings for this prototype.

The server adapter is [`server/voice.ts`](../server/voice.ts). Its use of Nova-3 follows [EMMA’s speech-provider boundary](https://github.com/riyadadlani02/EmmaLiveKit) conceptually; Relay does not import the EMMA telephony runtime. The explicit completion/review design is informed by [asli’s turn-boundary findings](https://github.com/riyadadlani02/asli), not a claim that its calibrated detector has been deployed here.

This is **not a phone call demo**, telephony service, barge-in benchmark or streaming endpointing evaluation. No microphone recording was performed on the user’s device during verification. The synthetic audio test exercises recognition, review and model execution; real microphone quality depends on browser, permissions and environment.

Provider references: [Deepgram models/languages](https://developers.deepgram.com/docs/models-languages-overview), [OpenAI text-to-speech](https://developers.openai.com/api/docs/guides/text-to-speech).
