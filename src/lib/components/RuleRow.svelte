<script lang="ts">
  import { Trash2 } from 'lucide-svelte';
  import { COLOR_PRESETS } from '../studio.svelte';
  import type { RuleGroup, RuleSpec } from '../types';

  const {
    group,
    spec,
    onUpdate,
    onRemove,
  }: {
    group: RuleGroup;
    spec: RuleSpec | undefined;
    onUpdate: (patch: Partial<RuleGroup>) => void;
    onRemove: () => void;
  } = $props();

  const requested = $derived(spec?.names.length ?? 0);
  const qualified = $derived((spec?.states.length ?? 0) > 0);
</script>

<div class="rounded-xl border border-line/10 bg-console/60 p-3">
  <div class="flex items-start gap-2.5">
    <input
      type="color"
      class="swatch h-9 w-11 flex-none"
      value={group.color}
      oninput={(event) => onUpdate({ color: (event.currentTarget as HTMLInputElement).value })}
      aria-label="Highlight colour"
    />
    <textarea
      class="ctl flex-1"
      rows="2"
      placeholder="Greenville, Pickens, Spartanburg"
      value={group.counties}
      oninput={(event) => onUpdate({ counties: (event.currentTarget as HTMLTextAreaElement).value })}
    ></textarea>
    <button
      type="button"
      class="btn btn-icon flex-none"
      onclick={onRemove}
      title="Remove this highlight group"
      aria-label="Remove this highlight group"
    >
      <Trash2 size={14} />
    </button>
  </div>

  <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
    {#each COLOR_PRESETS as preset (preset.value)}
      <button
        type="button"
        class="h-5 w-5 rounded-md border transition-transform hover:scale-110 {group.color.toLowerCase() ===
        preset.value
          ? 'border-accent'
          : 'border-line/20'}"
        style="background: {preset.value}"
        onclick={() => onUpdate({ color: preset.value })}
        title={preset.name}
        aria-label={preset.name}
      ></button>
    {/each}
    <input
      type="text"
      class="ctl ml-auto w-24 font-mono text-[11px]"
      value={group.color}
      oninput={(event) => onUpdate({ color: (event.currentTarget as HTMLInputElement).value })}
      aria-label="Highlight colour hex value"
    />
  </div>

  <p class="micro mt-2 mb-0 text-fg-dim">
    {#if requested === 0}
      No counties yet
    {:else}
      {requested} county {requested === 1 ? 'name' : 'names'}
      {qualified ? '· state-qualified' : '· any state'}
    {/if}
  </p>

  {#if spec && spec.unresolved.length > 0}
    {#each spec.unresolved as note (note)}
      <p class="micro mt-1.5 mb-0 text-amber-400">⚠ {note}</p>
    {/each}
  {/if}
</div>
