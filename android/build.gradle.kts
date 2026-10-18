allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// DO NOT REDIRECT THIS OUT OF THE PROJECT FOLDER.
//
// Tried and reverted: pointing the build tree at a path outside the repo (to
// keep Gradle intermediates out of a OneDrive-synced folder) makes Gradle
// itself succeed and then breaks `flutter run` with
//
//     Gradle build failed to produce an .apk file. It's likely that this file
//     was generated under <project>\build, but the tool couldn't find it.
//
// The Flutter tool resolves the APK at `<project>/build/app/outputs/...` on its
// own and has no flag that follows a relocated Gradle buildDir. The two have to
// agree, so this path is effectively fixed by the toolchain.
val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
