package io.github.galvanized_pukeko.agui;

import com.agui.core.types.AgUiJsonKt;
import com.agui.core.types.BaseEvent;
import com.agui.core.types.RunAgentInput;
import com.agui.core.types.ToolCallResultEvent;
import com.google.adk.agents.RunConfig;
import com.google.adk.events.Event;
import com.google.adk.runner.Runner;
import com.google.genai.types.Content;
import com.google.genai.types.Part;
import io.reactivex.rxjava3.core.Flowable;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * BE-5 wire proof: the ADK {@code show_a2ui_surface} tool result must reach the client as the raw
 * A2UI surface JSONL, NOT a Java {@code Map.toString()} ({@code {surfaceJsonl=..., status=...}}).
 *
 * <p>Two levels of proof:
 * <ul>
 *   <li><b>Seam</b>, {@link AdkLocalAgent#toolResultContent(Object)} directly: the exact
 *       serialization that was broken. Deterministic, no genai/ADK/servlet machinery.</li>
 *   <li><b>Wire</b>, drives the REAL {@link AdkLocalAgent#drive} against a mocked ADK
 *       {@link Runner} through the REAL {@link EventEncoder} + {@code SseEmitter}, captures the actual
 *       SSE bytes, decodes them back through {@code AgUiJson}, and asserts the {@code TOOL_CALL_RESULT}
 *       frame carries the raw JSONL. {@code AdkLocalAgent} runs the ADK loop on a worker thread and
 *       {@code SseEmitter} buffers sends in {@code earlySendAttempts} until Spring MVC initializes it
 *       with a handler; the test never wires a servlet, so it polls the emitter's {@code complete}
 *       flag and then reads those buffered frames by reflection, the raw bytes the client would
 *       receive, no {@code MockMvc}/servlet needed.</li>
 * </ul>
 */
class AdkLocalAgentA2uiWireTest {

    /** A minimal but valid A2UI surface (concatenated JSON objects), as the model produces it. */
    private static final String SURFACE_JSONL =
        "{\"surfaceUpdate\":{\"surfaceId\":\"@default\",\"components\":["
        + "{\"id\":\"root\",\"component\":{\"Column\":{\"children\":{\"explicitList\":[\"title\"]}}}},"
        + "{\"id\":\"title\",\"component\":{\"Text\":{\"text\":{\"literalString\":\"Contact form\"}}}}"
        + "]}}"
        + "{\"beginRendering\":{\"surfaceId\":\"@default\",\"root\":\"root\"}}";

    private static final String REQUEST_BODY = """
        {
          "threadId": "thread-1",
          "runId": "run-1",
          "state": {},
          "messages": [
            { "id": "m1", "role": "user", "content": "Show me a contact form" }
          ],
          "tools": [],
          "context": [],
          "forwardedProps": {}
        }
        """;

    // ---- Seam: the exact transformation that was broken -----------------------------------------

    @Test
    void toolResultContentUnwrapsSurfaceJsonlVerbatim() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "surface_rendered");
        response.put("surfaceJsonl", SURFACE_JSONL);

        String content = AdkLocalAgent.toolResultContent(response);

        // The client's parseA2UIJsonl consumes exactly this, so it must BE the surface, verbatim.
        assertEquals(SURFACE_JSONL, content);
        // Not the Java Map.toString() {k=v} form that broke the client.
        assertFalse(content.contains("surfaceJsonl="), "must not leak Map.toString() form");
        assertFalse(content.contains("status=surface_rendered"), "must not leak the wrapper map");
    }

    @Test
    void toolResultContentSerializesOtherToolsAsJsonNotMapToString() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "ok");
        response.put("count", 2);

        String content = AdkLocalAgent.toolResultContent(response);

        // Valid JSON, not {status=ok, count=2}.
        assertTrue(content.startsWith("{") && content.contains("\"status\":\"ok\""),
            "generic tool result must be JSON: " + content);
        assertFalse(content.contains("status=ok"), "must not be Java Map.toString()");
    }

    @Test
    void toolResultContentHandlesNull() {
        assertEquals("", AdkLocalAgent.toolResultContent(null));
    }

    // ---- Wire: real AdkLocalAgent.drive() through the real controller + encoder ------------------

    @Test
    void a2uiSurfaceIsEmittedAsToolCallResultCarryingRawJsonl() throws Exception {
        // Mock the ADK Runner to emit a single event whose Part is the show_a2ui_surface tool
        // response, the map AdkLocalAgent must translate into a TOOL_CALL_RESULT.
        Map<String, Object> toolResponse = new LinkedHashMap<>();
        toolResponse.put("status", "surface_rendered");
        toolResponse.put("surfaceJsonl", SURFACE_JSONL);

        Content content = Content.fromParts(
            Part.fromFunctionResponse("show_a2ui_surface", toolResponse));
        Event toolEvent = Event.builder()
            .id(Event.generateEventId())
            .author("pukeko-ui-agent")
            .content(content)
            .build();

        Runner runner = mock(Runner.class);
        when(runner.runAsync(anyString(), anyString(), any(Content.class), any(RunConfig.class)))
            .thenReturn(Flowable.just(toolEvent));

        AdkLocalAgent adk = new AdkLocalAgent("pukeko-ui-agent", runner);

        // Decode the request exactly as AgUiController does, then drive the real run on its worker
        // thread against a plain SseEmitter (never initialized by a servlet, so sends buffer).
        RunAgentInput input = AgUiJsonKt.getAgUiJson()
            .decodeFromString(RunAgentInput.Companion.serializer(), REQUEST_BODY);
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        adk.run(input, emitter, "text/event-stream");

        awaitComplete(emitter, 30_000);

        String sse = drainBufferedFrames(emitter);
        System.out.println("=== CAPTURED A2UI SSE WIRE ===");
        System.out.println(sse);
        System.out.println("=== END A2UI SSE WIRE ===");

        // Decode every frame back through AgUiJson.
        List<BaseEvent> decoded = new ArrayList<>();
        for (String frame : sse.split("\n\n")) {
            String trimmed = frame.strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            assertTrue(trimmed.startsWith("data:"), "SSE frame must start with data: -> " + trimmed);
            String json = trimmed.substring("data:".length()).strip();
            decoded.add(AgUiJsonKt.getAgUiJson()
                .decodeFromString(BaseEvent.Companion.serializer(), json));
        }

        // The surface must arrive as a TOOL_CALL_RESULT carrying the raw JSONL.
        ToolCallResultEvent result = decoded.stream()
            .filter(e -> e instanceof ToolCallResultEvent)
            .map(e -> (ToolCallResultEvent) e)
            .findFirst()
            .orElse(null);
        assertNotNull(result, "expected a TOOL_CALL_RESULT event on the wire");
        assertEquals(SURFACE_JSONL, result.getContent(),
            "TOOL_CALL_RESULT content must be the raw A2UI surface JSONL");
        assertFalse(result.getContent().contains("surfaceJsonl="),
            "must NOT be the Java Map.toString() form that broke the client");

        // Sanity: the run was well-formed (started + finished around the result).
        List<String> types = decoded.stream().map(e -> e.getEventType().name()).toList();
        assertTrue(types.contains("RUN_STARTED"), types.toString());
        assertTrue(types.contains("RUN_FINISHED"), types.toString());
    }

    /** Spin until the emitter's private {@code complete} flag flips (run finished) or we time out. */
    private static void awaitComplete(SseEmitter emitter, long timeoutMillis) throws Exception {
        Field completeField = ResponseBodyEmitter.class.getDeclaredField("complete");
        completeField.setAccessible(true);
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            if (Boolean.TRUE.equals(completeField.get(emitter))) {
                return;
            }
            Thread.sleep(25);
        }
        throw new AssertionError("AG-UI run did not complete within " + timeoutMillis + "ms");
    }

    /**
     * Reconstruct the raw SSE bytes from the emitter's buffered {@code earlySendAttempts}. Because the
     * emitter is never initialized with a servlet handler, every {@code send()} lands there as ordered
     * {@code DataWithMediaType} chunks; joining their data yields the exact {@code data:{json}\n\n}
     * stream the client would receive.
     */
    private static String drainBufferedFrames(SseEmitter emitter) throws Exception {
        Field attemptsField = ResponseBodyEmitter.class.getDeclaredField("earlySendAttempts");
        attemptsField.setAccessible(true);
        StringBuilder sb = new StringBuilder();
        Method getData = null;
        synchronized (emitter) {
            Set<?> attempts = (Set<?>) attemptsField.get(emitter);
            for (Object chunk : attempts) {
                if (getData == null) {
                    getData = chunk.getClass().getMethod("getData");
                    getData.setAccessible(true);
                }
                sb.append(getData.invoke(chunk));
            }
        }
        return sb.toString();
    }
}
