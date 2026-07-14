package io.github.galvanized_pukeko.agui;

import com.agui.core.types.AgUiJsonKt;
import com.agui.core.types.BaseEvent;

/**
 * Vendored (Java reimpl) of the ag-ui {@code :kotlin-encoder} {@code EventEncoder} (BE-7). Swap for
 * {@code com.ag-ui.community:kotlin-encoder} when BE-3's upstream PR publishes.
 *
 * <p>Encodes AG-UI {@link BaseEvent}s to the wire form. Mirrors the TypeScript
 * ({@code @ag-ui/encoder}) and Python ({@code ag_ui.encoder}) {@code EventEncoder}: construct per
 * request with the client's {@code Accept} header, then {@link #encode(BaseEvent)} each event.
 * SSE only for now (no Kotlin proto codec yet).
 *
 * <p>Serialization goes through the same proven Java&harr;kotlinx idiom already used in this module
 * (see {@code AgUiController} decode side + {@code AgUiWireTest}): the {@code AgUiJson} top-level
 * Kotlin {@code val} is reached from Java as {@code AgUiJsonKt.getAgUiJson()}, and the polymorphic
 * {@link BaseEvent} is serialized with its generated {@code BaseEvent.Companion.serializer()}.
 */
public final class EventEncoder {

    public static final String SSE_CONTENT_TYPE = "text/event-stream";
    public static final String AGUI_MEDIA_TYPE = "application/vnd.ag-ui.event+proto";

    private final String accept;

    public EventEncoder(String accept) {
        this.accept = accept;
    }

    /** Always SSE for now (no Kotlin proto codec yet). */
    public String getContentType() {
        return SSE_CONTENT_TYPE;
    }

    /** Mirrors TS/Python {@code encode()}. */
    public String encode(BaseEvent event) {
        return encodeSSE(event);
    }

    /** Canonical SSE framing: {@code data: {json}\n\n}. */
    public String encodeSSE(BaseEvent event) {
        return "data: " + encodeToJson(event) + "\n\n";
    }

    /**
     * The JSON wire body for {@code event}, with <b>no</b> SSE framing. Use from transports that add
     * their own framing (Spring MVC's {@code SseEmitter}, which prefixes {@code data:} and appends the
     * blank line) — pairing those with {@link #encode(BaseEvent)} would double-frame the stream.
     */
    public String encodeToJson(BaseEvent event) {
        return AgUiJsonKt.getAgUiJson().encodeToString(BaseEvent.Companion.serializer(), event);
    }
}
