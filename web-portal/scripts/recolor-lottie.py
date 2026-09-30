"""Re-hue a Lottie onto the Monticello palette.

TECHNIQUE. Every remapped colour keeps its LIGHTNESS exactly and is given a new
hue and saturation. Lightness is what carries an illustration's shading, depth
and readability, so preserving it means the drawing survives intact and only the
palette changes. Snapping colours onto a fixed ramp instead flattens the
modelling and turns a shaded figure into a sticker.

WHY IT IS LAYER-AWARE. Colour alone cannot tell skin from a background. In the
guardhouse animation the big background blob and the figure's face are both
#FFE3C2 -- the same value, in different layers -- so a purely colour-based rule
either greens the face or leaves a peach blob behind an emerald scene. Both
files name their layers, so the layer name is the extra signal that separates
them.

WHAT STAYS HUMAN. Skin and hair keep their original colours; everything else --
clothing, furniture, charts, backgrounds, UI -- goes to the brand. That is how
illustration systems normally work, and it is why the result reads as a branded
scene rather than as a green person.
"""
import colorsys, json, re, sys, zipfile

# The product palette's two hues, measured off the real tokens:
#   emerald  #047857 (--color-brand-500, the accent)
#   slate    #475569 (--color-text-secondary, the neutral family)
EMERALD_HUE = 162.9 / 360
SLATE_HUE = 215.3 / 360

# Layers that may contain skin. Membership only PERMITS preservation; the colour
# still has to look like skin, which is what stops "L Shoulder F" (a blue
# sleeve) from being spared along with the hand beside it.
HUMAN = re.compile(r'(face|neck|hand|wrist|shoulder|body|arm|leg|foot|thi|skin)', re.I)
# Layers that are hair. Warm colours here are kept whatever their lightness:
# recolouring auburn to a same-lightness slate reads as grey hair on a young
# figure, which is worse than leaving it warm beside the skin it belongs to.
HAIR = re.compile(r'(hair|head)', re.I)


def to_hls(hx):
    r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return colorsys.rgb_to_hls(r, g, b)


def from_hls(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return [round(r, 6), round(g, 6), round(b, 6)]


def warm(deg):
    return deg <= 55 or deg >= 340


def remap(hx, layer):
    h, l, s = to_hls(hx)
    deg = h * 360
    human, hair = bool(HUMAN.search(layer)), bool(HAIR.search(layer))

    if s < 0.10:
        return None, 'neutral'                                   # white, black, grey
    if hair and warm(deg):
        return None, 'hair'
    if human and l >= 0.70 and warm(deg) and s >= 0.45:
        return None, 'skin'
    if l < 0.20:
        return from_hls(SLATE_HUE, l, min(0.30, max(0.12, s * 0.5))), 'ink'
    if s < 0.30:
        return from_hls(SLATE_HUE, l, min(0.22, max(0.08, s * 0.8))), 'slate'
    return from_hls(EMERALD_HUE, l, min(0.80, max(0.35, s * 0.72))), 'accent'


def px(k):
    r, g, b = [max(0, min(255, round(float(c) * 255))) for c in k[:3]]
    return '#%02X%02X%02X' % (r, g, b)


def walk(node, layer, stats):
    if isinstance(node, dict):
        ty = node.get('ty')
        if ty in ('fl', 'st') and isinstance(node.get('c'), dict):
            k = node['c'].get('k')
            if isinstance(k, list) and k and isinstance(k[0], (int, float)):
                new, kind = remap(px(k), layer)
                stats[kind] = stats.get(kind, 0) + 1
                if new:
                    k[0:3] = new
        if ty in ('gf', 'gs'):
            g = node.get('g', {})
            kk = g.get('k', {}).get('k')
            if isinstance(kk, list) and kk and isinstance(kk[0], (int, float)):
                for i in range(g.get('p', 0)):
                    off = i * 4
                    if off + 3 < len(kk):
                        new, kind = remap(px(kk[off + 1:off + 4]), layer)
                        stats[kind] = stats.get(kind, 0) + 1
                        if new:
                            kk[off + 1:off + 4] = new
        for v in node.values():
            walk(v, layer, stats)
    elif isinstance(node, list):
        for v in node:
            walk(v, layer, stats)


src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
name = [x for x in z.namelist() if x.startswith('animations/') and x.endswith('.json')][0]
doc = json.loads(z.read(name))
stats = {}
for layer in doc.get('layers', []):
    walk(layer, str(layer.get('nm', '')), stats)
for asset in doc.get('assets', []):
    for layer in asset.get('layers', []) if isinstance(asset, dict) else []:
        walk(layer, str(layer.get('nm', '')), stats)
json.dump(doc, open(out, 'w', encoding='utf-8'), separators=(',', ':'))
print(f'{out}: ' + ', '.join(f'{k}={v}' for k, v in sorted(stats.items())))
