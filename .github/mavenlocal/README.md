# mavenLocal encoder recipe (temporary)

The Koog e2e example (`examples/pukeko-koog-ag-ui/koog-agent`) and the ADK agent
build against the AG-UI Kotlin **EventEncoder**:

```kotlin
implementation("com.ag-ui.community:kotlin-core:0.4.1")
implementation("com.ag-ui.community:kotlin-encoder:0.4.1")
```

The `:kotlin-encoder` module is **not on Maven Central yet** — it lives on the fork
`andruhon/ag-ui` @ `feat/kotlin-encoder-server-integrations` and is the subject of the
upstream PR tracked by **BE-3**. Until that PR lands and the encoder is published to
Maven Central, CI (and local dev) build it to **mavenLocal** from the fork.

> **TEMPORARY — remove once BE-3's upstream encoder PR lands.** When
> `com.ag-ui.community:kotlin-encoder` is on Maven Central, delete this directory and
> the "Build the AG-UI encoder to mavenLocal" step in `.github/workflows/release.yml`;
> `mavenCentral()` alone will then resolve the dependency.

## Why two override files (the no-Android shortcut)

A full `publishToMavenLocal` of the SDK needs an **Android SDK** on the runner, because
`:kotlin-core` (and `:kotlin-client`) declare an `androidTarget()`. JVM consumers only
need the `-jvm` artifacts, so we publish **JVM-only** with no Android SDK by swapping in
two files before publishing:

| File in this dir | Overwrites (in the fork's `sdks/community/kotlin/library/`) | What it changes |
| --- | --- | --- |
| `settings-core-encoder.gradle.kts` | `settings.gradle.kts` | Includes only `:kotlin-core` + `:kotlin-encoder` (drops `:kotlin-client` / `:kotlin-tools`, the Android-target modules we don't need). |
| `core-jvmonly.build.gradle.kts` | `core/build.gradle.kts` | Removes the Android + iOS targets from `:kotlin-core` (drops the `com.android.library` plugin, `androidTarget{}`, the three iOS targets, and the `android{}` block). `:kotlin-core`'s single `expect/actual` (`Platform`) is satisfied by `jvmMain`, so JVM output is unchanged. |

`:kotlin-encoder` is already JVM-only upstream, so it needs no override.

## The publish steps (mirrored by the `e2e` workflow job)

```bash
# 1. Get the fork at the encoder branch
git clone https://github.com/andruhon/ag-ui.git _agui-fork
cd _agui-fork && git checkout feat/kotlin-encoder-server-integrations
cd sdks/community/kotlin/library

# 2. Apply the JVM-only overrides
cp <repo>/.github/mavenlocal/core-jvmonly.build.gradle.kts core/build.gradle.kts
cp <repo>/.github/mavenlocal/settings-core-encoder.gradle.kts settings.gradle.kts

# 3. Publish JVM-only to ~/.m2 (needs JDK 21 — bytecode is JVM 21; JDK 17 can't load it)
JAVA_HOME=<jdk21> ./gradlew :kotlin-core:publishToMavenLocal :kotlin-encoder:publishToMavenLocal --no-daemon
```

Lands `com.ag-ui.community:{kotlin-core-jvm, kotlin-encoder-jvm}:0.4.1` in `~/.m2/repository/`.
Gradle module metadata resolves the `-jvm` variant from the plain `kotlin-core` / `kotlin-encoder`
coordinate the examples request, so no `-jvm` suffix is needed in the consumer build files.

Verified 2026-07-12: this recipe builds green on JDK 21 with no Android SDK
(`BUILD SUCCESSFUL`, both `publishToMavenLocal` tasks).
