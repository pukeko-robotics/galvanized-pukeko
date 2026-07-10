# ADK UI Agent to ADK Agent Example

This example demonstrates how to use `galvanized-pukeko-agent-adk` as a Maven dependency to create a UI-enabled agent that communicates with another ADK agent.

## Prerequisites

- Java 17+
- Maven 3.6+
- Node.js 18+ (for Playwright tests)

## Running the Example

### Start Both Agents

The easiest way to start both agents:

```bash
./start-all.sh
```

Or start them individually in separate terminals:

Start remote Demo A2A agent (`cd demo-agent`)
```bash
./mvnw clean compile exec:java -Dexec.classpathScope=compile -Dexec.args="--adk.agents.source-dir=target"
```

Start UI demo agent (`cd demo-ui-agent`)
```bash
./mvnw clean compile exec:java -Dexec.classpathScope=compile -Dexec.args="--adk.agents.source-dir=target"
```

### Access the UI

Open your browser and navigate to:
```
http://localhost:8080
```

### Creating a Session and Sending a Message

Using curl:

```bash
# Create a session
curl 'http://localhost:8080/apps/ui-agent/users/user/sessions' \
  -X POST \
  -H "Content-Type: application/json" \
  -H 'Accept: application/json'

# Send a message (replace SESSION_ID with the id from the previous response)
curl 'http://localhost:8080/run_sse' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "appName": "ui-agent",
    "userId": "user",
    "sessionId": "SESSION_ID",
    "newMessage": {
      "role": "user",
      "parts": [{"text": "Show me a contact form"}]
    },
    "streaming": false
  }'
```

## Running Tests

```bash
npx playwright test -c playwright.config.ts
```

## How It Works

### UI Agent

The `ui-agent` is a minimal Spring Boot application that extends `UiAgentApplication` from the `galvanized-pukeko-agent-adk` library:

```java
@SpringBootApplication
public class DemoUiAgent extends io.github.galvanized_pukeko.UiAgentApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoUiAgent.class, args);
    }
}
```

This provides:
- Dynamic UI rendering tools (forms, charts, tables)
- WebSocket support for real-time updates
- Embedded web client
- Optional MCP integration

### Demo Agent

The `demo-agent` is a standard ADK agent that can be connected to via A2A protocol. The `ui-agent` is configured to connect to it via `application.properties`:

```properties
adk.a2a.agents.demo-agent.url=http://localhost:8082
adk.a2a.agents.demo-agent.description=A demo agent that can answer questions
```

## Key Files

- [`demo-ui-agent/pom.xml`](demo-ui-agent/pom.xml) - Maven dependency on `galvanized-pukeko-agent-adk`
- [`demo-ui-agent/src/main/java/io/github/galvanized_pukeko/DemoUiAgentApplication.java`](demo-ui-agent/src/main/java/io/github/galvanized_pukeko/DemoUiAgentApplication.java) - Main application class
- [`demo-ui-agent/src/main/resources/application.properties`](demo-ui-agent/src/main/resources/application.properties) - Configuration

## Stopping the Agents

Press `Ctrl+C` in the terminal where `start-all.sh` is running, or:

```bash
lsof -ti:8080 | xargs kill -9
lsof -ti:8082 | xargs kill -9
```

## Deploying to Google Cloud Run

The UI agent can be deployed to Google Cloud Run:

```bash
cd demo-ui-agent

# Set your GCP project
export TEST_AGENT_GCP_PROJECT=your-gcp-project-id
# Set the host (no protocol) used for UI URLs and CORS
export TEST_AGENT_HOST=demo-ui-agent-xyz-ue.a.run.app


# Deploy
./deploy.sh
```

Prerequisites:
- Google Cloud CLI (`gcloud`) installed and authenticated
- A GCP project with Cloud Run and Vertex AI APIs enabled

The deployment script uses Vertex AI for model access, which supports both Gemini and Anthropic models from the Model Garden.

Set `TEST_AGENT_HOST` to the Cloud Run hostname (or your custom domain) without `https://`; `deploy.sh` forwards it as `WEB_HOST` to configure base URLs and CORS.

You need to configure your URLs and CORS for your deployment
```
pukeko.ui.base-url=https://your-domain.com
pukeko.ui.ws-url=wss://your-domain.com/ws
adk.web.cors.origins=https://your-domain.com,wss://your-domain.com
adk.web.cors.methods=GET,POST,PUT,DELETE,OPTIONS
adk.web.cors.headers=*
adk.web.cors.allow-credentials=true
adk.web.cors.max-age=3600
adk.web.cors.mapping=/**
```

Important! The websockets need 1G of memory, configure your instance size to have 1G of memory; default 512 is not enough.

## Related Documentation

- [galvanized-pukeko-agent-adk README](../../packages/galvanized-pukeko-agent-adk/README.md)
- [Root README](../../README.md)
