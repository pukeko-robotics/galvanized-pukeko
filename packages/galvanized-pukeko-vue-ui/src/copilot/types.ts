/** UI mode for the {@link PukekoCopilot} shell (P2b increment 4). */
export type UiMode = 'bespoke' | 'stock' | 'headless'

/**
 * Where the headless UI renders `show_a2ui_surface` A2UI surfaces (PLAT-19):
 *   - `chat`  — inline in the transcript, one ephemeral surface per tool call.
 *   - `panel` — a single shared, persistent/updatable pane beside the transcript
 *               (bespoke `CoreApp` parity). This is the headless default.
 */
export type A2UITarget = 'chat' | 'panel'
