package com.google.adk.webservice;

import com.google.adk.agents.BaseAgent;
import io.a2a.server.events.InMemoryQueueManager;
import io.a2a.server.events.QueueManager;
import io.a2a.server.requesthandlers.DefaultRequestHandler;
import io.a2a.server.requesthandlers.RequestHandler;
import io.a2a.server.tasks.InMemoryTaskStore;
import io.a2a.spec.AgentCapabilities;
import io.a2a.spec.AgentCard;
import io.a2a.transport.jsonrpc.handler.JSONRPCHandler;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
// WARNING adapted from https://github.com/google/adk-java/tree/main/a2a (absent in google-adk-a2a)

/**
 * Registers the transport-only A2A webservice stack.
 *
 * <p>Importers must supply a {@link BaseAgent} bean. The agent remains opaque to this module so the
 * transport can be reused across applications.
 *
 * <p><b>ADK 1.6.0 note:</b> the pre-1.0 {@code com.google.adk.a2a.A2ASendMessageExecutor} +
 * {@code ResponseConverter.eventsToMessage} single-shot bridge was removed at GA. This wiring now
 * builds the standard a2a-java server stack — ADK's
 * {@code com.google.adk.a2a.executor.AgentExecutor} (which implements
 * {@code io.a2a.server.agentexecution.AgentExecutor}) behind a {@link DefaultRequestHandler},
 * surfaced as a {@link JSONRPCHandler}. The Spring controller ({@link A2ARemoteController}) still
 * exposes the same {@code POST /a2a/remote/v1/message:send} wire.
 *
 * @apiNote <b>EXPERIMENTAL:</b> Subject to change, rename, or removal in any future patch release. Do
 *     not use in production code.
 */
@Configuration
@ComponentScan(basePackages = "com.google.adk.webservice")
public class A2ARemoteConfiguration {

  private static final Logger logger = LoggerFactory.getLogger(A2ARemoteConfiguration.class);
  private static final String DEFAULT_APP_NAME = "a2a-remote-service";
  private static final String DEFAULT_APP_URL =
      "http://localhost:8082/a2a/remote/v1/message:send";

  /**
   * Discovery/handler agent card, derived from the local agent. Shared by the JSON-RPC handler and
   * the {@link AgentCardController} well-known endpoint (single source of truth).
   */
  @Bean
  public AgentCard agentCard(
      BaseAgent agent, @Value("${a2a.remote.appUrl:" + DEFAULT_APP_URL + "}") String appUrl) {
    AgentCapabilities capabilities =
        new AgentCapabilities.Builder()
            .streaming(false)
            .pushNotifications(false)
            .stateTransitionHistory(false)
            .extensions(List.of())
            .build();
    return new AgentCard.Builder()
        .name(agent.name())
        .description(agent.description())
        .url(appUrl)
        .version("1.0.0")
        .capabilities(capabilities)
        .defaultInputModes(List.of("text"))
        .defaultOutputModes(List.of("text"))
        .skills(List.of())
        .build();
  }

  /**
   * The a2a-java JSON-RPC handler wrapping ADK's {@code AgentExecutor}. Replaces the removed
   * {@code A2ASendMessageExecutor} single-shot executor bean.
   */
  @Bean
  public JSONRPCHandler jsonrpcHandler(
      BaseAgent agent,
      AgentCard agentCard,
      @Value("${a2a.remote.appName:" + DEFAULT_APP_NAME + "}") String appName) {
    logger.info("Initializing A2A JSON-RPC handler for appName {}", appName);

    com.google.adk.a2a.executor.AgentExecutor executor =
        new com.google.adk.a2a.executor.AgentExecutor.Builder()
            .agent(agent)
            .appName(appName)
            .build();

    InMemoryTaskStore taskStore = new InMemoryTaskStore();
    QueueManager queueManager = new InMemoryQueueManager(taskStore);
    Executor asyncExecutor = Executors.newCachedThreadPool();

    // Push-notification config store + sender are optional (no push transport in this demo) → null.
    RequestHandler requestHandler =
        new DefaultRequestHandler(executor, taskStore, queueManager, null, null, asyncExecutor);

    return new JSONRPCHandler(agentCard, requestHandler, asyncExecutor);
  }
}
