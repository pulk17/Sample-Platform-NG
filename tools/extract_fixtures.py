"""Extract frontend fixtures from the sample-platform prod SQL dump.

Streams the mysqldump file, parses INSERT tuples for the tables we need,
aggregates recent run results, and writes JSON into the web project.

Usage:
    SP_DUMP=/path/to/dump.sql python tools/extract_fixtures.py

The dump contains the full production database — keep it out of the repo,
delete it when done, and never widen COLS below without checking the new
columns for user data (emails, tokens, IPs). Everything COLS currently
selects is public on the classic site already.
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

DUMP = Path(os.environ.get("SP_DUMP", "sample_platform_full_dump.sql"))
OUT = Path(os.environ.get(
    "SP_FIXTURES_OUT",
    Path(__file__).resolve().parents[1] / "src" / "mocks" / "generated",
))
if not DUMP.is_file():
    sys.exit(f"dump not found: {DUMP} (set SP_DUMP)")
OUT.mkdir(parents=True, exist_ok=True)

COLS = {
    "category": ["id", "name", "description"],
    "regression_test": ["id", "sample_id", "command", "input_type", "output_type",
                         "expected_rc", "active", "description",
                         "last_passed_on_windows", "last_passed_on_linux"],
    "regression_test_category": ["regression_id", "category_id"],
    "regression_test_output": ["id", "regression_id", "correct", "correct_extension",
                                "expected_filename", "ignore"],
    "regression_test_output_files": ["id", "file_hashes", "regression_test_output_id"],
    "sample": ["id", "sha", "extension", "original_name"],
    "sample_tag_association": ["sample_id", "tag_id"],
    "tag": ["id", "name", "description"],
    "fork": ["id", "github"],
    "test": ["id", "platform", "test_type", "token", "fork_id", "branch", "commit", "pr_nr"],
    "test_progress": ["id", "test_id", "status", "timestamp", "message"],
    "test_result": ["test_id", "regression_test_id", "runtime", "exit_code", "expected_rc"],
    "test_result_file": ["test_id", "regression_test_id", "regression_test_output_id",
                          "expected", "got"],
}


def parse_tuples(s):
    """Yield tuples (lists of python values) from a mysqldump VALUES payload."""
    i, n = 0, len(s)
    while i < n:
        if s[i] != "(":
            i += 1
            continue
        i += 1
        row, buf, in_str = [], [], False
        while i < n:
            c = s[i]
            if in_str:
                if c == "\\":
                    nxt = s[i + 1]
                    buf.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0",
                                "'": "'", '"': '"', "\\": "\\"}.get(nxt, nxt))
                    i += 2
                    continue
                if c == "'":
                    in_str = False
                    row.append(("s", "".join(buf)))
                    buf = []
                    i += 1
                    continue
                buf.append(c)
                i += 1
                continue
            if c == "'":
                in_str = True
                i += 1
                continue
            if c in ",)":
                if buf:
                    tok = "".join(buf).strip()
                    buf = []
                    if tok:
                        row.append(("r", tok))
                i += 1
                if c == ")":
                    yield [decode(kind, v) for kind, v in row]
                    break
                continue
            buf.append(c)
            i += 1


def decode(kind, v):
    if kind == "s":
        return v
    if v == "NULL":
        return None
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


# ---- pass 1: collect small tables + test ids -------------------------------
small = {t: [] for t in COLS}
BIG = {"test_result", "test_result_file", "test_progress"}

print("pass 1: small tables…", flush=True)
with DUMP.open(encoding="utf-8", errors="replace") as f:
    for line in f:
        if not line.startswith("INSERT INTO `"):
            continue
        table = line[13:line.index("`", 13)]
        if table not in COLS or table in BIG:
            continue
        payload = line[line.index("VALUES") + 6:]
        for row in parse_tuples(payload):
            small[table].append(dict(zip(COLS[table], row)))

tests_rows = small["test"]
tests_rows.sort(key=lambda r: r["id"])
recent_ids = {r["id"] for r in tests_rows[-60:]}
print(f"  test rows={len(tests_rows)}, samples={len(small['sample'])}, "
      f"regression_tests={len(small['regression_test'])}", flush=True)

# ---- pass 2: big tables filtered by recent test ids ------------------------
print("pass 2: results for recent runs…", flush=True)
results = defaultdict(dict)          # test_id -> {regression_id: {...}}
mismatches = defaultdict(set)        # test_id -> {regression_id with got != NULL}
progress = defaultdict(list)         # test_id -> [(status, ts, msg)]

with DUMP.open(encoding="utf-8", errors="replace") as f:
    for line in f:
        if not line.startswith("INSERT INTO `"):
            continue
        table = line[13:line.index("`", 13)]
        if table not in BIG:
            continue
        payload = line[line.index("VALUES") + 6:]
        for row in parse_tuples(payload):
            d = dict(zip(COLS[table], row))
            tid = d["test_id"]
            if tid not in recent_ids:
                continue
            if table == "test_result":
                results[tid][d["regression_test_id"]] = d
            elif table == "test_result_file":
                if d["got"] is not None:
                    mismatches[tid].add(d["regression_test_id"])
            else:
                progress[tid].append((d["status"], d["timestamp"], d["message"]))

print(f"  runs with results={len(results)}", flush=True)

# ---- assemble --------------------------------------------------------------
def passed(tid, rid):
    r = results[tid].get(rid)
    if r is None:
        return None
    return r["exit_code"] == r["expected_rc"] and rid not in mismatches[tid]

forks = {f["id"]: f["github"] for f in small["fork"]}
cat_names = {c["id"]: c["name"] for c in small["category"]}
rt_cats = defaultdict(list)
for link in small["regression_test_category"]:
    rt_cats[link["regression_id"]].append(link["category_id"])

outputs_by_rt = defaultdict(list)
for o in small["regression_test_output"]:
    outputs_by_rt[o["regression_id"]].append(o)
variants_by_output = defaultdict(list)
for v in small["regression_test_output_files"]:
    variants_by_output[v["regression_test_output_id"]].append(v["file_hashes"])

samples_by_id = {s["id"]: s for s in small["sample"]}
tags_by_id = {t["id"]: t for t in small["tag"]}
sample_tags = defaultdict(list)
for a in small["sample_tag_association"]:
    sample_tags[a["sample_id"]].append(a["tag_id"])

rt_by_sample = defaultdict(int)
for rt in small["regression_test"]:
    rt_by_sample[rt["sample_id"]] += 1

# logical runs: group recent test rows by (commit, pr_nr)
recent_tests = [r for r in tests_rows if r["id"] in recent_ids]
groups = defaultdict(list)
for t in recent_tests:
    groups[(t["commit"], t["pr_nr"])].append(t)

STATUS_MAP = {"preparation": "preparation", "testing": "testing",
              "completed": "completed", "canceled": "canceled"}

runs_json = []
ordered_groups = sorted(groups.values(), key=lambda g: max(x["id"] for x in g), reverse=True)
prev_failed = {}  # platform -> set of failing rids on the previous (older) run — filled later

# build oldest→newest so we can compute "new failures" vs previous run per platform
runs_asc = list(reversed(ordered_groups))
prev_fail_by_platform = {}
run_objs_asc = []
for g in runs_asc:
    platforms = []
    for t in sorted(g, key=lambda x: x["platform"]):
        tid = t["id"]
        rids = list(results[tid].keys())
        p_pass = sum(1 for rid in rids if passed(tid, rid))
        fails = {rid for rid in rids if passed(tid, rid) is False}
        prog = sorted(progress[tid], key=lambda x: x[1] or "")
        last = prog[-1] if prog else (None, None, "")
        first_ts = prog[0][1] if prog else None
        dur = None
        if prog and prog[0][1] and prog[-1][1]:
            from datetime import datetime
            fmt = "%Y-%m-%d %H:%M:%S"
            try:
                dur = int((datetime.strptime(prog[-1][1], fmt)
                           - datetime.strptime(prog[0][1], fmt)).total_seconds())
            except ValueError:
                pass
        prev = prev_fail_by_platform.get(t["platform"], set())
        platforms.append({
            "test_id": tid,
            "platform": t["platform"],
            "status": STATUS_MAP.get(last[0], "completed") if last[0] else "queued",
            "message": (last[2] or "")[:160],
            "passed": p_pass,
            "failed": len(fails),
            "new_failures": len(fails - prev) if rids else 0,
            "total": len(rids),
            "duration_s": dur,
            "started_at": first_ts,
            "failing_ids": sorted(fails)[:80],
        })
        if rids:
            prev_fail_by_platform[t["platform"]] = fails
    t0 = g[0]
    run_objs_asc.append({
        "id": str(max(x["id"] for x in g)),
        "commit": (t0["commit"] or "")[:9],
        "branch": t0["branch"],
        "fork": (forks.get(t0["fork_id"]) or "").replace("https://github.com/", "").removesuffix(".git"),
        "pr_nr": t0["pr_nr"] or None,
        "test_type": t0["test_type"],
        "created_at": platforms[0]["started_at"] if platforms else None,
        "platforms": platforms,
    })
runs_json = list(reversed(run_objs_asc))

# sparkline: last 20 logical runs (asc order) per regression test — pass iff
# passed on every platform that ran it
spark_runs = run_objs_asc[-20:]
def spark_for(rid):
    out = []
    for run in spark_runs:
        vals = []
        for p in run["platforms"]:
            v = passed(int(p["test_id"]), rid)
            if v is not None:
                vals.append(v)
        if not vals:
            out.append("skip")
        else:
            out.append("pass" if all(vals) else "fail")
    return out

avg_runtime = defaultdict(list)
for tid, by_rid in results.items():
    for rid, r in by_rid.items():
        if r["runtime"]:
            avg_runtime[rid].append(r["runtime"])

tests_json = []
for rt in sorted(small["regression_test"], key=lambda r: r["id"]):
    s = samples_by_id.get(rt["sample_id"], {})
    outs = []
    for o in outputs_by_rt[rt["id"]]:
        outs.append({
            "id": o["id"],
            "hash": o["correct"],
            "extension": o["correct_extension"],
            "ignore": bool(o["ignore"]),
            "variants": variants_by_output[o["id"]],
        })
    rts = avg_runtime[rt["id"]]
    tests_json.append({
        "id": rt["id"],
        "sample_id": rt["sample_id"],
        "sample_name": s.get("original_name", "?"),
        "sample_sha": s.get("sha", ""),
        "command": rt["command"],
        "input_type": rt["input_type"],
        "output_type": rt["output_type"],
        "expected_rc": rt["expected_rc"],
        "active": bool(rt["active"]),
        "description": rt["description"] or "",
        "categories": [cat_names.get(c, "?") for c in rt_cats[rt["id"]]],
        "baselines": outs,
        "last_passed_linux": rt["last_passed_on_linux"],
        "last_passed_windows": rt["last_passed_on_windows"],
        "avg_runtime_ms": int(sum(rts) / len(rts)) if rts else None,
        "recent_results": spark_for(rt["id"]),
    })

samples_json = []
for s in sorted(small["sample"], key=lambda x: x["id"]):
    samples_json.append({
        "id": s["id"],
        "sha": s["sha"],
        "extension": s["extension"],
        "original_name": s["original_name"],
        "tags": [tags_by_id[t]["name"] for t in sample_tags[s["id"]] if t in tags_by_id],
        "test_count": rt_by_sample[s["id"]],
    })

cats_json = [{
    "id": c["id"], "name": c["name"], "description": c["description"],
    "test_count": sum(1 for r in small["regression_test"] if c["id"] in rt_cats[r["id"]]),
} for c in sorted(small["category"], key=lambda x: x["name"])]

(OUT / "tests.json").write_text(json.dumps(tests_json, indent=1), encoding="utf-8")
(OUT / "samples.json").write_text(json.dumps(samples_json, indent=1), encoding="utf-8")
(OUT / "categories.json").write_text(json.dumps(cats_json, indent=1), encoding="utf-8")
(OUT / "runs.json").write_text(json.dumps(runs_json, indent=1), encoding="utf-8")

print(f"wrote {len(tests_json)} tests, {len(samples_json)} samples, "
      f"{len(cats_json)} categories, {len(runs_json)} runs -> {OUT}", flush=True)
