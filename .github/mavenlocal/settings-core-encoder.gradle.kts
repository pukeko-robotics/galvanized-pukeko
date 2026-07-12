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

// JVM-ONLY publish set (see .github/mavenlocal/README.md): only :kotlin-core and
// :kotlin-encoder are included. :kotlin-client and :kotlin-tools are dropped
// because they carry the Android target that would otherwise force an Android SDK
// onto the runner. :kotlin-encoder depends only on :kotlin-core.
include(":kotlin-core")
include(":kotlin-encoder")

// Map module directories to artifact names
project(":kotlin-core").projectDir = file("core")
project(":kotlin-encoder").projectDir = file("encoder")
