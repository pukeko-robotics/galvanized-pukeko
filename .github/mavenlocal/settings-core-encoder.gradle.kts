rootProject.name = "ag-ui-kotlin-sdk"

pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// Enable version catalog
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

// JVM-ONLY publish set (see .github/mavenlocal/README.md): only :kotlin-core is
// included. :kotlin-client and :kotlin-tools are dropped because they carry the
// Android target that would otherwise force an Android SDK onto the runner.
// :kotlin-encoder is no longer built here — the EventEncoder is now vendored into
// each consumer (BE-7). (Filename kept for release.yml's `cp`.)
include(":kotlin-core")

// Map module directories to artifact names
project(":kotlin-core").projectDir = file("core")
