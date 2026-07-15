# Theming

`@galvanized-pukeko/vue-ui` ships a **semantic colour-token contract** so you can re-skin the shared
chat/UI surfaces (a custom palette, brand accent, danger colour, and so on) **without forking a single
component**. Themes are plain CSS custom properties (`--pk-color-*`) written at `:root`, so a theme
override cascades to every mounted vue-ui component regardless of which entry point (`.` or
`./copilot`) rendered it.

The default theme reproduces the library's out-of-the-box appearance exactly; theming is opt-in.

## The token contract

Override any of these `--pk-color-*` variables to re-theme. The names are **semantic roles** (honouring
the cross-surface [DL-8 colour semantics](../../../docs/design-language.md)); the default values are the
colours the library ships.

| Token | Default | Role (DL-8) |
| --- | --- | --- |
| `--pk-color-surface` | `#fff` | Panel / toolbar / input background |
| `--pk-color-surface-muted` | `#f3f4f6` | Assistant bubble & notice background |
| `--pk-color-surface-sunken` | `#f9fafb` | Recessed panel (A2UI surface column) |
| `--pk-color-border` | `#e5e7eb` | Subtle separators / hairlines |
| `--pk-color-text` | `#1f2937` | Primary body text |
| `--pk-color-text-muted` | `#6b7280` | Secondary text (DL-8 dim) |
| `--pk-color-text-secondary` | `#64748b` | Tertiary captions/markers (DL-8 dim) |
| `--pk-color-text-dim` | `#9ca3af` | Faint text: thinking, helper (DL-8 dim) |
| `--pk-color-primary` | `#3b82f6` | Accent + **user's own message** (DL-8 "green"; see note) |
| `--pk-color-on-primary` | `#fff` | Text/icon drawn on a saturated accent/danger button |
| `--pk-color-link` | `#2563eb` | Inline link / toggle |
| `--pk-color-danger` | `#d32f2f` | Error / stop (DL-8 red) |
| `--pk-color-danger-strong` | `#b71c1c` | Danger gradient bottom / border |
| `--pk-color-danger-hover` | `#e53935` | Danger button hover top |
| `--pk-color-danger-hover-strong` | `#c62828` | Danger button hover bottom |
| `--pk-color-danger-text` | `#991b1b` | Error-banner text |
| `--pk-color-danger-surface` | `#fee2e2` | Error-banner background |
| `--pk-color-info-surface` | `#eff6ff` | Tool-call badge background (DL-8 informational) |
| `--pk-color-info-surface-hover` | `#dbeafe` | Tool-call header hover |
| `--pk-color-info-border` | `#bfdbfe` | Tool-call badge border |
| `--pk-color-info-text` | `#1e40af` | Tool-call label / section text |
| `--pk-color-code-text` | `#334155` | Preformatted result text |
| `--pk-color-code-surface` | `#f8fafc` | Preformatted result background |
| `--pk-color-code-border` | `#cbd5e1` | Preformatted result border |

> **DL-8 note.** DL-8 assigns green to "the user's own input"; the web surfaces have always drawn the
> user bubble in the accent blue. The default keeps that blue (this release is a refactor-to-tokens,
> not a restyle), and `--pk-color-primary` is the semantic slot you override to honour DL-8's
> green-for-user (see the worked example below). DL-8's warning/yellow role has no surface in the
> current components, so no warning token is defined yet.

## Overriding tokens

Two equivalent paths; pick whichever fits your setup.

### 1. `applyTheme()` (programmatic)

```ts
import { applyTheme } from '@galvanized-pukeko/vue-ui'
// (also re-exported from '@galvanized-pukeko/vue-ui/copilot')

// Writes the tokens on :root; returns an undo function that restores the prior state.
const undo = applyTheme({
  '--pk-color-primary': '#059669',
  '--pk-color-link': '#047857',
})

// later, to revert this specific override:
undo()
```

`applyTheme(theme, target?)` writes to `document.documentElement` (`:root`) by default; pass a target
element to scope the theme to a subtree. `resetTheme(target?)` removes **all** `--pk-color-*` overrides
from an element, reverting to the stylesheet/default values.

### 2. Plain CSS (`:root`)

Because the tokens are ordinary custom properties, you can set them in your own stylesheet (no JS):

```css
:root {
  --pk-color-primary: #059669;
  --pk-color-link: #047857;
}
```

### Reading the defaults

`defaultTheme` (a `Record<PkColorToken, string>`) and `PK_COLOR_TOKENS` (the ordered token list) are
exported for tooling/tests. `PkTheme` (a partial override map) and `PkColorToken` are exported types.

## Worked example: an emerald theme

A minimal end-to-end override that recolours the user bubble and tool-call badge to emerald. It also
demonstrates the DL-8 story: the user bubble becomes green.

```ts
import { applyTheme, type PkTheme } from '@galvanized-pukeko/vue-ui'

const emerald: PkTheme = {
  '--pk-color-primary': '#059669', // user bubble + accent → emerald (DL-8 green-for-user)
  '--pk-color-link': '#047857',
  '--pk-color-info-text': '#065f46', // tool-call badge text
  '--pk-color-info-surface': '#ecfdf5', // tool-call badge background
  '--pk-color-info-border': '#a7f3d0',
}

applyTheme(emerald) // every mounted vue-ui surface re-skins immediately
```

The equivalent pure-CSS form is the same five variables set under `:root`.

## Notes & scope

- **No fork required.** Every migrated component reads its colour through `var(--pk-color-*, <default>)`,
  so overriding the token re-themes the component; the default in the fallback means the library looks
  identical if you never set a token (including from the `./copilot` bundle, which doesn't ship the
  base stylesheet).
- **Migrated in this release:** the primary chat surfaces (`ChatInterface`, `HeadlessChat`,
  `ToolCallBadge`, `ToolResultGeneric`). Form controls / buttons / inputs still read the pre-existing
  `--grey-*` / `--bg-button-*` / `--border-input-*` layer in `global.css`; folding those into the
  semantic `--pk-color-*` tokens is an incremental follow-up. `PkLogoLarge` is fixed-palette artwork
  and is intentionally not tokenised.
