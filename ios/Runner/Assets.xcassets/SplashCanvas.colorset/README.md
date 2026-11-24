The splash canvas as an iOS named colour. ONE value, no dark variant.

LaunchScreen.storyboard is rendered by the OS before Dart runs, so it cannot
ask Flutter anything; it needs a named colour. It used to carry a
`luminosity: dark` variant so a dark-mode device launched onto #09090B.

That variant is gone: the splash is white on every device, by request. The
whole dark branch came out with it — `SplashPalette` in
lib/features/onboarding/widgets/splash_view.dart, and the entire
android/app/src/main/res/values-night/ directory.

  all appearances  #FFFFFF  SplashPalette.canvas
