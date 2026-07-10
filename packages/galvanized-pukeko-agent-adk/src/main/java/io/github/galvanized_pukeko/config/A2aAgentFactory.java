package io.github.galvanized_pukeko.config;

import com.google.adk.a2a.agent.RemoteA2AAgent;
import io.a2a.client.Client;
import io.a2a.client.config.ClientConfig;
import io.a2a.client.http.A2ACardResolver;
import io.a2a.client.http.JdkA2AHttpClient;
import io.a2a.client.transport.jsonrpc.JSONRPCTransport;
import io.a2a.client.transport.jsonrpc.JSONRPCTransportConfig;
import io.a2a.spec.AgentCard;
import io.a2a.spec.AgentCapabilities;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Factory for creating RemoteA2AAgent instances based on configuration.
 */
@Component
public class A2aAgentFactory {

  private static final Logger log = LoggerFactory.getLogger(A2aAgentFactory.class);

  /**
   * Creates a RemoteA2AAgent from the provided configuration.
   *
   * @param config A2A configuration
   * @return Optional containing RemoteA2AAgent if enabled and properly configured, empty otherwise
   */
  public Optional<RemoteA2AAgent> create(A2aConfiguration config) {
    if (!config.isEnabled()) {
      log.info("A2A is disabled");
      return Optional.empty();
    }

    if (config.getUrl() == null || config.getUrl().isEmpty()) {
      log.warn("A2A is enabled but URL is not configured");
      return Optional.empty();
    }

    if (config.getName() == null || config.getName().isEmpty()) {
      log.warn("A2A is enabled but name is not configured");
      return Optional.empty();
    }

    log.info("Creating RemoteA2AAgent for URL: {}", config.getUrl());

    try {
      // Resolve the agent card from the well-known endpoint
      String agentCardUrl = config.getUrl() + "/.well-known/agent-card.json";
      AgentCard agentCard;
      try {
        agentCard = new A2ACardResolver(new JdkA2AHttpClient(), config.getUrl(), agentCardUrl)
            .getAgentCard();
        log.info("Resolved agent card from: {}", agentCardUrl);
      } catch (Exception e) {
        // If card resolution fails, build a minimal AgentCard from configuration
        log.warn("Could not resolve agent card from {}, building from config: {}", agentCardUrl, e.getMessage());
        AgentCapabilities capabilities = new AgentCapabilities.Builder().build();
        agentCard = new AgentCard.Builder()
            .url(config.getUrl())
            .name(config.getName())
            .version("0.0.1")
            .description(config.getDescription() != null ? config.getDescription() : "")
            .capabilities(capabilities)
            .build();
      }

      // Build the A2A client
      Client a2aClient = Client.builder(agentCard)
          .withTransport(JSONRPCTransport.class, new JSONRPCTransportConfig())
          .clientConfig(
              new ClientConfig.Builder()
                  .setStreaming(agentCard.capabilities().streaming())
                  .build())
          .build();

      // Build RemoteA2AAgent using the new 0.7.0 API
      RemoteA2AAgent remoteAgent = RemoteA2AAgent.builder()
          .name(config.getName())
          .agentCard(agentCard)
          .a2aClient(a2aClient)
          .description(config.getDescription() != null ? config.getDescription() : "")
          .build();

      log.info("Successfully created RemoteA2AAgent: {}", config.getName());
      return Optional.of(remoteAgent);

    } catch (Exception e) {
      log.error("Failed to create RemoteA2AAgent", e);
      return Optional.empty();
    }
  }
}
