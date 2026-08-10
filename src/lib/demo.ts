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

// Administration state. Mutated in place so demo edits stick for the session,
// the same way role changes do.
const demoCategoryCounts = new Map<string, number>();
for (const t of tests)
  for (const c of t.categories)
    demoCategoryCounts.set(c, (demoCategoryCounts.get(c) ?? 0) + 1);
const demoCategories = [...demoCategoryCounts.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, test_count], i) => ({ id: i + 1, name, description: "", test_count }));

const demoMaintenance = new Map([
  ["linux", false],
  ["windows", false],
]);
const demoBlocked = [
  { user_id: 4242, comment: "Repeated abusive uploads" },
  { user_id: 90210, comment: "Broken CI spam" },
];
// Upload queue state. Mutated in place so a demo upload survives until the
// page is reloaded, the same way category and role edits do.
let nextQueueId = 1;
const demoQueue: {
  id: number; sha: string; extension: string; original_name: string; user_id: number;
}[] = [];
const demoTags = [
  { id: 1, name: "608", description: "CEA-608 captions" },
  { id: 2, name: "708", description: "CEA-708 captions" },
  { id: 3, name: "teletext", description: "DVB teletext" },
  { id: 4, name: "regression", description: "Guards a past regression" },
];
const demoAccount = { name: "Carlos Fernandez", email: "carlos@ccextractor.org" };

/** Stable stand-in hash so an upload looks like the real thing. */
function fakeSha(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: 8 }, (_, i) =>
    ((h * (i + 7)) >>> 0).toString(16).padStart(8, "0")).join("").slice(0, 64);
}

const demoForbidden = ["bat", "com", "dll", "exe", "sh"];

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

  // Routes added for the new endpoints go first: several of the
  // handlers below match on a path prefix alone, so a more specific
  // path placed after them would never be reached.
  // ---- uploads and the queue ----
  if (seg[0] === "samples" && seg[1] === "upload" && method === "POST") {
    const file = body instanceof FormData ? (body.get("file") as File | null) : null;
    const name = file?.name ?? "uploaded.ts";
    const dot = name.lastIndexOf(".");
    const row = {
      id: nextQueueId++,
      sha: fakeSha(name),
      extension: dot > 0 ? name.slice(dot) : "",
      original_name: dot > 0 ? name.slice(0, dot) : name,
      user_id: 1,
    };
    demoQueue.push(row);
    return OK(row, 201);
  }
  if (seg[0] === "queued-samples") {
    const id = Number(p(1));
    const row = demoQueue.find((r) => r.id === id);
    if (seg.length === 1) return OK(paginate(demoQueue, limit, offset));
    if (!row) return ERR(404, `Queued sample ${id} not found.`);
    if (seg[2] === "finalize" && method === "POST") {
      demoQueue.splice(demoQueue.indexOf(row), 1);
      const created = {
        id: 90000 + row.id,
        sha: row.sha,
        extension: row.extension.replace(".", ""),
        original_name: row.original_name,
        tags: [] as string[],
        test_count: 0,
      };
      samples.unshift(created);
      sampleById.set(created.id, created);
      return OK({ sample_id: created.id, sha: created.sha, original_name: created.original_name }, 201);
    }
    if (seg[2] === "link" && method === "POST") {
      const sampleId = (body as { sample_id?: number })?.sample_id ?? 0;
      if (!sampleById.has(sampleId)) return ERR(404, `Sample ${sampleId} not found.`);
      demoQueue.splice(demoQueue.indexOf(row), 1);
      return OK({ id: 500 + row.id, sample_id: sampleId, filename: `${row.sha}_1${row.extension}` }, 201);
    }
    if (method === "DELETE") {
      demoQueue.splice(demoQueue.indexOf(row), 1);
      return OK({ id, deleted: true });
    }
    return OK(row);
  }

  // ---- account and platform ----
  if (seg[0] === "auth" && seg[1] === "me" && seg[2] === "ftp-credentials")
    return OK({ host: "sampleplatform.ccextractor.org", port: "21", username: "sp_demo_user", password: "8Xk2mQ7rTn4wLp9v" });
  if (seg[0] === "auth" && seg[1] === "me" && method === "PATCH") {
    const patch = (body as Record<string, string>) ?? {};
    if (("email" in patch || "new_password" in patch) && !patch.current_password)
      return ERR(403, "current_password is required to change your email or password.");
    if (patch.name) demoAccount.name = patch.name;
    if (patch.email) demoAccount.email = patch.email;
    return OK({ ...DEMO_USERS[0], ...demoAccount });
  }
  if (seg[0] === "auth" && (seg[1] === "signup" || seg[1] === "password-reset"))
    return OK({ sent: true }, 202);
  if (seg[0] === "system" && seg[1] === "about")
    return OK({
      platform_commit: "fd0d5b3a91c4e77f2b6d84a0c1e5f39ab7d2c810",
      ccextractor_version: "0.94",
      ccextractor_released: "2020-08-16",
      last_tested_commit: runs[0]?.commit ?? null,
    });
  if (seg[0] === "users" && seg[2] === "password-reset" && method === "POST")
    return OK({ user_id: Number(p(1)), sent: true }, 202);
  if (seg[0] === "users" && seg[2] === "deactivate" && method === "POST") {
    const id = Number(p(1));
    const u = DEMO_USERS.find((x) => x.user_id === id);
    if (u) {
      u.name = `Anonymous ${id}`;
      u.email = `unknown${id}@ccextractor.org`;
    }
    return OK({ user_id: id, deactivated: true });
  }

  // ---- tags ----
  if (seg[0] === "tags") {
    if (method === "POST") {
      const name = (body as { name?: string })?.name ?? "";
      if (demoTags.some((t) => t.name === name)) return ERR(409, `Tag '${name}' already exists.`);
      const row = { id: Date.now(), name, description: (body as { description?: string })?.description ?? "" };
      demoTags.push(row);
      return OK(row, 201);
    }
    return OK(paginate(demoTags, limit, offset));
  }

  // ---- restart ----
  if (seg[0] === "runs" && seg[2] === "restart" && method === "POST")
    return OK({ run_id: Number(p(1)), action: "restart", status: "accepted", message: "Run has been queued to run again." }, 202);

  // ---- file locations ----
  if (seg.includes("download")) {
    const last = seg[seg.length - 2];
    return OK({
      sample_id: Number(p(1)) || undefined,
      filename: `${last}-demo-file`,
      download_url: "https://storage.googleapis.com/ccextractor-samples/demo-signed-url",
      storage_status: "ok",
    });
  }

  // ---- baseline variants ----
  if (seg[0] === "regression-tests" && seg.includes("variants")) {
    if (method === "POST")
      return OK({ id: Date.now(), hash: (body as { hash?: string })?.hash ?? "" }, 201);
    if (method === "DELETE") return OK({ id: Number(seg[seg.length - 1]), deleted: true });
  }

  // ---- sample edits ----
  if (seg[0] === "samples" && seg.length === 2 && method === "PATCH") {
    const s = sampleById.get(Number(p(1)));
    if (!s) return ERR(404, "not found");
    const tags = (body as { tags?: string[] })?.tags;
    if (tags) {
      const unknown = tags.filter((t) => !demoTags.some((d) => d.name === t));
      if (unknown.length) return ERR(400, `Unknown tags: ${unknown.join(", ")}`);
      s.tags = tags;
    }
    return OK({ sample_id: s.id, tags: s.tags });
  }
  if (seg[0] === "samples" && seg.length === 2 && method === "DELETE") {
    const s = sampleById.get(Number(p(1)));
    if (!s) return ERR(404, "not found");
    if (s.test_count) return ERR(409, `Sample ${s.id} is used by ${s.test_count} regression test(s). Delete those first.`);
    samples.splice(samples.indexOf(s), 1);
    sampleById.delete(s.id);
    return OK({ sample_id: s.id, deleted: true });
  }


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

  // platform configuration
  if (seg[0] === "system" && seg[1] === "maintenance") {
    if (method === "PATCH") {
      const plat = p(2);
      if (!demoMaintenance.has(plat)) return ERR(400, "Invalid platform.");
      const disabled = (body as { disabled?: boolean })?.disabled ?? false;
      demoMaintenance.set(plat, disabled);
      return OK({ platform: plat, disabled });
    }
    return OK({
      platforms: [...demoMaintenance].map(([platform, disabled]) => ({ platform, disabled })),
    });
  }
  if (seg[0] === "system" && seg[1] === "blocked-users") {
    if (method === "POST") {
      const id = (body as { user_id?: number })?.user_id ?? 0;
      if (demoBlocked.some((b) => b.user_id === id))
        return ERR(409, `GitHub user ${id} is already blocked.`);
      const row = { user_id: id, comment: (body as { comment?: string })?.comment ?? "" };
      demoBlocked.push(row);
      return OK(row, 201);
    }
    if (method === "DELETE") {
      const id = Number(p(2));
      const i = demoBlocked.findIndex((b) => b.user_id === id);
      if (i < 0) return ERR(404, `GitHub user ${id} is not blocked.`);
      demoBlocked.splice(i, 1);
      return OK({ user_id: id, deleted: true });
    }
    return OK(paginate([...demoBlocked].sort((a, b) => a.user_id - b.user_id), limit, offset));
  }
  if (seg[0] === "system" && seg[1] === "forbidden-extensions") {
    if (method === "POST") {
      const ext = ((body as { extension?: string })?.extension ?? "").toLowerCase();
      if (demoForbidden.includes(ext)) return ERR(409, `Extension '${ext}' is already forbidden.`);
      demoForbidden.push(ext);
      return OK({ extension: ext }, 201);
    }
    if (method === "DELETE") {
      const ext = p(2).replace(/^\.+/, "").toLowerCase();
      const i = demoForbidden.indexOf(ext);
      if (i < 0) return ERR(404, `Extension '${ext}' is not forbidden.`);
      demoForbidden.splice(i, 1);
      return OK({ extension: ext, deleted: true });
    }
    return OK(paginate([...demoForbidden].sort(), limit, offset));
  }

  // categories
  if (seg[0] === "categories") {
    if (method === "POST") {
      const name = (body as { name?: string })?.name ?? "";
      if (demoCategories.some((c) => c.name === name))
        return ERR(409, `Category '${name}' already exists.`);
      const row = { id: Date.now(), name, description: "", test_count: 0 };
      demoCategories.push(row);
      return OK(row, 201);
    }
    const target = demoCategories.find((c) => c.id === Number(p(1)));
    if (method === "PATCH") {
      if (!target) return ERR(404, "Category not found.");
      const name = (body as { name?: string })?.name;
      if (name && demoCategories.some((c) => c.name === name && c.id !== target.id))
        return ERR(409, `Category '${name}' already exists.`);
      if (name) target.name = name;
      return OK(target);
    }
    if (method === "DELETE") {
      if (!target) return ERR(404, "Category not found.");
      if (target.test_count)
        return ERR(409, `Category ${target.id} is used by ${target.test_count} regression test(s).`);
      demoCategories.splice(demoCategories.indexOf(target), 1);
      return OK({ id: target.id, deleted: true });
    }
    return OK(paginate(demoCategories, limit, offset));
  }

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
    if (seg.includes("baseline-approval"))
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
      if (init?.body instanceof FormData) {
        // Multipart: hand the FormData straight to the handler, which
        // needs the file name rather than a parsed object.
        body = init.body;
      } else {
        try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { /* ignore */ }
      }
      await new Promise((r) => setTimeout(r, 120)); // tiny latency so loading states show
      return route(path, (init?.method ?? "GET").toUpperCase(), body);
    }
    return real(input, init);
  };
}
