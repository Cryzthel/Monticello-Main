package com.monticello_villas_app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import androidx.core.content.FileProvider
import java.io.File

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createAlertsChannel()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Whether the phone can tell which way it is facing. The home map only
        // draws its heading cone when it can: Mapbox's heading puck on a phone
        // without a compass sits at 0° forever, which reads as "facing north"
        // rather than "unknown". See DeviceHeading on the Dart side.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "monticello/heading")
            .setMethodCallHandler { call, result ->
                if (call.method == "isAvailable") {
                    result.success(hasCompass())
                } else {
                    result.notImplemented()
                }
            }
        // The app's own NOTIFICATION settings page, not its general App info
        // page. Once Android holds a denial for POST_NOTIFICATIONS (or on 12
        // and below, where there is no runtime prompt at all), the system
        // will not show the permission dialog again; this page is the one
        // place the switch can still be turned back on.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "monticello/notifications")
            .setMethodCallHandler { call, result ->
                if (call.method == "openSettings") {
                    result.success(openNotificationSettings())
                } else {
                    result.notImplemented()
                }
            }
        // The in-app updater (lib/core/updates/update_service.dart): where to
        // download the new APK, whether this app may install packages, the
        // switch that allows it, and handing the file to the system installer.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "monticello/updater")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "downloadDir" -> result.success(updateDir().absolutePath)
                    "canInstall" -> result.success(canInstallPackages())
                    "openInstallSettings" -> result.success(openInstallSettings())
                    "install" -> result.success(installApk(call.argument<String>("path")))
                    else -> result.notImplemented()
                }
            }
    }

    // Android 7+ hands the installer a content:// URI from UpdateFileProvider,
    // so the APK stays in private cache. Android 5–6 installers only read
    // file:// URIs, which they cannot open inside private storage, so there
    // the download goes to the app's external cache instead.
    private fun updateDir(): File {
        val base = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            cacheDir
        } else {
            externalCacheDir ?: cacheDir
        }
        return File(base, "updates")
    }

    // Android 8+ grants "install unknown apps" per app, through Settings only.
    // Before that it was one system-wide switch the installer itself asks about.
    private fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

    private fun openInstallSettings(): Boolean {
        return try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:$packageName"))
            } else {
                Intent(Settings.ACTION_SECURITY_SETTINGS)
            }
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            false
        }
    }

    // Opens the system installer on the downloaded APK. Same package, same
    // signing key, higher versionCode: Android installs it as an update in
    // place, keeping the app's data, then restarts it on the new version.
    private fun installApk(path: String?): Boolean {
        if (path == null) return false
        return try {
            val file = File(path)
            val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                FileProvider.getUriForFile(this, "$packageName.updates", file)
            } else {
                Uri.fromFile(file)
            }
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun openNotificationSettings(): Boolean {
        return try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", packageName, null))
            }
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun hasCompass(): Boolean {
        val sensors = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            ?: return false
        if (sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null) return true
        return sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null &&
            sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
    }

    // The manifest names `monticello_alerts` as FCM's default channel, but
    // naming a channel does not create it. Until something does, Android 8+
    // files every background push under FCM's "Miscellaneous" fallback — the
    // exact outcome the manifest entry exists to avoid. Creating an existing
    // channel is a no-op, so this is safe on every launch, and the resident's
    // own changes to the channel's settings are never overwritten by it.
    private fun createAlertsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            "monticello_alerts",
            "Dispatch and emergency alerts",
            // HIGH so a dispatch update or "help is on the way" shows as a
            // heads-up banner rather than arriving silently in the shade.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Updates on your reports and responses to your SOS alerts."
        }
        getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }
}
