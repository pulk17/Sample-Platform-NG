/**
 * Demo mode: serve every /api/v1/* request from the baked snapshot so the
 * app runs as a static site with no backend. Enabled at build time via
 * VITE_DEMO=1. Patches window.fetch, so all data-layer code is unchanged.
 */
import runsJson from "@/mocks/generated/runs.json";
import samplesJson from "@/mocks/generated/samples.json";
import testsJson from "@/mocks/generated/tests.json";

export const DEMO = import.meta.env.VITE_DEMO === "1";

interface SnapTest {
  id: number;
  sample_id: number;
  sample_name: string;
  sample_sha: string;
  command: string;
  input_type: string | null;
  output_type: string | null;
  expected_rc: number;
  active: boolean;
  description: string;
  categories: string[];
  baselines: { id: number; hash: string; extension: string; ignore: boolean; variants: string[] }[];
  last_passed_linux: number | null;
  last_passed_windows: number | null;
  avg_runtime_ms: number | null;
  recent_results: string[];
}
interface SnapSample {
  id: number; sha: string; extension: string; original_name: string; tags: string[]; test_count: number;
}
interface SnapPlatform {
  test_id: number; platform: string; status: string; message: string;
  passed: number; failed: number; new_failures: number; total: number;
  duration_s: number | null; started_at: string | null; failing_ids: number[];
}
interface SnapRun {
  id: string; commit: string; branch: string; fork: string; pr_nr: number | null;
  test_type: string; created_at: string | null; platforms: SnapPlatform[];
}

const tests = testsJson as SnapTest[];
const samples = samplesJson as SnapSample[];
const runs = runsJson as unknown as SnapRun[];

const testById = new Map(tests.map((t) => [t.id, t]));
const sampleById = new Map(samples.map((s) => [s.id, s]));
// Flatten to per-platform run rows keyed by test_id (= run_id in the API).
const platformRuns = new Map<number, { run: SnapRun; p: SnapPlatform }>();
for (const run of runs) for (const p of run.platforms) platformRuns.set(p.test_id, { run, p });

const nowISO = () => new Date().toISOString();
const OK = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ERR = (status: number, message: string) =>
  new Response(JSON.stringify({ code: "error", message }), { status, headers: { "Content-Type": "application/json" } });

const paginate = <T,>(rows: T[], limit: number, offset: number) => ({
  data: rows.slice(offset, offset + limit),
  meta: {},
  pagination: {
    total: rows.length,
    limit,
    offset,
    next_offset: offset + limit < rows.length ? offset + limit : null,
  },
});

const DEMO_USERS = [
  { user_id: 1, name: "Carlos Fernandez", email: "carlos@ccextractor.org", role: "admin", github_linked: true, github_login: "carlosfernandez" },
  { user_id: 2, name: "Pulkit Chauhan", email: "pulkit@ccextractor.org", role: "contributor", github_linked: true, github_login: "pulkitchauhan" },
  { user_id: 3, name: "Willem Van Iseghem", email: "willem@ccextractor.org", role: "admin", github_linked: true, github_login: "canihavesomecoffee" },
  { user_id: 4, name: "Test Runner Bot", email: "ci@ccextractor.org", role: "tester", github_linked: false, github_login: null },
  { user_id: 5, name: "Community User", email: "user@example.com", role: "user", github_linked: false, github_login: null },
];
// Mutated by PATCH /users in demo so role changes stick for the session.
const demoUserRoles = new Map(DEMO_USERS.map((u) => [u.user_id, u.role]));

const SRT_DIFF = `--- expected
+++ actual
@@ -1,12 +1,14 @@
 1
 00:00:05,977 --> 00:00:08,317
-to tell the world the story of the US government
+to tell the world the story
+of the US government

 2
 00:00:08,317 --> 00:00:10,987
-covert arms resupply operation for the Contras.
+covert arms resupply
+operation for the Contras.

 3
 00:00:10,987 --> 00:00:15,487
-My name is Gene Hasenfus. I come from Marinette Wisconsin.
+My name is Gene Hasenfus.
+I come from Marinette, Wisconsin.`;

function mediaInfoFor(s: SnapSample) {
  return [
    { name: "Media info version", value: "2.0" },
    {
      name: "General",
      value: {
        Format: s.extension === "ts" ? "MPEG-TS" : s.extension === "mp4" ? "MPEG-4" : "MPEG-PS",
        FileSize: `${(200 + (s.id % 40) * 55).toFixed(0)} MB`,
        Duration: `${5 + (s.id % 50)}m ${s.id % 60}s`,
      },
    },
    {
      name: "Video",
      value: [{
        name: "ID: 1",
        value: {
          Format: s.id % 2 ? "AVC" : "MPEG Video",
          Resolution: s.id % 3 ? "1920 x 1080" : "1280 x 720",
          "Frame rate": "29.970",
          "Scan type": "Interlaced (TFF)",
        },
      }],
    },
    {
      name: "Captions",
      value: s.tags.length
        ? [{ name: "Text ID: 1", value: { Format: "EIA-608", Language: "en" } }]
        : [],
    },
  ];
}

function runFailures(p: SnapPlatform) {
  const rows: unknown[] = [];
  for (const id of p.failing_ids) {
    const t = testById.get(id);
    if (!t) continue;
    rows.push({
      regression_test_id: t.id,
      sample_id: t.sample_id,
      sample_name: t.sample_name,
      command: t.command,
      categories: t.categories,
      status: "fail",
      exit_code: 0,
      expected_rc: t.expected_rc,
      runtime_ms: t.avg_runtime_ms ?? 12000,
      outputs: [{ output_id: t.id * 10, filename: `${t.sample_sha.slice(0, 16)}.srt`, status: "fail" }],
    });
  }
  return rows;
}

function passRows(p: SnapPlatform) {
  // a few passing tests for the run-detail category view
  const failing = new Set(p.failing_ids);
  const rows: unknown[] = [];
  for (const t of tests) {
    if (failing.has(t.id)) continue;
    rows.push({
      regression_test_id: t.id,
      sample_id: t.sample_id,
      sample_name: t.sample_name,
      command: t.command,
      categories: t.categories,
      status: "pass",
      exit_code: t.expected_rc,
      expected_rc: t.expected_rc,
      runtime_ms: t.avg_runtime_ms ?? 12000,
      outputs: [{ output_id: t.id * 10, filename: `${t.sample_sha.slice(0, 16)}.srt`, status: "pass" }],
    });
    if (rows.length >= Math.max(0, p.passed)) break;
  }
  return rows;
}

function liveRun(run: SnapRun, p: SnapPlatform) {
  return {
    run_id: p.test_id,
    status: p.status === "completed" ? (p.failed > 0 ? "fail" : "pass") : p.status,
    platform: p.platform,
    test_type: run.pr_nr ? "pr" : "commit",
    repository: run.fork,
    branch: run.pr_nr ? `pull_request` : run.branch,
    commit_sha: (run.commit + "0".repeat(40)).slice(0, 40),
    pr_number: run.pr_nr,
    created_at: run.created_at,
    queued_at: run.created_at,
    started_at: p.started_at,
    completed_at: p.duration_s && p.started_at
      ? new Date(new Date(p.started_at).getTime() + p.duration_s * 1000).toISOString()
      : null,
    github_link: run.pr_nr ? `https://github.com/${run.fork}/pull/${run.pr_nr}` : null,
  };
}

function route(path: string, method: string, body: unknown): Response {
  const url = new URL(path, "http://x");
  const q = url.searchParams;
  const seg = url.pathname.replace(/^\/api\/v1/, "").split("/").filter(Boolean);
  const limit = Number(q.get("limit") ?? 50);
  const offset = Number(q.get("offset") ?? 0);
  const p = (i: number) => seg[i];

  // auth
  if (seg[0] === "auth" && seg[1] === "tokens" && method === "POST")
    return OK({ token: "spci_demo", token_name: "demo", token_type: "bearer",
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      scopes: ["runs:read", "runs:write", "system:read", "baselines:write", "results:read", "tokens:manage"] }, 201);
  if (seg[0] === "auth" && seg[1] === "me")
    return OK({ user_id: 1, name: "Carlos Fernandez", email: "carlos@ccextractor.org", role: "admin",
      scopes: ["runs:read", "runs:write", "system:read", "baselines:write", "results:read", "tokens:manage"] });
  if (seg[0] === "auth" && seg[1] === "tokens" && method === "GET")
    return OK(paginate([
      { id: 1, token_name: "web-console", token_prefix: "spci_0lj23f8", scopes: ["runs:read", "runs:write"], created_at: nowISO(), expires_at: new Date(Date.now() + 6 * 864e5).toISOString(), is_revoked: false },
      { id: 2, token_name: "ci-pipeline", token_prefix: "spci_9aXf21b", scopes: ["runs:read", "results:read"], created_at: nowISO(), expires_at: new Date(Date.now() + 20 * 864e5).toISOString(), is_revoked: false },
    ], 50, 0));
  if (seg[0] === "auth" && seg[1] === "tokens" && method === "DELETE")
    return new Response(null, { status: 204 });

  // system
  if (seg[0] === "system" && seg[1] === "health")
    return OK({ status: "ok", checked_at: nowISO(), dependencies: [
      { name: "database", status: "ok", message: null },
      { name: "local_storage", status: "ok", message: null },
      { name: "gcs", status: "ok", message: null }] });
  if (seg[0] === "system" && seg[1] === "queue")
    return OK({ ...paginate([
      { run_id: 9349, platform: "windows", status: "running", position: null, queued_at: nowISO(), started_at: nowISO() },
      { run_id: 9350, platform: "linux", status: "queued", position: 1, queued_at: nowISO(), started_at: null },
    ], 50, 0), meta: { queue_depth: 1, running_count: 1 } });

  // users
  if (seg[0] === "users" && method === "GET")
    return OK(paginate(DEMO_USERS.map((u) => ({ ...u, role: demoUserRoles.get(u.user_id) })), 100, 0));
  if (seg[0] === "users" && method === "PATCH") {
    const id = Number(p(1));
    const role = (body as { role?: string })?.role ?? "user";
    demoUserRoles.set(id, role);
    const u = DEMO_USERS.find((x) => x.user_id === id)!;
    return OK({ ...u, role });
  }

  // regression tests
  if (seg[0] === "regression-tests" && seg.length === 1 && method === "GET") {
    const active = (q.get("active") ?? "true") === "true";
    const rows = tests.filter((t) => t.active === active).map((t) => ({
      regression_test_id: t.id, sample_id: t.sample_id, sample_name: t.sample_name,
      command: t.command, input_type: t.input_type, output_type: t.output_type,
      expected_rc: t.expected_rc, active: t.active, categories: t.categories, description: t.description,
    }));
    return OK(paginate(rows, limit, offset));
  }
  if (seg[0] === "regression-tests" && (method === "POST" || method === "PATCH"))
    return OK({ regression_test_id: 9001, ...(body as object) });

  // samples
  if (seg[0] === "samples" && seg.length === 1) {
    let rows = samples;
    const ext = q.get("extension");
    if (ext) rows = rows.filter((s) => s.extension === ext);
    return OK(paginate(rows.map((s) => ({
      sample_id: s.id, sha: s.sha, extension: s.extension, original_name: s.original_name,
      filename: `${s.sha}.${s.extension}`, tags: s.tags, regression_test_count: s.test_count,
    })), limit, offset));
  }
  if (seg[0] === "samples" && seg[2] === "details") {
    const s = sampleById.get(Number(p(1)));
    if (!s) return ERR(404, "not found");
    return OK({
      sample_id: s.id, sha: s.sha, extension: s.extension, original_name: s.original_name,
      filename: `${s.sha}.${s.extension}`, tags: s.tags,
      upload: {
        platform: s.id % 2 ? "windows" : "linux",
        parameters: tests.find((t) => t.sample_id === s.id)?.command ?? "--autoprogram",
        notes: s.id % 4 === 0 ? "Gets cut off after 40 minutes" : "",
        version: "0.94", version_released: "2020-08-16",
      },
      extra_files: [],
      media_info: mediaInfoFor(s),
    });
  }
  if (seg[0] === "samples" && seg[2] === "history") {
    const sid = Number(p(1));
    const sTests = new Set(tests.filter((t) => t.sample_id === sid).map((t) => t.id));
    const rows: unknown[] = [];
    for (const run of runs) for (const pl of run.platforms) for (const rid of [...sTests]) {
      const failed = pl.failing_ids.includes(rid);
      rows.push({
        run_id: pl.test_id, regression_test_id: rid, platform: pl.platform,
        status: failed ? "fail" : "pass",
        commit_sha: (run.commit + "0".repeat(40)).slice(0, 40),
        branch: run.branch, tested_at: pl.started_at,
      });
    }
    return OK(paginate(rows.slice(0, 40), limit, offset));
  }
  if (seg[0] === "samples" && seg.length === 2) {
    const s = sampleById.get(Number(p(1)));
    if (!s) return ERR(404, "not found");
    return OK({ sample_id: s.id, sha: s.sha, extension: s.extension, original_name: s.original_name,
      filename: `${s.sha}.${s.extension}`, tags: s.tags, regression_test_count: s.test_count, active: s.test_count > 0 });
  }

  // runs
  if (seg[0] === "runs" && seg.length === 1 && method === "GET") {
    const rows: unknown[] = [];
    for (const run of runs) for (const pl of run.platforms) rows.push(liveRun(run, pl));
    rows.sort((a, b) => (b as { run_id: number }).run_id - (a as { run_id: number }).run_id);
    return OK(paginate(rows, limit, offset));
  }
  if (seg[0] === "runs" && method === "POST") return OK({ run_id: 9351 });
  if (seg[0] === "runs" && seg.length >= 2) {
    const rid = Number(p(1));
    const pr = platformRuns.get(rid);
    if (!pr) return ERR(404, "run not found");
    const { run, p: pl } = pr;
    if (seg[2] === undefined) return OK(liveRun(run, pl));
    if (seg[2] === "summary")
      return OK({
        run_id: rid, status: pl.status === "completed" ? (pl.failed > 0 ? "fail" : "pass") : pl.status,
        total_samples: pl.total, pass_count: pl.passed, fail_count: pl.failed,
        error_count: Math.max(0, pl.total - pl.passed - pl.failed - 10),
        missing_output_count: Math.min(10, Math.max(0, pl.total - pl.passed - pl.failed)),
        skipped_count: Math.max(0, pl.total - pl.passed - pl.failed),
        duration_ms: (pl.duration_s ?? 1800) * 1000,
      });
    if (seg[2] === "progress")
      return OK(paginate([
        { status: "preparation", message: "Loaded variables, checking for CCExtractor build artifact", timestamp: pl.started_at ?? nowISO() },
        { status: "testing", message: "Running tests", timestamp: pl.started_at ?? nowISO() },
        { status: pl.status === "canceled" ? "canceled" : "completed", message: pl.message, timestamp: nowISO() },
      ], 50, 0));
    if (seg[2] === "samples") {
      const status = q.get("status");
      const rows = status === "fail" ? runFailures(pl) : [...runFailures(pl), ...passRows(pl)];
      return OK(paginate(rows, limit, offset));
    }
    if (seg[2] === "cancel" && method === "POST")
      return OK({ run_id: rid, action: "cancel", status: "accepted", message: "Run has been canceled." }, 202);
    if (seg[2] === "artifacts") {
      const arts: unknown[] = [{
        artifact_id: `buildlog_${rid}`, run_id: rid, sample_id: null, type: "build_log",
        filename: `${rid}.txt`, content_type: "text/plain", size_bytes: 52_140,
        storage_status: "ok", download_url: null,
      }];
      for (const id of pl.failing_ids.slice(0, 4)) {
        const t = testById.get(id);
        if (!t) continue;
        for (const kind of ["expected", "actual"] as const) {
          arts.push({
            artifact_id: `${kind}_${rid}_${t.id}`, run_id: rid, sample_id: t.sample_id,
            type: `${kind}_output`, filename: `${t.sample_sha.slice(0, 16)}_${kind}.srt`,
            content_type: "application/octet-stream", size_bytes: 40_000 + t.id * 7,
            storage_status: "ok", download_url: null,
          });
        }
      }
      return OK(paginate(arts, limit, offset));
    }
    if (seg[2] === "infrastructure-errors") {
      // Real backend derives these from progress messages; a run stuck in
      // preparation never produced a build, which is a platform fault, not a
      // test failure. Everything else has none.
      const infra =
        pl.status === "preparation"
          ? [{
              type: "build_artifact_missing",
              severity: "error",
              message:
                "No CCExtractor build artifact was produced for this commit — the run never reached the testing phase.",
              timestamp: pl.started_at,
            }]
          : [];
      return OK(paginate(infra, limit, offset));
    }
    if (seg.includes("diff")) return OK({ format: "unified", content: SRT_DIFF });
    if (seg.includes("promote-baseline"))
      return OK({
        status: "promoted",
        run_id: rid,
        sample_id: Number(p(3)),
        regression_id: (body as { regression_id?: number })?.regression_id ?? 0,
        output_id: (body as { output_id?: number })?.output_id ?? 0,
        promoted_by: "carlos@ccextractor.org",
        promoted_at: nowISO(),
      });
  }

  return OK({ data: [], meta: {}, pagination: { total: 0, limit, offset, next_offset: null } });
}

export function installDemoFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url;
    if (path.includes("/api/v1/")) {
      let body: unknown = undefined;
      try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 120)); // tiny latency so loading states show
      return route(path, (init?.method ?? "GET").toUpperCase(), body);
    }
    return real(input, init);
  };
}
