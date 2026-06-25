# Init AG-UI for the Pukeko project

We are going to build an integration between Galvanized Pukeko and Gaunt Sloth using the AG-UI protocol.

## Working Repositories

- https://github.com/pukeko-robotics/galvanized-pukeko.git
- https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant.git

## Reference Dependencies

- https://github.com/langchain-ai/langchainjs.git
- https://github.com/langchain-ai/langgraphjs.git
- https://github.com/google/adk-java.git
- https://github.com/ag-ui-protocol/ag-ui.git (TypeScript SDK is in ag-ui/tree/main/sdks/typescript)

Reference dependencies are checked out for reference to help agents understand how to use them. They are not to be edited.

## Tasks

- Checkout https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant.git as a submodule to packages dir, add a command to run gaunt sloth in chat mode from root project package json.
- Check out the 4 reference repositories to the `./_readonly` directory.
- Create a very minimalistic AGENTS.md file explaining that the repositories we are working on are `galvanized-pukeko` and `gaunt-sloth-assistant`, and that copies of important dependencies are available in the `./_readonly` directory.
- Create a CLAUDE.md file containing only a reference to `@AGENTS.md`.