package com.pukeko.example.koog

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.encoder.EventEncoder
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.utils.io.writeStringUtf8
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString

/**
 * Reusable AG-UI POST endpoint. This is the whole "server" recipe, copied verbatim
 * (only the package renamed) from the AG-UI Kotlin server-starter reference: decode a
 * [RunAgentInput], build a per-request [EventEncoder] from the client's `Accept`
 * header, then stream `encoder.encode(event)` for each [BaseEvent] the agent emits.
 *
 * It mirrors the Python/TypeScript example servers (a `StreamingResponse` +
 * `encoder.encode`) — no EventFactory, no AbstractServerAgent, no server-side event
 * verification. The single seam is [agent], where a real streaming agent (here, Koog)
 * plugs in.
 *
 * @param path route pattern (default mirrors the AG-UI convention `/agents/{agentId}/run`)
 * @param agent maps a decoded [RunAgentInput] to a cold [Flow] of events
 */
fun Route.aguiEndpoint(
    path: String = "/agents/{agentId}/run",
    agent: (RunAgentInput) -> Flow<BaseEvent>,
) {
    post(path) {
        // Decode BEFORE opening the response writer, so a malformed body is a clean
        // HTTP 4xx rather than a broken/half-streamed 200.
        val input = try {
            AgUiJson.decodeFromString<RunAgentInput>(call.receiveText())
        } catch (e: SerializationException) {
            call.respond(HttpStatusCode.BadRequest, "Invalid RunAgentInput: ${e.message}")
            return@post
        } catch (e: IllegalArgumentException) {
            call.respond(HttpStatusCode.BadRequest, "Invalid RunAgentInput: ${e.message}")
            return@post
        }

        val encoder = EventEncoder(call.request.headers[HttpHeaders.Accept])

        // respondBytesWriter with the encoder's content type = FastAPI's
        // StreamingResponse(media_type=encoder.get_content_type()). We do NOT use
        // ktor-server-sse's sse{} DSL: it is GET-oriented, whereas AG-UI is
        // POST-with-a-JSON-body.
        call.respondBytesWriter(ContentType.parse(encoder.getContentType())) {
            agent(input).collect { event ->
                writeStringUtf8(encoder.encode(event))
                flush()
            }
        }
    }
}
