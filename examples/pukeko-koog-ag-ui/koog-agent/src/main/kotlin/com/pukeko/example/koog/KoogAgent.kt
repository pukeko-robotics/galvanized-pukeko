package com.pukeko.example.koog

import ai.koog.prompt.dsl.prompt
import ai.koog.prompt.executor.clients.LLMClient
import ai.koog.prompt.executor.clients.google.GoogleLLMClient
import ai.koog.prompt.executor.clients.google.GoogleModels
import ai.koog.prompt.executor.clients.openai.OpenAILLMClient
import ai.koog.prompt.executor.clients.openai.OpenAIModels
import ai.koog.prompt.executor.ollama.client.OllamaClient
import ai.koog.prompt.executor.ollama.client.OllamaModels
import ai.koog.prompt.llm.LLModel
import ai.koog.prompt.streaming.StreamFrame
import com.agui.core.types.BaseEvent
import com.agui.core.types.Role
import com.agui.core.types.RunAgentInput
import com.agui.core.types.RunErrorEvent
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.TextMessageContentEvent
import com.agui.core.types.TextMessageEndEvent
import com.agui.core.types.TextMessageStartEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Bridges a Koog LLM stream into the AG-UI event lifecycle. This is the single seam
 * the copied [aguiEndpoint] calls: `(RunAgentInput) -> Flow<BaseEvent>`.
 *
 * The Koog side uses the **client-level streaming API** —
 * `LLMClient.executeStreaming(prompt, model): Flow<StreamFrame>` — mapping each
 * `StreamFrame.TextDelta` to an AG-UI `TEXT_MESSAGE_CONTENT`. See the report's
 * "deviation" note on why we go through `OpenAILLMClient`/`OllamaClient` directly
 * rather than the higher-level `AIAgent` + `simpleOpenAIExecutor` (that convenience
 * module is not published at Koog 1.0.0).
 */

private val log = LoggerFactory.getLogger("KoogAgent")

private const val SYSTEM_PROMPT =
    "You are a concise, friendly assistant embedded in the Pukeko AG-UI demo. " +
        "Answer in a few short sentences."

/** Resolve the configured LLM client + model from the environment (OpenAI default). */
private data class LlmConfig(val client: LLMClient, val model: LLModel, val label: String)

private fun resolveLlm(): LlmConfig {
    return when (System.getenv("LLM_PROVIDER")?.lowercase() ?: "openai") {
        "google" -> {
            val apiKey = System.getenv("GOOGLE_API_KEY")
                ?: error("GOOGLE_API_KEY is not set (Google AI Studio key)")
            val modelId = System.getenv("GOOGLE_MODEL") ?: "gemini-2.5-flash"
            // Start from a real Gemini chat model so streaming capabilities are set, then
            // override the id so any Gemini model name is configurable (same trick as below).
            // GoogleLLMClient talks to the Gemini Developer API (AI Studio) — no Vertex creds.
            val model = GoogleModels.Gemini2_5Flash.copy(id = modelId)
            LlmConfig(GoogleLLMClient(apiKey), model, "google:$modelId")
        }

        "ollama" -> {
            val baseUrl = System.getenv("OLLAMA_BASE_URL") ?: "http://localhost:11434"
            val modelId = System.getenv("OLLAMA_MODEL") ?: "granite4.1:3b"
            // Reuse a known Granite model's capability set, swap in the requested id.
            val model = OllamaModels.Granite.GRANITE_3_2_VISION.copy(id = modelId)
            LlmConfig(OllamaClient(baseUrl = baseUrl), model, "ollama:$modelId @ $baseUrl")
        }

        else -> {
            val apiKey = System.getenv("OPENAI_API_KEY")
                ?: error("OPENAI_API_KEY is not set (or set LLM_PROVIDER=ollama)")
            val modelId = System.getenv("OPENAI_MODEL") ?: "gpt-4o-mini"
            // Start from a real OpenAI chat model so streaming capabilities are set,
            // then override the id so any chat model name is configurable.
            val model = OpenAIModels.Chat.GPT4oMini.copy(id = modelId)
            LlmConfig(OpenAILLMClient(apiKey), model, "openai:$modelId")
        }
    }
}

// Resolved lazily on the first request (and we log the target then); a misconfiguration
// therefore surfaces as a RUN_ERROR on that first call rather than at boot.
private val llm: LlmConfig by lazy { resolveLlm().also { log.info("LLM target = {}", it.label) } }

/**
 * The real agent: RUN_STARTED -> TEXT_MESSAGE_START -> TEXT_MESSAGE_CONTENT* ->
 * TEXT_MESSAGE_END -> RUN_FINISHED, with any failure surfaced as RUN_ERROR.
 */
fun koogAgent(input: RunAgentInput): Flow<BaseEvent> = flow {
    emit(RunStartedEvent(threadId = input.threadId, runId = input.runId))

    val userText = input.messages
        .lastOrNull { it.messageRole == Role.USER }
        ?.content
        ?.takeIf { it.isNotBlank() }
        ?: "Say hello and introduce yourself in one sentence."

    val messageId = UUID.randomUUID().toString()
    try {
        emit(TextMessageStartEvent(messageId = messageId, role = Role.ASSISTANT))

        val koogPrompt = prompt("agui") {
            system(SYSTEM_PROMPT)
            user(userText)
        }

        var emittedContent = false
        llm.client.executeStreaming(koogPrompt, llm.model).collect { frame ->
            when (frame) {
                is StreamFrame.TextDelta -> {
                    // delta must be non-empty: TextMessageContentEvent require()s it.
                    if (frame.text.isNotEmpty()) {
                        emit(TextMessageContentEvent(messageId = messageId, delta = frame.text))
                        emittedContent = true
                    }
                }
                // Some providers deliver only a terminal aggregate instead of deltas;
                // emit it once so a text response always yields >= 1 content event.
                is StreamFrame.TextComplete -> {
                    if (!emittedContent && frame.text.isNotEmpty()) {
                        emit(TextMessageContentEvent(messageId = messageId, delta = frame.text))
                        emittedContent = true
                    }
                }
                else -> { /* End / ToolCall* / Reasoning* — not surfaced in this demo */ }
            }
        }

        emit(TextMessageEndEvent(messageId = messageId))
        emit(RunFinishedEvent(threadId = input.threadId, runId = input.runId))
    } catch (ce: CancellationException) {
        // Client disconnect / stream cancellation: propagate so the flow tears down
        // cooperatively. Do NOT convert it to a RUN_ERROR (emitting after a downstream
        // cancellation would violate flow-exception transparency).
        throw ce
    } catch (e: Exception) {
        log.error("koogAgent run failed", e)
        emit(RunErrorEvent(message = e.message ?: e.toString()))
    }
}
