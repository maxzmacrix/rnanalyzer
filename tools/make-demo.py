"""Build the demo data set for the guided tour (app/demo/).

Takes two Guadix laps from "Example files", anonymises the driver (name → DRIVER A, photo removed),
renames the video references and re-encodes the complete lap videos as low-resolution clips with ffmpeg
(640 px wide, mono audio; about 4 MB per 1½-minute lap). CLIP_S limits the clip length when set.

    python tools/make-demo.py
"""
import os, re, zipfile, subprocess, json, shutil, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Example files')
OUT = os.path.join(ROOT, 'app', 'demo')
CLIP_S = None  # seconds; None = the whole lap video
LAPS = [
    # (rnz, source video or None, demo base name)
    ('20171219_102903432_RNONE-228_LAP_6_1min26sec.rnz', '20171219_102248243_RNONE-228_Lap_6_1min26sec.mp4', 'demo-lap6'),
    ('20171219_104851020_RNONE-228_LAP_13_1min26sec.rnz', '20171219_104711858_RNONE-228_Lap_13_1min26sec.mp4', 'demo-lap13'),
]
DRIVER = 'DRIVER A'

os.makedirs(OUT, exist_ok=True)
for _f in os.listdir(OUT): os.remove(os.path.join(OUT, _f))
index = {'laps': [], 'videos': []}

def shift(ts, seconds):
    t = datetime.datetime.strptime(ts, '%Y-%m-%d %H:%M:%S.%f') + datetime.timedelta(seconds=seconds)
    return t.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

for rnz, video, base in LAPS:
    z = zipfile.ZipFile(os.path.join(SRC, rnz))
    rn = [n for n in z.namelist() if n.endswith('.rn')][0]
    x = z.read(rn).decode('utf-8')
    comment = z.comment.decode('utf-8')
    # driver anonymised
    x = re.sub(r'<driverName>[^<]*</driverName>', f'<driverName>{DRIVER}</driverName>', x)
    x = re.sub(r'<driverSurname>[^<]*</driverSurname>', '<driverSurname></driverSurname>', x)
    x = re.sub(r'<photo>[^<]*</photo>', '<photo></photo>', x)
    comment = re.sub(r'^Driver=.*$', f'Driver={DRIVER}', comment, flags=re.M)
    if video:
        clip = f'{base}.mp4'
        m = re.search(r'<video locationType="0" uri="[^"]*">(.*?)</video>', x, re.S)
        vstart = re.search(r'<startTime>([^<]*)</startTime>', m.group(1)).group(1)
        body = m.group(1)
        body = re.sub(r'<fileName>[^<]*</fileName>', f'<fileName>{clip}</fileName>', body)
        if CLIP_S: body = re.sub(r'<endTime>[^<]*</endTime>', f'<endTime>{shift(vstart, CLIP_S)}</endTime>', body)
        x = x[:m.start()] + f'<video locationType="0" uri="{clip}">' + body + '</video>' + x[m.end():]
        comment = re.sub(r'^VideoLocationType_0=.*$', f'VideoLocationType_0={clip}', comment, flags=re.M)
        # from the start of the recording (its startTime stays valid), 640 px wide, small
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', os.path.join(SRC, video)] + (['-t', str(CLIP_S)] if CLIP_S else []) +
                       ['-vf', 'scale=640:-2', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-movflags', '+faststart', os.path.join(OUT, clip)], check=True)
        index['videos'].append(clip)
    else:
        x = re.sub(r'<videos>.*?</videos>', '<videos></videos>', x, flags=re.S)
        comment = re.sub(r'^VideoLocationType_0=.*\n?', '', comment, flags=re.M)
    out = os.path.join(OUT, f'{base}.rnz')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zo:
        zo.writestr(f'{base}.rn', x.encode('utf-8'))
        zo.comment = comment.encode('utf-8')
    index['laps'].append(f'{base}.rnz')

# pack the clips into one uncompressed archive – fetch() of bare .mp4 files fails in the iOS shell's media handler
with zipfile.ZipFile(os.path.join(OUT, 'demo-videos.zip'), 'w', zipfile.ZIP_STORED) as zv:
    for clip in index['videos']:
        zv.write(os.path.join(OUT, clip), clip)
        os.remove(os.path.join(OUT, clip))
index['videoArchive'] = 'demo-videos.zip'
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=2)
for f in sorted(os.listdir(OUT)): print(f'{f:24s} {os.path.getsize(os.path.join(OUT, f)) / 1024:8.0f} kB')
