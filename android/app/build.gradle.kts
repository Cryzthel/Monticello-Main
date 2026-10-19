import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// ── RELEASE SIGNING (2026-10-20) ────────────────────────────────────────────
// `android/key.properties` (git-ignored) points at the upload keystore:
//
//     storeFile=C:\\path\\to\\monticello-upload.jks
//     storePassword=…
//     keyAlias=upload
//     keyPassword=…
//
// Every release build that reaches a phone must be signed with that one key:
// Android only installs an update signed by the same key as the installed app,
// so an APK signed by a different (or debug) key cannot update it. Without the
// file, release builds fall back to the debug key so `flutter run --release`
// still works on a developer machine — and scripts/deploy-apk.sh refuses to
// publish them (it checks the certificate).
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
if (hasReleaseKey) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}

android {
    namespace = "com.example.monticello_villas_app"
    compileSdk = flutter.compileSdkVersion

    // `flutter.ndkVersion` is a non-null String (FlutterExtension.kt), so the
    // `?: "25.2.9519653"` that used to sit here was dead code — Kotlin warns
    // that the elvis operator always returns the left operand. It never
    // applied, but it did leave a stale "25.x" version string in the one file
    // people open when a build fails, which is misleading when the real error
    // is about a different 25.x entirely. Flutter 3.44.8 supplies 28.2.13676358.
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.example.monticello_villas_app"

        // Mapbox Maps SDK requires a minimum SDK version of 21 or higher
        minSdk = maxOf(flutter.minSdkVersion, 21)

        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // Multidex support for Firebase dependencies
        multiDexEnabled = true
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
            // R8 code shrinking and resource shrinking. The Flutter Gradle
            // plugin already enables both for release builds; stated here so
            // the release configuration is readable in one place.
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

flutter {
    source = "../.."
}
