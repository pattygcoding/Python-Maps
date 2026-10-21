/**
 * Pyodide worker.
 *
 * Boots a WebAssembly Python, installs the geospatial stack and executes the
 * generated map script, then streams the rendered figure back to the main thread.
 *
 * Two things here are non-obvious and deliberate:
 *
 *  1. Pyodide is loaded as an ES module and the worker is created with
 *     `{ type: 'module' }`.  Pyodide's docs are explicit that classic workers
 *     using importScripts() are no longer supported, because its loader is an ES
 *     module.  Vite is configured with `worker.format: 'es'` to match.
 *
 *  2. `pyodide.loadPackage` is used rather than micropip.  geopandas, shapely,
 *     pyproj, fiona and matplotlib are all first-class Pyodide packages, so the
 *     whole dependency chain resolves from the runtime's own lockfile -- no
 *     compilation, no PyPI round trip.
 */

import { generateScript } from '../lib/pyscript';
import type {
  BootStage,
  MapConfig,
  ProbeResult,
  RuleSpec,
  WorkerMessage,
  WorkerRequest,
} from '../lib/types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const PYODIDE_VERSION = '314.0.7';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const DATA_PATH = '/data/us_counties.geojson';
const PACKAGES = ['geopandas', 'matplotlib'];

/** Every CRS the picker can offer.  Albers-via-ESRI is probe-gated. */
const PROBED_CRS = ['EPSG:5070', 'ESRI:102003', 'EPSG:3857', 'EPSG:4326'];

interface PyodideApi {
  loadPackage(
    names: string[],
    options?: {
      messageCallback?: (message: string) => void;
      progressCallback?: (progress: { name: string; loaded: number; total: number }) => void;
    },
  ): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
}

let pyodide: PyodideApi | null = null;
let bootPromise: Promise<ProbeResult> | null = null;

function post(message: WorkerMessage): void {
  ctx.postMessage(message);
}

function progress(stage: BootStage, message: string, pct: number | null = null): void {
  post({ type: 'progress', stage, message, pct });
}

/* -------------------------------------------------------------------------- */
/* Python harness                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Runs once.  Establishes the Agg backend (there is no display in a browser) and
 * the rcParams the studio wants rather than the map author.  Deliberately not part
 * of the script shown in the drawer, which should stay portable to a desktop.
 */
const INIT_PY = `
import base64, io, json, sys, time, warnings
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
import geopandas as gpd, fiona, pyproj, shapely

plt.rcParams["savefig.facecolor"] = "auto"
plt.rcParams["font.family"] = "DejaVu Sans"

# matplotlib 3.10 emits this from inside its own Agg save path whenever savefig()
# is handed a non-default dpi, even when the dpi is an int.  It is upstream,
# harmless and fixed in 3.12; it is filtered here rather than in the generated
# script so that the script shown to the user stays clean when run locally.
warnings.filterwarnings(
    "ignore", message=".*parameter as float was deprecated.*", category=DeprecationWarning
)
`;

const PROBE_PY = `
from importlib.metadata import version as _version

def _v(name):
    try:
        return _version(name)
    except Exception:
        return "?"

packages = {n: _v(n) for n in
            ["geopandas", "shapely", "pyproj", "fiona", "matplotlib", "pandas", "numpy"]}

# Exercise each CRS for real rather than trusting that the code exists: this is
# what decides whether the Albers-via-ESRI option is offered in the picker.
_probe = gpd.GeoDataFrame({"geometry": [shapely.Point(-80.0, 34.0)]}, crs="EPSG:4326")
crs = {}
for _code in ${JSON.stringify(PROBED_CRS)}:
    try:
        _probe.to_crs(_code)
        crs[_code] = True
    except Exception:
        crs[_code] = False

# matplotlib in WASM has no system font directory, so confirm a real glyph run
# works instead of discovering missing text on the user's first render.
_font_warnings = []
with warnings.catch_warnings(record=True) as _caught:
    warnings.simplefilter("always")
    _fig = plt.figure()
    _fig.text(0.5, 0.5, "County Map 0123")
    _buffer = io.BytesIO()
    _fig.savefig(_buffer, format="png")
    plt.close(_fig)
    _font_warnings = [str(w.message) for w in _caught if "glyph" in str(w.message).lower()]

json.dumps({
    "python": sys.version.split()[0],
    "packages": packages,
    "crs": crs,
    "fonts": "ok" if not _font_warnings else _font_warnings[0],
})
`;

/**
 * Runs after every render.  Reads back the PNG the script itself wrote, and
 * reports how many counties each rule actually matched -- without that, a typo'd
 * county name produces a silently unstyled map with no clue why.
 */
const TAIL_PY = `
_report = {
    "counties": int(len(subset)),
    "highlighted": int((subset["color"] != BASE_COLOR).sum()),
    "unmatched": [],
}
for _colour, _names, _states in rules:
    for _name in _names:
        if not (subset["NAME"].str.casefold() == _name.casefold()).any():
            _suffix = " [" + ", ".join(_states) + "]" if _states else ""
            _report["unmatched"].append(_name + _suffix)

with open(out_path, "rb") as _handle:
    _png = base64.b64encode(_handle.read()).decode("ascii")

json.dumps({"report": _report, "png": _png})
`;

/** Re-saves the retained figure, so an export never recomputes the map. */
function exportPy(format: 'png' | 'svg', dpi: number): string {
  return `
_buffer = io.BytesIO()
fig.savefig(_buffer, format=${JSON.stringify(format)}, dpi=${dpi}, facecolor=fig.get_facecolor())
base64.b64encode(_buffer.getvalue()).decode("ascii")
`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot(dataUrl: string): Promise<ProbeResult> {
  const started = performance.now();

  progress('runtime', 'Downloading the Python runtime…', 4);
  const module = (await import(/* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<PyodideApi>;
  };
  pyodide = await module.loadPyodide({ indexURL: PYODIDE_INDEX });

  const seen = new Set<string>();
  await pyodide.loadPackage(PACKAGES, {
    progressCallback: (item) => {
      if (item.name) seen.add(item.name);
      // Coarse but honest: interpolate across the packages resolved so far, and
      // show exact byte counts for whatever is downloading right now.
      const share = Math.min(seen.size / 12, 1);
      const detail = item.total
        ? `${item.name} — ${formatBytes(item.loaded)} of ${formatBytes(item.total)}`
        : item.name;
      progress('packages', `Installing ${detail}…`, 12 + Math.round(share * 58));
    },
  });

  progress('data', 'Loading U.S. county boundaries…', 76);
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Could not load ${dataUrl} (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  pyodide.FS.mkdirTree('/data');
  pyodide.FS.writeFile(DATA_PATH, bytes);

  progress('python', 'Starting the Python session…', 88);
  await pyodide.runPythonAsync(INIT_PY);

  const raw = (await pyodide.runPythonAsync(PROBE_PY)) as string;
  const probe = JSON.parse(raw) as Omit<ProbeResult, 'pyodide' | 'bootMs'>;
  progress('ready', 'Ready', 100);
  return { ...probe, pyodide: PYODIDE_VERSION, bootMs: Math.round(performance.now() - started) };
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

interface RenderJob {
  id: number;
  config: MapConfig;
  rules: RuleSpec[];
}

let queued: RenderJob | null = null;
let busy = false;

function describe(error: unknown): { message: string; traceback?: string } {
  if (error instanceof Error) return { message: error.message, traceback: error.stack };
  return { message: String(error) };
}

async function runRender(job: RenderJob): Promise<void> {
  if (!pyodide) throw new Error('The Python runtime is not ready yet.');

  const script = generateScript(job.config, job.rules);
  // Close the previous figure first; otherwise every render leaves one behind in
  // the WASM heap for the lifetime of the worker.
  await pyodide.runPythonAsync('plt.close("all")');

  const started = performance.now();
  await pyodide.runPythonAsync(script);
  const raw = (await pyodide.runPythonAsync(TAIL_PY)) as string;
  const parsed = JSON.parse(raw) as {
    report: { counties: number; highlighted: number; unmatched: string[] };
    png: string;
  };

  post({
    type: 'result',
    id: job.id,
    mime: 'image/png',
    base64: parsed.png,
    script,
    stats: { ...parsed.report, ms: Math.round(performance.now() - started) },
  });
}

async function pump(): Promise<void> {
  if (busy || !queued) return;
  const job = queued;
  queued = null;
  busy = true;
  try {
    await runRender(job);
  } catch (error) {
    post({ type: 'error', id: job.id, ...describe(error) });
  } finally {
    busy = false;
    void pump();
  }
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'boot') {
    bootPromise ??= boot(request.dataUrl);
    bootPromise
      .then((probe) => post({ type: 'ready', probe }))
      .catch((error) => {
        bootPromise = null;
        const detail = describe(error);
        progress('error', detail.message, null);
        post({ type: 'error', id: null, ...detail });
      });
    return;
  }

  if (request.type === 'render') {
    // Latest request wins: only the newest config is worth computing while a user
    // drags a slider.  Results carry their id so the UI can discard stale ones.
    queued = { id: request.id, config: request.config, rules: request.rules };
    void pump();
    return;
  }

  if (request.type === 'export') {
    void (async () => {
      try {
        if (!pyodide) throw new Error('Render a map before exporting it.');
        const base64 = (await pyodide.runPythonAsync(
          exportPy(request.format, request.dpi),
        )) as string;
        post({
          type: 'result',
          id: request.id,
          mime: request.format === 'svg' ? 'image/svg+xml' : 'image/png',
          base64,
          script: '',
          stats: { counties: 0, highlighted: 0, unmatched: [], ms: 0 },
        });
      } catch (error) {
        post({ type: 'error', id: request.id, ...describe(error) });
      }
    })();
  }
};


