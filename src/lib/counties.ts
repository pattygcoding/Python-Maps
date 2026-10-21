/**
 * State lookup + county-list parsing.
 *
 * County names are only unique *within* a state -- Greenville exists in both SC
 * and AL -- so a rule can carry a state qualifier.  Only two-letter codes count
 * as qualifiers, because plenty of full state names are also county names
 * (Washington, Nevada, Idaho, Delaware...), and guessing between the two would
 * silently paint the wrong counties.
 */

import type { RuleGroup, RuleSpec, StateRecord, StateTable } from './types';

let cache: StateTable | null = null;

export async function loadStates(): Promise<StateTable> {
  if (cache) return cache;
  const url = new URL(`${import.meta.env.BASE_URL}data/states.json`, location.href);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url.pathname} (HTTP ${response.status})`);
  }
  cache = (await response.json()) as StateTable;
  return cache;
}

export function indexStates(table: StateTable): Map<string, StateRecord> {
  return new Map(table.states.map((state) => [state.fips, state]));
}

/** Suffixes that people type but the Census basename does not contain. */
const TYPE_SUFFIXES = [
  ' county',
  ' parish',
  ' borough',
  ' census area',
  ' municipality',
  ' city',
  ' town',
  ' village',
  ' plantation',
  ' township',
];

function cleanName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, ' ');
  name = name.replace(/^county of\s+/i, '');
  const lower = name.toLowerCase();
  for (const suffix of TYPE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      name = name.slice(0, name.length - suffix.length).trim();
      break;
    }
  }
  return name;
}

export interface ParseOutcome {
  entries: { name: string; fips: string | null }[];
  /** Two-letter codes that are not real state abbreviations. */
  unknownStates: string[];
}

/**
 * Parse one rule's textarea.
 *
 * Accepted, one rule per line (commas also separate names):
 *   Greenville, Pickens, Spartanburg      -> three names, any state
 *   Greenville, SC                        -> Greenville in South Carolina
 *   Charleston, SC, Beaufort, SC          -> both in South Carolina
 *
 * When the studio is scoped to a single state every name inherits that state, so
 * the qualifier becomes unnecessary and the state tokens are ignored.
 */
export function parseCountyText(
  text: string,
  defaultFips: string | null,
  byFips: Map<string, StateRecord>,
): ParseOutcome {
  const abbrToFips = new Map<string, string>();
  for (const [fips, state] of byFips) {
    abbrToFips.set(state.abbr.toUpperCase(), fips);
  }

  const entries: { name: string; fips: string | null }[] = [];
  const unknownStates: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const tokens = line
      .split(/[,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0) continue;

    // A trailing two-letter token is a state qualifier for the whole line.
    let lineState: string | null = null;
    let last = tokens[tokens.length - 1];
    if (tokens.length > 1 && /^[A-Za-z]{2}$/.test(last)) {
      const fips = abbrToFips.get(last.toUpperCase());
      if (fips) {
        lineState = fips;
        tokens.pop();
      } else {
        unknownStates.push(last.toUpperCase());
      }
    }

    for (const token of tokens) {
      const name = cleanName(token);
      if (!name) continue;
      entries.push({ name, fips: defaultFips ?? lineState });
    }
  }

  return { entries, unknownStates };
}

/** Turn the raw form rows into the concrete rule set the Python generator needs. */
export function resolveRules(
  groups: RuleGroup[],
  defaultFips: string | null,
  byFips: Map<string, StateRecord>,
): RuleSpec[] {
  return groups.map((group) => {
    const { entries, unknownStates } = parseCountyText(group.counties, defaultFips, byFips);

    // Collapse to the (names, states) shape the generated Python matches on.
    // An empty state list means "any state", matching the parser's null fips.
    const names: string[] = [];
    const states = new Set<string>();
    const unresolved: string[] = [];

    for (const entry of entries) {
      names.push(entry.name);
      if (entry.fips) states.add(entry.fips);
    }
    for (const code of unknownStates) {
      unresolved.push(`${code} is not a state code`);
    }

    return { color: group.color, names, states: [...states], unresolved };
  });
}
