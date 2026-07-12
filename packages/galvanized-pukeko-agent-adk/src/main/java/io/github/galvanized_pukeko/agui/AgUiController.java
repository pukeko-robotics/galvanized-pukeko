package io.github.galvanized_pukeko.agui;

import com.agui.core.types.AgUiJsonKt;
import com.agui.core.types.RunAgentInput;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * AG-UI endpoint. Wire: {@code POST /agents/{agentId}/run} → {@code text/event-stream}.
 *
 * <p>The body is read as a raw String and decoded to {@link RunAgentInput} with the SDK's
 * {@code AgUiJson} (kotlinx-serialization), <em>not</em> Spring's Jackson — the AG-UI types are
 * kotlinx {@code @Serializable} data classes with a custom {@code UserMessage} serializer and a
 * {@code "type"}/{@code "role"} class discriminator that Jackson does not understand. Decoding
 * before opening the stream means a malformed body fails fast as {@code 400} instead of aborting a
 * half-open SSE response.
 */
@RestController
public class AgUiController {

    private static final Logger log = LoggerFactory.getLogger(AgUiController.class);

    private final AgUiAgentRunner agentRunner;

    public AgUiController(AgUiAgentRunner agentRunner) {
        this.agentRunner = agentRunner;
    }

    @PostMapping(value = "/agents/{agentId}/run", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter runAgent(
        @PathVariable String agentId,
        @RequestHeader(value = "Accept", required = false) String accept,
        HttpServletRequest request
    ) {
        // Read the raw request body straight off the servlet input stream rather than binding it with
        // {@code @RequestBody String}: AG-UI clients POST {@code application/json}, for which Spring
        // selects the Jackson converter and tries to deserialize the JSON object into a String — which
        // fails ("cannot deserialize String from Object value") before the handler even runs. Reading
        // the stream ourselves keeps the raw text for kotlinx {@code AgUiJson} to decode, as intended.
        String body;
        try {
            body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.warn("Could not read AG-UI request body for agent {}: {}", agentId, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Could not read AG-UI request body", e);
        }

        RunAgentInput input;
        try {
            // AgUiJson is a Kotlin top-level `val`, exposed to Java as AgUiJsonKt.getAgUiJson().
            // decodeFromString(deserializer, string) is a member of kotlinx StringFormat, so it is
            // callable from Java; the serializer comes from the generated companion.
            input = AgUiJsonKt.getAgUiJson()
                .decodeFromString(RunAgentInput.Companion.serializer(), body);
        } catch (RuntimeException e) {
            log.warn("Rejecting malformed AG-UI request body for agent {}: {}", agentId, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Malformed AG-UI request body", e);
        }

        log.info("AG-UI run request for agent: {}, threadId: {}", agentId, input.getThreadId());
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        agentRunner.run(input, emitter, accept);
        return emitter;
    }
}
