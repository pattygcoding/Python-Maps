/**
 * Where does the WebAssembly runtime actually spend its time?
 *
 * Guessing at this is how you optimise the wrong thing: the slow parts of this
 * pipeline are not where they look.  This boots the same Pyodide build the
 * browser uses, against the same committed dataset, and times every phase
 * separately -- package install, each import, read_file, to_crs, the colour
 * lookup, plot and savefig -- then repeats a render to show what a second,
 * cached render would cost.
 *
 *   node --experimental-strip-types scripts/profile_python.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data', 'us_counties.geojson');

const row = (label, seconds, note = '') =>
  console.log(
    `  ${label.padEnd(30)} ${(seconds * 1000).toFixed(0).padStart(6)} ms   ${note}`,
  );

let t0 = Date.now();
console.log('Booting');
const py = await loadPyodide();
row('loadPyodide', (Date.now() - t0) / 1000);

// Per-package download sizes: the install is the part of first load the user
// waits longest on, so it is worth seeing which wheels dominate it.
const packages = [];
let current = null;
t0 = Date.now();
await py.loadPackage(['geopandas', 'matplotlib'], {
  progressCallback: (item) => {
    if (item.name !== current?.name) {
      current = { name: item.name, total: item.total ?? 0 };
      packages.push(current);
    } else if (item.total) {
      current.total = item.total;
    }
  },
});
row('loadPackage', (Date.now() - t0) / 1000, `${packages.length} packages`);

const totalBytes = packages.reduce((sum, p) => sum + (p.total || 0), 0);
console.log(`\n  downloaded ${(totalBytes / 1024 / 1024).toFixed(1)} MB across ${packages.length} wheels`);
for (const p of [...packages].sort((a, b) => b.total - a.total).slice(0, 8)) {
  console.log(`    ${p.name.padEnd(18)} ${(p.total / 1024 / 1024).toFixed(2)} MB`);
}

console.log('\nImports (this is what the boot bar sits at 88% for)');
const timings = JSON.parse(
  await py.runPythonAsync(`
import time, json
_t = {}
_t0 = time.perf_counter(); import geopandas as gpd; _t["geopandas"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); import matplotlib; matplotlib.use("AGG"); _t["matplotlib"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); import matplotlib.pyplot as plt; _t["pyplot"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); from shapely.geometry import Point; _t["shapely"] = time.perf_counter() - _t0
json.dumps(_t)
`),
);
for (const [name, seconds] of Object.entries(timings)) row(`import ${name}`, seconds);
row('imports total', Object.values(timings).reduce((a, b) => a + b, 0));

// Stage the dataset the way the worker does.
const bytes = new Uint8Array(readFileSync(DATA));
py.FS.mkdirTree('/data');
py.FS.writeFile('/data/us_counties.geojson', bytes);

console.log('\nFirst render, phase by phase');
const phases = JSON.parse(
  await py.runPythonAsync(`
import time, json, io
import matplotlib.pyplot as plt
plt.rcParams["font.family"] = "DejaVu Sans"
_t = {}
_t0 = time.perf_counter(); gdf = gpd.read_file("/data/us_counties.geojson", engine="fiona"); _t["read_file (3.79 MB GeoJSON)"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); subset = gdf[gdf["STATEFP"] == "45"].copy(); _t["filter to one state"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); projected = subset.to_crs("EPSG:5070"); _t["to_crs"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); subset = projected; _t["assign"] = time.perf_counter() - _t0
_t0 = time.perf_counter()
fig, ax = plt.subplots(figsize=(12, 8)); fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#ffffff")
subset.plot(ax=ax, color="#e5e7eb", edgecolor="#1f2937", linewidth=0.5)
ax.axis("off"); fig.tight_layout()
_t["plot + layout"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); fig.savefig(io.BytesIO(), format="png", dpi=110); _t["savefig png"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); fig.savefig(io.BytesIO(), format="svg"); _t["savefig svg"] = time.perf_counter() - _t0
json.dumps(_t)
`),
);
for (const [name, seconds] of Object.entries(phases)) row(name, seconds);
row('first render total', Object.values(phases).reduce((a, b) => a + b, 0));

console.log('\nThe two costs that repeat on every single render');
const repeat = JSON.parse(
  await py.runPythonAsync(`
import time, json
_t = {}
_t0 = time.perf_counter(); _again = gpd.read_file("/data/us_counties.geojson", engine="fiona"); _t["read_file again"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); _cached = gdf.copy(); _t["copy cached frame"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); projected.to_crs("EPSG:5070"); _t["to_crs on 46 counties"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); gdf.to_crs("EPSG:5070"); _t["to_crs on all 3,235"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); gdf.geometry.representative_point(); _t["representative_point all"] = time.perf_counter() - _t0
json.dumps(_t)
`),
);
for (const [name, seconds] of Object.entries(repeat)) row(name, seconds);

// The Lower 48 is the slow case and the one worth knowing the shape of: if the
// cost is in plotting rather than in anything avoidable, that is where to stop.
console.log('\nLower 48 render, phase by phase (the slow case)');
const conus = JSON.parse(
  await py.runPythonAsync(`
import time, json, io
import matplotlib.pyplot as plt
_t = {}
_t0 = time.perf_counter()
big = gdf[~gdf["STATEFP"].isin(["02", "15", "60", "66", "69", "72", "78"])].copy()
_t["filter to Lower 48"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); big["color"] = "#e5e7eb"; _t["add colour column"] = time.perf_counter() - _t0
_t0 = time.perf_counter()
_before = big["color"].tolist()
_colours = [c for c in _before]
_t["build colour list"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); projected_big = big.to_crs("EPSG:5070"); _t["to_crs (3,109 counties)"] = time.perf_counter() - _t0
_t0 = time.perf_counter()
fig, ax = plt.subplots(figsize=(12, 8)); fig.patch.set_facecolor("#ffffff"); ax.set_facecolor("#ffffff")
projected_big.plot(ax=ax, color=projected_big["color"], edgecolor="#1f2937", linewidth=0.5)
ax.axis("off"); fig.tight_layout()
_t["plot + layout (3,109 patches)"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); fig.savefig(io.BytesIO(), format="png", dpi=110); _t["savefig png 110"] = time.perf_counter() - _t0
_t0 = time.perf_counter(); fig.savefig(io.BytesIO(), format="png", dpi=80); _t["savefig png 80"] = time.perf_counter() - _t0
json.dumps(_t)
`),
);
for (const [name, seconds] of Object.entries(conus)) row(name, seconds);
row('Lower 48 total', Object.values(conus).reduce((a, b) => a + b, 0));

// DataFrame.apply(axis=1) is the classic pandas slow path, and the generated
// script uses it to stay close to the original hand-written scripts.
console.log('\napply(axis=1) versus a vectorised lookup, on the Lower 48');
const applyCost = JSON.parse(
  await py.runPythonAsync(`
import time, json
names = {"greenville", "pickens", "spartanburg", "anderson"}
_t = {}
_t0 = time.perf_counter()
def assign(row):
    return "#ef4444" if row["NAME"].casefold() in names else "#e5e7eb"
big["color"] = big.apply(assign, axis=1)
_t["apply(axis=1)"] = time.perf_counter() - _t0
_t0 = time.perf_counter()
folded = big["NAME"].str.casefold()
big["color"] = folded.isin(names).map({True: "#ef4444", False: "#e5e7eb"})
_t["vectorised"] = time.perf_counter() - _t0
json.dumps(_t)
`),
);
for (const [name, seconds] of Object.entries(applyCost)) row(name, seconds);
