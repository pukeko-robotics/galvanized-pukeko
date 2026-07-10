rootProject.name = "pukeko-koog-ag-ui"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        // The AG-UI Kotlin SDK (:kotlin-core, :kotlin-encoder) is consumed from the
        // local Maven cache, published there by the coordinator. Koog + ktor come
        // from Maven Central.
        mavenLocal()
        mavenCentral()
    }
}
