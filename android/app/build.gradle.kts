plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    // END: FlutterFire Configuration
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
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

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}