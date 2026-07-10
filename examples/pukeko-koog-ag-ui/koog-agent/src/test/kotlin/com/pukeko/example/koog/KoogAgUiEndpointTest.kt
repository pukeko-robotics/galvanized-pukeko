package com.pukeko.example.koog

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.Role
import com.agui.core.types.RunAgentInput
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.TextMessageContentEvent
import com.agui.core.types.TextMessageEndEvent
import com.agui.core.types.TextMessageStartEvent
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.encodeToString
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Round-trips the AG-UI SSE wire produced by [EventEncoder] through a real ktor server,
 * using a deterministic stub agent (no live LLM) so the framing + event ordering are
 * asserted hermetically. A separate live `curl` against [koogAgent] (see the README /
 * report) proves the Koog streaming integration end-to-end.
 */
class KoogAgUiEndpointTest {

    /** A Koog-shaped stub: same lifecycle koogAgent emits, minus the network call. */
    private fun stubAgent(input: RunAgentInput): Flow<BaseEvent> = flow {
        emit(RunStartedEvent(threadId = input.threadId, runId = input.runId))
        val messageId = UUID.randomUUID().toString()
        emit(TextMessageStartEvent(messageId = messageId, role = Role.ASSISTANT))
        emit(TextMessageContentEvent(messageId = messageId, delta = "Hello"))
        emit(TextMessageContentEvent(messageId = messageId, delta = ", world!"))
        emit(TextMessageEndEvent(messageId = messageId))
        emit(RunFinishedEvent(threadId = input.threadId, runId = input.runId))
    }

    /** Split an SSE body into decoded events, asserting canonical `data: {json}\n\n` framing. */
    private fun parseFrames(body: String): List<BaseEvent> =
        body.split("\n\n")
            .filter { it.isNotBlank() }
            .map { frame ->
                assertTrue(frame.startsWith("data: "), "frame must start with 'data: ': <$frame>")
                AgUiJson.decodeFromString<BaseEvent>(frame.removePrefix("data: "))
            }

    @Test
    fun koogStreamProducesCanonicalSseSequence() = testApplication {
        application { aguiModule(agent = ::stubAgent) }

        val input = RunAgentInput(threadId = "t1", runId = "r1")
        val response = client.post("/agents/default/run") {
            contentType(ContentType.Application.Json)
            setBody(AgUiJson.encodeToString(input))
        }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(
            ContentType.Text.EventStream,
            response.headers["Content-Type"]?.let { ContentType.parse(it) },
        )

        val body = response.bodyAsText()
        assertTrue(body.endsWith("\n\n"), "SSE body must end with a blank line")

        val events = parseFrames(body)
        // RUN_STARTED -> TEXT_MESSAGE_START -> CONTENT(2) -> END -> RUN_FINISHED
        assertEquals(6, events.size, "expected the ordered run/message lifecycle")
        assertTrue(events[0] is RunStartedEvent, "first event is RUN_STARTED")
        assertTrue(events[1] is TextMessageStartEvent, "then TEXT_MESSAGE_START")
        assertTrue(events[2] is TextMessageContentEvent, "then TEXT_MESSAGE_CONTENT")
        assertTrue(events[3] is TextMessageContentEvent, "content continues")
        assertTrue(events[4] is TextMessageEndEvent, "then TEXT_MESSAGE_END")
        assertTrue(events[5] is RunFinishedEvent, "finally RUN_FINISHED")

        val reassembled = events.filterIsInstance<TextMessageContentEvent>()
            .joinToString("") { it.delta }
        assertEquals("Hello, world!", reassembled)

        val started = events[0] as RunStartedEvent
        assertEquals("t1", started.threadId)
        assertEquals("r1", started.runId)

        // START and END must reference the same messageId (matched-pair invariant).
        val startId = (events[1] as TextMessageStartEvent).messageId
        val endId = (events[4] as TextMessageEndEvent).messageId
        assertEquals(startId, endId, "START and END messageIds must match")
    }

    @Test
    fun malformedBodyReturns4xx() = testApplication {
        application { aguiModule(agent = ::stubAgent) }

        val response = client.post("/agents/default/run") {
            contentType(ContentType.Application.Json)
            setBody("{ this is not valid json")
        }

        assertTrue(response.status.value in 400..499, "expected 4xx, got ${response.status}")
    }
}
