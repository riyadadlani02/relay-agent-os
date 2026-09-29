"""Generate local Kokoro narration and timed caption cues; no remote speech API."""
from pathlib import Path
import json, hashlib
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.video-work'
OUT = WORK / 'audio'
OUT.mkdir(exist_ok=True)
scenes = json.loads((ROOT / 'scripts/video/storyboard.json').read_text())
model = Kokoro(str(WORK / 'models/kokoro-v1.0.onnx'), str(WORK / 'models/voices-v1.0.bin'))
sample_rate = 24000
track, timeline, captions = [], [], []
cursor = 0.0

def silence(seconds):
    global cursor
    track.append(np.zeros(round(seconds * sample_rate), dtype=np.float32))
    cursor += seconds

for scene in scenes:
    start = cursor
    silence(.65)
    scene_cues = []
    for i, sentence in enumerate(scene['sentences']):
        digest = hashlib.sha256((sentence + "af_heart/.98").encode()).hexdigest()[:8]
        path = OUT / f"{scene['id']}-{i}-{digest}.wav"
        if not path.exists():
            samples, rate = model.create(sentence, voice='af_heart', speed=.98, lang='en-us')
            sf.write(path, samples, rate)
        samples, rate = sf.read(path, dtype='float32')
        assert rate == sample_rate
        # Remove long model padding while retaining natural speech edges.
        active = np.flatnonzero(abs(samples) > .006)
        if len(active):
            samples = samples[max(0, active[0]-1600):min(len(samples), active[-1]+2400)]
        duration = len(samples) / sample_rate
        cue = {'start': round(cursor, 3), 'end': round(cursor+duration, 3), 'text':sentence.replace('O S', 'OS')}
        captions.append(cue)
        scene_cues.append(cue)
        track.append(samples)
        cursor += duration
        silence(.2)
    silence(1.0 if scene['id'] != 'outro' else 2.5)
    timeline.append({**scene, 'start':round(start,3), 'end':round(cursor,3), 'cues':scene_cues})
    print(scene['id'], round(cursor-start,2), 'seconds', flush=True)
voice = np.concatenate(track)
voice = voice / max(np.max(abs(voice)), .01) * .84
sf.write(OUT / 'voiceover.wav', voice, sample_rate)
(WORK/'timeline.json').write_text(json.dumps(timeline, indent=2))
(WORK/'captions.json').write_text(json.dumps(captions, indent=2))
def timestamp(t):
    ms=round(t*1000); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02}.{ms:03}'
text='WEBVTT\n\n'+'\n\n'.join(f"{timestamp(c['start'])} --> {timestamp(c['end'])}\n{c['text']}" for c in captions)+'\n'
(ROOT/'public/media/relay-demo.vtt').write_text(text)
print('TOTAL',cursor,flush=True)
