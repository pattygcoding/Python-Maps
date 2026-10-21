/**
 * Reproduces the worker's exact render sequence in Node.
 *
 * The verify harness runs the generated map script, but it never runs the two
 * things the worker wraps around it: the `plt.close("all")` that precedes it and
 * the TAIL_PY that reads the PNG back and builds the diagnostics.  If a render
 * hangs in the browser but not in the harness, the difference has to be in that
 * wrapper -- so this runs the wrapper verbatim, twice, with timings.
 *
 *   node --experimental-strip-types scripts/repro_render.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { generateScript } from '../src/lib/pyscript.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data', 'us_counties.geojson');

// ---- verbatim copies of the worker's harness ---------------------------------
const GEOPANDAS_PY = `
import base64, io, json, sys, warnings
import geopandas as gpd
import fiona, pyproj, shapely
`;
const MATPLOTLIB_PY = `
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
plt.rcParams["savefig.facecolor"] = "auto"
plt.rcParams["font.family"] = "DejaVu Sans"
`;
const LOAD_PY = `
BOUNDARIES = gpd.read_file("/data/us_counties.geojson", engine="fiona")
BOUNDARIES["STATEFP"] = BOUNDARIES["STATEFP"].astype(str).str.zfill(2)
BOUNDARIES["COUNTYFP"] = BOUNDARIES["COUNTYFP"].astype(str).str.zfill(3)
COUNTY_COUNT = len(BOUNDARIES)
`;
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

const config = {
  scope: 'state',
  stateFips: '45',
  groups: [],
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
const rules = [
  {
    color: '#ef4444',
    names: ['Greenville', 'Pickens', 'Spartanburg', 'Anderson'],
    states: ['45'],
    unresolved: [],
  },
  { color: '#3b82f6', names: ['Charleston', 'Beaufort'], states: ['45'], unresolved: [] },
];

const step = async (label, code) => {
  const t0 = Date.now();
  const out = await py.runPythonAsync(code);
  console.log(`  ${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)} ms`);
  return out;
};

console.log('Booting (mirroring the worker)');
const py = await loadPyodide();
await py.loadPackage(['geopandas', 'matplotlib']);
await py.runPythonAsync(GEOPANDAS_PY);
await py.runPythonAsync(MATPLOTLIB_PY);

const bytes = new Uint8Array(readFileSync(DATA));
py.FS.mkdirTree('/data');
py.FS.writeFile('/data/us_counties.geojson', bytes);
await step('LOAD_PY', LOAD_PY);

const script = generateScript(config, rules);

// The exact sequence runRender performs, twice -- the app renders once on boot
// and again whenever the user asks.
for (const pass of [1, 2]) {
  console.log(`\nRender pass ${pass} (verbatim worker sequence)`);
  try {
    await step('plt.close("all")', 'plt.close("all")');
    await step('runPythonAsync(script)', script);
    const raw = await step('runPythonAsync(TAIL_PY)', TAIL_PY);
    const parsed = JSON.parse(raw);
    console.log(
      `  -> ${parsed.report.counties} counties, ${parsed.report.highlighted} highlighted, ` +
        `${parsed.report.unmatched.length} unmatched, ` +
        `${(parsed.png.length / 1024).toFixed(0)} KB base64`,
    );
  } catch (error) {
    console.log(`  !! FAILED: ${String(error).split('\n').slice(-3).join(' | ')}`);
  }
}
console.log('\nNo hang in Node.');
