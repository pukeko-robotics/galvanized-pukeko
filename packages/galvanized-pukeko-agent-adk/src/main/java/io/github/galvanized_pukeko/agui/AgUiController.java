package io.github.galvanized_pukeko.agui;

import com.agui.core.types.AgUiJsonKt;
import com.agui.core.types.RunAgentInput;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

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
        @RequestBody String body
    ) {
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
