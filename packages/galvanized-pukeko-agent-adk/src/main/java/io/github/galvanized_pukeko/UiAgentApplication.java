package io.github.galvanized_pukeko;

import static io.github.galvanized_pukeko.UiAgent.PUKEKO_UI_AGENT_NAME;

import com.google.adk.agents.BaseAgent;
import com.google.adk.agents.LlmAgent;
import com.google.adk.artifacts.BaseArtifactService;
import com.google.adk.memory.BaseMemoryService;
import com.google.adk.runner.Runner;
import com.google.adk.sessions.BaseSessionService;
import com.google.adk.web.AdkWebServer;
import com.google.adk.web.AgentLoader;
import com.google.common.collect.ImmutableList;
import io.github.galvanized_pukeko.agui.AdkLocalAgent;
import io.github.galvanized_pukeko.config.A2aAgentFactory;
import io.github.galvanized_pukeko.config.A2aConfiguration;
import io.github.galvanized_pukeko.config.AiConfiguration;
import io.github.galvanized_pukeko.config.McpConfiguration;
import io.github.galvanized_pukeko.config.McpToolsetFactory;
import io.github.galvanized_pukeko.config.PromptLoader;
import java.util.NoSuchElementException;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.context.annotation.Primary;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Main application class for the UI Agent server. Extends AdkWebServer to inherit all ADK web
 * configuration including resource handlers, view controllers, and bean definitions. Also scans the
 * custom agent package for additional components. AdkWebServer comes from adk-dev, we probably need
 * to create all our implementations to avoid including the entire adk-dev.
 */
@SpringBootApplication
@ComponentScan(
    basePackages = {
        "com.google.adk.web",        // Scan ADK web components
        "io.github.galvanized_pukeko"          // Scan custom agent components
    },
    excludeFilters = {
        @ComponentScan.Filter(
            type = FilterType.ASSIGNABLE_TYPE,
            classes = AdkWebServer.class
        )
    }
)
public class UiAgentApplication extends AdkWebServer {

  private static final Logger log = LoggerFactory.getLogger(UiAgentApplication.class);

  @Override
  public void addViewControllers(
      org.springframework.web.servlet.config.annotation.ViewControllerRegistry registry) {
    log.info("addViewControllers");
    // Forward / to index.html so that the Vue app is served
    registry.addViewController("/").setViewName("forward:/index.html");
    // Redirect /dev-ui to / for backward compatibility
    // registry.addRedirectViewController("/dev-ui", "/");
  }

  public static void main(String[] args) {
    // Set WebSocket buffer size before starting the application
    System.setProperty(
        "org.apache.tomcat.websocket.DEFAULT_BUFFER_SIZE",
        String.valueOf(10 * 1024 * 1024)
    );

    SpringApplication.run(UiAgentApplication.class, args);
  }

  @Bean
  public AdkLocalAgent adkLocalAgent(
      AgentLoader agentLoader,
      BaseSessionService sessionService,
      BaseArtifactService artifactService,
      BaseMemoryService memoryService
  ) {
    BaseAgent agent = agentLoader.loadAgent(PUKEKO_UI_AGENT_NAME);
    Runner runner = new Runner(agent, PUKEKO_UI_AGENT_NAME, artifactService, sessionService, memoryService);
    return new AdkLocalAgent(PUKEKO_UI_AGENT_NAME, runner);
  }

  /**
   * Custom AgentLoader that creates the UI agent with MCP and A2A configuration from
   * application.properties. This bean takes precedence over the default CompiledAgentLoader.
   */
  @Bean
  @Primary
  public AgentLoader agentLoader(
      AiConfiguration aiConfig,
      McpConfiguration mcpConfig,
      McpToolsetFactory mcpFactory,
      A2aConfiguration a2aConfig,
      A2aAgentFactory a2aFactory,
      PromptLoader promptLoader
  ) {
    log.info("creating agent loader");
    return new UiAgentLoader(aiConfig, mcpConfig, mcpFactory, a2aConfig, a2aFactory, promptLoader);
  }

  private static class UiAgentLoader implements AgentLoader {

    private LlmAgent uiAgent;

    public UiAgentLoader(AiConfiguration aiConfig,
        McpConfiguration mcpConfig, McpToolsetFactory mcpFactory, A2aConfiguration a2aConfig,
        A2aAgentFactory a2aFactory, PromptLoader promptLoader) {
      this.uiAgent = UiAgent.createAgent(aiConfig, mcpConfig, mcpFactory,
          a2aConfig, a2aFactory, promptLoader);
    }

    @Override
    public ImmutableList<String> listAgents() {
      log.info("Listing agents...");

      return ImmutableList.of(PUKEKO_UI_AGENT_NAME);
    }

    @Override
    public BaseAgent loadAgent(String name) {
      log.info("Loading agent [{}]", name);
      if (PUKEKO_UI_AGENT_NAME.equals(name)) {
        return uiAgent;
      }
      throw new NoSuchElementException("Agent not found: " + name);
    }
  }
}
