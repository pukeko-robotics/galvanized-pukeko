package io.github.galvanized_pukeko.agui;

import com.agui.core.types.AgUiJsonKt;
import com.agui.core.types.BaseEvent;
import com.agui.core.types.RunAgentInput;
import com.agui.core.types.RunFinishedEvent;
import com.agui.core.types.RunStartedEvent;
import com.agui.core.types.TextMessageContentEvent;
import com.agui.core.types.TextMessageEndEvent;
import com.agui.core.types.TextMessageStartEvent;
import com.agui.encoder.EventEncoder;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Wire proof for the vendored → published-encoder swap. Drives the real {@link AgUiController}
 * through {@code MockMvc}, capturing the actual SSE bytes Spring's {@code SseEmitter} produces, then
 * decodes every frame back through {@code AgUiJson}. The controller's body-decode path (real
 * {@code RunAgentInput} JSON) and the {@link EventEncoder#encodeToJson} + emitter framing path are
 * both exercised. Proves the emitted sequence is spec-equivalent to the pre-swap wire (canonical
 * {@code data: {json}\n\n} frames, no double-framing, decodable by an {@code @ag-ui/client}-style
 * SSE parser). The ADK {@code Runner} is not involved — a stub {@link AgUiAgentRunner} emits a
 * canonical RUN_STARTED → TEXT_MESSAGE_* → RUN_FINISHED sequence through the real encoder.
 */
class AgUiWireTest {

    // A real AG-UI request body, as the web client (@ag-ui/client) POSTs it.
    private static final String REQUEST_BODY = """
        {
          "threadId": "thread-1",
          "runId": "run-1",
          "state": {},
          "messages": [
            { "id": "m1", "role": "user", "content": "Hello ADK" }
          ],
          "tools": [],
          "context": [],
          "forwardedProps": {}
        }
        """;

    @Test
    void controllerDecodesInputAndStreamsSpecEquivalentSseFrames() throws Exception {
        // Stub the run seam: emit a canonical event sequence through the REAL encoder + emitter.
        AgUiAgentRunner stub = (input, emitter, accept) -> {
            // The controller must have decoded the body into a real RunAgentInput.
            assertEquals("thread-1", input.getThreadId());
            assertEquals("run-1", input.getRunId());
            assertEquals(1, input.getMessages().size());

            EventEncoder encoder = new EventEncoder(accept);
            String messageId = "msg-1";
            try {
                send(emitter, encoder, new RunStartedEvent("thread-1", "run-1", null, null));
                send(emitter, encoder,
                    new TextMessageStartEvent(messageId, com.agui.core.types.Role.ASSISTANT, null, null));
                send(emitter, encoder, new TextMessageContentEvent(messageId, "Hello", null, null));
                send(emitter, encoder, new TextMessageContentEvent(messageId, " there", null, null));
                send(emitter, encoder, new TextMessageEndEvent(messageId, null, null));
                send(emitter, encoder,
                    new RunFinishedEvent("thread-1", "run-1", null, null, null, null));
                emitter.complete();
            } catch (IOException e) {
                emitter.completeWithError(e);
            }
        };

        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new AgUiController(stub)).build();

        // POST, then async-dispatch to flush the buffered SSE frames.
        MvcResult started = mockMvc.perform(post("/agents/pukeko-ui-agent/run")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .contentType(MediaType.APPLICATION_JSON)
                .content(REQUEST_BODY))
            .andExpect(request().asyncStarted())
            .andReturn();

        MvcResult finished = mockMvc.perform(asyncDispatch(started))
            .andExpect(status().isOk())
            .andReturn();

        String sse = finished.getResponse().getContentAsString();
        System.out.println("=== CAPTURED SSE WIRE ===");
        System.out.println(sse);
        System.out.println("=== END SSE WIRE ===");

        // Each SSE frame is `data:{json}\n\n`. Split on the blank-line terminator, strip the `data:`
        // prefix (a compliant @ag-ui/client parser strips one optional leading space too), decode
        // each JSON body back through AgUiJson to prove it is valid, typed AG-UI wire.
        List<BaseEvent> decoded = new ArrayList<>();
        for (String frame : sse.split("\n\n")) {
            String trimmed = frame.strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            assertTrue(trimmed.startsWith("data:"), "SSE frame must start with data:  -> " + trimmed);
            String json = trimmed.substring("data:".length()).strip();
            // No double-framing: the body is a single JSON object, not another `data:` line.
            assertFalse(json.startsWith("data:"), "double-framed! -> " + trimmed);
            BaseEvent event = AgUiJsonKt.getAgUiJson()
                .decodeFromString(BaseEvent.Companion.serializer(), json);
            decoded.add(event);
        }

        // Spec-equivalent ordered sequence.
        List<String> types = decoded.stream().map(e -> e.getEventType().name()).toList();
        assertEquals(List.of(
            "RUN_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "RUN_FINISHED"
        ), types);

        // Content survives the round trip.
        RunStartedEvent rs = (RunStartedEvent) decoded.get(0);
        assertEquals("thread-1", rs.getThreadId());
        assertEquals("run-1", rs.getRunId());
        TextMessageContentEvent c0 = (TextMessageContentEvent) decoded.get(2);
        assertEquals("Hello", c0.getDelta());
        assertEquals("msg-1", c0.getMessageId());
    }

    @Test
    void malformedBodyIsRejectedBeforeStreamOpens() throws Exception {
        AgUiAgentRunner neverCalled = (input, emitter, accept) -> {
            throw new AssertionError("runner must not be called for a malformed body");
        };
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new AgUiController(neverCalled)).build();

        mockMvc.perform(post("/agents/pukeko-ui-agent/run")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{ this is not valid json "))
            .andExpect(status().isBadRequest());
    }

    private static void send(
        org.springframework.web.servlet.mvc.method.annotation.SseEmitter emitter,
        EventEncoder encoder,
        BaseEvent event
    ) throws IOException {
        emitter.send(org.springframework.web.servlet.mvc.method.annotation.SseEmitter.event()
            .data(encoder.encodeToJson(event)).build());
    }
}
