// Data layer. Live API calls where endpoints exist; a bundled snapshot of
// the production database covers what the API doesn't serve yet (per-test
// baselines, run history sparklines, failure groupings).

import { useQuery } from "@tanstack/react-query";

import categoriesJson from "@/mocks/generated/categories.json";
import runsSnapshotJson from "@/mocks/generated/runs.json";
import samplesJson from "@/mocks/generated/samples.json";
import testsJson from "@/mocks/generated/tests.json";
import { getSession, logout } from "@/lib/auth";
import type {
  Category,
  DryRunOutput,
  DryRunState,
  LiveRun,
  LogicalRun,
  Platform,
  RegressionTest,
  RunSummary,
  Sample,
  SnapshotRun,
  SparkResult,
} from "@/lib/types";

/* ---------------- snapshot (prod dump, June 2026) ---------------- */

export const snapshotTests = testsJson as RegressionTest[];
export const snapshotSamples = samplesJson as Sample[];
export const categories = categoriesJson as Category[];
export const snapshotRuns = runsSnapshotJson as unknown as SnapshotRun[];
export const snapshotTestsById = new Map(snapshotTests.map((t) => [t.id, t]));

/* ---------------- live fetch helpers ---------------- */

const BASE = "/api/v1";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Turn an API failure into copy safe to render. 4xx validation messages are
 * written for end users and pass through; auth failures and server errors
 * get generic copy so backend internals never reach the screen. The raw
 * message goes to the console either way.
 */
function apiError(status: number, raw: string): ApiError {
  console.warn(`API ${status}:`, raw);
  if (status === 401) return new ApiError(status, "Session expired — sign in again.");
  if (status === 403) return new ApiError(status, "You don't have permission to do that.");
  if (status === 429) return new ApiError(status, "Rate limited — give it a minute.");
  if (status >= 500) return new ApiError(status, "The platform hit an internal error. Try again shortly.");
  return new ApiError(status, raw || "Request failed.");
}

async function apiGet<T>(path: string): Promise<T> {
  const session = getSession();
  const res = await fetch(`${BASE}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (res.status === 401 && session) {
    // Token expired/revoked server-side — drop the stale session and land
    // back on the login screen instead of erroring every query. logout()
    // guards itself against the parallel-query stampede.
    logout();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw apiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function apiSend<T>(method: string, path: string, body: unknown): Promise<T> {
  const session = getSession();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && session) logout();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(res.status, data.message ?? res.statusText);
  return data as T;
}

interface Envelope<T> {
  data: T[];
  pagination?: { total: number; next_offset: number | null };
}

/** Follow offset pagination until exhausted (API caps limit at 100). */
async function fetchAll<T>(path: string, cap = 500): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await apiGet<Envelope<T>>(`${path}${sep}limit=100&offset=${offset}`);
    out.push(...page.data);
    const next = page.pagination?.next_offset ?? null;
    if (next === null || out.length >= cap || page.data.length === 0) break;
    offset = next;
  }
  return out;
}

/* ---------------- live queries ---------------- */

/** Regression tests: live list (active + inactive) + snapshot analytics by id. */
export function useRegressionTests() {
  return useQuery({
    queryKey: ["regression-tests"],
    staleTime: 60_000,
    queryFn: async () => {
      const [act, inact] = await Promise.all([
        fetchAll<LiveRegressionTest>("/regression-tests?active=true"),
        fetchAll<LiveRegressionTest>("/regression-tests?active=false"),
      ]);
      const rows = [...act, ...inact].sort(
        (a, b) => a.regression_test_id - b.regression_test_id,
      );
      return rows.map((r): RegressionTest => {
        const snap = snapshotTestsById.get(r.regression_test_id);
        return {
          id: r.regression_test_id,
          sample_id: r.sample_id,
          sample_name: r.sample_name,
          sample_sha: snap?.sample_sha ?? "",
          command: r.command,
          input_type: r.input_type,
          output_type: r.output_type,
          expected_rc: r.expected_rc,
          active: r.active,
          description: r.description ?? "",
          categories: r.categories,
          baselines: snap?.baselines ?? [],
          last_passed_linux: snap?.last_passed_linux ?? null,
          last_passed_windows: snap?.last_passed_windows ?? null,
          avg_runtime_ms: snap?.avg_runtime_ms ?? null,
          recent_results: snap?.recent_results ?? [],
        };
      });
    },
  });
}

interface LiveRegressionTest {
  regression_test_id: number;
  sample_id: number;
  sample_name: string;
  command: string;
  input_type: string | null;
  output_type: string | null;
  expected_rc: number;
  active: boolean;
  description: string | null;
  categories: string[];
}

export function useSamples() {
  return useQuery({
    queryKey: ["samples"],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchAll<LiveSample>("/samples");
      return res.map(
        (s): Sample => ({
          id: s.sample_id,
          sha: s.sha,
          extension: s.extension.startsWith(".") ? s.extension : `.${s.extension}`,
          original_name: s.original_name,
          tags: s.tags ?? [],
          test_count: s.regression_test_count ?? 0,
        }),
      );
    },
  });
}

interface LiveSample {
  sample_id: number;
  sha: string;
  extension: string;
  original_name: string;
  tags: string[];
  regression_test_count: number;
}

/** Runs, grouped client-side into logical (per-commit) entries. */
export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await apiGet<Envelope<LiveRun>>("/runs?limit=40&sort=-created_at");
      const groups = new Map<string, LiveRun[]>();
      for (const r of res.data) {
        const key = `${r.commit_sha}:${r.pr_number ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      const logical: LogicalRun[] = [...groups.values()].map((g) => {
        const first = g[0];
        return {
          id: String(Math.max(...g.map((x) => x.run_id))),
          commit: first.commit_sha.slice(0, 9),
          branch: first.branch,
          fork: first.repository,
          pr_nr: first.pr_number,
          test_type: first.test_type,
          created_at: first.created_at,
          github_link: first.github_link,
          platforms: g
            .sort((a, b) => a.platform.localeCompare(b.platform))
            .map((x) => ({
              run_id: x.run_id,
              platform: x.platform,
              status: x.status,
              started_at: x.started_at,
              completed_at: x.completed_at,
            })),
        };
      });
      logical.sort((a, b) => Number(b.id) - Number(a.id));
      return logical;
    },
  });
}

/** Single run (one platform) — GET /runs/<id>. */
export function useRun(runId: number | null) {
  return useQuery({
    queryKey: ["run", runId],
    enabled: runId !== null,
    queryFn: () => apiGet<LiveRun>(`/runs/${runId}`),
  });
}

export interface ProgressEvent {
  status: string;
  message: string;
  timestamp: string;
}

export function useRunProgress(runId: number | null) {
  return useQuery({
    queryKey: ["run-progress", runId],
    enabled: runId !== null,
    refetchInterval: (q) => {
      const data = q.state.data as ProgressEvent[] | undefined;
      const done = data?.some((e) => e.status === "completed" || e.status === "canceled");
      return done ? false : 15_000; // poll live runs, stop once finished
    },
    queryFn: async () => {
      const res = await apiGet<Envelope<ProgressEvent>>(`/runs/${runId}/progress`);
      return res.data;
    },
  });
}

/** Every result row of a run (all statuses) — GET /runs/<id>/samples. */
export function useRunSamples(runId: number | null) {
  return useQuery({
    queryKey: ["run-samples-all", runId],
    enabled: runId !== null,
    staleTime: 120_000,
    queryFn: () => fetchAll<RunFailure>(`/runs/${runId}/samples`, 400),
  });
}

/** Per-run counts, fetched lazily when a run row expands. */
export function useRunSummary(runId: number | null) {
  return useQuery({
    queryKey: ["run-summary", runId],
    enabled: runId !== null,
    staleTime: 300_000,
    queryFn: () => apiGet<RunSummary>(`/runs/${runId}/summary`),
  });
}

/** One failing result row from GET /runs/<id>/samples?status=fail. */
export interface RunFailure {
  regression_test_id: number;
  sample_id: number;
  sample_name: string;
  command: string;
  categories: string[];
  status: string;
  exit_code: number | null;
  expected_rc: number | null;
  runtime_ms: number | null;
  outputs: { output_id: number; filename: string; status: string }[];
}

/** Live failures for a platform run (used by triage + run expansion). */
export function useRunFailures(runId: number | null) {
  return useQuery({
    queryKey: ["run-failures", runId],
    enabled: runId !== null,
    staleTime: 300_000,
    queryFn: () => fetchAll<RunFailure>(`/runs/${runId}/samples?status=fail`, 300),
  });
}

export interface QueueEntry {
  run_id: number;
  platform: Platform;
  status: string;
  position: number | null;
  queued_at: string | null;
  started_at: string | null;
}

export function useQueue() {
  return useQuery({
    queryKey: ["queue"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const session = getSession();
      const res = await fetch(`${BASE}/system/queue`, {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      });
      if (!res.ok) throw apiError(res.status, res.statusText);
      const body = (await res.json()) as {
        data: QueueEntry[];
        meta: { queue_depth: number; running_count: number };
      };
      return body;
    },
  });
}

export interface ApiToken {
  id: number;
  token_name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  is_revoked: boolean;
}

export function useTokens() {
  return useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const res = await apiGet<Envelope<ApiToken>>("/auth/tokens");
      return res.data;
    },
  });
}

export async function revokeToken(id: number): Promise<void> {
  const session = getSession();
  const res = await fetch(`${BASE}/auth/tokens/${id}`, {
    method: "DELETE",
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw apiError(res.status, body.message ?? res.statusText);
  }
}

export interface HistoryEntry {
  run_id: number;
  regression_test_id: number;
  platform: Platform;
  status: string;
  commit_sha: string;
  branch: string;
  tested_at: string | null;
}

export interface MediaInfoNode {
  name: string;
  value: string | Record<string, string> | { name: string; value: Record<string, string> }[];
}

export interface SampleDetails {
  sample_id: number;
  sha: string;
  extension: string;
  original_name: string;
  filename: string;
  tags: string[];
  upload: {
    platform: string | null;
    parameters: string;
    notes: string;
    version: string | null;
    version_released: string | null;
  } | null;
  extra_files: { id: number; original_name: string; extension: string }[];
  media_info: MediaInfoNode[] | null;
}

export function useSampleDetails(sampleId: number | null) {
  return useQuery({
    queryKey: ["sample-details", sampleId],
    enabled: sampleId !== null,
    staleTime: 300_000,
    queryFn: () => apiGet<SampleDetails>(`/samples/${sampleId}/details`),
  });
}

export function useSampleHistory(sampleId: number | null) {
  return useQuery({
    queryKey: ["sample-history", sampleId],
    enabled: sampleId !== null,
    staleTime: 300_000,
    queryFn: async () => {
      // Keep the query date-bounded: without created_after the endpoint
      // loads every historical run before paginating, which takes ~10s on
      // a long-lived sample. 45 days covers anything worth triaging.
      const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      const res = await apiGet<Envelope<HistoryEntry>>(
        `/samples/${sampleId}/history?limit=20&created_after=${since}`,
      );
      return res.data;
    },
  });
}

/**
 * Promote a run's actual output to the expected baseline. This replaces the
 * stored hash for every future run, so the UI must confirm before calling.
 * The server enforces admin role + baselines:write.
 */
export async function approveBaseline(args: {
  runId: number;
  sampleId: number;
  regressionId: number;
  outputId: number;
}): Promise<{ ok: boolean; message: string }> {
  const session = getSession();
  const res = await fetch(
    `${BASE}/runs/${args.runId}/samples/${args.sampleId}/baseline-approval`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify({
        regression_id: args.regressionId,
        output_id: args.outputId,
        remove_variants: false,
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    message: body.message ?? (res.ok ? "Baseline updated." : res.statusText),
  };
}

export interface PlatformUser {
  user_id: number;
  name: string;
  email: string;
  role: "admin" | "contributor" | "tester" | "user";
  github_linked: boolean;
  github_login: string | null;
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await apiGet<Envelope<PlatformUser>>("/users");
      return res.data;
    },
  });
}

export function updateUserRole(id: number, role: string) {
  return apiSend<PlatformUser>("PATCH", `/users/${id}`, { role });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    staleTime: 60_000,
    queryFn: () =>
      apiGet<{ status: string; dependencies: { name: string; status: string }[] }>(
        "/system/health",
      ),
  });
}

/* ---------------- write operations (live) ---------------- */

export interface RegressionTestPatch {
  command?: string;
  description?: string;
  expected_rc?: number;
  active?: boolean;
  categories?: string[];
}

export function updateRegressionTest(id: number, patch: RegressionTestPatch) {
  return apiSend<unknown>("PATCH", `/regression-tests/${id}`, patch);
}

export function createRegressionTest(body: {
  sample_id: number;
  command: string;
  input_type?: string;
  output_type?: string;
  expected_rc?: number;
  description?: string;
  categories: string[];
}) {
  return apiSend<{ regression_test_id: number }>("POST", "/regression-tests", body);
}

/** Queue a real CI run (old "customized tests"). One call per platform. */
export function createRun(body: {
  commit_sha: string;
  platform: Platform;
  branch?: string;
  repository: string;
  regression_test_ids?: number[];
}) {
  return apiSend<{ run_id: number }>("POST", "/runs", body);
}

/** Unified diff for one failing output of a run. */
export async function fetchDiff(args: {
  runId: number;
  sampleId: number;
  regressionId: number;
  outputId: number;
}): Promise<{ content: string }> {
  return apiGet<{ content: string }>(
    `/runs/${args.runId}/samples/${args.sampleId}/regression-tests/${args.regressionId}` +
      `/outputs/${args.outputId}/diff?format=unified`,
  );
}

/** Category list derived from the live test suite (no snapshot). */
export function deriveCategories(tests: RegressionTest[]) {
  const counts = new Map<string, number>();
  for (const t of tests) for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, test_count], i) => ({ id: i + 1, name, description: "", test_count }));
}

/* ---------------- snapshot-derived analytics ---------------- */

export function healthOf(t: RegressionTest): SparkResult {
  for (let i = t.recent_results.length - 1; i >= 0; i--) {
    if (t.recent_results[i] !== "skip") return t.recent_results[i];
  }
  return "skip";
}

export function categoryHealth(name: string, tests: RegressionTest[]) {
  const inCat = tests.filter((t) => t.categories.includes(name));
  return {
    total: inCat.length,
    failing: inCat.filter((t) => healthOf(t) === "fail").length,
  };
}

export interface TriageGroup {
  run: SnapshotRun;
  platform: Platform;
  category: string;
  tests: RegressionTest[];
}

/** Failure groups (run × platform × category) computed from the snapshot. */
export function triageGroups(maxRuns = 3): TriageGroup[] {
  const out: TriageGroup[] = [];
  for (const run of snapshotRuns.slice(0, maxRuns)) {
    for (const p of run.platforms) {
      if (p.new_failures === 0 || p.failing_ids.length === 0) continue;
      const byCat = new Map<string, RegressionTest[]>();
      for (const id of p.failing_ids) {
        const t = snapshotTestsById.get(id);
        if (!t) continue;
        const cat = t.categories[0] ?? "Uncategorized";
        byCat.set(cat, [...(byCat.get(cat) ?? []), t]);
      }
      for (const [category, ts] of [...byCat.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        out.push({ run, platform: p.platform, category, tests: ts });
      }
    }
  }
  return out;
}

/* ---------------- dry run simulation (builder step 3) ---------------- */

export function simulateDryRun(
  sample: Sample,
  _command: string,
  onUpdate: (states: DryRunState[]) => void,
): () => void {
  const mkOutput = (platform: Platform): DryRunOutput => ({
    filename: `${sample.sha.slice(0, 12)}_out.srt`,
    hash: "c41d8e" + sample.sha.slice(6, 40),
    size_bytes: 48_213,
    runtime_ms: platform === "linux" ? 9_412 : 14_803,
    exit_code: 0,
    preview: [
      "1",
      "00:00:01,120 --> 00:00:03,400",
      "Good evening. Tonight's headlines:",
      "",
      "2",
      "00:00:03,480 --> 00:00:06,910",
      "Parliament approves the new",
      "broadcasting standards bill.",
    ],
  });

  const phases: { status: DryRunState["status"]; message: string; pct: number }[] = [
    { status: "preparation", message: "Provisioning VM", pct: 10 },
    { status: "building", message: "Building CCExtractor @ master", pct: 40 },
    { status: "testing", message: `Running on ${sample.original_name}`, pct: 75 },
    { status: "completed", message: "Done", pct: 100 },
  ];

  let step = 0;
  const timer = setInterval(() => {
    const linuxStep = Math.min(step, phases.length - 1);
    const winStep = Math.min(Math.max(step - 1, 0), phases.length - 1);
    const states: DryRunState[] = (["linux", "windows"] as Platform[]).map((p) => {
      const ph = phases[p === "linux" ? linuxStep : winStep];
      return {
        platform: p,
        status: ph.status,
        progress_pct: ph.pct,
        message: ph.message,
        outputs: ph.status === "completed" ? [mkOutput(p)] : [],
      };
    });
    onUpdate(states);
    step += 1;
    if (step > phases.length) clearInterval(timer);
  }, 900);

  return () => clearInterval(timer);
}

export function commandPresets(tests: RegressionTest[], limit = 6) {
  const counts = new Map<string, number>();
  for (const t of tests) counts.set(t.command, (counts.get(t.command) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([command, count]) => ({ command, count }));
}
