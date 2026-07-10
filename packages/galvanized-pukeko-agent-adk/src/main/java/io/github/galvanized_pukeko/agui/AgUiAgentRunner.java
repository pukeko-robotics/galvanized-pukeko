package io.github.galvanized_pukeko.agui;

import com.agui.core.types.RunAgentInput;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Thin seam between the AG-UI HTTP controller and whatever actually drives a run.
 *
 * <p>An implementation consumes a decoded {@link RunAgentInput}, streams AG-UI events onto the
 * supplied {@link SseEmitter} (framing each with {@code EventEncoder.encodeToJson(...)}), and
 * completes/aborts the emitter when the run ends. This mirrors the Ktor/Spring
 * {@code (RunAgentInput) -> Flow<BaseEvent>} agent seam from the BE-3 {@code server-starter},
 * adapted to Spring MVC's push-style {@code SseEmitter}. Keeping it an interface lets the wire
 * (controller + encoder + emitter framing) be tested without standing up the ADK {@code Runner}.
 *
 * @see AdkLocalAgent the production implementation that drives the Google ADK {@code Runner}
 */
@FunctionalInterface
public interface AgUiAgentRunner {

    /**
     * Streams the events for one run onto {@code emitter}.
     *
     * @param input  the decoded AG-UI request body
     * @param emitter the SSE sink to push framed events onto; the implementation owns completing it
     * @param accept  the client's {@code Accept} header (or {@code null}); selects the encoder mode
     */
    void run(RunAgentInput input, SseEmitter emitter, String accept);
}
