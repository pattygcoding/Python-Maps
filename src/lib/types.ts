/**
 * Shared shapes for the studio, the Python generator and the worker protocol.
 *
 * The worker and the main thread both import from here, so a config change can
 * never desynchronise the preview from the script that produced it.
 */

export type Scope = 'conus' | 'state';

/** Every projection the picker offers. Albers is the default for CONUS. */
export type ProjectionId = 'EPSG:5070' | 'ESRI:102003' | 'EPSG:3857' | 'EPSG:4326';

export interface ProjectionOption {
  id: ProjectionId;
  label: string;
  hint: string;
  /** Only offered when the runtime probe confirms pyproj/PROJ can resolve it. */
  optional?: boolean;
}

export interface StateRecord {
  fips: string;
  abbr: string;
  name: string;
  conus: boolean;
  territory: boolean;
}

export interface StateTable {
  source: string;
  default: string;
  states: StateRecord[];
}

/** One "Add Highlight Group" row: a fill colour plus the counties to paint. */
export interface RuleGroup {
  id: string;
  color: string;
  /** Raw textarea text, e.g. "Greenville, Pickens, Spartanburg" or "Greenville, SC". */
  counties: string;
}

/** A group after parsing: counties resolved to concrete (name, state) pairs. */
export interface RuleSpec {
  color: string;
  names: string[];
  /** STATEFP codes; empty means "match this name in any state". */
  states: string[];
  /** Names the user typed that did not resolve to a known state, for feedback. */
  unresolved: string[];
}

export interface MapConfig {
  scope: Scope;
  /** STATEFP of the selected state when scope === 'state'. */
  stateFips: string;

  groups: RuleGroup[];
  baseColor: string;
  borderColor: string;
  borderWidth: number;
  /** Figure/axes face colour. White by default so the map reads like a print. */
  background: string;

  title: string;
  subtitle: string;
  titleSize: number;
  subtitleSize: number;

  showLabels: boolean;
  labelSize: number;
  labelsHighlightedOnly: boolean;

  projection: ProjectionId;
  figWidth: number;
  figHeight: number;
}

/* -------------------------------------------------------------------------- */
/* Worker protocol                                                            */
/* -------------------------------------------------------------------------- */

export type BootStage = 'runtime' | 'packages' | 'data' | 'python' | 'ready' | 'error';

export interface ProgressMessage {
  type: 'progress';
  stage: BootStage;
  message: string;
  /** 0..1 when the runtime can report byte progress, otherwise null. */
  pct: number | null;
}

export interface ProbeResult {
  python: string;
  pyodide: string;
  packages: Record<string, string>;
  /** Which of the offered CRS strings actually resolved in PROJ. */
  crs: Record<string, boolean>;
  /** "ok" when matplotlib rendered text without missing glyphs. */
  fonts: string;
  bootMs: number;
}

export interface RenderStats {
  counties: number;
  highlighted: number;
  /** "Name (STATE)" for every requested county that matched nothing. */
  unmatched: string[];
  ms: number;
}

export interface ReadyMessage {
  type: 'ready';
  probe: ProbeResult;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  mime: string;
  base64: string;
  script: string;
  stats: RenderStats;
}

export interface FailureMessage {
  type: 'error';
  id: number | null;
  message: string;
  traceback?: string;
}

export type WorkerMessage = ProgressMessage | ReadyMessage | ResultMessage | FailureMessage;

export type WorkerRequest =
  | { type: 'boot'; dataUrl: string }
  | { type: 'render'; id: number; config: MapConfig; rules: RuleSpec[] }
  | { type: 'export'; id: number; format: 'png' | 'svg'; dpi: number };

export interface ExportResult {
  mime: string;
  base64: string;
}
