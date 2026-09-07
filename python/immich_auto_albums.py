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
        DOMINANT_SHARE=cl["dominant_share"], TRIP_GAP_H=cl["trip_gap_hours"],
        TRIP_MIN_PHOTOS=cl["trip_min_photos"], TRIP_MIN_DAYS=cl["trip_min_days"],
        DAYTRIP_MIN_PHOTOS=cl["daytrip_min_photos"], GATHER_GAP_H=cl["gather_gap_hours"],
        GATHER_MIN_PHOTOS=cl["gather_min_photos"], GATHER_MIN_GUESTS=cl["gather_min_guests"],
        YEAR_MIN_PHOTOS=py["min_photos"], HOUSEHOLD_YEAR_MIN_PHOTOS=py["household_min_photos"],
        NO_GPS_ERA_END=se["no_gps_era_end"], SEASON_MIN_PHOTOS=se.get("min_photos", 5),
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
def api(method, path, body=None):
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
        log(f"FATAL: HTTP {e.code} {method} {path}: {e.read().decode(errors='replace')[:300]}")
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
            "people": set(),
        }
    return out


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


def place_name(cluster):
    """City if one place dominates, else state if all in one state, else country, else two countries."""
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
        return label(top) or label(top, "state") or label(top, "country") or "Trip"
    states = {label(pl["items"], "state") for pl in places} - {None}
    if len(states) == 1:
        return states.pop()
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
        meta = dict(kv.split("=", 1) for kv in head[len(MARKER):].split() if "=" in kv)
        auto = tail[len("auto: "):] if tail.startswith("auto: ") else al["albumName"]
        found.append({"id": al["id"], "name": al["albumName"], "auto": auto, "kind": meta.get("kind"),
                      "key": meta.get("key"), "count": al.get("assetCount") or 0, "assets": None})
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


def apply(plans, existing, writer):
    used = set()
    for plan in sorted(plans, key=lambda p: p["start"]):
        al = match_existing(plan, existing, used)
        ids = set(plan["ids"])
        if al is None:
            writer.writerow([plan["kind"], "create", plan["name"], len(ids), ""])
            log(f"  create  {plan['kind']:9} {plan['name']} ({len(ids)}) key={plan['key']}")
            if not DRY_RUN:
                api("POST", "/albums", {"albumName": plan["name"], "description": desc_for(plan), "assetIds": sorted(ids)})
            continue
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
        writer.writerow([plan["kind"], op, plan["name"], len(ids), detail])
        log(f"  {op:7} {plan['kind']:9} {plan['name']} ({detail})")
        if DRY_RUN:
            continue
        api("PATCH", f"/albums/{al['id']}", {"albumName": al["name"] if user_renamed else plan["name"], "description": desc_for(plan)})
        if add:
            api("PUT", f"/albums/{al['id']}/assets", {"ids": add})
        if rem:
            api("DELETE", f"/albums/{al['id']}/assets", {"ids": rem})


def main():
    log(f"Started. DRY_RUN={int(DRY_RUN)} window since {WINDOW_START:%Y-%m-%d}")
    if not API_KEY:
        log("FATAL: IMMICH_API_KEY not set")
        sys.exit(1)
    api("GET", "/users/me")  # auth check, exits with FATAL on a bad key

    assets = fetch_assets()
    log(f"Assets: {len(assets)} ({sum(has_gps(a) for a in assets.values())} with GPS)")
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
    log(f"GPS-less photos absorbed into trips: {len(absorbed)}")
    log(f"Plans: {dict(Counter(p['kind'] for p in plans))}")

    existing = load_auto_albums()
    log(f"Existing auto albums: {len(existing)}")

    csv_path = os.path.join(OUT, f"decisions_{STAMP}.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["kind", "action", "album", "assets", "detail"])
        apply(plans, existing, w)
    log(f"Decision log: {csv_path}")
    if DRY_RUN:
        log("DRY RUN, nothing written to Immich. Review the CSV, then set DRY_RUN=0.")
    log("Done.")


if __name__ == "__main__":
    main()
