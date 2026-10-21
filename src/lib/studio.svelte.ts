/**
 * Studio state.
 *
 * One class instance holds the form, the boot status and the latest render.  The
 * Python script is `$derived` from the form, so the code drawer updates on every
 * keystroke without touching the worker.
 */

import { indexStates, loadStates, resolveRules } from './counties';
import { generateScript } from './pyscript';
import type {
  BootStage,
  MapConfig,
  ProbeResult,
  ProjectionOption,
  RenderStats,
  RuleGroup,
  StateRecord,
  StateTable,
} from './types';
import { PyodideClient } from './workerClient';

/** Mirrors the original state_county_map.py example, so the default view is the
 *  same map the repository's scripts produce. */
export const DEFAULT_CONFIG: MapConfig = {
  scope: 'state',
  stateFips: '45',
  groups: [
    { id: 'group-1', color: '#ef4444', counties: 'Greenville, Pickens, Spartanburg, Anderson' },
    { id: 'group-2', color: '#3b82f6', counties: 'Charleston, Beaufort' },
  ],
  baseColor: '#e5e7eb',
  borderColor: '#1f2937',
  borderWidth: 0.5,
  background: '#ffffff',
  title: 'Upstate South Carolina Counties',
  subtitle: 'Selected counties highlighted',
  titleSize: 14,
  subtitleSize: 10,
  showLabels: false,
  labelSize: 6,
  labelsHighlightedOnly: true,
  projection: 'EPSG:5070',
  figWidth: 12,
  figHeight: 8,
};

export const COLOR_PRESETS: { name: string; value: string }[] = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Orange', value: '#f59e0b' },
  { name: 'Forest green', value: '#166534' },
  { name: 'Teal', value: '#0d9488' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Rose', value: '#e11d48' },
  { name: 'Slate', value: '#64748b' },
];

export const BASE_COLOR_PRESETS = ['#e5e7eb', '#f3f4f6', '#d1d5db', '#fed7aa', '#bfdbfe', '#bbf7d0'];

export const PROJECTIONS: ProjectionOption[] = [
  {
    id: 'EPSG:5070',
    label: 'Albers Equal Area',
    hint: 'EPSG:5070 — the standard CONUS projection',
  },
  {
    id: 'ESRI:102003',
    label: 'Albers Equal Area (ESRI)',
    hint: 'ESRI:102003 — needs the ESRI records in PROJ',
    optional: true,
  },
  { id: 'EPSG:3857', label: 'Web Mercator', hint: 'EPSG:3857 — what slippy maps use' },
  { id: 'EPSG:4326', label: 'Unprojected', hint: 'EPSG:4326 — raw lon/lat, shapes look squashed' },
];

export class Studio {
  config = $state<MapConfig>(structuredClone(DEFAULT_CONFIG));
  table = $state<StateTable | null>(null);
  probe = $state<ProbeResult | null>(null);
  phase = $state<'booting' | 'ready' | 'rendering' | 'exporting' | 'failed'>('booting');
  progress = $state<{ stage: BootStage; message: string; pct: number }>({
    stage: 'runtime',
    message: 'Starting the Python runtime…',
    pct: 0,
  });
  image = $state<{ mime: string; base64: string } | null>(null);
  stats = $state<RenderStats | null>(null);
  failure = $state<{ message: string; traceback?: string } | null>(null);

  byFips = $derived(this.table ? indexStates(this.table) : new Map<string, StateRecord>());
  defaultFips = $derived(this.config.scope === 'state' ? this.config.stateFips : null);
  rules = $derived(resolveRules(this.config.groups, this.defaultFips, this.byFips));

  /** Exactly what the drawer shows, and exactly what the worker executes. */
  script = $derived(generateScript(this.config, this.rules));

  get isBusy(): boolean {
    return this.phase === 'booting' || this.phase === 'rendering' || this.phase === 'exporting';
  }

  get canRender(): boolean {
    return this.phase === 'ready' || this.phase === 'rendering';
  }

  get stateOptions(): StateRecord[] {
    if (!this.table) return [];
    return [...this.table.states].sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Only offer a projection the runtime probe proved resolvable. */
  get projections(): ProjectionOption[] {
    return PROJECTIONS.filter((option) => {
      if (!option.optional) return true;
      return this.probe?.crs[option.id] === true;
    });
  }

  get selectedState(): StateRecord | undefined {
    return this.byFips.get(this.config.stateFips);
  }

  private client: PyodideClient | null = null;
  private awaitingRender: number | null = null;
  private awaitingExport: number | null = null;

  async init(): Promise<void> {
    try {
      this.table = await loadStates();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }

    this.client = new PyodideClient({
      onProgress: (stage, message, pct) => {
        this.progress = { stage, message, pct: pct ?? this.progress.pct };
      },
      onReady: (probe) => {
        this.probe = probe;
        this.phase = 'ready';
        if (!this.projections.some((option) => option.id === this.config.projection)) {
          this.config.projection = 'EPSG:5070';
        }
        // Render once automatically so the canvas is never empty on arrival.
        this.render();
      },
      onRender: (id, mime, base64, _script, stats) => {
        if (id === this.awaitingExport) {
          this.awaitingExport = null;
          this.phase = 'ready';
          this.saveFile(mime, base64);
          return;
        }
        if (id !== this.awaitingRender) return; // superseded by a newer request
        this.awaitingRender = null;
        this.image = { mime, base64 };
        this.stats = stats;
        this.phase = 'ready';
      },
      onError: (id, message, traceback) => {
        if (id !== null && id !== this.awaitingRender && id !== this.awaitingExport) return;
        this.awaitingRender = null;
        this.awaitingExport = null;
        this.fail(message, traceback);
      },
    });

    const dataUrl = new URL(
      `${import.meta.env.BASE_URL}data/us_counties.geojson`,
      location.href,
    ).href;
    this.client.boot(dataUrl);
  }

  private fail(message: string, traceback?: string): void {
    this.failure = { message, traceback };
    this.phase = 'failed';
  }

  render(): void {
    if (!this.client || !this.probe) return;
    this.failure = null;
    this.phase = 'rendering';
    this.awaitingRender = this.client.render(this.config, this.rules);
  }

  /** Export re-saves the retained figure in the worker, so the map is not recomputed. */
  download(format: 'png' | 'svg'): void {
    if (!this.client || !this.image) return;
    this.phase = 'exporting';
    this.awaitingExport = this.client.export(format, format === 'png' ? 300 : 110);
  }

  private saveFile(mime: string, base64: string): void {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.suggestedName()}.${mime === 'image/svg+xml' ? 'svg' : 'png'}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private suggestedName(): string {
    const scope =
      this.config.scope === 'state'
        ? (this.selectedState?.name ?? 'state').toLowerCase().replace(/\s+/g, '-')
        : 'contiguous-us';
    return `county-map-${scope}`;
  }

  update(patch: Partial<MapConfig>): void {
    Object.assign(this.config, patch);
  }

  setScope(scope: MapConfig['scope']): void {
    this.config.scope = scope;
  }

  addGroup(): void {
    const index = this.config.groups.length + 1;
    this.config.groups = [
      ...this.config.groups,
      { id: `group-${Date.now()}`, color: COLOR_PRESETS[index % COLOR_PRESETS.length].value, counties: '' },
    ];
  }

  removeGroup(id: string): void {
    this.config.groups = this.config.groups.filter((group) => group.id !== id);
  }

  updateGroup(id: string, patch: Partial<RuleGroup>): void {
    this.config.groups = this.config.groups.map((group) =>
      group.id === id ? { ...group, ...patch } : group,
    );
  }
}
