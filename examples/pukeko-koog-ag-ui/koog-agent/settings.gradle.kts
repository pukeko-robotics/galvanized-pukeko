rootProject.name = "pukeko-koog-ag-ui"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        // The AG-UI Kotlin SDK :kotlin-core is consumed from the local Maven cache,
        // published there by the coordinator. The EventEncoder is vendored (BE-7), so
        // :kotlin-encoder is no longer required. Koog + ktor come from Maven Central.
        mavenLocal()
        mavenCentral()
    }
}
