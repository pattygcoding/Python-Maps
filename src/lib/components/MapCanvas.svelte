<script lang="ts">
  import { AlertTriangle, FileCode2, ImageDown, Loader2 } from 'lucide-svelte';
  import type { Studio } from '../studio.svelte';

  const { studio }: { studio: Studio } = $props();

  const src = $derived(
    studio.image ? `data:${studio.image.mime};base64,${studio.image.base64}` : null,
  );

  const unmatched = $derived(studio.stats?.unmatched ?? []);
</script>

<section class="flex min-w-0 flex-col gap-3">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap items-baseline gap-3">
      <h2 class="micro m-0 font-bold text-accent">Canvas</h2>
      {#if studio.stats && studio.stats.counties > 0}
        <span class="micro text-fg-dim">
          {studio.stats.counties.toLocaleString()} counties plotted
          · {studio.stats.highlighted.toLocaleString()} highlighted
          · {studio.stats.ms.toLocaleString()} ms in Python
        </span>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="btn"
        disabled={!studio.image || studio.isBusy}
        onclick={() => studio.download('png')}
        title="Download a 300 dpi PNG"
      >
        <ImageDown size={14} /> PNG · 300&nbsp;dpi
      </button>
      <button
        type="button"
        class="btn"
        disabled={!studio.image || studio.isBusy}
        onclick={() => studio.download('svg')}
        title="Download the vector SVG"
      >
        <FileCode2 size={14} /> SVG
      </button>
    </div>
  </div>

  <div class="map-frame relative grid min-h-[440px] place-items-center p-3">
    {#if src}
      <img
        src={src}
        alt="Generated choropleth map"
        class="max-h-[72vh] w-auto max-w-full rounded-lg"
      />
    {:else}
      <div class="skeleton h-[380px] w-full rounded-lg"></div>
    {/if}

    {#if studio.isBusy && studio.probe}
      <div
        class="absolute inset-0 grid place-items-center rounded-xl bg-ink-950/55 backdrop-blur-[2px]"
      >
        <span class="micro flex items-center gap-2 text-fg-soft">
          <Loader2 size={14} class="animate-spin" />
          {studio.phase === 'exporting' ? 'Exporting…' : 'Running Python…'}
        </span>
      </div>
    {/if}
  </div>

  {#if unmatched.length > 0}
    <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p class="micro m-0 flex items-center gap-2 font-bold text-amber-400">
        <AlertTriangle size={13} /> {unmatched.length} county
        {unmatched.length === 1 ? 'name' : 'names'} matched nothing
      </p>
      <p class="mt-1.5 mb-0 font-mono text-[0.72rem] leading-relaxed text-fg-soft">
        {unmatched.join(', ')}
      </p>
      <p class="mt-1.5 mb-0 text-[0.72rem] text-fg-dim">
        Check the spelling, or add the state code if the county lives elsewhere.
      </p>
    </div>
  {/if}

  {#if studio.failure && studio.probe}
    <div class="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
      <p class="micro m-0 flex items-center gap-2 font-bold text-red-400">
        <AlertTriangle size={13} /> Python raised an exception
      </p>
      <pre
        class="mt-2 mb-0 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[0.72rem] leading-relaxed text-fg-soft">{studio.failure.traceback ??
            studio.failure.message}</pre>
    </div>
  {/if}
</section>
