package com.google.adk.webservice;

import io.a2a.spec.AgentCard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller exposing A2A discovery endpoints.
 * Somehow ADK does not seem to expose this.
 *
 * <p><b>ADK 1.6.0 note:</b> serves the shared {@link AgentCard} bean built by
 * {@link A2ARemoteConfiguration} (single source of truth with the JSON-RPC handler). The removed
 * {@code A2ASendMessageExecutor} constructor dependency (never referenced here) was dropped.
 */
@RestController
@RequestMapping("/a2a")
public class AgentCardController {

  private static final Logger logger = LoggerFactory.getLogger(AgentCardController.class);

  private final AgentCard agentCard;

  public AgentCardController(AgentCard agentCard) {
    this.agentCard = agentCard;
  }

  @GetMapping(path = "/.well-known/agent-card.json", produces = "application/json")
  public AgentCard getAgentCard() {
    logger.debug("Received agent card request for {}", agentCard.name());
    return agentCard;
  }
}
