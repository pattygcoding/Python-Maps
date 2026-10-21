<script lang="ts">
  import { Code2, Moon, Sun } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import BootOverlay from './lib/components/BootOverlay.svelte';
  import CodeDrawer from './lib/components/CodeDrawer.svelte';
  import ControlPanel from './lib/components/ControlPanel.svelte';
  import MapCanvas from './lib/components/MapCanvas.svelte';
  import { Studio } from './lib/studio.svelte';
  import { theme, toggleTheme } from './lib/theme.svelte';

  const studio = new Studio();
  let showCode = $state(false);

  onMount(() => {
    void studio.init();
  });
</script>

<div class="min-h-screen flex flex-col">
  <header class="px-5 sm:px-10 lg:px-14 pt-8">
    <div class="mx-auto w-full max-w-[1500px]">
      <div
        class="flex flex-wrap items-center justify-between gap-4 border-b border-line/10 pb-5"
      >
        <div class="flex items-center gap-3">
          <span class="micro font-bold text-accent">PG</span>
          <span class="micro text-fg-dim">/ Geospatial tooling</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="micro hidden items-center gap-2 text-fg-muted sm:inline-flex">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
            Python · WebAssembly
          </span>
          <button
            type="button"
            class="btn btn-icon"
            onclick={toggleTheme}
            title="Switch between the light and dark palette"
            aria-label="Toggle colour theme"
          >
            {#if theme.value === 'dark'}
              <Sun size={15} />
            {:else}
              <Moon size={15} />
            {/if}
          </button>
        </div>
      </div>

      <div class="rise-in pt-9 pb-8">
        <h1 class="accent-dot m-0 text-[2.1rem] font-bold leading-tight text-fg-strong sm:text-[2.75rem]">
          Python Map Studio
        </h1>
        <p class="mt-3.5 max-w-[760px] text-[0.94rem] leading-relaxed text-fg-muted">
          Build and style a U.S. county choropleth without writing code — while real
          <span class="text-fg-soft">geopandas</span>,
          <span class="text-fg-soft">shapely</span> and
          <span class="text-fg-soft">matplotlib</span> run entirely in your browser through
          <span class="text-fg-soft">Pyodide</span>. No server renders a single pixel. Open
          the drawer to read back the exact Python script for whatever you have configured.
        </p>
      </div>
    </div>
  </header>

  <main class="flex-1 px-5 pb-8 sm:px-10 lg:px-14">
    <div
      class="mx-auto grid w-full max-w-[1500px] gap-6 lg:grid-cols-[minmax(320px,370px)_minmax(0,1fr)]"
    >
      <ControlPanel {studio} />
      <MapCanvas {studio} />
    </div>
  </main>

  <CodeDrawer {studio} bind:open={showCode} />

  <footer class="px-5 pb-8 sm:px-10 lg:px-14">
    <div
      class="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-2 border-t border-line/10 pt-5"
    >
      <span class="micro text-fg-dim">
        Boundaries — U.S. Census Bureau TIGERweb, Jan 2026 vintage
      </span>
      <button type="button" class="micro inline-flex items-center gap-2 text-fg-muted hover:text-accent" onclick={() => (showCode = !showCode)}>
        <Code2 size={13} />
        {showCode ? 'Hide' : 'View'} the Python
      </button>
    </div>
  </footer>
</div>

<BootOverlay {studio} />
