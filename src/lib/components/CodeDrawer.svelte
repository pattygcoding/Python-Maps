<script lang="ts">
  import hljs from 'highlight.js/lib/core';
  import python from 'highlight.js/lib/languages/python';
  import { Check, ChevronDown, Copy } from 'lucide-svelte';
  import type { Studio } from '../studio.svelte';

  hljs.registerLanguage('python', python);

  let { studio, open = $bindable(false) }: { studio: Studio; open?: boolean } = $props();

  // Real-time: a $derived re-run on every keystroke, straight off generateScript().
  // No worker round trip, so the drawer never lags behind the form.
  const highlighted = $derived(hljs.highlight(studio.script, { language: 'python' }).value);
  const lines = $derived(studio.script.trimEnd().split('\n').length);

  let copied = $state(false);

  async function copyScript(): Promise<void> {
    try {
      await navigator.clipboard.writeText(studio.script);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 1800);
    } catch {
      // Clipboard permission can be denied; the code is selectable either way.
    }
  }
</script>

<section class="px-5 pb-4 sm:px-10 lg:px-14">
  <div class="mx-auto w-full max-w-[1500px]">
    <div class="panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          class="flex items-center gap-2.5 text-left"
          onclick={() => (open = !open)}
          aria-expanded={open}
        >
          <ChevronDown
            size={15}
            class="text-fg-muted transition-transform {open ? 'rotate-180' : ''}"
          />
          <span class="micro font-bold text-accent">View the Python code</span>
        </button>

        <span class="micro hidden text-fg-dim sm:inline">
          {lines} lines · regenerated from the form on every change
        </span>

        <div class="ml-auto flex items-center gap-1.5">
          <span class="micro hidden text-fg-dim md:inline">
            byte-identical to what the worker executed
          </span>
          <button type="button" class="btn" onclick={copyScript}>
            {#if copied}
              <Check size={14} /> Copied
            {:else}
              <Copy size={14} /> Copy Python
            {/if}
          </button>
        </div>
      </div>

      {#if open}
        <div class="border-t border-line/10">
          <div class="code-surface max-h-[52vh] overflow-auto p-4">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- highlighted output
                 of our own generated source; hljs escapes the text it emits. -->
            <pre><code class="language-python">{@html highlighted}</code></pre>
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>
