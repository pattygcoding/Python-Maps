/**
 * Map configuration -> Python source.
 *
 * This module is imported by BOTH the main thread (so the code drawer updates on
 * every keystroke, with no worker round-trip) and the worker (which executes what
 * it generates and sends the same text back).  Because there is one generator,
 * the script shown in the drawer is byte-identical to the script that ran -- it
 * cannot drift out of sync the way a separately-maintained copy would.
 */

import type { MapConfig, ProjectionId, RuleSpec } from './types';

export const PREVIEW_DPI = 110;
/** Where the script writes its figure. Also what the worker reads back out. */
export const OUTPUT_PATH = '/tmp/map.png';

/** STATEFP codes excluded from the "Contiguous U.S." scope (AK, HI + territories). */
export const NON_CONUS_FIPS = ['02', '15', '60', '66', '69', '72', '78'];

export const PROJECTION_LABELS: Record<ProjectionId, string> = {
  'EPSG:5070': 'Albers Equal Area (EPSG:5070)',
  'ESRI:102003': 'Albers Equal Area (ESRI:102003)',
  'EPSG:3857': 'Web Mercator (EPSG:3857)',
  'EPSG:4326': 'Unprojected WGS84 (EPSG:4326)',
};

/**
 * JSON string syntax is a subset of Python string syntax, so this is a correct
 * and complete Python literal emitter -- including for names with apostrophes
 * such as "St. Mary's".
 */
function pyStr(value: string): string {
  return JSON.stringify(value);
}

function pyTuple(values: string[]): string {
  const inner = values.map(pyStr).join(', ');
  return values.length === 1 ? `(${inner},)` : `(${inner})`;
}

/** A name list, wrapped so long lists stay readable in the drawer. */
function pyNameTuple(names: string[]): string {
  const single = pyTuple(names);
  if (single.length <= 72) return single;
  const body = names.map((name) => `        ${pyStr(name)},`).join('\n');
  return `(\n${body}\n    )`;
}

function heading(text: string): string {
  return `# ${text}\n# ${'-'.repeat(Math.max(4, 70 - text.length))}`;
}

export function generateScript(config: MapConfig, allRules: RuleSpec[]): string {
  // Empty groups would emit dead code, so they are dropped from the preview and
  // the execution alike -- the drawer always reflects what actually ran.
  const rules = allRules.filter((rule) => rule.names.length > 0);
  const lines: string[] = [];
  const add = (...items: string[]) => lines.push(...items);

  // The imports have to be emitted, not assumed.  The worker's harness imports
  // geopandas and matplotlib before the script runs, so a script that merely
  // *uses* gpd and plt executes fine in the studio -- and then fails with
  // "NameError: name 'gpd' is not defined" the moment anyone copies it to a
  // desktop, which is the whole point of the drawer.
  add('import geopandas as gpd', 'import matplotlib.pyplot as plt', '');

  add(
    heading('Load the boundary dataset'),
    '# The studio parses these boundaries once when Python starts and hands them over',
    '# as BOUNDARIES, so re-rendering never re-reads the file.  Run this script on a',
    '# desktop instead and it falls back to reading the GeoJSON from disk.',
    'try:',
    '    gdf = BOUNDARIES.copy()',
    'except NameError:',
    '    gdf = gpd.read_file("us_counties.geojson", engine="fiona")',
    '',
  );

  add(heading('Scope'));
  if (config.scope === 'state') {
    add(
      `# Single state (STATEFP ${config.stateFips})`,
      `subset = gdf[gdf["STATEFP"] == ${pyStr(config.stateFips)}].copy()`,
    );
  } else {
    add(
      '# Contiguous United States -- the Lower 48, so no Alaska, Hawaii or territories',
      `subset = gdf[~gdf["STATEFP"].isin([${NON_CONUS_FIPS.map(pyStr).join(', ')}])].copy()`,
    );
  }
  add('');

  add(
    heading('Highlight rules'),
    `BASE_COLOR = ${pyStr(config.baseColor)}`,
    '',
    'rules = [',
    '    # (fill colour, county names, state FIPS codes)',
  );
  for (const rule of rules) {
    const names = pyNameTuple(rule.names);
    const states = rule.states.length ? pyTuple(rule.states) : '()';
    add(`    (${pyStr(rule.color)}, ${names}, ${states}),`);
  }
  add(
    ']',
    '',
    '# County names are matched case-insensitively, so the input box can be typed',
    '# naturally.  An empty state set means "match this name in any state".',
    '_lookup = [(c, {n.casefold() for n in names}, set(states)) for c, names, states in rules]',
    '',
    'def assign_color(row):',
    '    name = row["NAME"].casefold()',
    '    for color, names, states in _lookup:',
    '        if name in names and (not states or row["STATEFP"] in states):',
    '            return color',
    '    return BASE_COLOR',
    '',
    'subset["color"] = subset.apply(assign_color, axis=1)',
    '',
  );

  add(heading('Reproject and plot'));
  if (config.projection === 'EPSG:4326') {
    add('# Unprojected: geometries stay in WGS84 lon/lat, so shapes look squashed.');
  } else {
    add(
      `# ${PROJECTION_LABELS[config.projection]}`,
      `subset = subset.to_crs(${pyStr(config.projection)})`,
    );
  }
  add(
    '',
    `fig, ax = plt.subplots(figsize=(${config.figWidth}, ${config.figHeight}))`,
    `fig.patch.set_facecolor(${pyStr(config.background)})`,
    `ax.set_facecolor(${pyStr(config.background)})`,
    '',
    'subset.plot(',
    '    ax=ax,',
    '    color=subset["color"],',
    `    edgecolor=${pyStr(config.borderColor)},`,
    `    linewidth=${config.borderWidth},`,
    ')',
    '',
  );

  if (config.showLabels) {
    add(
      '# Labels sit on representative_point() rather than the centroid, so a label',
      '# never lands outside the polygon it belongs to.',
      config.labelsHighlightedOnly
        ? 'labeled = subset[subset["color"] != BASE_COLOR]'
        : 'labeled = subset',
      'points = labeled.geometry.representative_point()',
      'for name, x, y in zip(labeled["NAME"], points.x, points.y):',
      '    ax.annotate(',
      '        name,',
      '        xy=(x, y),',
      '        ha="center",',
      '        va="center",',
      `        fontsize=${config.labelSize},`,
      '        color="#111827",',
      '    )',
      '',
    );
  }

  // Title and subtitle are both anchored to the top of the axes and separated in
  // *points*, not axes fractions.  Axes fractions collide (a subtitle placed just
  // above 1.0 lands exactly where set_title() sits) and drift with figsize and
  // aspect ratio, so the offsets are computed from the font sizes instead.
  if (config.title) {
    const titleOffset = config.subtitle ? 6 + Math.round(config.subtitleSize * 1.5) : 10;
    add(
      `ax.annotate(${pyStr(config.title)}, xy=(0.5, 1.0), xycoords="axes fraction", xytext=(0, ${titleOffset}), textcoords="offset points", ha="center", va="bottom", fontsize=${config.titleSize})`,
    );
  }
  if (config.subtitle) {
    add(
      `ax.annotate(${pyStr(config.subtitle)}, xy=(0.5, 1.0), xycoords="axes fraction", xytext=(0, 6), textcoords="offset points", ha="center", va="bottom", fontsize=${config.subtitleSize}, color="#6b7280")`,
    );
  }
  add(
    'ax.axis("off")',
    'fig.tight_layout()',
    '',
    `out_path = ${pyStr(OUTPUT_PATH)}`,
    `fig.savefig(out_path, dpi=${PREVIEW_DPI}, facecolor=fig.get_facecolor())`,
    '# plt.show()   # <- uncomment to open the figure locally instead of saving',
  );

  return lines.join('\n') + '\n';
}

