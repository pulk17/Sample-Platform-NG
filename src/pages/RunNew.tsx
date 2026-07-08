import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, GitBranch, Loader2, Play } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRun, deriveCategories, useRegressionTests } from "@/lib/api";
import type { Platform } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Start a run against any fork/commit — replaces the old "Customized tests"
 * page. POSTs one run per selected platform via POST /api/v1/runs.
 */
export function RunNew() {
  const { data: tests = [] } = useRegressionTests();
  const navigate = useNavigate();

  const [repository, setRepository] = useState("CCExtractor/ccextractor");
  const [branch, setBranch] = useState("master");
  const [commit, setCommit] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(["linux", "windows"]);
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = deriveCategories(tests);
  const commitOk = /^[a-fA-F0-9]{40}$/.test(commit);
  const repoOk = /^[\w.-]+\/[\w.-]+$/.test(repository);

  const selectedIds = useMemo(() => {
    if (cats.length === 0) return undefined; // full suite
    return tests
      .filter((t) => t.active && t.categories.some((c) => cats.includes(c)))
      .map((t) => t.id);
  }, [cats, tests]);

  const estimate = useMemo(() => {
    const pool =
      selectedIds === undefined
        ? tests.filter((t) => t.active)
        : tests.filter((t) => selectedIds.includes(t.id));
    const ms = pool.reduce((acc, t) => acc + (t.avg_runtime_ms ?? 15_000), 0);
    return { count: pool.length, minutes: Math.max(1, Math.round(ms / 60_000)) };
  }, [selectedIds, tests]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        platforms.map((platform) =>
          createRun({
            commit_sha: commit,
            platform,
            branch,
            repository,
            ...(selectedIds ? { regression_test_ids: selectedIds } : {}),
          }),
        ),
      );
      void results;
      navigate({ to: "/runs" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to queue run");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-7 flex items-center gap-3">
        <Link to="/runs">
          <Button variant="ghost" size="icon"><ChevronLeft /></Button>
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <GitBranch className="size-4 text-primary" /> New run
          </h1>
          <p className="text-[13px] text-faint">
            Test any fork or commit against the suite — the old "customized tests", queued
            on real CI VMs.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Repository</Label>
            <Input
              value={repository}
              onChange={(e) => setRepository(e.target.value)}
              placeholder="owner/repo"
              className={cn(!repoOk && repository && "border-destructive/50")}
            />
          </div>
          <div>
            <Label>Branch</Label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Commit SHA (full 40 characters)</Label>
          <Input
            value={commit}
            onChange={(e) => setCommit(e.target.value.trim())}
            placeholder="e.g. cf7c396176271462b9a29c62a1c3c6d8b723bd2b"
            className={cn("font-mono text-xs", !commitOk && commit && "border-destructive/50")}
          />
        </div>

        <div>
          <Label>Platforms</Label>
          <div className="flex gap-2">
            {(["linux", "windows"] as Platform[]).map((p) => {
              const on = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() =>
                    setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p])
                  }
                  className={cn(
                    "cursor-pointer rounded-lg border px-4 py-2 text-[13px] font-medium capitalize transition-all duration-150",
                    on
                      ? "border-primary/50 bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>
            Scope <span className="font-normal normal-case">— empty = full suite</span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const on = cats.includes(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() =>
                    setCats(on ? cats.filter((x) => x !== c.name) : [...cats, c.name])
                  }
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1 text-xs transition-all duration-150",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {c.name} <span className="opacity-60">{c.test_count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-4">
          <span className="text-[12px] text-faint">
            ~{estimate.count} tests · est. {estimate.minutes} min per platform ×{" "}
            {platforms.length} platform{platforms.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            {error && <span className="text-[11px] text-destructive">{error}</span>}
            <Button
              disabled={!commitOk || !repoOk || platforms.length === 0 || busy}
              onClick={submit}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Play />} Queue run
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}
