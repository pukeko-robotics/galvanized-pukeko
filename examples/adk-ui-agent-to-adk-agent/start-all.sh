#!/bin/bash

# Start all agents for the adk-ui-agent-to-adk-agent example
# Usage: ./start-all.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting demo-agent on port 8082..."
cd "$SCRIPT_DIR/demo-agent"
./mvnw clean compile exec:java -Dexec.classpathScope=compile -Dexec.args="--adk.agents.source-dir=target" &
DEMO_AGENT_PID=$!

echo "Starting demo-ui-agent on port 8080..."
cd "$SCRIPT_DIR/demo-ui-agent"
./mvnw clean compile exec:java -Dexec.classpathScope=compile -Dexec.args="--adk.agents.source-dir=target" &
UI_AGENT_PID=$!

echo ""
echo "Both agents starting..."
echo "  demo-agent (port 8082): PID $DEMO_AGENT_PID"
echo "  demo-ui-agent (port 8080): PID $UI_AGENT_PID"
echo ""
echo "Open http://localhost:8080 in your browser"
echo ""
echo "Press Ctrl+C to stop all agents"

# Trap Ctrl+C and kill both processes
trap "echo 'Stopping agents...'; kill $DEMO_AGENT_PID $UI_AGENT_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for both processes
wait
