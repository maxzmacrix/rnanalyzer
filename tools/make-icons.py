"""Generate all app icons from the vector RN logo (PDF).

    python tools/make-icons.py "<path to RN-Logo.pdf>"

Writes:
  app/icons/icon.svg, logo.svg, icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png
  native/ios-assets/AppIcon-1024.png (no alpha, as required by iOS), splash-2732.png (dark, logo centred)

Requires: pip install pymupdf pillow
"""
import os, sys
import fitz  # PyMuPDF
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\MaxZuchowski\OneDrive - Macrix\Dokumente\Projekte\RN Vision.Org\Logos\RN Logo\RN-Logo.pdf"
BG_TOP, BG_BOTTOM = (0x16, 0x18, 0x1e), (0x07, 0x08, 0x0a)   # splash: matches the app's dark theme
ICON_BG = (0xff, 0xff, 0xff)                                 # app icon: brand logo on white
RED = (0xed, 0x1c, 0x24)

doc = fitz.open(PDF)
page = doc[0]
drawings = page.get_drawings()
red = next(d for d in drawings if d['fill'] and d['fill'][0] > 0.5 and d['fill'][1] < 0.5)
white = next((d for d in drawings if d['fill'] and min(d['fill']) > 0.9), None)
bbox = red['rect']
fill_hex = '#%02x%02x%02x' % tuple(round(c * 255) for c in red['fill'])

# ---------- vector: build SVG path data (page coordinates → local, relative to bbox) ----------
def path_d(drawing):
    out, cur = [], None
    def P(p): return f"{p.x - bbox.x0:.2f} {p.y - bbox.y0:.2f}"
    for it in drawing['items']:
        kind = it[0]
        if kind == 'l':
            p1, p2 = it[1], it[2]
            if cur is None or abs(cur.x - p1.x) > 0.01 or abs(cur.y - p1.y) > 0.01:
                if cur is not None: out.append('Z')
                out.append('M' + P(p1))
            out.append('L' + P(p2)); cur = p2
        elif kind == 'c':
            p1, p2, p3, p4 = it[1], it[2], it[3], it[4]
            if cur is None or abs(cur.x - p1.x) > 0.01 or abs(cur.y - p1.y) > 0.01:
                if cur is not None: out.append('Z')
                out.append('M' + P(p1))
            out.append(f"C{P(p2)} {P(p3)} {P(p4)}"); cur = p4
        elif kind == 're':
            r = it[1]
            if cur is not None: out.append('Z')
            out.append(f"M{P(r.tl)} L{P(r.tr)} L{P(r.br)} L{P(r.bl)}"); cur = r.tl
        elif kind == 'qu':
            q = it[1]
            if cur is not None: out.append('Z')
            out.append(f"M{P(q.ul)} L{P(q.ur)} L{P(q.lr)} L{P(q.ll)}"); cur = q.ul
    out.append('Z')
    return ''.join(out)

W, H = bbox.width, bbox.height
red_d = path_d(red)
mask_svg = ''
mark_attr = f'fill="{fill_hex}"'
if white is not None:
    mask_svg = f'<mask id="cut"><rect width="{W:.2f}" height="{H:.2f}" fill="#fff"/><path d="{path_d(white)}" fill="#000"/></mask>'
    mark_attr += ' mask="url(#cut)"'

logo_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}">{mask_svg}'
            f'<path d="{red_d}" {mark_attr}/></svg>')

# icon.svg: white square, logo ~74 % wide, centred
S = 512
scale = S * 0.74 / W
lw, lh = W * scale, H * scale
tx, ty = (S - lw) / 2, (S - lh) / 2
icon_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">'
            f'<defs>{mask_svg}</defs>'
            f'<rect width="{S}" height="{S}" fill="#%02x%02x%02x"/>'
            f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})"><path d="{red_d}" {mark_attr}/></g></svg>') % ICON_BG

# ---------- raster: render the mark with transparent counters ----------
def render_mark(width_px):
    zoom = width_px / W
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=bbox, alpha=True)
    im = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
    r, g, b, a = im.split()
    # whiteness of the counters → transparency; pure red keeps full alpha
    import numpy as np
    A = np.asarray(a).astype('float32') / 255
    G = np.asarray(g).astype('float32'); B = np.asarray(b).astype('float32')
    w = np.clip((np.minimum(G, B) - RED[2]) / (255 - RED[2]), 0, 1)
    A = A * (1 - w)
    out = Image.new('RGBA', im.size, RED + (0,))
    out.putalpha(Image.fromarray((A * 255).astype('uint8')))
    return out

def gradient(size, top=BG_TOP, bottom=BG_BOTTOM):
    im = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        f = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * f) for i in range(3)))
    return im

def compose(size, logo_frac, alpha=False, mark_cache={}):
    big = size * 2
    bg = gradient(big, ICON_BG, ICON_BG).convert('RGBA')
    mark = render_mark(int(big * logo_frac))
    bg.alpha_composite(mark, ((big - mark.width) // 2, (big - mark.height) // 2))
    out = bg.resize((size, size), Image.LANCZOS)
    return out if alpha else out.convert('RGB')

icons = os.path.join(ROOT, 'app', 'icons'); os.makedirs(icons, exist_ok=True)
native = os.path.join(ROOT, 'native', 'ios-assets'); os.makedirs(native, exist_ok=True)
open(os.path.join(icons, 'icon.svg'), 'w', encoding='utf-8').write(icon_svg)
open(os.path.join(icons, 'logo.svg'), 'w', encoding='utf-8').write(logo_svg)
compose(192, 0.74).save(os.path.join(icons, 'icon-192.png'), optimize=True)
compose(512, 0.74).save(os.path.join(icons, 'icon-512.png'), optimize=True)
compose(512, 0.58).save(os.path.join(icons, 'icon-512-maskable.png'), optimize=True)   # safe zone
compose(180, 0.74).save(os.path.join(icons, 'apple-touch-icon.png'), optimize=True)
compose(1024, 0.74).save(os.path.join(native, 'AppIcon-1024.png'), optimize=True)        # RGB, no alpha

# splash: 2732 square, dark, logo ~34 % of the short side
S2 = 2732
bg = gradient(S2).convert('RGBA')
mark = render_mark(int(S2 * 0.34))
bg.alpha_composite(mark, ((S2 - mark.width) // 2, (S2 - mark.height) // 2))
bg.convert('RGB').save(os.path.join(native, 'splash-2732.png'), optimize=True)
print('icons written; logo fill', fill_hex, 'bbox', bbox)
