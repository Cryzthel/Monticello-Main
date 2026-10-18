"""Compose every Android and iOS launcher icon from the brand emblem.

    flutter test tool/app_icons/render_mark_master_test.dart   # stage 1
    py -I tool/app_icons/gen_app_icons.py                      # stage 2

Stage 1 rasterizes the emblem with Flutter's own engine, so the shape here is
the shape the app draws. This stage only composes: background colour, rounded
corners, safe-zone insets, and — for iOS — stripping the alpha channel.

WHAT IT REPLACES. The Android mipmaps and the iOS AppIcon set both shipped
Flutter's default placeholder, the blue "F". That is the icon a resident sees
on their home screen, so it is the single most visible piece of placeholder
branding in the project.

THE ICON. The splash, exactly: the emerald mark (#047857) on pure white.
It was an emerald tile with a white mark, on the argument that a mostly-white
icon can dissolve into pale docks; the user chose (2026-10-18) strict parity
with the splash screen instead, so the icon a resident taps and the screen it
opens are the same picture. The launcher's own mask and shadow give the white
tile its edge.
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MASTER = os.path.join(ROOT, "tool", "app_icons", "build", "mark_master.png")

BRAND = (4, 120, 87)  # #047857 — the mark
BACKGROUND = (255, 255, 255)  # pure white — the tile, as on the splash

# ── Android, legacy mipmaps (pre-Oreo, and the fallback everywhere) ───────
# Density buckets, in px. A rounded square rather than a full-bleed one: on a
# launcher that does not apply its own mask these are drawn exactly as given,
# and a hard-cornered square reads as an unfinished icon next to everything
# else on the home screen.
ANDROID_LEGACY = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# ── Android, adaptive foreground (API 26+) ────────────────────────────────
# The canvas is 108dp and the launcher may mask it to anything inside the
# central 72dp, then animate it beyond that. Art that fills more than about
# 66dp gets clipped by a circular mask. The mark is sized to 44dp of 108 —
# comfortably inside the safe circle with room for the parallax the launcher
# applies.
ANDROID_ADAPTIVE = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
ADAPTIVE_MARK_FRACTION = 44 / 108

# ── iOS ───────────────────────────────────────────────────────────────────
# Square, opaque, no rounded corners and NO ALPHA CHANNEL — iOS masks the
# corners itself, and App Store validation rejects an icon with transparency.
IOS_ICONS = {
    "Icon-App-20x20@1x.png": 20,
    "Icon-App-20x20@2x.png": 40,
    "Icon-App-20x20@3x.png": 60,
    "Icon-App-29x29@1x.png": 29,
    "Icon-App-29x29@2x.png": 58,
    "Icon-App-29x29@3x.png": 87,
    "Icon-App-40x40@1x.png": 40,
    "Icon-App-40x40@2x.png": 80,
    "Icon-App-40x40@3x.png": 120,
    "Icon-App-60x60@2x.png": 120,
    "Icon-App-60x60@3x.png": 180,
    "Icon-App-76x76@1x.png": 76,
    "Icon-App-76x76@2x.png": 152,
    "Icon-App-83.5x83.5@2x.png": 167,
    "Icon-App-1024x1024@1x.png": 1024,
}

# How much of the tile's width the mark occupies on a filled square icon.
# 0.58 keeps the mark clear of the corner radius iOS applies and of the
# circular crop some Android launchers use on the legacy icon.
TILE_MARK_FRACTION = 0.58

# Corner radius of the legacy Android tile, as a fraction of its side.
LEGACY_RADIUS_FRACTION = 0.22


def load_master():
    if not os.path.exists(MASTER):
        raise SystemExit(
            "missing %s — run stage 1 first:\n"
            "  flutter test tool/app_icons/render_mark_master_test.dart" % MASTER
        )
    return Image.open(MASTER).convert("RGBA")


def scaled_mark(master, target_width):
    """The mark in brand emerald, resampled to `target_width`, aspect kept.

    The master is rendered white; only its alpha is used, so the shape is
    still exactly the one Flutter draws and the colour is applied here.
    """
    ratio = master.height / master.width
    size = (max(1, int(round(target_width))), max(1, int(round(target_width * ratio))))
    alpha = master.resize(size, Image.LANCZOS).getchannel("A")
    mark = Image.new("RGBA", size, BRAND + (255,))
    mark.putalpha(alpha)
    return mark


def centred(canvas, mark):
    canvas.alpha_composite(
        mark,
        (
            (canvas.width - mark.width) // 2,
            (canvas.height - mark.height) // 2,
        ),
    )


def rounded_tile(size, radius_fraction):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=int(round(size * radius_fraction)),
        fill=BACKGROUND + (255,),
    )
    return tile


def write(image, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, "PNG", optimize=True)
    return path


def main():
    master = load_master()
    written = []

    res = os.path.join(ROOT, "android", "app", "src", "main", "res")

    for bucket, size in ANDROID_LEGACY.items():
        tile = rounded_tile(size, LEGACY_RADIUS_FRACTION)
        centred(tile, scaled_mark(master, size * TILE_MARK_FRACTION))
        written.append(write(tile, os.path.join(res, bucket, "ic_launcher.png")))

    for bucket, size in ANDROID_ADAPTIVE.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        centred(canvas, scaled_mark(master, size * ADAPTIVE_MARK_FRACTION))
        written.append(
            write(canvas, os.path.join(res, bucket, "ic_launcher_foreground.png"))
        )

    appicon = os.path.join(
        ROOT, "ios", "Runner", "Assets.xcassets", "AppIcon.appiconset"
    )
    for name, size in IOS_ICONS.items():
        tile = Image.new("RGBA", (size, size), BACKGROUND + (255,))
        centred(tile, scaled_mark(master, size * TILE_MARK_FRACTION))
        # RGB, not RGBA: no alpha channel at all in the file iOS ships.
        written.append(write(tile.convert("RGB"), os.path.join(appicon, name)))

    for path in written:
        print("  %s" % os.path.relpath(path, ROOT).replace("\\", "/"))
    print("%d icons written" % len(written))


if __name__ == "__main__":
    sys.exit(main())
