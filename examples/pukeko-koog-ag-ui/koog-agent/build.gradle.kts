plugins {
    // Match Koog 1.0.0's build Kotlin so its metadata + inline APIs resolve cleanly.
    kotlin("jvm") version "2.2.20"
    // Needed for reified serializer<T>() resolution at our AgUiJson call sites.
    kotlin("plugin.serialization") version "2.2.20"
    application
}

// Ktor SERVER is aligned to the ktor CLIENT version Koog 1.0.0 drags in
// (io.ktor:ktor-client-core:3.3.3). Keeping one ktor train across client+server
// avoids a split ktor-io / ktor-utils on the classpath. See ENCODER FINDINGS / the
// ktor-clash note in the README.
val ktorVersion = "3.3.3"
val coroutinesVersion = "1.10.2"
val serializationVersion = "1.9.0"
val koogVersion = "1.0.0"

dependencies {
    // AG-UI SDK from mavenLocal. Gradle module metadata resolves the JVM variant of
    // these KMP modules for a plain kotlin("jvm") consumer. We depend on the encoder
    // (the thing under validation) plus core; there is deliberately NO server module.
    implementation("com.ag-ui.community:kotlin-core:0.4.1")
    implementation("com.ag-ui.community:kotlin-encoder:0.4.1")

    // kotlin-core exposes kotlinx-serialization-json only as `implementation`, so a
    // consumer that calls AgUiJson (decode/encode) must depend on it directly.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:$serializationVersion")

    // Ktor server (the web framework half of the "encoder + framework" recipe).
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-cio:$ktorVersion")
    // CORS: the AG-UI web client runs cross-origin (browser :5555 -> server :3000),
    // so the server must answer the preflight. Mirrors the gaunt-sloth AG-UI server.
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:$coroutinesVersion")
    implementation("ch.qos.logback:logback-classic:1.5.13")

    // Koog agent framework (the real streaming-token source behind koogAgent).
    implementation("ai.koog:koog-agents:$koogVersion")
    // Koog's Google (Gemini) client. koog-agents 1.0.0 bundles the openai/ollama/anthropic
    // clients but NOT the google one, and the google client has no stable 1.0.0 on Maven Central
    // (latest is 1.0.0-beta-preview7). Gradle resolves its transitive koog-core deps UP to the
    // 1.0.0 the rest of the stack pins (a release outranks a -preview qualifier), so the classpath
    // keeps a single koog core version. Gives GoogleLLMClient / GoogleModels for the "google" branch.
    implementation("ai.koog:prompt-executor-google-client:1.0.0-beta-preview7")

    testImplementation(kotlin("test"))
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
}

application {
    mainClass.set("com.pukeko.example.koog.MainKt")
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}
