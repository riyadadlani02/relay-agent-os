"""Render a 1080p product film from genuine UI captures and original motion graphics."""
from pathlib import Path
from functools import lru_cache
import json, math, subprocess, sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'.video-work'
MEDIA=ROOT/'public/media'
W,H,FPS=1920,1080,30
INK=(28,33,27); OLIVE=(188,194,169); PAPER=(229,231,214); ORANGE=(233,127,73); MUTED=(142,151,129)
timing = WORK if (WORK/'timeline.json').exists() else ROOT/'scripts/video'
scenes=json.loads((timing/'timeline.json').read_text())
captions=json.loads((timing/'captions.json').read_text())
TOTAL=scenes[-1]['end']
@lru_cache(None)
def font(size,kind='mono'):
    f={'title':'anton-400.ttf','mono':'space-mono-400.ttf','bold':'space-mono-700.ttf'}[kind]
    return ImageFont.truetype(str(WORK/'fonts'/f),size)
@lru_cache(None)
def asset(name):
    return Image.open(ROOT/'scripts/video/captures'/name).convert('RGB')
def ease(t):
    t=max(0,min(1,t)); return 1-(1-t)**3
def text(d,xy,txt,size=24,fill=PAPER,kind='mono'):
    d.text(xy,txt,font=font(size,kind),fill=fill,stroke_width=0)
def fittext(d,xy,txt,width,size=90,fill=PAPER,kind='title'):
    while d.textlength(txt,font=font(size,kind))>width: size-=1
    text(d,xy,txt,size,fill,kind)
def wrap(d,txt,size,width,kind='mono'):
    lines=[]; line=''
    for word in txt.split():
        trial=(line+' '+word).strip()
        if d.textlength(trial,font=font(size,kind))>width and line:
            lines.append(line);line=word
        else:line=trial
    if line:lines.append(line)
    return lines

def base(t, light=False):
    im=Image.new('RGB',(W,H),OLIVE if light else INK);d=ImageDraw.Draw(im)
    color=(174,181,155) if light else (37,44,35)
    for x in range(0,W,80): d.line((x,0,x,H),fill=color)
    for y in range(0,H,80): d.line((0,y,W,y),fill=color)
    fg=INK if light else PAPER
    text(d,(76,45),'RELAY',37,fg,'title')
    d.rectangle((180,51,223,89),outline=fg,width=2)
    text(d,(188,57),'OS',18,fg,'bold')
    text(d,(1315,61),'PRODUCT FILM  /  VOL. 01',18,fg)
    d.line((76,112,1844,112),fill=MUTED,width=1)
    d.line((76,990,1844,990),fill=MUTED,width=1)
    text(d,(76,1016),'REAL INFERENCE / SAMPLE BUSINESS DATA',17,fg)
    text(d,(1440,1016),'EDITED FOR CLARITY',17,fg)
    d.rectangle((76,984,76+int(1768*t/TOTAL),987),fill=ORANGE)
    return im

@lru_cache(None)
def screen_img(name,target_w,target_h):
    source=asset(name)
    # The photographed panel is the focus; exclude a partially scrolled page title.
    if name == "blocked.png":
        source=source.crop((730,234,1244,630))
    elif name != "request.png":
        source=source.crop((24,90,source.width-24,source.height-36))
    scale=min(target_w/source.width,target_h/source.height)
    return source.resize((round(source.width*scale),round(source.height*scale)),Image.Resampling.LANCZOS)
def screen(im,name,local,box=(670,170,1174,760)):
    x,y,w,h=box
    # Gentle editorial drift preserves every captured UI pixel.
    offset=round(22*(1-ease(local/1.0)))
    shot=screen_img(name,w,h-34)
    sx=x+(w-shot.width)//2;sy=y+34+offset
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((sx-10,sy-44,sx+shot.width+10,sy+shot.height+10),radius=15,fill=(11,15,11),outline=(92,105,83),width=1)
    for i,c in enumerate([ORANGE,OLIVE,MUTED]):d.ellipse((sx+10+i*22,sy-27,sx+20+i*22,sy-17),fill=c)
    text(d,(sx+100,sy-30),'RELAY OS  /  LIVE PLAYGROUND',14,OLIVE)
    im.paste(shot,(sx,sy))
    return (sx,sy,shot.width,shot.height)

def badge(d,x,y,label,color=ORANGE):
    width=d.textlength(label,font=font(18,'bold'))+34
    d.rounded_rectangle((x,y,x+width,y+42),radius=4,fill=color)
    text(d,(x+17,y+9),label,18,INK,'bold')

art=Image.open(ROOT/'public/images/agent-core.png').convert('RGBA')
@lru_cache(None)
def art_size(size): return art.resize((size,size),Image.Resampling.LANCZOS)

def frame(t):
    index=next((i for i,s in enumerate(scenes) if s['start']<=t<s['end']),len(scenes)-1)
    scene=scenes[index];local=t-scene['start'];dur=scene['end']-scene['start'];p=local/dur
    sid=scene['id'];light=sid in ['intro','outro'];im=base(t,light);d=ImageDraw.Draw(im)
    fg=INK if light else PAPER
    enter=round(35*(1-ease(local/.75)))
    text(d,(76,153+enter),scene['kicker'],20,fg)
    if sid in ['intro','outro']:
        # Original project art, framed as a physical object against the editorial field.
        size=820+int(15*ease(p));a=art_size(size)
        im.paste(a,(1020-int(p*12),160+int(5*math.sin(t))),a)
        d=ImageDraw.Draw(im)
        for i,line in enumerate(scene['title']):
            fittext(d,(76,265+153*i+enter),line,940,142,INK)
        if sid=='intro':
            text(d,(80,648),'AN OPERATING LAYER FOR AI AGENTS',24,INK)
            badge(d,80,724,'AUTONOMY, WITH CONTROL')
            # Signal bars animate with a deliberately analog cadence.
            for j in range(40):
                bar=10+32*(.5+.5*math.sin(t*3+j*.61))
                d.rectangle((80+j*13,855-bar,87+j*13,855+bar),fill=INK)
        else:
            text(d,(80,646),'OPEN THE PLAYGROUND',24,INK,'bold')
            text(d,(80,705),'riyadadlani02.github.io',24,INK)
            text(d,(80,746),'/relay-agent-os/',24,INK)
            badge(d,80,817,'NO API KEY / WEBGPU REQUIRED')
    else:
        for i,line in enumerate(scene['title']):fittext(d,(76,260+i*99+enter),line,555,84)
        if sid=='playground':
            screen(im,'request.png',local)
            d=ImageDraw.Draw(im);text(d,(80,530),'QWEN 2.5',44,PAPER,'title')
            text(d,(80,597),'ON-DEVICE MODEL',20,OLIVE)
            for j,label in enumerate(['TYPE A REQUEST','MODEL SELECTS TOOLS','RUNTIME CHECKS AUTHORITY']):
                d.ellipse((80,684+j*58,91,695+j*58),fill=ORANGE if local>j*1.2 else MUTED)
                text(d,(109,675+j*58),label,17,OLIVE)
        elif sid=='refund':
            screen(im,'refund.png' if local>2 else 'request.png',local)
            d=ImageDraw.Draw(im);text(d,(76,512),'$49',158,ORANGE,'title')
            badge(d,82,729,'COMMITTED',OLIVE)
            text(d,(82,802),'ORDER R-1042',20,OLIVE)
            text(d,(82,844),'Receipt saved locally.',18,OLIVE)
        elif sid=='approval':
            # The cut corresponds to the real before/after captures.
            approving=local>(scene['cues'][-1]['start']-scene['start'])
            screen(im,'approved.png' if approving else 'approval.png',local)
            d=ImageDraw.Draw(im);text(d,(76,512),'$249',158,ORANGE,'title')
            badge(d,82,729,'APPROVED' if approving else 'AWAITING YOUR APPROVAL',OLIVE if approving else ORANGE)
            text(d,(82,802),'ORDER R-1043',20,OLIVE)
            text(d,(82,844),'One explicit human decision.',18,OLIVE)
        elif sid=='blocked':
            screen(im,'blocked.png',local)
            d=ImageDraw.Draw(im);text(d,(76,512),'$500',158,ORANGE,'title')
            badge(d,82,729,'HARD REFUND LIMIT')
            text(d,(82,802),'POLICY REF-01',20,OLIVE)
            text(d,(82,844),'Permission comes from code.',18,OLIVE)
        elif sid=='trace':
            screen(im,'trace.png' if p<.62 else 'records.png',local)
            d=ImageDraw.Draw(im)
            labels=['TOOL ARGUMENTS','POLICY DECISIONS','VERIFIED RECEIPTS','PERSISTED RECORDS']
            for j,label in enumerate(labels):
                y=540+j*80;d.line((80,y+12,109,y+12),fill=ORANGE,width=3)
                text(d,(127,y),label,20,OLIVE)
    # Readable open captions; external WebVTT is also provided for accessibility.
    d=ImageDraw.Draw(im)
    cue=next((c for c in captions if c['start']<=t<c['end']),None)
    if cue:
        lines=wrap(d,cue['text'],27,1660)
        height=24+len(lines)*37;top=966-height
        widths=[d.textlength(s,font=font(27)) for s in lines]
        maxw=max(widths)+52
        d.rounded_rectangle(((W-maxw)/2,top,(W+maxw)/2,966),radius=8,fill=(13,18,13))
        for j,line in enumerate(lines):text(d,((W-widths[j])/2,top+10+j*37),line,27,PAPER)
    # Quick exposure fade on each scene keeps the cuts purposeful.
    fade=min(1,local/.32,(dur-local)/.26)
    if fade<1: im=Image.blend(Image.new('RGB',(W,H),INK),im,max(0,fade))
    return im

if '--stills' in sys.argv:
    for s in scenes:
        try:
            frame(s['start']+(s['end']-s['start'])*.45).save(WORK/f"review-{s['id']}.jpg",quality=90)
        except FileNotFoundError:
            print("Capture pending:",s['id'])
    frame(.5).save(MEDIA/'relay-demo-poster.jpg',quality=92)
    sys.exit()

# Original, low-key electronic bed, ducked underneath the narration.
voice,sr=sf.read(WORK/'audio/voiceover.wav',dtype='float32');n=len(voice);tt=np.arange(n)/sr
bed=np.zeros(n,np.float32)
chords=[[130.813,164.814,195.998],[110,130.813,164.814],[87.307,110,130.813],[97.999,123.471,146.832]]
for start in np.arange(0,TOTAL,8):
    i=int(start*sr);end=min(n,i+int(9*sr));u=np.arange(end-i)/sr
    env=np.minimum(u/1.5,1)*np.minimum((9-u)/2,1)
    tones=chords[int(start/8)%4]
    pad=sum(np.sin(2*np.pi*f*u+.15*np.sin(2*np.pi*.13*u)) for f in tones)/3
    bed[i:end]+=pad*env*.022
for start in np.arange(.4,TOTAL,60/88):
    i=int(start*sr);end=min(n,i+int(.23*sr));u=np.arange(end-i)/sr
    bed[i:end]+=.018*np.sin(2*np.pi*(110*u-130*u*u))*np.exp(-u*25)
# Block envelope prevents music from obscuring speech.
for i in range(0,n,1200):
    if np.sqrt(np.mean(voice[i:i+1200]**2))>.018:bed[i:i+1200]*=.38
bed*=np.minimum(tt/2,1)*np.minimum((TOTAL-tt)/2,1)
stereo=np.column_stack((voice+bed, voice+np.roll(bed,int(.009*sr))*.94))
sf.write(WORK/'audio/mix.wav',stereo,sr)
output=WORK/'picture.mp4'
proc=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','warning','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',str(output)],stdin=subprocess.PIPE)
for i in range(math.ceil(TOTAL*FPS)):
    proc.stdin.write(frame(i/FPS).tobytes())
    if i%(FPS*10)==0: print(f'Rendered {i/FPS:.0f}/{TOTAL:.0f}s',flush=True)
proc.stdin.close()
if proc.wait():raise RuntimeError('Video encoding failed')
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning','-i',str(output),'-i',str(WORK/'audio/mix.wav'),'-i',str(MEDIA/'relay-demo.vtt'),'-map','0:v','-map','1:a','-map','2:s','-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:s','mov_text','-metadata:s:s:0','language=eng','-metadata','title=Relay OS — Intelligence, in your hands','-movflags','+faststart',str(MEDIA/'relay-demo.mp4')],check=True)
print('Finished',MEDIA/'relay-demo.mp4',flush=True)

subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning','-i',str(MEDIA/'relay-demo.mp4'),'-map','0:v:0','-map','0:a:0','-c:v','libvpx-vp9','-b:v','0','-crf','28','-deadline','good','-cpu-used','5','-row-mt','1','-threads','8','-c:a','libopus','-b:a','128k','-sn',str(MEDIA/'relay-demo.webm')],check=True)
