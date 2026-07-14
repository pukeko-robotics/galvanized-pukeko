# mavenLocal core recipe (temporary)

The Koog e2e example (`examples/pukeko-koog-ag-ui/koog-agent`) and the ADK agent
build against the AG-UI Kotlin **core types**:

```kotlin
implementation("com.ag-ui.community:kotlin-core:0.4.1")
```

> **NOTE (BE-7):** The AG-UI `EventEncoder` used to be pulled from a second module,
> `:kotlin-encoder`, built to mavenLocal alongside core. It is a trivial ~48-line wrapper
> over `kotlin-core`, so it is now **vendored** into each consumer instead — Koog copies
> `EventEncoder.kt` into `com.pukeko.example.koog`, and the ADK package has a Java reimpl at
> `io.github.galvanized_pukeko.agui.EventEncoder`. This recipe therefore builds **kotlin-core
> only**. When BE-3's upstream encoder PR publishes, swap the vendored copies back to
> `com.ag-ui.community:kotlin-encoder`.

The `:kotlin-core` module is **not on Maven Central yet** — it lives on the fork
`andruhon/ag-ui` @ `feat/kotlin-encoder-server-integrations` and is part of the
upstream work tracked by **BE-3**. Until it is published to Maven Central, CI (and local
dev) build it to **mavenLocal** from the fork.

> **TEMPORARY — remove once BE-3's upstream PR lands.** When
> `com.ag-ui.community:kotlin-core` is on Maven Central, delete this directory and
> the "Build AG-UI kotlin-core to mavenLocal" step in `.github/workflows/release.yml`;
> `mavenCentral()` alone will then resolve the dependency. (The vendored encoder copies
> can also be swapped back to `:kotlin-encoder` at that point.)

## Why two override files (the no-Android shortcut)

A full `publishToMavenLocal` of the SDK needs an **Android SDK** on the runner, because
`:kotlin-core` (and `:kotlin-client`) declare an `androidTarget()`. JVM consumers only
need the `-jvm` artifacts, so we publish **JVM-only** with no Android SDK by swapping in
two files before publishing:

| File in this dir | Overwrites (in the fork's `sdks/community/kotlin/library/`) | What it changes |
| --- | --- | --- |
| `settings-core-encoder.gradle.kts` | `settings.gradle.kts` | Includes only `:kotlin-core` (drops `:kotlin-client` / `:kotlin-tools`, the Android-target modules we don't need; `:kotlin-encoder` is no longer built — vendored per BE-7). Filename kept so `release.yml`'s `cp` still resolves. |
| `core-jvmonly.build.gradle.kts` | `core/build.gradle.kts` | Removes the Android + iOS targets from `:kotlin-core` (drops the `com.android.library` plugin, `androidTarget{}`, the three iOS targets, and the `android{}` block). `:kotlin-core`'s single `expect/actual` (`Platform`) is satisfied by `jvmMain`, so JVM output is unchanged. |

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
JAVA_HOME=<jdk21> ./gradlew :kotlin-core:publishToMavenLocal --no-daemon
```

Lands `com.ag-ui.community:kotlin-core-jvm:0.4.1` in `~/.m2/repository/`. Gradle module
metadata resolves the `-jvm` variant from the plain `kotlin-core` coordinate the examples
request, so no `-jvm` suffix is needed in the consumer build files.

Verified 2026-07-12: this recipe builds green on JDK 21 with no Android SDK
(`BUILD SUCCESSFUL`, `publishToMavenLocal`). Since BE-7 it publishes `:kotlin-core` only
(the encoder is vendored into the consumers).
