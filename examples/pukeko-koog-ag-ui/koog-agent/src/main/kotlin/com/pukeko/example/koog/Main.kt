package com.pukeko.example.koog

import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.flow.Flow

/**
 * Installs CORS + the health probe + the AG-UI endpoint. Parameterised on the [agent] seam
 * so the test can drive a deterministic stub through the exact same encoder wire, while
 * production wires the real [koogAgent].
 */
fun Application.aguiModule(agent: (RunAgentInput) -> Flow<BaseEvent> = ::koogAgent) {
    // The AG-UI web client is a browser app on a different origin (default
    // http://localhost:5555) POSTing to this server (:3000), so the browser sends a
    // CORS preflight the server must answer. Mirrors the gaunt-sloth AG-UI server
    // (allowOrigin / POST,GET,OPTIONS / Content-Type,Accept). Override the client host
    // (as "host:port", no scheme) with AGUI_CORS_HOST.
    install(CORS) {
        allowHost(System.getenv("AGUI_CORS_HOST") ?: "localhost:5555", schemes = listOf("http", "https"))
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Options)
        allowHeader(HttpHeaders.ContentType)
        allowHeader(HttpHeaders.Accept)
    }
    routing {
        get("/health") { call.respondText("ok") }
        aguiEndpoint(agent = agent)
    }
}

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull()
        ?: System.getenv("AGUI_PORT")?.toIntOrNull()
        ?: 3000
    embeddedServer(CIO, port = port, host = "0.0.0.0") { aguiModule() }.start(wait = true)
}
