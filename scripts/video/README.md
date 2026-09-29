# Relay OS product film

75 seconds, 1920 × 1080, 30 fps, H.264/AAC MP4 plus VP9/Opus WebM, English synthetic narration, open captions and an embedded subtitle track. The website also serves WebVTT captions, a plain-text transcript, an MP4 download, and a separate narration MP3.

The film uses genuine screenshots captured through the browser UI from the local production build with Qwen 2.5 1.5B running through WebGPU. The selected runs were edited for clarity; this is not a continuous screen recording or a model-quality benchmark. No application outcomes were composited into the screenshots. The opening/closing cassette is the project's original generated art.

Recorded outcomes:

- R-1042: $49 refund committed; receipt `7da2c15d`.
- R-1043: $249 refund paused for approval, then committed after an actual operator click; receipt `11a405dc`. The record was also checked after refresh.
- Policy scene: a close-up of the actual published refund rules. This scene explains the code-enforced ceiling; it does not depict a generated refund attempt.

The raw captures are in `captures/`. `storyboard.json` is the narration and editorial structure. `timeline.json` and `captions.json` retain the measured timings. `render.py` creates the motion graphics, a quiet original synthesized soundtrack, and the final mix. All business records are fictional and local; no payment processor is involved.

## Rebuild

Requires Python 3.12, FFmpeg with libx264 and libvpx-vp9, and the project's npm dependencies. Keep downloaded models and intermediate renders in the ignored `.video-work/` directory.

```sh
uv venv .video-work/venv --python 3.12
uv pip install --python .video-work/venv/bin/python kokoro-onnx==0.6.1 soundfile pillow numpy fonttools brotli
```

Download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the [official Kokoro ONNX model release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1) into `.video-work/models/`. Speech uses the standard `af_heart` voice from [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), synthesized locally; it does not imitate the project author's voice.

Convert the bundled Anton 400 and Space Mono 400/700 WOFF font files to TTF with fontTools, writing `anton-400.ttf`, `space-mono-400.ttf`, and `space-mono-700.ttf` into `.video-work/fonts/`. Fonts retain their upstream licenses in the npm packages.

```sh
.video-work/venv/bin/python scripts/video/narrate.py
.video-work/venv/bin/python scripts/video/render.py --stills
.video-work/venv/bin/python scripts/video/render.py
```

Final assets are written to `public/media/`. Model weights, temporary PCM audio, and the intermediate picture-only encode are not committed.
