package com.monticello_villas_app

import androidx.core.content.FileProvider

/**
 * Shares a downloaded update APK with the system package installer.
 *
 * Its own subclass rather than `androidx.core.content.FileProvider` itself:
 * plugins declare FileProviders too, and two `<provider>` entries with the
 * same class name collide in the manifest merge. Paths: res/xml/update_paths.xml.
 */
class UpdateFileProvider : FileProvider()
