# phosphor_flutter — vendored, patched fork of 2.1.0

## Why this exists

Flutter declares `IconData` as a **`final class`**, which cannot be extended
outside its own library. Upstream `phosphor_flutter` is built on subclassing it:

```dart
class PhosphorIconData extends IconData { ... }        // lib/src/phosphor_icon_data.dart
class PhosphorFlatIconData extends PhosphorIconData { ... }
```

so every build of this app failed at compile time with:

```
phosphor_flutter-2.1.0/lib/src/phosphor_icon_data.dart:5:32:
Error: The class 'IconData' can't be extended outside of its library
because it's a final class.
```

**2.1.0 is the newest version published to pub.dev** (versions: 1.2.0, 1.3.1,
1.4.0, 2.0.0, 2.0.1, 2.1.0), so there was no upgrade to take. The package is not
keeping pace with the SDK, and the app uses it in 29 files across 279 call
sites, so removing it was the larger change.

## What was changed

The subclassing is gone. Every icon constant is now a plain `const IconData`
carrying exactly the values upstream's constructor supplied:

```dart
// upstream
static const acorn = PhosphorFlatIconData(0xeb9a, 'Regular');

// here
static const acorn = IconData(0xeb9a, fontFamily: 'PhosphorRegular',
    fontPackage: 'phosphor_flutter', matchTextDirection: true);
```

Same code point, same font family, same package, same text-direction flag — so
the rendered glyph is byte-for-byte the one upstream produced. This was applied
mechanically to all 1512 constants in each of the five flat style files; **no
call site in the app changed**, because the app only ever used these constants
as `IconData` passed to `Icon(...)`.

## What was dropped, and why

| Removed | Reason |
| --- | --- |
| `PhosphorIconData` / `PhosphorFlatIconData` / `PhosphorDuotoneIconData` | The subclasses that cannot compile. This is the whole point of the fork. |
| `phosphor_icons_duotone.dart` + `Phosphor-Duotone.ttf` | A duotone glyph is two layered code points; upstream modelled that as a `secondary` field **on the IconData subclass**. A plain `IconData` has nowhere to put it, so duotone cannot be represented without reintroducing a subclass. |
| `PhosphorIcon` widget (`phosphor_icon.dart`) | Its only behaviour beyond the framework's `Icon` was painting that duotone secondary layer. With duotone gone it is a strictly worse `Icon`. The app never used it (0 references). |
| `phosphor_icons_base.dart` (`PhosphorIcons.name(style)`) | The runtime style-switching API returns `PhosphorIconData` and dispatches into duotone. The app never used it (0 references). |

Retained styles: **Regular, Light, Bold, Fill, Thin** — all 1512 icons each.
The app currently uses Regular (278 call sites) and Light (1).

## Maintenance

This is wired in via `dependency_overrides` in the root `pubspec.yaml`. Drop the
override and delete this directory the moment upstream publishes a release that
does not subclass `IconData` — check <https://pub.dev/packages/phosphor_flutter>.

To regenerate after pulling a newer upstream, the transform is one substitution
per style file:

```
s/PhosphorFlatIconData\((0x[0-9a-fA-F]+), '([A-Za-z]+)'\)/IconData(\1, fontFamily: 'Phosphor\2', fontPackage: 'phosphor_flutter', matchTextDirection: true)/g
```

plus deleting the `phosphor_icon_data.dart` import from each file.

Upstream licence is unmodified in `LICENSE`.
