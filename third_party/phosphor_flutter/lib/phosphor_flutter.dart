library phosphor_flutter;

// Upstream also exported `src/phosphor_icon_data.dart` (the IconData subclasses
// this fork exists to remove) and `src/phosphor_icon.dart` (the PhosphorIcon
// widget, whose only behaviour beyond the framework's own Icon was painting a
// duotone glyph's secondary layer). Both are gone — see README.md.
//
// Icons are plain `IconData` now, so they go straight into `Icon(...)`, and
// anything else in the framework that accepts an IconData.
export 'package:phosphor_flutter/src/phosphor_icons.dart';
