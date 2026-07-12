package io.github.galvanized_pukeko.agui;

import com.agui.core.types.BaseEvent;
import com.agui.core.types.Message;
import com.agui.core.types.Role;
import com.agui.core.types.RunAgentInput;
import com.agui.core.types.RunErrorEvent;
import com.agui.core.types.RunFinishedEvent;
import com.agui.core.types.RunStartedEvent;
import com.agui.core.types.TextMessageContentEvent;
import com.agui.core.types.TextMessageEndEvent;
import com.agui.core.types.TextMessageStartEvent;
import com.agui.core.types.ToolCallArgsEvent;
import com.agui.core.types.ToolCallEndEvent;
import com.agui.core.types.ToolCallResultEvent;
import com.agui.core.types.ToolCallStartEvent;
import com.agui.encoder.EventEncoder;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.adk.agents.RunConfig;
import com.google.adk.events.Event;
import com.google.adk.runner.Runner;
import com.google.genai.types.Content;
import com.google.genai.types.Part;
import io.reactivex.rxjava3.core.Flowable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Drives one AG-UI run against the Google ADK {@code Runner} and streams the translated AG-UI
 * events onto a Spring MVC {@link SseEmitter}.
 *
 * <p>Events are constructed directly from the {@code com.agui.core.types.*} kotlinx data classes and
 * framed with {@link EventEncoder#encodeToJson(BaseEvent)} — the unframed JSON body — because
 * {@code SseEmitter.event().data(...)} supplies its own {@code data:} line and blank-line terminator.
 * Pairing the emitter with {@code encode()}/{@code encodeSSE()} instead would double-frame the stream.
 *
 * <p>Replaces the previous vendored {@code com.agui.server.LocalAgent}/{@code AgentStreamer}/
 * {@code EventStream} machinery: the run executes on a worker thread (so the servlet thread returns
 * the emitter immediately), pushing frames as ADK produces them.
 */
public class AdkLocalAgent implements AgUiAgentRunner {

    private static final Logger log = LoggerFactory.getLogger(AdkLocalAgent.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Dedicated pool for the blocking ADK run loop. Each run does long blocking work
     * ({@code blockingIterable()} over the LLM stream), so it must not run on the shared
     * {@code ForkJoinPool.commonPool()} (CPU-core-sized) — that would cap concurrent runs
     * and starve other pool work. Cached daemon threads scale to demand and reuse idle threads.
     */
    private static final ExecutorService RUN_EXECUTOR = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "agui-run");
        t.setDaemon(true);
        return t;
    });

    private final String agentId;
    private final Runner runner;

    public AdkLocalAgent(String agentId, Runner runner) {
        this.agentId = agentId;
        this.runner = runner;
    }

    public String getAgentId() {
        return agentId;
    }

    @Override
    public void run(RunAgentInput input, SseEmitter emitter, String accept) {
        EventEncoder encoder = new EventEncoder(accept);
        // Stop pushing frames once the client goes away (disconnect / timeout / error). Best-effort:
        // the loop checks this between ADK events and stops emitting; the demo does not forcibly
        // dispose the in-flight ADK subscription.
        AtomicBoolean active = new AtomicBoolean(true);
        emitter.onCompletion(() -> active.set(false));
        emitter.onTimeout(() -> active.set(false));
        emitter.onError(t -> active.set(false));
        RUN_EXECUTOR.execute(() -> drive(input, emitter, encoder, active));
    }

    private void drive(RunAgentInput input, SseEmitter emitter, EventEncoder encoder, AtomicBoolean active) {
        String threadId = input.getThreadId();
        String runId = input.getRunId();

        try {
            // RUN_STARTED (timestamp, rawEvent default to null).
            send(emitter, encoder, new RunStartedEvent(threadId, runId, null, null));

            // Extract the last user message text.
            String userText = "";
            if (input.getMessages() != null) {
                for (Message msg : input.getMessages()) {
                    if (msg.getMessageRole() == Role.USER && msg.getContent() != null) {
                        userText = msg.getContent();
                    }
                }
            }
            if (userText.isEmpty()) {
                throw new RuntimeException("No user message found in AG-UI request");
            }

            // Use threadId as sessionId for consistency.
            String userId = "user";
            String sessionId = threadId;

            Content userContent = Content.fromParts(Part.fromText(userText));

            RunConfig runConfig = RunConfig.builder()
                .setStreamingMode(RunConfig.StreamingMode.SSE)
                .setAutoCreateSession(true)
                .build();

            Flowable<Event> adkEvents = runner.runAsync(userId, sessionId, userContent, runConfig);

            // Translate ADK events to AG-UI events.
            String messageId = UUID.randomUUID().toString();
            boolean messageStarted = false;

            for (Event adkEvent : adkEvents.blockingIterable()) {
                if (!active.get()) {
                    // Client disconnected — stop translating/emitting.
                    return;
                }
                if (adkEvent.content().isEmpty()) {
                    continue;
                }
                Content content = adkEvent.content().get();
                if (content.parts().isEmpty()) {
                    continue;
                }
                for (Part part : content.parts().get()) {
                    // Text parts from the model.
                    if (part.text().isPresent() && !part.text().get().isEmpty()) {
                        String text = part.text().get();
                        String author = adkEvent.author();

                        // Only emit text from model/agent responses, not user echoes. Also skip the
                        // final consolidated ADK event (partial absent) — it duplicates the streamed
                        // chunks already emitted.
                        if (author != null && !author.equals("user") && adkEvent.partial().isPresent()) {
                            if (!messageStarted) {
                                send(emitter, encoder,
                                    new TextMessageStartEvent(messageId, Role.ASSISTANT, null, null));
                                messageStarted = true;
                            }
                            send(emitter, encoder,
                                new TextMessageContentEvent(messageId, text, null, null));
                        }
                    }

                    // Function calls (tool invocations).
                    if (part.functionCall().isPresent()) {
                        var fc = part.functionCall().get();
                        String toolCallId = fc.id().orElse(UUID.randomUUID().toString());

                        send(emitter, encoder, new ToolCallStartEvent(
                            toolCallId, fc.name().orElse("unknown"), messageId, null, null));

                        if (fc.args().isPresent()) {
                            String delta;
                            try {
                                delta = objectMapper.writeValueAsString(fc.args().get());
                            } catch (Exception e) {
                                delta = fc.args().get().toString();
                            }
                            send(emitter, encoder, new ToolCallArgsEvent(toolCallId, delta, null, null));
                        }

                        send(emitter, encoder, new ToolCallEndEvent(toolCallId, null, null));
                    }

                    // Function responses (tool results).
                    if (part.functionResponse().isPresent()) {
                        var fr = part.functionResponse().get();
                        String toolCallId = fr.id().orElse(UUID.randomUUID().toString());
                        String resultContent = fr.response().isPresent() ? fr.response().get().toString() : "";
                        send(emitter, encoder, new ToolCallResultEvent(
                            messageId, toolCallId, resultContent, null, null, null));
                    }
                }
            }

            if (messageStarted) {
                send(emitter, encoder, new TextMessageEndEvent(messageId, null, null));
            }

            // RUN_FINISHED (result, outcome, timestamp, rawEvent default to null).
            send(emitter, encoder, new RunFinishedEvent(threadId, runId, null, null, null, null));
            emitter.complete();

        } catch (Exception e) {
            log.error("Error during AG-UI agent run", e);
            // RunErrorEvent.message is non-nullable in kotlin-core; many exceptions (bare NPEs,
            // some ADK/runtime errors) have a null message, so coalesce to the class name — else
            // the RunErrorEvent constructor itself NPEs and the client gets no terminal frame.
            String message = e.getMessage() != null ? e.getMessage() : e.getClass().getName();
            try {
                send(emitter, encoder, new RunErrorEvent(message, null, null, null));
            } catch (Exception sendFailure) {
                log.debug("Could not emit RUN_ERROR (client likely gone): {}", sendFailure.getMessage());
            }
            emitter.completeWithError(e);
        }
    }

    /**
     * Frames one event as the unframed JSON body and lets {@code SseEmitter} add the {@code data:} line.
     *
     * <p>The {@code TEXT_PLAIN} media type is required: {@code encodeToJson} already returns a JSON
     * String, and {@code SseEmitter.event().data(String)} with the default (null) media type lets
     * Spring pick the Jackson converter, which re-serializes the String — emitting a double-encoded
     * {@code data:"{\"type\":...}"} that an {@code @ag-ui/client} SSE parser rejects with a ZodError.
     * Forcing {@code text/plain} selects {@code StringHttpMessageConverter}, writing the raw JSON as
     * {@code data:{"type":...}} — the canonical AG-UI frame the vue web client expects.
     */
    private void send(SseEmitter emitter, EventEncoder encoder, BaseEvent event) throws IOException {
        emitter.send(SseEmitter.event().data(encoder.encodeToJson(event), MediaType.TEXT_PLAIN).build());
    }
}
