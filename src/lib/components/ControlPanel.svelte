<script lang="ts">
  import { Frame, Globe2, Layers, Palette, Play, Plus, RefreshCw, Type } from 'lucide-svelte';
  import type { Studio } from '../studio.svelte';
  import RuleRow from './RuleRow.svelte';

  const { studio }: { studio: Studio } = $props();
</script>

<aside class="panel h-fit p-5 lg:sticky lg:top-6">
  <!-- Scope ---------------------------------------------------------------- -->
  <section>
    <h2 class="micro m-0 flex items-center gap-2 font-bold text-accent">
      <Layers size={13} /> Scope
    </h2>

    <div class="mt-3 grid grid-cols-2 gap-1.5 rounded-xl border border-line/10 bg-console/50 p-1">
      {#each [{ id: 'conus', label: 'Contiguous U.S.' }, { id: 'state', label: 'Single state' }] as option (option.id)}
        <button
          type="button"
          class="rounded-lg px-2 py-2 text-[0.75rem] font-semibold transition-colors {studio.config
            .scope === option.id
            ? 'bg-accent text-on-accent'
            : 'text-fg-muted hover:text-fg'}"
          onclick={() => studio.setScope(option.id as 'conus' | 'state')}
        >
          {option.label}
        </button>
      {/each}
    </div>

    {#if studio.config.scope === 'state'}
      <label class="mt-3 block">
        <span class="micro text-fg-muted">State</span>
        <select class="ctl mt-1.5" bind:value={studio.config.stateFips}>
          {#each studio.stateOptions as state (state.fips)}
            <option value={state.fips}>
              {state.name} ({state.abbr}) · {state.fips}
            </option>
          {/each}
        </select>
      </label>
    {:else}
      <p class="mt-3 mb-0 text-[0.75rem] leading-relaxed text-fg-dim">
        Every county in the Lower 48. Add a two-letter code after a name
        (e.g. <span class="font-mono text-fg-muted">Greenville, SC</span>) because county
        names repeat across states.
      </p>
    {/if}
  </section>

  <hr class="my-5 border-0 border-t border-line/10" />

  <!-- Highlight rules ----------------------------------------------------- -->
  <section>
    <div class="flex items-center justify-between gap-3">
      <h2 class="micro m-0 flex items-center gap-2 font-bold text-accent">
        <Palette size={13} /> Highlight groups
      </h2>
      <button type="button" class="btn btn-icon" onclick={() => studio.addGroup()} title="Add a highlight group">
        <Plus size={14} />
      </button>
    </div>

    <div class="mt-3 space-y-3">
      {#each studio.config.groups as group, index (group.id)}
        <RuleRow
          {group}
          spec={studio.rules[index]}
          onUpdate={(patch) => studio.updateGroup(group.id, patch)}
          onRemove={() => studio.removeGroup(group.id)}
        />
      {/each}
      {#if studio.config.groups.length === 0}
        <p class="m-0 text-[0.75rem] text-fg-dim">
          No groups — every county will use the base colour.
        </p>
      {/if}
    </div>

    <div class="mt-3 grid grid-cols-2 gap-3">
      <label class="block">
        <span class="micro text-fg-muted">Base colour</span>
        <input
          type="color"
          class="swatch mt-1.5"
          bind:value={studio.config.baseColor}
          aria-label="Base colour for unselected counties"
        />
      </label>
      <label class="block">
        <span class="micro text-fg-muted">Border</span>
        <input
          type="color"
          class="swatch mt-1.5"
          bind:value={studio.config.borderColor}
          aria-label="County border colour"
        />
      </label>
    </div>

    <label class="mt-3 block">
      <span class="micro flex items-center justify-between text-fg-muted">
        Border width <span class="text-fg-soft">{studio.config.borderWidth.toFixed(2)} pt</span>
      </span>
      <input
        type="range"
        class="ctl mt-1.5"
        min="0"
        max="2"
        step="0.05"
        bind:value={studio.config.borderWidth}
      />
    </label>

    <label class="mt-3 block">
      <span class="micro text-fg-muted">Map background</span>
      <input
        type="color"
        class="swatch mt-1.5"
        bind:value={studio.config.background}
        aria-label="Map background colour"
      />
    </label>
  </section>

  <hr class="my-5 border-t border-line/10" />

  <!-- Typography --------------------------------------------------------- -->
  <section>
    <h2 class="micro m-0 flex items-center gap-2 font-bold text-accent"><Type size={13} /> Labels &amp; typography</h2>

    <label class="mt-3 block">
      <span class="micro text-fg-muted">Title</span>
      <input type="text" class="ctl mt-1.5" bind:value={studio.config.title} placeholder="Map title" />
    </label>

    <label class="mt-2.5 block">
      <span class="micro text-fg-muted">Subtitle / note</span>
      <input
        type="text"
        class="ctl mt-1.5"
        bind:value={studio.config.subtitle}
        placeholder="Optional subtitle"
      />
    </label>

    <div class="mt-3 grid grid-cols-2 gap-3">
      <label class="block">
        <span class="micro flex items-center justify-between text-fg-muted">
          Title <span class="text-fg-soft">{studio.config.titleSize}</span>
        </span>
        <input type="range" class="ctl mt-1.5" min="8" max="28" step="1" bind:value={studio.config.titleSize} />
      </label>
      <label class="block">
        <span class="micro flex items-center justify-between text-fg-muted">
          Subtitle <span class="text-fg-soft">{studio.config.subtitleSize}</span>
        </span>
        <input type="range" class="ctl mt-1.5" min="6" max="18" step="1" bind:value={studio.config.subtitleSize} />
      </label>
    </div>

    <label class="mt-3 flex items-center gap-2.5">
      <input type="checkbox" bind:checked={studio.config.showLabels} />
      <span class="text-[0.78rem] text-fg-soft">Show county names</span>
    </label>

    {#if studio.config.showLabels}
      <div class="mt-3 space-y-2.5 rounded-xl border border-line/10 bg-console/50 p-3">
        <label class="block">
          <span class="micro flex items-center justify-between text-fg-muted">
            Label size <span class="text-fg-soft">{studio.config.labelSize}</span>
          </span>
          <input type="range" class="ctl mt-1.5" min="3" max="14" step="1" bind:value={studio.config.labelSize} />
        </label>
        <label class="flex items-center gap-2.5">
          <input type="checkbox" bind:checked={studio.config.labelsHighlightedOnly} />
          <span class="text-[0.78rem] text-fg-soft">Only label highlighted counties</span>
        </label>
        <p class="m-0 text-[0.7rem] leading-relaxed text-fg-dim">
          Labels use <span class="font-mono">representative_point()</span>, so they never fall
          outside their own polygon. Naming every county on the Lower 48 is unreadable — try a
          single state.
        </p>
      </div>
    {/if}
  </section>

  <hr class="my-5 border-t border-line/10" />

  <!-- Projection ---------------------------------------------------------- -->
  <section>
    <h2 class="micro m-0 flex items-center gap-2 font-bold text-accent">
      <Globe2 size={13} /> Projection
    </h2>
    <div class="mt-3 space-y-1.5">
      {#each studio.projections as option (option.id)}
        <button
          type="button"
          class="w-full rounded-xl border px-3 py-2 text-left transition-colors {studio.config
            .projection === option.id
            ? 'border-accent bg-accent/10'
            : 'border-line/10 hover:border-line/25'}"
          onclick={() => studio.update({ projection: option.id })}
        >
          <span
            class="block text-[0.78rem] font-semibold {studio.config.projection === option.id
              ? 'text-accent'
              : 'text-fg'}">{option.label}</span
          >
          <span class="micro mt-0.5 block text-fg-dim">{option.hint}</span>
        </button>
      {/each}
    </div>
    {#if !studio.projections.some((option) => option.id === 'ESRI:102003')}
      <p class="micro mt-2 mb-0 text-fg-dim">
        ESRI:102003 hidden — this PROJ build has no ESRI records for it.
      </p>
    {/if}
  </section>

  <hr class="my-5 border-t border-line/10" />

  <!-- Figure -------------------------------------------------------------- -->
  <section>
    <h2 class="micro m-0 flex items-center gap-2 font-bold text-accent">
      <Frame size={13} /> Figure
    </h2>
    <div class="mt-3 grid grid-cols-2 gap-3">
      <label class="block">
        <span class="micro text-fg-muted">Width (in)</span>
        <input type="number" class="ctl mt-1.5" min="4" max="30" step="1" bind:value={studio.config.figWidth} />
      </label>
      <label class="block">
        <span class="micro text-fg-muted">Height (in)</span>
        <input type="number" class="ctl mt-1.5" min="4" max="30" step="1" bind:value={studio.config.figHeight} />
      </label>
    </div>

    <button
      type="button"
      class="btn btn-primary mt-4 w-full"
      disabled={!studio.canRender || studio.phase === 'booting'}
      onclick={() => studio.render()}
    >
      {#if studio.phase === 'rendering'}
        <RefreshCw size={14} class="animate-spin" /> Rendering in Python…
      {:else}
        <Play size={14} /> Generate map
      {/if}
    </button>

    {#if studio.probe}
      <dl class="micro mt-4 mb-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-fg-dim">
        <dt class="m-0">Python</dt>
        <dd class="m-0 text-fg-muted">{studio.probe.python}</dd>
        <dt class="m-0">Pyodide</dt>
        <dd class="m-0 text-fg-muted">{studio.probe.pyodide}</dd>
        <dt class="m-0">geopandas</dt>
        <dd class="m-0 text-fg-muted">{studio.probe.packages['geopandas'] ?? '—'}</dd>
        <dt class="m-0">matplotlib</dt>
        <dd class="m-0 text-fg-muted">{studio.probe.packages['matplotlib'] ?? '—'}</dd>
        <dt class="m-0">Boot</dt>
        <dd class="m-0 text-fg-muted">{(studio.probe.bootMs / 1000).toFixed(1)} s</dd>
        <dt class="m-0">Fonts</dt>
        <dd class="m-0 {studio.probe.fonts === 'ok' ? 'text-fg-muted' : 'text-amber-400'}">
          {studio.probe.fonts === 'ok' ? 'ok' : studio.probe.fonts}
        </dd>
      </dl>
    {/if}
  </section>
</aside>
