#!/usr/bin/env python3
"""Immich auto-albums: monthly event clustering (trips, day trips, gatherings, people-years, seasons).
Stdlib only. DRY_RUN=1 by default: plans and logs, touches nothing. Set DRY_RUN=0 to apply."""

import csv
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

# ---- Config: everything personal lives in a TOML file (CONFIG env, default ./config.toml) ----
import tomllib

def load_config(path):
    with open(path, "rb") as f:
        c = tomllib.load(f)
    g = globals()
    im, pe, cl, py, se = c["immich"], c["people"], c["clustering"], c["person_years"], c["seasons"]
    g.update(
        SERVER=os.environ.get("IMMICH_URL", im.get("url", "http://localhost:2283")),
        API_KEY=os.environ.get("IMMICH_API_KEY", ""),
        OUT=os.environ.get("OUT", im.get("out_dir", ".")),
        DRY_RUN=os.environ.get("DRY_RUN", "1") == "1",
        WINDOW_DAYS=int(os.environ.get("WINDOW_DAYS", im.get("window_days", 365))),
        MARKER=im.get("marker", "[auto-albums]"),
        ME=pe["me"],
        HOUSEHOLD=set(pe["household"]),
        WITH_SHARE=pe.get("with_share", 0.4),
        WITH_MIN_TAGGED=pe.get("with_min_tagged", 5),
        MAX_NAMED=pe.get("max_named", 3),
        NO_PEOPLE_PLACES=set(pe.get("no_people_places", [])),
        HOMES=[(h["from"], h["lat"], h["lon"]) for h in c["homes"]],
        HOME_KM=cl["home_km"], PLACE_KM=cl["place_km"], MERGE_LABEL_KM=cl["merge_label_km"],
        DOMINANT_SHARE=cl["dominant_share"], REGION_SHARE=cl.get("region_share", 0.8),
        ZONE_SHARE=cl.get("zone_share", 0.6),
        ZONES=[(z["name"], z["lat"], z["lon"], z["km"]) for z in c.get("zones", [])],
        TRIP_GAP_H=cl["trip_gap_hours"],
        TRIP_MIN_PHOTOS=cl["trip_min_photos"], TRIP_MIN_DAYS=cl["trip_min_days"],
        DAYTRIP_MIN_PHOTOS=cl["daytrip_min_photos"], GATHER_GAP_H=cl["gather_gap_hours"],
        GATHER_MIN_PHOTOS=cl["gather_min_photos"], GATHER_MIN_GUESTS=cl["gather_min_guests"],
        EVENT_ABSORB_SHARE=cl.get("event_absorb_share", 0.5),
        YEAR_MIN_PHOTOS=py["min_photos"], HOUSEHOLD_YEAR_MIN_PHOTOS=py["household_min_photos"],
        NO_GPS_ERA_END=se["no_gps_era_end"], SEASON_MIN_PHOTOS=se.get("min_photos", 5),
        DISTRICT_COUNTRIES=set(c.get("naming", {}).get("district_countries", ["France"])),
        KEEP_REGIONS=set(c.get("naming", {}).get("keep_regions", ["Normandy", "Île-de-France"])),
        PLACE_ALIASES=dict(c.get("aliases", {})),
        FIXED_EVENTS=[(e["name"], e["from"], e["to"]) for e in c.get("events", [])],
    )

load_config(os.environ.get("CONFIG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.toml")))
# -------------------------------------------------------------------------------------------

NOW = datetime.now()
WINDOW_START = NOW - timedelta(days=WINDOW_DAYS)
YEARS = range(min(WINDOW_START.year, NOW.year - 1), NOW.year + 1)  # person-year albums and people lookups
os.makedirs(OUT, exist_ok=True)
STAMP = NOW.strftime("%Y%m%d_%H%M%S")
LOGF = open(os.path.join(OUT, f"run_{STAMP}.log"), "a", encoding="utf-8")


def log(msg):
    line = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(line)
    LOGF.write(line + "\n")
    LOGF.flush()


# ---- API ----
class ApiError(Exception):
    pass


def api(method, path, body=None, fatal=True):
    """Reads exit on failure, since nothing can be planned without them. Writes raise instead."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{SERVER}/api{path}", data=data, method=method,
        headers={"x-api-key": API_KEY, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        msg = f"HTTP {e.code} {method} {path}: {e.read().decode(errors='replace')[:300]}"
        if not fatal:
            raise ApiError(msg) from None
        log(f"FATAL: {msg}")
        sys.exit(1)


def search(body):
    """Paginate POST /search/metadata, yield raw asset dicts."""
    page = 1
    while True:
        res = api("POST", "/search/metadata", {**body, "page": page, "size": 1000})
        block = res.get("assets", {})
        yield from block.get("items", [])
        if not block.get("nextPage"):
            return
        page += 1


def fetch_assets():
    out = {}
    for a in search({"withExif": True, "visibility": "timeline"}):
        local = a.get("localDateTime") or a.get("fileCreatedAt")
        if not local:
            continue
        ex = a.get("exifInfo") or {}
        out[a["id"]] = {
            "id": a["id"],
            "t": datetime.fromisoformat(local.replace("Z", "")).replace(tzinfo=None),
            "lat": ex.get("latitude"), "lon": ex.get("longitude"),
            "city": ex.get("city"), "state": ex.get("state"), "country": ex.get("country"),
            "district": None,
            "people": set(),
        }
    return out


DISTRICT_MAX_KM = 100  # beyond this the lookup matched another town of the same name
NEIGHBOUR_KM = 25      # the place index skips the smallest communes; a town this close shares their district


def district_of(hits, city, lat, lon):
    """Prefers an exact name match, then the hit nearest the photo."""
    exact = [h for h in hits if h.get("name", "").lower() == city.lower()]
    best = None
    for h in (exact or hits):
        if not h.get("admin2name"):
            continue
        km = haversine_km(lat, lon, h["latitude"], h["longitude"])
        if best is None or km < best[0]:
            best = (km, h["admin2name"])
    return best[1] if best and best[0] <= DISTRICT_MAX_KM else None


def fill_from_neighbours(want):
    """A town the place index does not carry takes the district of the nearest town that resolved."""
    towns = {}
    for a in want:
        towns.setdefault(a["city"], a)
    known = [a for a in towns.values() if a["district"]]
    if not known:
        return
    for town in [a for a in towns.values() if not a["district"]]:
        best = min(((haversine_km(town["lat"], town["lon"], k["lat"], k["lon"]), k["district"])
                    for k in known), key=lambda p: p[0])
        if best[0] > NEIGHBOUR_KM:
            continue
        for a in want:
            if a["city"] == town["city"]:
                a["district"] = best[1]


def attach_districts(assets):
    """Immich exif carries the region but not the departement, so look it up once per town."""
    if not DISTRICT_COUNTRIES:
        return 0
    want = [a for a in assets.values()
            if a["city"] and has_gps(a) and a["country"] in DISTRICT_COUNTRIES]
    cache = {}
    for city in {a["city"] for a in want}:
        try:
            cache[city] = api("GET", "/search/places?name=" + urllib.parse.quote(city), fatal=False) or []
        except ApiError:
            cache[city] = []
    for a in want:
        a["district"] = district_of(cache[a["city"]], a["city"], a["lat"], a["lon"])
    fill_from_neighbours(want)
    return len(cache)


def fetch_people():
    people, page = [], 1
    while True:
        res = api("GET", f"/people?withHidden=false&page={page}&size=500")
        people += [p for p in res.get("people", []) if p.get("name")]
        if not res.get("hasNextPage"):
            return people
        page += 1


def attach_people(assets, people):
    """One search per named person, from the first year the window covers."""
    since = f"{YEARS[0]}-01-01T00:00:00.000Z"
    for p in people:
        n = 0
        for a in search({"personIds": [p["id"]], "takenAfter": since, "visibility": "timeline"}):
            if a["id"] in assets:
                assets[a["id"]]["people"].add(p["name"])
                n += 1
        log(f"  people: {p['name']} -> {n} assets since {since}")


# ---- Geo / time helpers ----
def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin(math.radians(lat2 - lat1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def home_for(d):
    home = HOMES[0]
    for h in HOMES:
        if d >= h[0]:
            home = h
    return home[1], home[2]


def has_gps(a):
    return a["lat"] is not None and a["lon"] is not None


def at_home(a):
    lat, lon = home_for(a["t"].date())
    return haversine_km(a["lat"], a["lon"], lat, lon) <= HOME_KM


def cluster_by_gap(assets, hours):
    assets = sorted(assets, key=lambda a: a["t"])
    clusters, cur = [], []
    for a in assets:
        if cur and (a["t"] - cur[-1]["t"]) > timedelta(hours=hours):
            clusters.append(cur)
            cur = []
        cur.append(a)
    if cur:
        clusters.append(cur)
    return clusters


def sub_places(cluster):
    """Greedy PLACE_KM grouping around running centroids; largest group first."""
    groups = []
    for a in cluster:
        for g in groups:
            if haversine_km(a["lat"], a["lon"], g["lat"], g["lon"]) <= PLACE_KM:
                g["items"].append(a)
                n = len(g["items"])
                g["lat"] += (a["lat"] - g["lat"]) / n
                g["lon"] += (a["lon"] - g["lon"]) / n
                break
        else:
            groups.append({"lat": a["lat"], "lon": a["lon"], "items": [a]})
    return sorted(groups, key=lambda g: len(g["items"]), reverse=True)


def norm_place(name):
    if not name:
        return None
    if re.match(r"^Paris \d{2} ", name):
        return "Paris"
    return PLACE_ALIASES.get(name, name)


def label(items, field="city"):
    c = Counter(norm_place(a[field]) for a in items)
    c.pop(None, None)
    return c.most_common(1)[0][0] if c else None


def zone_circles():
    """Zones sharing a name are one area, so a range can be several circles that miss the valley between."""
    by_name = defaultdict(list)
    for name, lat, lon, km in ZONES:
        by_name[name].append((lat, lon, km))
    return sorted(by_name.items(), key=lambda kv: max(c[2] for c in kv[1]))


def zone_name(gps):
    """The tightest zone holding ZONE_SHARE of the photos, so it beats the district."""
    need = ZONE_SHARE * len(gps)
    for name, circles in zone_circles():
        inside = sum(any(haversine_km(a["lat"], a["lon"], lat, lon) <= km for lat, lon, km in circles)
                     for a in gps)
        if inside >= need:
            return name
    return None


def prefers_districts(gps, region):
    """True when this country names albums after districts and this region is not one of the keepers."""
    if region in KEEP_REGIONS or norm_place(region) in KEEP_REGIONS:
        return False
    countries = Counter(a["country"] for a in gps if a["country"])
    return bool(countries) and countries.most_common(1)[0][0] in DISTRICT_COUNTRIES


def district_name(gps, need):
    """One district holding `need` photos, else the top two together, so "Isere & Drome"."""
    top = Counter(a["district"] for a in gps if a.get("district")).most_common(2)
    if not top:
        return None
    if top[0][1] >= need:
        return norm_place(top[0][0])
    if len(top) > 1 and top[0][1] + top[1][1] >= need:
        return " & ".join(norm_place(d) for d, _ in top)
    return None


def area_name(gps, share):
    """Above city level: the district when the country prefers it, else the region."""
    need = share * len(gps)
    regions = Counter(a["state"] for a in gps if a["state"])
    region, n = regions.most_common(1)[0] if regions else (None, 0)
    enough = region is not None and n >= need
    if enough and not prefers_districts(gps, region):
        return norm_place(region)
    return district_name(gps, need) or (norm_place(region) if enough else None)


def place_name(cluster):
    """City if one place dominates, else district or region, else country, else two countries."""
    gps = [a for a in cluster if has_gps(a)]
    groups = sub_places(gps)
    places = []  # {"lat","lon","items"} merged within MERGE_LABEL_KM
    for g in groups:
        for pl in places:
            if haversine_km(g["lat"], g["lon"], pl["lat"], pl["lon"]) <= MERGE_LABEL_KM:
                pl["items"] += g["items"]
                break
        else:
            places.append(dict(g))
    places.sort(key=lambda pl: len(pl["items"]), reverse=True)
    if not places:
        return "Trip"
    top = places[0]["items"]
    if len(top) >= DOMINANT_SHARE * len(gps):
        return label(top) or area_name(top, 0) or label(top, "country") or "Trip"
    # One area holding most of the photos names the trip on its own; the rest is a detour.
    area = zone_name(gps) or area_name(gps, REGION_SHARE)
    if area:
        return area
    countries = Counter(norm_place(a["country"]) for a in gps)
    countries.pop(None, None)
    if len(countries) == 1:
        return next(iter(countries))
    return " & ".join(c for c, _ in countries.most_common(2)) or "Trip"


def join_names(names):
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} & {names[-1]}"


def month_span(start, end):
    if (start.year, start.month) == (end.year, end.month):
        return start.strftime("%b %Y")
    if start.year == end.year:
        return f"{start:%b}-{end:%b %Y}"
    return f"{start:%b %Y} - {end:%b %Y}"


def with_people(cluster, place):
    if place in NO_PEOPLE_PLACES:
        return ""
    with_faces = [a for a in cluster if a["people"]]
    if len(with_faces) < WITH_MIN_TAGGED:
        return ""
    c = Counter(p for a in with_faces for p in a["people"] if p not in HOUSEHOLD)
    named = [p.split()[0] for p, n in c.most_common(MAX_NAMED) if n >= WITH_SHARE * len(with_faces)]
    return f" with {join_names(named)}" if named else ""


# ---- Rule engines: each returns plans {kind, key, name, ids, start} ----
def plan_trips_and_daytrips(assets, absorbed):
    """Trips and day trips from GPS photos away from home. GPS-less photos inside a trip's span join it."""
    away = [a for a in assets if has_gps(a) and a["t"] >= WINDOW_START and not at_home(a)]
    nogps = sorted((a for a in assets if not has_gps(a) and a["t"] >= WINDOW_START), key=lambda a: a["t"])
    plans = []
    for cl in cluster_by_gap(away, TRIP_GAP_H):
        days = Counter(a["t"].date() for a in cl)
        start, end = cl[0]["t"], cl[-1]["t"]
        if len(cl) >= TRIP_MIN_PHOTOS and len(days) >= TRIP_MIN_DAYS:
            extra = [a for a in nogps if start <= a["t"] <= end]
            absorbed.update(a["id"] for a in extra)
            full = cl + extra
            place = place_name(cl)
            name = f"{place}{with_people(full, place)}, {month_span(start, end)}"
            plans.append({"kind": "trip", "key": start.date().isoformat(), "name": name,
                          "ids": [a["id"] for a in full], "start": start})
        else:
            day, n = days.most_common(1)[0]
            if n >= DAYTRIP_MIN_PHOTOS:
                plans.append({"kind": "daytrip", "key": day.isoformat(), "name": f"{place_name(cl)}, {day:%d %b %Y}",
                              "ids": [a["id"] for a in cl], "start": start})
    return plans


def plan_gatherings(assets):
    home = [a for a in assets if has_gps(a) and a["t"] >= WINDOW_START and at_home(a)]
    plans = []
    for cl in cluster_by_gap(home, GATHER_GAP_H):
        guests = {p for a in cl for p in a["people"] if p not in HOUSEHOLD}
        if len(cl) >= GATHER_MIN_PHOTOS and len(guests) >= GATHER_MIN_GUESTS:
            d = cl[0]["t"]
            plans.append({"kind": "gathering", "key": d.date().isoformat(), "name": f"Gathering at home, {d:%d %b %Y}",
                          "ids": [a["id"] for a in cl], "start": d})
    return plans


def plan_person_years(assets):
    plans = []
    for year in YEARS:
        per = defaultdict(list)
        for a in assets:
            if a["t"].year == year:
                for p in a["people"]:
                    per[p].append(a["id"])
        for p, ids in per.items():
            if len(ids) >= (HOUSEHOLD_YEAR_MIN_PHOTOS if p in HOUSEHOLD else YEAR_MIN_PHOTOS):
                plans.append({"kind": "person", "key": f"{p}:{year}", "name": f"{p.split()[0]} {year}",
                              "ids": ids, "start": datetime(year, 1, 1)})
    return plans


def plan_seasons(assets, absorbed):
    buckets = defaultdict(list)
    for a in assets:
        if has_gps(a) or a["t"].date() >= NO_GPS_ERA_END or a["id"] in absorbed:
            continue
        t = a["t"]
        if t.month in (7, 8):
            buckets[("Summer", t.year)].append(a["id"])
        elif (t.month == 12 and t.day >= 20) or (t.month == 1 and t.day <= 5):
            buckets[("Christmas", t.year if t.month == 12 else t.year - 1)].append(a["id"])
    return [{"kind": "season", "key": f"{s}:{y}", "name": f"{s} {y}", "ids": ids, "start": datetime(y, 1, 1)}
            for (s, y), ids in buckets.items() if len(ids) >= SEASON_MIN_PHOTOS]


def plan_fixed_events(assets):
    plans = []
    for name, d0, d1 in FIXED_EVENTS:
        ids = [a["id"] for a in assets if d0 <= a["t"].date() <= d1]
        if ids:
            plans.append({"kind": "event", "key": f"{name}:{d0.isoformat()}", "name": f"{name}, {d0:%b %Y}",
                          "ids": ids, "start": datetime(d0.year, d0.month, d0.day)})
    return plans


CLUSTER_KINDS = ("trip", "daytrip", "gathering")


def fold_into_events(assets, plans):
    """A cluster with EVENT_ABSORB_SHARE of its photos and its days inside a hand-declared event is that event."""
    if not FIXED_EVENTS:
        return plans, []
    day = {a["id"]: a["t"].date() for a in assets}
    events = {p["key"]: p for p in plans if p["kind"] == "event"}
    # Narrowest range first, then earliest, then by name: a tie goes to the most specific event.
    ordered = sorted(FIXED_EVENTS, key=lambda e: (e[2] - e[1], e[1], e[0]))
    kept, folded, extra = [], [], defaultdict(list)
    for p in plans:
        if p["kind"] not in CLUSTER_KINDS:
            kept.append(p)
            continue
        days = {day[i] for i in p["ids"] if i in day}
        best = None
        for name, d0, d1 in ordered:
            share = sum(1 for i in p["ids"] if i in day and d0 <= day[i] <= d1) / max(1, len(p["ids"]))
            # Photo count alone would let a three week trip fold into the wedding weekend it starts with.
            over_days = sum(1 for d in days if d0 <= d <= d1) / max(1, len(days))
            if share >= EVENT_ABSORB_SHARE and over_days >= EVENT_ABSORB_SHARE and (best is None or share > best[1]):
                best = ((name, d0), share)
        if best is None:
            kept.append(p)
            continue
        (name, d0), _ = best
        key = f"{name}:{d0.isoformat()}"
        if key in events:
            extra[key].extend(p["ids"])
        folded.append((name, p))
    # Rebuild rather than mutate, so a caller keeps the plans it handed in.
    merged = []
    for p in kept:
        add = extra.get(p["key"]) if p["kind"] == "event" else None
        if not add:
            merged.append(p)
            continue
        seen = set(p["ids"])
        tail = [i for i in dict.fromkeys(add) if i not in seen]
        merged.append({**p, "ids": p["ids"] + tail})
    return merged, folded


# ---- Reconcile with existing albums ----
def desc_for(plan):
    """Second line records the generated name so a manual rename in Immich is detected and preserved."""
    return f"{MARKER} kind={plan['kind']} key={plan['key']}\nauto: {plan['name']}"


def load_auto_albums():
    found = []
    for al in api("GET", "/albums") or []:
        d = al.get("description") or ""
        if not d.startswith(MARKER):
            continue
        head, _, tail = d.partition("\n")
        # key runs to the end of the line: a person or event key holds a name with spaces in it.
        meta = head[len(MARKER):]
        kind = re.search(r"\bkind=(\S+)", meta)
        key = re.search(r"\bkey=(.*)$", meta)
        auto = tail[len("auto: "):] if tail.startswith("auto: ") else al["albumName"]
        found.append({"id": al["id"], "name": al["albumName"], "auto": auto,
                      "kind": kind.group(1) if kind else None,
                      "key": key.group(1).strip() or None if key else None,
                      "count": al.get("assetCount") or 0, "assets": None})
    return found


def album_assets(al):
    """The album response carries only a count, so the ids come from a search."""
    if al["assets"] is None:
        al["assets"] = set() if not al["count"] else {a["id"] for a in search({"albumIds": [al["id"]]})}
    return al["assets"]


def match_existing(plan, existing, used):
    """Stable-key kinds match by key; event kinds match by >=50% asset overlap within 45 days."""
    same_kind = [al for al in existing if al["kind"] == plan["kind"] and al["id"] not in used]
    if plan["kind"] in ("person", "season", "event"):
        return next((al for al in same_kind if al["key"] == plan["key"]), None)
    ids = set(plan["ids"])
    best, best_score = None, 0.0
    for al in same_kind:
        try:
            kd = date.fromisoformat(al["key"])
        except (TypeError, ValueError):
            continue
        if abs((kd - plan["start"].date()).days) > 45:
            continue
        have = album_assets(al)
        score = len(ids & have) / max(1, min(len(ids), len(have)))
        if score > best_score:
            best, best_score = al, score
    return best if best_score >= 0.5 else None


def write_album(plan, al, user_renamed, add, rem):
    """One album's writes, raising ApiError so the run can carry on to the next album."""
    if al is None:
        api("POST", "/albums", {"albumName": plan["name"], "description": desc_for(plan),
                                "assetIds": sorted(plan["ids"])}, fatal=False)
        return
    api("PATCH", f"/albums/{al['id']}", {"albumName": al["name"] if user_renamed else plan["name"],
                                         "description": desc_for(plan)}, fatal=False)
    if add:
        api("PUT", f"/albums/{al['id']}/assets", {"ids": add}, fatal=False)
    if rem:
        api("DELETE", f"/albums/{al['id']}/assets", {"ids": rem}, fatal=False)


def apply(plans, existing, writer):
    used = set()
    failures = 0
    for plan in sorted(plans, key=lambda p: p["start"]):
        al = match_existing(plan, existing, used)
        ids = set(plan["ids"])
        if al is None:
            op, detail, add, rem, user_renamed = "create", f"key={plan['key']}", sorted(ids), [], False
        else:
            used.add(al["id"])
            have = album_assets(al)
            add, rem = sorted(ids - have), sorted(have - ids)
            user_renamed = al["name"] != al["auto"]
            rename = not user_renamed and al["name"] != plan["name"]
            stale_desc = al["auto"] != plan["name"]
            if not (add or rem or rename or stale_desc):
                continue
            op = "update" if (add or rem) else "rename"  # a rename moves no photos
            detail = f"+{len(add)} -{len(rem)}" + (f", was: {al['name']}" if rename else "") + (", keeping your name" if user_renamed else "")
        error = ""
        if not DRY_RUN:
            try:
                write_album(plan, al, user_renamed, add, rem)
            except ApiError as e:
                error, failures = str(e), failures + 1
        writer.writerow([plan["kind"], op, plan["name"], len(ids), detail, error])
        log(f"  {'FAILED ' if error else op:7} {plan['kind']:9} {plan['name']} ({detail})")
        if error:
            log(f"          {error}")
    return failures, used


def main():
    log(f"Started. DRY_RUN={int(DRY_RUN)} window since {WINDOW_START:%Y-%m-%d}")
    if not API_KEY:
        log("FATAL: IMMICH_API_KEY not set")
        sys.exit(1)
    api("GET", "/users/me")  # auth check, exits with FATAL on a bad key

    assets = fetch_assets()
    log(f"Assets: {len(assets)} ({sum(has_gps(a) for a in assets.values())} with GPS)")
    towns = attach_districts(assets)
    if towns:
        named = sum(1 for a in assets.values() if a.get("district"))
        log(f"Districts: {towns} cities looked up, {named} photos got one")
    people = fetch_people()
    log(f"Named people: {len(people)}")
    attach_people(assets, people)
    missing = HOUSEHOLD - {p["name"] for p in people}
    if missing:
        log(f"WARN: household names not found in Immich People: {sorted(missing)}")

    alist = list(assets.values())
    absorbed = set()
    plans = (plan_trips_and_daytrips(alist, absorbed) + plan_gatherings(alist) + plan_person_years(alist)
             + plan_seasons(alist, absorbed) + plan_fixed_events(alist))
    plans, folded = fold_into_events(alist, plans)
    log(f"GPS-less photos absorbed into trips: {len(absorbed)}")
    for name, p in folded:
        log(f"  folded {p['kind']} \"{p['name']}\" ({len(p['ids'])}) into event \"{name}\"")
    log(f"Plans: {dict(Counter(p['kind'] for p in plans))}")

    existing = load_auto_albums()
    log(f"Existing auto albums: {len(existing)}")

    csv_path = os.path.join(OUT, f"decisions_{STAMP}.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["kind", "action", "album", "assets", "detail", "error"])
        failures, claimed = apply(plans, existing, w)
    stale = [al for al in existing if al["id"] not in claimed]
    if stale:
        log(f"WARN: {len(stale)} auto albums no longer have a plan, delete them in Immich if you want them gone:")
        for al in stale:
            log(f"          {al['name']}")
    log(f"Decision log: {csv_path}")
    if DRY_RUN:
        log("DRY RUN, nothing written to Immich. Review the CSV, then set DRY_RUN=0.")
    if failures:
        log(f"FAILED on {failures} album(s). The rest went through; the CSV has a message per failure.")
    log("Done.")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
