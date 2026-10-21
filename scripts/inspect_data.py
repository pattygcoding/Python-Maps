#!/usr/bin/env python3
"""Inspect and validate public/data/us_counties.geojson.

A quick sanity check after regenerating the dataset: how many counties came
through, how dense the geometry is, which counties carry the most detail, and
whether the schema still matches what the browser-side Python expects.

    python scripts/inspect_data.py
    python scripts/inspect_data.py --county 45045
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO_ROOT / "public" / "data" / "us_counties.geojson"

REQUIRED_PROPS = ("GEOID", "STATEFP", "COUNTYFP", "NAME", "NAMELSAD", "ALAND", "AWATER")


def rings_of(geometry: dict) -> list[list[list[float]]]:
    if geometry["type"] == "Polygon":
        return list(geometry["coordinates"])
    return [ring for poly in geometry["coordinates"] for ring in poly]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--county", help="dump one county by GEOID, e.g. 45045")
    args = parser.parse_args()

    if not args.path.exists():
        raise SystemExit(f"missing {args.path} -- run scripts/build_data.py first")

    data = json.loads(args.path.read_text(encoding="utf-8"))
    features = data["features"]

    if args.county:
        matches = [f for f in features if f["properties"]["GEOID"] == args.county]
        if not matches:
            raise SystemExit(f"no county with GEOID {args.county}")
        feature = matches[0]
        ring = rings_of(feature["geometry"])[0]
        print(json.dumps(feature["properties"], indent=2))
        print(f"geometry      {feature['geometry']['type']}")
        print(f"rings         {len(rings_of(feature['geometry']))}")
        print(f"first ring    {len(ring)} vertices")
        print(f"first 6 pts   {ring[:6]}")
        return

    problems: list[str] = []
    vertex_counts: list[int] = []
    per_county: list[tuple[int, str, str]] = []
    total_vertices = 0
    states: set[str] = set()
    geometry_types: dict[str, int] = {}

    for feature in features:
        props = feature["properties"]
        missing = [key for key in REQUIRED_PROPS if key not in props]
        if missing:
            problems.append(f"{props.get('GEOID')}: missing {missing}")
            continue

        if feature.get("id") != props["GEOID"]:
            problems.append(f"{props['GEOID']}: feature id does not match GEOID")
        if not isinstance(props["STATEFP"], str) or len(props["STATEFP"]) != 2:
            problems.append(f"{props['GEOID']}: STATEFP is not a 2-char string")
        if props["NAME"].endswith((" County", " Parish", " Borough")):
            problems.append(f"{props['GEOID']}: NAME still carries a suffix: {props['NAME']!r}")

        rings = rings_of(feature["geometry"])
        vertices = sum(len(r) for r in rings)
        total_vertices += vertices
        vertex_counts.append(vertices)
        per_county.append((vertices, props["GEOID"], props["NAMELSAD"]))
        states.add(props["STATEFP"])
        geometry_types[feature["geometry"]["type"]] = (
            geometry_types.get(feature["geometry"]["type"], 0) + 1
        )

    per_county.sort(reverse=True)
    raw_bytes = args.path.stat().st_size

    print(f"file              {args.path.relative_to(REPO_ROOT)}")
    print(f"counties          {len(features):,}")
    print(f"states covered    {len(states)}")
    print(f"geometry types    {geometry_types}")
    print(f"vertices          {total_vertices:,}")
    print(f"  per county      min {min(vertex_counts)}  "
          f"median {statistics.median(vertex_counts):.0f}  "
          f"mean {statistics.mean(vertex_counts):.1f}  max {max(vertex_counts)}")
    print(f"file size         {raw_bytes / 1024 / 1024:.2f} MB raw")
    print("sparsest          " + ", ".join(f"{n} ({g})" for n, g, _ in per_county[-3:]))
    print("densest           " + ", ".join(f"{n} ({g})" for n, g, _ in per_county[:5]))

    if problems:
        print(f"\n{len(problems)} PROBLEM(S):", file=sys.stderr)
        for problem in problems[:20]:
            print(f"  - {problem}", file=sys.stderr)
        raise SystemExit(1)
    print("\nschema OK")


if __name__ == "__main__":
    main()
