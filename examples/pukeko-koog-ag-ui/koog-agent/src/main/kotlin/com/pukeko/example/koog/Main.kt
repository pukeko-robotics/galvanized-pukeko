package com.pukeko.example.koog

import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import io.ktor.server.application.Application
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.flow.Flow

/**
 * Installs the health probe + the AG-UI endpoint. Parameterised on the [agent] seam so
 * the test can drive a deterministic stub through the exact same encoder wire, while
 * production wires the real [koogAgent].
 */
fun Application.aguiModule(agent: (RunAgentInput) -> Flow<BaseEvent> = ::koogAgent) {
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
