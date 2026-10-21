/**
 * Boots Pyodide in Node and runs the studio's own generated Python.
 *
 * A browser is the real target, but the riskiest part of this project is the
 * Python the generator emits -- it is written by hand inside a TypeScript
 * template, so a typo would only surface as a runtime error in a user's browser.
 * This harness closes that gap: it imports the *same* generateScript() the app
 * uses, executes its output against the *same* GeoJSON, and reports the same
 * things the in-browser probe reports (resolved versions, which CRS strings
 * actually resolve, whether matplotlib can draw text at all).
 *
 *   node --experimental-strip-types scripts/verify_python.mjs
 *
 * Deliberately outside the deploy path: the site build never runs it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { generateScript } from '../src/lib/pyscript.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data', 'us_counties.geojson');

/** Mirrors DEFAULT_CONFIG in src/lib/studio.svelte.ts. */
const baseConfig = {
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

const scRules = [
  {
    color: '#ef4444',
    names: ['Greenville', 'Pickens', 'Spartanburg', 'Anderson'],
    states: ['45'],
    unresolved: [],
  },
  { color: '#3b82f6', names: ['Charleston', 'Beaufort'], states: ['45'], unresolved: [] },
];

const INIT_PY = `
import base64, io, json, sys, warnings
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
import geopandas as gpd, fiona, pyproj, shapely
plt.rcParams["savefig.facecolor"] = "auto"
plt.rcParams["font.family"] = "DejaVu Sans"
warnings.filterwarnings(
    "ignore", message=".*parameter as float was deprecated.*", category=DeprecationWarning
)
`;

const PROBE_PY = `
from importlib.metadata import version as _version
def _v(n):
    try: return _version(n)
    except Exception: return "?"
versions = {n: _v(n) for n in
    ["geopandas","shapely","pyproj","fiona","matplotlib","pandas","numpy"]}
_p = gpd.GeoDataFrame({"geometry":[shapely.Point(-80.0,34.0)]}, crs="EPSG:4326")
crs = {}
for _c in ["EPSG:5070","ESRI:102003","EPSG:3857","EPSG:4326"]:
    try:
        _p.to_crs(_c); crs[_c] = True
    except Exception: crs[_c] = False
_warn = []
with warnings.catch_warnings(record=True) as _caught:
    warnings.simplefilter("always")
    _f = plt.figure(); _f.text(0.5, 0.5, "County Map 0123")
    _b = io.BytesIO(); _f.savefig(_b, format="png"); plt.close(_f)
    _warn = [str(w.message) for w in _caught if "glyph" in str(w.message).lower()]
json.dumps({"python": sys.version.split()[0], "versions": versions, "crs": crs,
            "fonts": "ok" if not _warn else _warn[0]})
`;

const STATS_PY = `
json.dumps({
    "counties": int(len(subset)),
    "highlighted": int((subset["color"] != BASE_COLOR).sum()),
    "crs": str(subset.crs),
    "unmatched": [n for _c, names, _s in rules for n in names
                  if not (subset["NAME"].str.casefold() == n.casefold()).any()],
})
`;

let failures = 0;

function report(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
}

const started = Date.now();
console.log('Loading Pyodide and the geospatial stack (node_modules/pyodide)');
const py = await loadPyodide();
await py.loadPackage(['geopandas', 'matplotlib'], {
  messageCallback: (message) => {
    if (/^Loading|^Loaded/.test(message)) console.log(`    ${message}`);
  },
});
console.log(`  runtime ready in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

await py.runPythonAsync(INIT_PY);

console.log('Runtime probe');
const probe = JSON.parse(await py.runPythonAsync(PROBE_PY));
console.log(`  python         ${probe.python}`);
for (const [name, version] of Object.entries(probe.versions)) {
  console.log(`  ${name.padEnd(14)} ${version}`);
}
console.log('  CRS resolution');
for (const [code, ok] of Object.entries(probe.crs)) {
  console.log(`    ${ok ? 'ok  ' : 'MISS'}  ${code}`);
}
console.log(`  matplotlib text  ${probe.fonts}\n`);

report('geopandas importable', probe.versions.geopandas !== '?', probe.versions.geopandas);
report('fiona importable (read_file engine)', probe.versions.fiona !== '?', probe.versions.fiona);
report('pyproj importable', probe.versions.pyproj !== '?', probe.versions.pyproj);
report('EPSG:5070 resolves', probe.crs['EPSG:5070'] === true);
report('ESRI:102003 resolves', probe.crs['ESRI:102003'] === true);
report('matplotlib draws text', probe.fonts === 'ok', probe.fonts);

// Stage the dataset exactly the way the worker stages it.
const bytes = new Uint8Array(readFileSync(DATA));
py.FS.mkdirTree('/data');
py.FS.writeFile('/data/us_counties.geojson', bytes);
console.log(`\nStaged ${(bytes.length / 1024 / 1024).toFixed(2)} MB of county boundaries\n`);

async function timeIt(fn) {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
}

// The worker parses the boundaries once and exposes them as BOUNDARIES, and the
// generated script prefers that frame.  Mirroring it here means the variants below
// exercise the same path the browser does, instead of the desktop fallback.
const parseMs = await timeIt(() =>
  py.runPythonAsync(`
BOUNDARIES = gpd.read_file("/data/us_counties.geojson", engine="fiona")
BOUNDARIES["STATEFP"] = BOUNDARIES["STATEFP"].astype(str).str.zfill(2)
BOUNDARIES["COUNTYFP"] = BOUNDARIES["COUNTYFP"].astype(str).str.zfill(3)
`),
);
console.log(`Parsed the boundaries once: ${parseMs} ms (paid at boot, not per render)\n`);

const variants = [
  { label: 'SC / two groups / Albers 5070', config: {}, rules: scRules },
  {
    label: 'SC / Albers 5070 / all labels',
    config: { showLabels: true, labelsHighlightedOnly: false },
    rules: scRules,
  },
  { label: 'SC / Web Mercator', config: { projection: 'EPSG:3857' }, rules: scRules },
  { label: 'SC / ESRI Albers', config: { projection: 'ESRI:102003' }, rules: scRules },
  { label: 'SC / unprojected WGS84', config: { projection: 'EPSG:4326' }, rules: scRules },
  { label: 'CONUS / any-state name', config: { scope: 'conus' }, rules: scRules },
  {
    label: 'CONUS / state-qualified Maricopa',
    config: { scope: 'conus' },
    rules: [{ color: '#f59e0b', names: ['Maricopa'], states: ['04'], unresolved: [] }],
  },
];

console.log('Generated-script execution');
let defaultView = null;
for (const [index, variant] of variants.entries()) {
  const config = { ...baseConfig, ...variant.config };
  const script = generateScript(config, variant.rules);
  try {
    const t0 = Date.now();
    await py.runPythonAsync('plt.close("all")');
    await py.runPythonAsync(script);
    const stats = JSON.parse(await py.runPythonAsync(STATS_PY));
    const png = py.FS.readFile('/tmp/map.png');
    if (index === 0) defaultView = png;
    const ms = Date.now() - t0;
    report(
      variant.label,
      stats.counties > 0 && png.length > 1000 && stats.unmatched.length === 0,
      `${stats.counties} counties, ${stats.highlighted} highlighted, ${stats.crs}, ` +
        `${(png.length / 1024).toFixed(0)} KB PNG, ${ms} ms` +
        (stats.unmatched.length ? `, UNMATCHED ${stats.unmatched.join('/')}` : ''),
    );
  } catch (error) {
    report(variant.label, false, String(error).split('\n').slice(-4).join(' | '));
  }
}

// Optional: write the default view out, used to refresh docs/preview.png.
const outPath = process.argv[2];
if (outPath && defaultView) {
  writeFileSync(outPath, Buffer.from(defaultView));
  console.log(`\nWrote the default view to ${outPath}`);
}

// Vector export re-saves the retained figure, exactly as the export path does.
console.log('\nVector export');
try {
  const svg = await py.runPythonAsync(`
_buffer = io.BytesIO()
fig.savefig(_buffer, format="svg", facecolor=fig.get_facecolor())
base64.b64encode(_buffer.getvalue()).decode("ascii")
`);
  const text = Buffer.from(svg, 'base64').toString('utf8');
  report(
    'SVG is genuine vector output',
    text.includes('<svg') && !text.includes('<image'),
    `${(text.length / 1024).toFixed(0)} KB, ${(text.match(/<path/g) ?? []).length} path elements`,
  );
} catch (error) {
  report('SVG export', false, String(error).split('\n').slice(-2).join(' | '));
}

// The script has to stand on its own, so it is run in a *fresh* namespace with no
// gpd, no plt and no BOUNDARIES.  Testing it with the worker's namespace still
// populated passes even when the generated script forgets its own imports -- which
// is exactly the bug this now guards against.
console.log('\nStandalone: the generated script in a clean namespace');
try {
  py.FS.writeFile('/home/pyodide/us_counties.geojson', bytes);
  const fresh = py.globals.get('dict')();
  const standaloneMs = await timeIt(() =>
    py.runPythonAsync(generateScript(baseConfig, scRules), { globals: fresh }),
  );
  const counts = JSON.parse(
    await py.runPythonAsync(
      `import json
json.dumps({
    "counties": int(len(subset)),
    "unmatched": [n for _c, names, _s in rules for n in names
                  if not (subset["NAME"].str.casefold() == n.casefold()).any()],
})`,
      { globals: fresh },
    ),
  );
  report(
    'runs standalone in a clean namespace',
    counts.counties === 46 && counts.unmatched.length === 0,
    `${counts.counties} counties in ${standaloneMs} ms (imports and reads the file itself)`,
  );
} catch (error) {
  report(
    'runs standalone in a clean namespace',
    false,
    String(error).split('\n').slice(-3).join(' | '),
  );
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
