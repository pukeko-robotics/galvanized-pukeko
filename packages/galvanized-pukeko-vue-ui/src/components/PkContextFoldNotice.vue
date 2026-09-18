<script setup lang="ts">
/**
 * RC-68 — the inline marker for a mid-turn context fold.
 *
 * Drawn at the point in the conversation where gaunt-sloth's AG-UI server
 * folded the older history into a summary and asked the model again. Shared by
 * both client surfaces (the bespoke `ChatInterface` and the CopilotKit-driven
 * `HeadlessChat`) so the browser says the same thing whichever one is mounted.
 *
 * The words come from the server's own `value.notice` whenever it sent one, so
 * this surface does not drift away from the sentence the terminal, TUI and
 * editor surfaces already print. Only when the notice is missing does the
 * marker fall back to the fold's raw numbers — facts, which cannot drift, in
 * place of prose, which would.
 */
import type { ContextFold } from '../services/contextCompaction'

defineProps<{ fold: ContextFold }>()

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
</script>

<template>
  <div
    class="pk-context-fold"
    :class="`tone-${fold.tone}`"
    data-testid="pk-context-fold"
    role="note"
  >
    <div class="pk-context-fold-title" data-testid="pk-context-fold-title">{{ fold.title }}</div>
    <p
      v-for="(line, i) in fold.lines"
      :key="i"
      class="pk-context-fold-line"
      data-testid="pk-context-fold-line"
    >{{ line }}</p>
    <!--
      The numbers, and ONLY when the server sent no notice of its own: a
      well-formed notice already states them in its own words (gaunt-sloth's
      `contextSizeLine`), and printing them twice is how one event starts
      reading as two.
    -->
    <p
      v-if="!fold.lines && fold.compaction"
      class="pk-context-fold-counts"
      data-testid="pk-context-fold-counts"
    >
      {{ formatCount(fold.compaction.removedCount) }} folded ·
      {{ formatCount(fold.compaction.before.messages) }} →
      {{ formatCount(fold.compaction.after.messages) }} messages ·
      ~{{ formatCount(fold.compaction.before.characters) }} →
      ~{{ formatCount(fold.compaction.after.characters) }} characters
    </p>
  </div>
</template>

<style scoped>
.pk-context-fold {
  margin: 0.5rem 0;
  padding: 0.5rem 0.75rem;
  border-left: 3px solid var(--pk-color-border, #e5e7eb);
  border-radius: 0.4rem;
  background-color: var(--pk-color-surface-sunken, #f9fafb);
  color: var(--pk-color-text-muted, #6b7280);
  font-size: 0.8rem;
  line-height: 1.4;
  text-align: left;
}

.pk-context-fold.tone-warn {
  border-left-color: var(--pk-color-danger, #d32f2f);
}

.pk-context-fold.tone-info {
  border-left-color: var(--pk-color-info-border, #bfdbfe);
}

.pk-context-fold-title {
  font-weight: 600;
  color: var(--pk-color-text-secondary, #64748b);
}

.pk-context-fold-line,
.pk-context-fold-counts {
  margin: 0.25rem 0 0;
}

.pk-context-fold-counts {
  font-variant-numeric: tabular-nums;
}
</style>
