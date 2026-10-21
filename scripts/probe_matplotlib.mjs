/**
 * Which text-placement call triggers matplotlib 3.10's
 * "The x parameter as float was deprecated ... Use int(x) instead." warning?
 *
 * The generated script showed that warning on every variant, so one of the title,
 * subtitle or axis calls is responsible.  Rather than guess -- or blanket-wrap
 * coordinates in int() and silently lose precision -- each candidate is exercised
 * on its own with warnings captured, so the fix can be precise.
 *
 *   node --experimental-strip-types scripts/probe_matplotlib.mjs
 */

import { loadPyodide } from 'pyodide';

const py = await loadPyodide();
await py.loadPackage(['matplotlib']);
await py.runPythonAsync(`
import io, json, warnings
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
plt.rcParams["font.family"] = "DejaVu Sans"
`);

const PROBE = `
def _check(label, fn):
    figs_before = set(plt.get_fignums())
    caught = []
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        fn()
        caught = [str(x.message) for x in w if "deprecated" in str(x.message).lower()]
    plt.close("all")
    return {"label": label, "warned": bool(caught), "messages": caught[:2]}

fig, ax = plt.subplots(figsize=(6, 4))
ax.plot([0, 1], [0, 1])
results = [
    _check("ax.set_title(title)", lambda: ax.set_title("Title", fontsize=14, pad=14)),
    _check("ax.text(0.5, 1.012, sub, transAxes)",
        lambda: ax.text(0.5, 1.012, "Sub", transform=ax.transAxes, ha="center")),
    _check("fig.text(0.5, 0.94, sub)",
        lambda: fig.text(0.5, 0.94, "Sub", ha="center")),
    _check("ax.annotate(name, xy=(float, float))",
        lambda: ax.annotate("Greenville", xy=(0.5, 0.5), ha="center", va="center", fontsize=6)),
    _check("ax.annotate(name, xy=(float, float), xycoords='data')",
        lambda: ax.annotate("Pickens", xy=(0.4, 0.6), xycoords="data", ha="center", fontsize=6)),
    _check("ax.axis('off')", lambda: ax.axis("off")),
    _check("fig.tight_layout()", lambda: fig.tight_layout()),
    _check("fig.savefig(dpi=110)",
        lambda: fig.savefig(io.BytesIO(), format="png", dpi=110)),
]
json.dumps(results)
`;

for (const result of JSON.parse(await py.runPythonAsync(PROBE))) {
  console.log(`${result.warned ? 'WARNS ' : 'clean '}  ${result.label}`);
  for (const message of result.messages) {
    console.log(`          ${message.replace(/\n/g, ' ')}`);
  }
}
