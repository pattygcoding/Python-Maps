<script lang="ts">
  import { AlertTriangle, Check } from 'lucide-svelte';
  import type { Studio } from '../studio.svelte';

  const { studio }: { studio: Studio } = $props();

  // Ordered exactly as the worker reports them: the current step is derived from
  // the index of the reported stage id, so the list and the worker must agree.
  const STAGES: { id: string; label: string }[] = [
    { id: 'runtime', label: 'Python runtime' },
    { id: 'packages', label: 'GeoPandas, Shapely, pyproj, matplotlib' },
    { id: 'python', label: 'Importing the libraries' },
    { id: 'data', label: 'County boundaries' },
  ];

  // 'ready' is not one of the steps, so it means every step is finished.
  const currentIndex = $derived(
    studio.progress.stage === 'ready'
      ? STAGES.length
      : Math.max(
          0,
          STAGES.findIndex((stage) => stage.id === studio.progress.stage),
        ),
  );
</script>

{#if studio.phase === 'booting' || (studio.phase === 'failed' && !studio.probe)}
  <div class="fixed inset-0 z-50 grid place-items-center bg-ink-950/95 px-6 backdrop-blur-sm">
    <div class="panel w-full max-w-[440px] p-7">
      <p class="micro m-0 font-bold text-accent">Loading</p>
      <h2 class="mt-3 mb-1.5 text-lg font-semibold text-fg-strong">
        Booting Python in your browser
      </h2>
      <p class="m-0 text-[0.8rem] leading-relaxed text-fg-muted">
        The first visit downloads roughly 30&nbsp;MB of WebAssembly — the interpreter, then
        the geospatial wheel set. It is cached afterwards, so returning visits skip straight
        to rendering.
      </p>

      {#if studio.phase === 'failed'}
        <div class="mt-5 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <div class="flex items-start gap-2 text-[0.78rem] text-fg-soft">
            <AlertTriangle size={14} class="mt-0.5 flex-none text-red-400" />
            <span>{studio.failure?.message}</span>
          </div>
        </div>
      {:else}
        <div class="mt-5">
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-line/12">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-300"
              style="width: {studio.progress.pct}%"
            ></div>
          </div>
          <div class="mt-2.5 flex items-baseline justify-between gap-3">
            <span class="micro text-fg-soft">{studio.progress.message}</span>
            <span class="micro text-fg-dim">{studio.progress.pct}%</span>
          </div>
        </div>
      {/if}

      <ul class="mt-6 m-0 list-none space-y-2.5 p-0">
        {#each STAGES as stage, index (stage.id)}
          {@const done = index < currentIndex || studio.phase === 'failed'}
          {@const active = index === currentIndex && studio.phase !== 'failed'}
          <li class="flex items-center gap-2.5">
            <span
              class="grid h-4 w-4 flex-none place-items-center rounded-full border text-[9px] {done
                ? 'border-accent bg-accent text-on-accent'
                : active
                  ? 'border-accent text-accent'
                  : 'border-line/20 text-transparent'}"
            >
              {#if done}
                <Check size={10} strokeWidth={3} />
              {:else if active}
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>
              {/if}
            </span>
            <span
              class="text-[0.78rem] {done
                ? 'text-fg-muted'
                : active
                  ? 'text-fg'
                  : 'text-fg-dim'}">{stage.label}</span
            >
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
