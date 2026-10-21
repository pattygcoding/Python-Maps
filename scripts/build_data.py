#!/usr/bin/env python3
"""Build the simplified U.S. county boundary dataset for the Map Studio.

Downloads county polygons from the Census Bureau's TIGERweb REST service,
normalises the attributes to the names the browser-side Python expects, then
simplifies and quantises the geometry so the result is small enough to commit
and fast enough to load in under two seconds.

Deliberately depends on nothing but the standard library: this repository's
local interpreter has no geopandas/GDAL stack, and none is needed because the
hard simplification work happens here rather than at render time.

Usage
-----
    python scripts/build_data.py                 # default 1:5,000,000-ish detail
    python scripts/build_data.py --tolerance 0.02 --min-ring-area 2e-4
    python scripts/build_data.py --states-only   # refresh data/states.json only

Outputs
-------
    data/us_counties.geojson   FeatureCollection, WGS84, simplified
    data/states.json           FIPS -> {abbr, name} lookup for the UI

Data source
-----------
U.S. Census Bureau TIGERweb, layer "State_County/MapServer/1" (Counties).
Public domain.  See data/README.md for provenance and the raw query.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------- #
# Source
# --------------------------------------------------------------------------- #

TIGERWEB_LAYER = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/State_County/MapServer/1"
)

# Only the attributes the map needs.  AREALAND/AREAWATER are kept because they
# make the committed file useful for future choropleth metrics (density, etc.).
OUT_FIELDS = "GEOID,STATE,COUNTY,BASENAME,NAME,AREALAND,AREAWATER"

PAGE_SIZE = 1000  # server maxRecordCount is 100000, but paging keeps memory sane
USER_AGENT = "Python-Maps/1.0 (county boundary builder; static site generator)"

# Census county-equivalents for the January 1, 2026 vintage.
EXPECTED_COUNT = 3235

REPO_ROOT = Path(__file__).resolve().parent.parent
# Vite serves everything under public/ at the site root, so the dataset lands at
# /data/us_counties.geojson in the browser -- the path the generated Python reads.
DATA_DIR = REPO_ROOT / "public" / "data"

# --------------------------------------------------------------------------- #
# FIPS -> state lookup (Census FIPS 5-2).  Feeds the scope dropdown and lets the
# UI resolve a bare "Greenville, SC" into the (NAME, STATEFP) pair Python matches.
# --------------------------------------------------------------------------- #

STATES: dict[str, tuple[str, str]] = {
    "01": ("AL", "Alabama"),
    "02": ("AK", "Alaska"),
    "04": ("AZ", "Arizona"),
    "05": ("AR", "Arkansas"),
    "06": ("CA", "California"),
    "08": ("CO", "Colorado"),
    "09": ("CT", "Connecticut"),
    "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"),
    "12": ("FL", "Florida"),
    "13": ("GA", "Georgia"),
    "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"),
    "17": ("IL", "Illinois"),
    "18": ("IN", "Indiana"),
    "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"),
    "21": ("KY", "Kentucky"),
    "22": ("LA", "Louisiana"),
    "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"),
    "25": ("MA", "Massachusetts"),
    "26": ("MI", "Michigan"),
    "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"),
    "29": ("MO", "Missouri"),
    "30": ("MT", "Montana"),
    "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"),
    "33": ("NH", "New Hampshire"),
    "34": ("NJ", "New Jersey"),
    "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"),
    "37": ("NC", "North Carolina"),
    "38": ("ND", "North Dakota"),
    "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"),
    "41": ("OR", "Oregon"),
    "42": ("PA", "Pennsylvania"),
    "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"),
    "46": ("SD", "South Dakota"),
    "47": ("TN", "Tennessee"),
    "48": ("TX", "Texas"),
    "49": ("UT", "Utah"),
    "50": ("VT", "Vermont"),
    "51": ("VA", "Virginia"),
    "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"),
    "55": ("WI", "Wisconsin"),
    "56": ("WY", "Wyoming"),
    # Territories: present in the dataset, excluded from the "Lower 48" scope but
    # useful if the app later offers an all-territories view.
    "60": ("AS", "American Samoa"),
    "66": ("GU", "Guam"),
    "69": ("MP", "Northern Mariana Islands"),
    "72": ("PR", "Puerto Rico"),
    "78": ("VI", "U.S. Virgin Islands"),
}

# Non-state, non-DC FIPS codes.  The app filters these out for "Contiguous U.S.".
TERRITORY_FIPS = frozenset({"60", "66", "69", "72", "78"})
NON_CONUS_FIPS = frozenset({"02", "15"}) | TERRITORY_FIPS

# --------------------------------------------------------------------------- #
# Geometry simplification
#
# Douglas-Peucker over (lon, lat) degrees.  Degrees are not equal-area, so a
# tolerance measured this way over-simplifies east-west at high latitudes; for a
# CONUS-wide cartographic boundary that skew is not visible, and the alternative
# (reprojecting a whole-country dataset in a *build* script with no pyproj) buys
# accuracy nobody can see.  Tolerance is exposed on the command line.
# --------------------------------------------------------------------------- #


def _sq_seg_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Squared distance from point P to segment AB."""
    dx, dy = bx - ax, by - ay
    if dx == 0.0 and dy == 0.0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2


def douglas_peucker(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Iterative Douglas-Peucker.  Returns a subset of `points`, ends preserved.

    Iterative rather than recursive so a pathological 100k-vertex coastline
    cannot blow the interpreter stack.
    """
    n = len(points)
    if n <= 2:
        return list(points)

    tol_sq = tol * tol
    keep = [False] * n
    keep[0] = keep[n - 1] = True

    stack = [(0, n - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue  # adjacent: nothing between them to test
        ax, ay = points[first]
        bx, by = points[last]
        worst_sq, worst_i = -1.0, -1
        for i in range(first + 1, last):
            d = _sq_seg_dist(points[i][0], points[i][1], ax, ay, bx, by)
            if d > worst_sq:
                worst_sq, worst_i = d, i
        if worst_sq > tol_sq:
            keep[worst_i] = True
            stack.append((first, worst_i))
            stack.append((worst_i, last))

    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Simplify a closed ring without opening it.

    Anchoring a closed ring on a single point makes Douglas-Peucker degenerate
    (start and end are the same vertex, so the reference segment has zero
    length).  Instead the ring is split at the vertex farthest from its first
    point, each half is simplified independently, and the halves are rejoined --
    which keeps the "farthest" vertex as a fixed anchor on both arcs.
    """
    if len(ring) < 5:
        return ring  # triangle/quad: any simplification destroys it

    core = ring[:-1] if ring[0] == ring[-1] else list(ring)
    if len(core) < 4:
        return ring

    x0, y0 = core[0]
    far_i, far_d = 0, -1.0
    for i in range(1, len(core)):
        d = (core[i][0] - x0) ** 2 + (core[i][1] - y0) ** 2
        if d > far_d:
            far_i, far_d = i, d

    if far_i == 0:
        return ring

    arc_a = core[: far_i + 1]
    arc_b = core[far_i:] + [core[0]]

    out = douglas_peucker(arc_a, tol)[:-1] + douglas_peucker(arc_b, tol)
    if len(out) < 4:
        return ring
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def ring_area(ring: list[tuple[float, float]]) -> float:
    """Absolute shoelace area in square degrees (used only to drop specks)."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def quantise_ring(ring: list[tuple[float, float]], places: int) -> list[tuple[float, float]]:
    """Round coordinates and drop vertices that collapse onto each other.

    Rounding is what actually shrinks the payload, but it can also emit
    consecutive duplicate vertices or a ring that is no longer a ring.  GEOS
    rejects those downstream, so they are cleaned here rather than left for
    shapely to choke on inside the browser.
    """
    out: list[tuple[float, float]] = []
    for x, y in ring:
        p = (round(x, places), round(y, places))
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    if len(out) < 3:
        return []
    out.append(out[0])
    return out


def simplify_geometry(geom: dict | None, tol: float, places: int, min_ring_area: float) -> dict | None:
    """Simplify a Polygon or MultiPolygon, dropping degenerate rings/holes."""
    if not geom:
        return None

    gtype = geom.get("type")
    if gtype == "Polygon":
        rings = [geom.get("coordinates") or []]
    elif gtype == "MultiPolygon":
        rings = geom.get("coordinates") or []
    else:
        return None

    candidates: list[tuple[float, list[list[list[float]]]]] = []
    for poly in rings:
        if not poly:
            continue
        kept: list[list[list[float]]] = []
        largest = 0.0
        for idx, ring in enumerate(poly):
            pts = [(float(c[0]), float(c[1])) for c in ring if len(c) >= 2]
            if len(pts) < 4:
                continue
            quantised = quantise_ring(simplify_ring(pts, tol), places)
            if len(quantised) < 4:
                continue
            if idx == 0:
                largest = ring_area(quantised)
            kept.append([[x, y] for x, y in quantised])
        if kept:
            candidates.append((largest, kept))

    if not candidates:
        return None

    # The largest body is always retained, and small islands are dropped only when
    # a bigger polygon exists to carry the shape.  A blanket "drop anything below
    # min_ring_area" rule would delete genuinely tiny counties outright -- Falls
    # Church City, VA is about 5 km2 -- and the county count is asserted downstream.
    candidates.sort(key=lambda item: item[0], reverse=True)
    out_polys = [c[1] for i, c in enumerate(candidates) if i == 0 or c[0] >= min_ring_area]

    if len(out_polys) == 1:
        return {"type": "Polygon", "coordinates": out_polys[0]}
    return {"type": "MultiPolygon", "coordinates": out_polys}


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #


def _get_json(url: str, params: dict[str, str], retries: int = 4) -> dict:
    """GET an ArcGIS REST endpoint and decode JSON, with retries on transient errors."""
    query = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == retries - 1:
                break
            wait = 2 ** attempt
            print(f"  ! {type(error).__name__}: {error} -- retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise SystemExit(f"Failed to query TIGERweb: {last_error}")


def fetch_features(max_allowable_offset: float, cache_dir: Path | None = None) -> list[dict]:
    """Page through every county in the layer.

    Each page is cached on disk.  The whole download is tens of megabytes and
    takes minutes, so a rerun after a network hiccup or a tweak to the
    simplification settings should not have to fetch it all again.
    """
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)

    features: list[dict] = []
    offset = 0
    page_index = 0
    while True:
        cache_file = None
        if cache_dir is not None:
            cache_file = cache_dir / f"page_{page_index:03d}_{offset}.json"

        if cache_file is not None and cache_file.exists():
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            print(f"  page {page_index} (offset {offset}) from cache", flush=True)
        else:
            payload = _get_json(
                f"{TIGERWEB_LAYER}/query",
                {
                    "where": "1=1",
                    "outFields": OUT_FIELDS,
                    "returnGeometry": "true",
                    "outSR": "4326",  # RFC 7946 requires WGS84
                    "maxAllowableOffset": f"{max_allowable_offset}",
                    "geometryPrecision": "5",
                    "resultOffset": str(offset),
                    "resultRecordCount": str(PAGE_SIZE),
                    "f": "geojson",
                },
            )
            if payload.get("error"):
                raise SystemExit(f"TIGERweb error: {payload['error']}")
            if cache_file is not None:
                cache_file.write_text(json.dumps(payload), encoding="utf-8")

        page = payload.get("features") or []
        features.extend(page)
        print(f"  {len(features)} counties so far", flush=True)

        if len(page) < PAGE_SIZE:
            break
        offset += len(page)
        page_index += 1
        time.sleep(0.25)  # be polite to a free public service

    return features


# --------------------------------------------------------------------------- #
# Normalise
# --------------------------------------------------------------------------- #


def normalise(feature: dict, tol: float, places: int, min_ring_area: float) -> dict | None:
    """Rewrite one TIGERweb feature into the schema the browser-side Python expects.

    The important rename is NAME <- BASENAME.  TIGERweb's own NAME is the full
    "Cherokee County", which makes the natural `row["NAME"] in ["Cherokee", ...]`
    test silently match nothing.  BASENAME is the bare "Cherokee", and the full
    label is preserved as NAMELSAD for tooltips and label text.
    """
    props = feature.get("properties") or {}
    geoid = str(props.get("GEOID") or "").strip()
    statefp = str(props.get("STATE") or "").strip().zfill(2)
    countyfp = str(props.get("COUNTY") or "").strip().zfill(3)
    if len(geoid) != 5 or len(statefp) != 2:
        return None
    if statefp not in STATES:
        return None  # e.g. the "water only" / undefined-area buckets

    basename = (props.get("BASENAME") or "").strip()
    full_name = (props.get("NAME") or basename).strip()
    if not basename:
        return None

    geometry = simplify_geometry(feature.get("geometry"), tol, places, min_ring_area)
    if geometry is None:
        return None

    return {
        "type": "Feature",
        "id": geoid,
        "properties": {
            "GEOID": geoid,
            "STATEFP": statefp,
            "COUNTYFP": countyfp,
            "NAME": basename,
            "NAMELSAD": full_name,
            "ALAND": int(props.get("AREALAND") or 0),
            "AWATER": int(props.get("AREAWATER") or 0),
        },
        "geometry": geometry,
    }


# --------------------------------------------------------------------------- #
# Output + validation
# --------------------------------------------------------------------------- #


def rel(path: Path) -> str:
    """Render a path relative to the repo when possible, absolute otherwise."""
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def write_states(path: Path) -> None:
    payload = {
        "source": "U.S. Census Bureau FIPS 5-2",
        "default": "conus",
        "states": [
            {
                "fips": fips,
                "abbr": abbr,
                "name": name,
                "conus": fips not in NON_CONUS_FIPS,
                "territory": fips in TERRITORY_FIPS,
            }
            for fips, (abbr, name) in sorted(STATES.items())
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"  wrote {path.relative_to(REPO_ROOT)} ({len(STATES)} entries)")


def count_vertices(features: list[dict]) -> int:
    total = 0
    for feature in features:
        geom = feature["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in polys:
            for ring in poly:
                total += len(ring)
    return total


def validate(features: list[dict]) -> None:
    """Fail loudly rather than shipping a subtly broken dataset."""
    problems: list[str] = []

    # Census revises the county list every vintage, so small drift is expected and
    # only reported; a large delta means the pipeline itself broke.
    delta = len(features) - EXPECTED_COUNT
    if delta:
        message = f"expected {EXPECTED_COUNT} counties, got {len(features)} (delta {delta:+d})"
        if abs(delta) > 25:
            problems.append(message)
        else:
            print(f"  note: {message}")

    seen: set[str] = set()
    for feature in features:
        props = feature["properties"]
        geoid, statefp, name = props["GEOID"], props["STATEFP"], props["NAME"]

        if props["GEOID"] in seen:
            problems.append(f"duplicate GEOID {geoid}")
        seen.add(props["GEOID"])

        if props["GEOID"] != f"{statefp}{props['COUNTYFP']}":
            problems.append(f"{geoid}: GEOID does not match STATEFP+COUNTYFP")

        # The whole reason this pipeline exists: NAME must be the bare basename.
        for suffix in (" County", " Parish", " Borough", " Census Area", " Municipality"):
            if name.endswith(suffix):
                problems.append(f"{geoid}: NAME {name!r} still carries a type suffix")

        geom = feature["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        rings = 0
        for poly in polys:
            for ring in poly:
                rings += 1
                if len(ring) < 4:
                    problems.append(f"{geoid}: ring with {len(ring)} points")
                if ring[0] != ring[-1]:
                    problems.append(f"{geoid}: unclosed ring")
                for x, y in ring:
                    if not (-180.0 <= x <= 180.0 and -90.0 <= y <= 90.0):
                        problems.append(f"{geoid}: coordinate out of range ({x}, {y})")
        if rings == 0:
            problems.append(f"{geoid}: no rings survived simplification")

        if len(problems) > 25:
            problems.append("... further problems suppressed")
            break

    if problems:
        print("\nVALIDATION FAILED:", file=sys.stderr)
        for problem in problems[:26]:
            print(f"  - {problem}", file=sys.stderr)
        raise SystemExit(1)


def report(path: Path, features: list[dict], elapsed: float) -> None:
    raw = path.stat().st_size
    compressed = len(gzip.compress(path.read_bytes(), 6))
    vertices = count_vertices(features)
    joined = sum(1 for f in features if f["geometry"]["type"] == "MultiPolygon")
    print("\nDataset report")
    print(f"  counties          {len(features):,}")
    print(f"  vertices          {vertices:,}  ({vertices / len(features):.0f} per county)")
    print(f"  multipolygons     {joined:,}")
    print(f"  file size         {raw / 1024 / 1024:.2f} MB raw, {compressed / 1024:.0f} KB gzipped")
    print(f"  build time        {elapsed:.1f}s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build data/us_counties.geojson and data/states.json",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.003,
        help="Douglas-Peucker tolerance in degrees (0.003 deg is about 330 m)",
    )
    parser.add_argument(
        "--places", type=int, default=4, help="coordinate decimal places (4 is about 11 m)"
    )
    parser.add_argument(
        "--min-ring-area",
        type=float,
        default=1e-4,
        help="drop islands smaller than this many square degrees when a mainland exists",
    )
    parser.add_argument(
        "--max-allowable-offset",
        type=float,
        default=0.0005,
        help="server-side generalisation applied before download, in degrees",
    )
    parser.add_argument(
        "--states-only", action="store_true", help="refresh data/states.json and stop"
    )
    parser.add_argument(
        "--no-cache", action="store_true", help="ignore the cached TIGERweb pages"
    )
    parser.add_argument(
        "--out", type=Path, default=DATA_DIR / "us_counties.geojson", help="output path"
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("Writing state lookup")
    write_states(DATA_DIR / "states.json")
    if args.states_only:
        return

    started = time.time()
    print(f"\nDownloading counties from TIGERweb (server offset {args.max_allowable_offset} deg)")
    cache_dir = None if args.no_cache else REPO_ROOT / "scripts" / ".cache"
    raw = fetch_features(args.max_allowable_offset, cache_dir)
    print(f"  {len(raw)} raw features")

    print(f"\nSimplifying (tolerance {args.tolerance} deg, {args.places} dp)")
    features: list[dict] = []
    dropped: list[str] = []
    for index, feature in enumerate(raw):
        normalised = normalise(feature, args.tolerance, args.places, args.min_ring_area)
        if normalised is None:
            dropped.append(str((feature.get("properties") or {}).get("GEOID")))
            continue
        features.append(normalised)
        if (index + 1) % 500 == 0:
            print(f"  {index + 1}/{len(raw)}...", flush=True)

    if dropped:
        print(f"  {len(dropped)} features dropped: {', '.join(dropped[:10])}")

    features.sort(key=lambda f: f["properties"]["GEOID"])
    validate(features)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n" keeps the output byte-identical on Windows and Linux.  Without it
    # Python's text mode writes CRLF here and LF on CI, so the same commit would
    # carry a dataset that differs by a byte depending on who regenerated it.
    with args.out.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            handle,
            separators=(",", ":"),
            allow_nan=False,
        )
        handle.write("\n")
    print(f"\n  wrote {rel(args.out)}")
    report(args.out, features, time.time() - started)


if __name__ == "__main__":
    main()




