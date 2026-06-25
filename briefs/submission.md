### Problem Statement
LLMs largely generate text, but humans often need visual structure to support their thinking. When an agent is presenting something, it would be nice to present it as a diagram, a table, or a custom component. Agents actively use code generation to support their output; however, the generation is not always consistent and is likely not wired to real applications. Another downside is that code generation of nice components requires a larger LLM.

There are already a multitude of UI frameworks for AI that allow generating code on the fly, but so far most of them exploit code generation which later generates HTML. This approach is prone to errors, has higher than desired latency, and requires smarter models, which also increases latency.

### Why agents?
A dedicated UI agent using low-latency bidirectional communication to the browser with tool calling can be a massive improvement in UI consistency and speed. The UI agent can connect to other agents via A2A or to tools via MCP, as well as having other local tools or local sub-agents. A dedicated UI agent can use a smaller, faster model and be used as a router, delegating actual business tasks to different agents with LLMs of different sizes matching their task complexity.

### What you created
Galvanized Pukeko ADK-Java is a UI agent that uses WebSockets to communicate with a Vue application in the browser to render components.

At the moment, the UI agent has 3 built-in tools:
- Render form
- Render chart
- Render table

Each tool accepts a number of simple parameters. For example, the form tool has elements for input, select, and checkbox.

As of 01 December 2025, version 0.0.2 is available on Maven Central and is easy to configure and start.
See demo projects:
- UI Agent connecting to A2A agent: https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/examples/adk-ui-agent-to-adk-agent
- UI Agent connecting to MCP server: https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/examples/adk-ui-agent-to-external-mcp

### Demo

### The Build
The development of Galvanized Pukeko started with ADK-Java 0.3.0 and was upgraded to 0.4.0 during the hackathon.

**Core Technologies:**
- **ADK-Java 0.4.0**: google-adk (core), google-adk-dev (web server), google-adk-a2a (agent-to-agent protocol)
- **Spring Boot 3.4**: WebSocket support for real-time bidirectional communication
- **Vue.js**: Embedded web client served from the same Spring Boot server

**Key ADK Features Demonstrated:**
1. **Custom Tools**: Three rendering tools (`renderForm`, `renderChart`, `renderTable`) that use WebSocket to push UI components to the browser
2. **MCP Integration**: Optional connection to external MCP servers via HTTP/SSE or stdio transport, allowing the agent to use tools from any MCP-compatible server
3. **A2A Protocol**: Remote agent integration enabling the UI agent to delegate tasks to specialized agents running on different ports/servers
4. **Sessions**: InMemorySessionService for conversation state management
5. **Agent Deployment**: Published to Maven Central, making it trivial for developers to create their own UI-enabled agents by extending `UiAgentApplication`. Both demo projects include `deploy.sh` scripts for one-command deployment to Google Cloud Run with Vertex AI.

**Architecture Decisions:**
- The agent uses WebSocket for UI updates (low latency, bidirectional) and SSE for chat streaming
- Tool calling replaces code generation: instead of generating HTML, the LLM calls `renderForm({components: [...]})` with structured parameters
- The library is designed as a Spring Boot starter that developers extend, not a standalone application
- External prompts are configurable via properties, allowing customization without code changes

### If I had more time, this is what I'd do
- With the default distribution, there's still Google lock-in with only Anthropic via Vertex AI models as an alternative. I plan to improve the configuration.
- Connected agent and tool indication.
- Dynamic connection to A2A agents without restart.
- Some out-of-the-box integration to render outputs from visual models (Nano Banna, Stability AI, etc.).
- The library currently uses controllers from adk-java-dev. I'd like to have it somewhat compatible, but I plan to create custom controllers.
- The project certainly needs the ability to add custom UI components—that is the purpose of this project.
- Persistent memory (there were some hiccups with using Agent Engine memory in 0.3.0-java, but I'm confident this should be possible to get working).
- More build automation.
- More tests—there are currently just a few Playwright tests.
- Evaluations—the distribution has some default prompts worth covering.
- Better documentation.
- More examples.
- The UI itself is really out of scope for this capstone and still has a lot of work. I have a contributor ready to help with the UI, and we will certainly improve it over the next few weeks: more basic components, themes, sleek design, publish the package on npm, etc.
