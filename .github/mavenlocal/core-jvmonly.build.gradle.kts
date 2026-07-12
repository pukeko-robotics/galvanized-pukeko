plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("maven-publish")
    id("signing")
}

// Group and version inherited from parent build.gradle.kts
//
// JVM-ONLY VARIANT of :kotlin-core (see .github/mavenlocal/README.md). Identical
// to the upstream core/build.gradle.kts except that the Android + iOS targets are
// removed so the module can publish `kotlin-core-jvm` to mavenLocal with NO Android
// SDK on the runner. kotlin-core's only expect/actual (`Platform`) is satisfied by
// jvmMain, so dropping the other targets is safe for JVM consumers.

repositories {
    google()
    mavenCentral()
}

kotlin {
    // Configure K2 compiler options
    targets.configureEach {
        compilations.configureEach {
            compileTaskProvider.configure {
                compilerOptions {
                    freeCompilerArgs.add("-Xexpect-actual-classes")
                    freeCompilerArgs.add("-opt-in=kotlin.RequiresOptIn")
                    freeCompilerArgs.add("-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi")
                    freeCompilerArgs.add("-opt-in=kotlinx.serialization.ExperimentalSerializationApi")
                    languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
                    apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
                }
            }
        }
    }

    // JVM target only (Android + iOS targets removed for the no-Android publish).
    jvm {
        compilations.all {
            compileTaskProvider.configure {
                compilerOptions {
                    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
                }
            }
        }
        testRuns["test"].executionTask.configure {
            useJUnitPlatform()
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                // Kotlinx libraries - core only needs serialization and datetime
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)

                // Coroutines for suspend functions
                implementation(libs.kotlinx.coroutines.core)

                // Logging - Kermit for multiplatform logging
                implementation(libs.kermit)
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
            }
        }

        val jvmMain by getting {
            dependencies {
                // No platform-specific logging dependencies needed with Kermit
            }
        }
    }
}

// Publishing configuration
publishing {
    publications {
        withType<MavenPublication> {
            version = project.version.toString()
            pom {
                name.set("kotlin-core")
                description.set("Core types and protocol definitions for the Agent User Interaction Protocol")
                url.set("https://github.com/ag-ui-protocol/ag-ui")

                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }

                developers {
                    developer {
                        id.set("contextablemark")
                        name.set("Mark Fogle")
                        email.set("mark@contextable.com")
                    }
                }

                scm {
                    url.set("https://github.com/ag-ui-protocol/ag-ui")
                    connection.set("scm:git:git://github.com/ag-ui-protocol/ag-ui.git")
                    developerConnection.set("scm:git:ssh://github.com:ag-ui-protocol/ag-ui.git")
                }
            }
        }
    }
}

// Signing configuration
signing {
    val signingKey: String? by project
    val signingPassword: String? by project

    if (signingKey != null && signingPassword != null) {
        useInMemoryPgpKeys(signingKey, signingPassword)
        sign(publishing.publications)
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}
