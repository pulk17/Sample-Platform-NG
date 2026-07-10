import { Link } from "@tanstack/react-router";
import { ExternalLink, MoreHorizontal, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { DiffDrawer, type DiffTarget } from "@/components/DiffDrawer";
import { Sparkline } from "@/components/Sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import {
  approveBaseline,
  snapshotTestsById,
  useRegressionTests,
  useRunFailures,
  useRuns,
  type RunFailure,
} from "@/lib/api";
import { getSession } from "@/lib/auth";
import type { LogicalRun } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Home: an inbox of recent runs that finished with failures. Each card pulls
 * that run's failing tests and groups them by category.
 *
 * Baseline promotion hides behind a per-row overflow menu and a warning
 * dialog. There is intentionally no bulk accept — replacing baselines should
 * take one deliberate click per test.
 */
export function Triage() {
  const { data: runs = [], isLoading } = useRuns();
  const { data: tests = [] } = useRegressionTests();

  // Latest platform runs that finished with failures — at most 3 cards.
  const failedRuns = useMemo(() => {
    const out: { run: LogicalRun; runId: number; platform: string }[] = [];
    for (const run of runs) {
      for (const p of run.platforms) {
        if (p.status === "fail" || p.status === "incomplete") {
          out.push({ run, runId: p.run_id, platform: p.platform });
        }
      }
      if (out.length >= 3) break;
    }
    return out.slice(0, 3);
  }, [runs]);

  const failingNow = tests.filter(
    (t) => t.active && t.recent_results.at(-1) === "fail",
  ).length;

  return (
    <div>
      <div className="sticky top-0 z-10 border-b bg-card/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Home</h1>
          <span className="text-xs text-faint">
            latest runs with failures · live from the platform
          </span>
          {failingNow > 0 && (
            <span className="ml-auto text-[11px] text-faint">
              {failingNow} tests red in the latest snapshot analytics
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-5">
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl border bg-muted/50" />
            ))}
          </div>
        )}

        {!isLoading && failedRuns.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <ShieldCheck className="size-10 text-success" />
            <div className="text-[15px] font-medium">Nothing to triage</div>
            <p className="max-w-sm text-[13px] text-faint">
              No recent runs finished with failures. New ones land here automatically.
            </p>
          </div>
        )}

        {failedRuns.map((fr, idx) => (
          <FailureCard key={fr.runId} {...fr} defaultOpen={idx === 0} index={idx} />
        ))}
      </div>
    </div>
  );
}

function FailureCard({
  run,
  runId,
  platform,
  defaultOpen,
  index,
}: {
  run: LogicalRun;
  runId: number;
  platform: string;
  defaultOpen: boolean;
  index: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data: failures = [], isLoading } = useRunFailures(open ? runId : null);

  // Group by first category, biggest group first.
  const groups = useMemo(() => {
    const byCat = new Map<string, RunFailure[]>();
    for (const f of failures) {
      const cat = f.categories[0] ?? "Uncategorized";
      byCat.set(cat, [...(byCat.get(cat) ?? []), f]);
    }
    return [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [failures]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="mb-3"
    >
      <div
        className={cn(
          "card-hover overflow-hidden rounded-xl border bg-card shadow-card",
          open && "border-border-strong",
        )}
      >
        <button
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
          onClick={() => setOpen(!open)}
        >
          <span
            className={cn(
              "w-9 shrink-0 rounded-md border px-1 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide",
              platform === "windows"
                ? "border-destructive/30 text-destructive"
                : "border-warning/40 text-warning",
            )}
          >
            {platform === "linux" ? "lnx" : "win"}
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium">
              {run.pr_nr ? `PR #${run.pr_nr}` : `commit ${run.commit}`}
            </span>{" "}
            <span className="text-muted-foreground">
              finished with failures on {platform}
            </span>
          </div>
          {open && !isLoading && (
            <Badge variant="destructive">{failures.length} failing</Badge>
          )}
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t bg-muted/30">
                {isLoading && (
                  <div className="flex flex-col gap-1 p-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-8 animate-pulse rounded-lg bg-muted" />
                    ))}
                  </div>
                )}
                {groups.map(([cat, items]) => (
                  <div key={cat}>
                    <div className="border-b bg-muted/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                      {cat} · {items.length}
                    </div>
                    {items.slice(0, 5).map((f) => (
                      <FailureRow key={f.regression_test_id} f={f} runId={runId} />
                    ))}
                    {items.length > 5 && (
                      <div className="border-b px-4 py-1.5 text-[11px] text-faint">
                        + {items.length - 5} more in {cat}
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 bg-card px-4 py-2.5">
                  {run.github_link && (
                    <a href={run.github_link} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost">
                        <ExternalLink /> Open on GitHub
                      </Button>
                    </a>
                  )}
                  <span className="ml-auto text-[11px] text-faint">
                    run {runId}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function FailureRow({ f, runId }: { f: RunFailure; runId: number }) {
  const admin = getSession()?.role === "admin";
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffTarget | null>(null);
  const snap = snapshotTestsById.get(f.regression_test_id);
  const output = f.outputs.find((o) => o.status === "fail") ?? f.outputs[0];

  const doApprove = async () => {
    if (!output) return;
    setBusy(true);
    const res = await approveBaseline({
      runId,
      sampleId: f.sample_id,
      regressionId: f.regression_test_id,
      outputId: output.output_id,
    });
    setBusy(false);
    setConfirming(false);
    setResult(res.ok ? "Baseline updated." : res.message);
  };

  return (
    <div className="group relative flex items-center gap-3 border-b px-4 py-2 text-[13px] transition-colors hover:bg-card">
      <Link
        to="/tests"
        search={{ t: f.regression_test_id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <code className="w-12 shrink-0 text-xs text-faint">#{f.regression_test_id}</code>
        <code className="min-w-0 flex-1 truncate text-xs text-foreground/85">{f.command}</code>
        <span className="w-32 shrink-0 truncate text-[11px] text-faint">{f.sample_name}</span>
        {snap && <Sparkline results={snap.recent_results.filter((r) => r !== "skip").slice(-10)} />}
      </Link>

      {result && <span className="shrink-0 text-[11px] text-faint">{result}</span>}

      {output && (
        <button
          className="shrink-0 cursor-pointer rounded-md border px-1.5 py-0.5 text-[11px] text-faint opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={() =>
            setDiff({
              runId,
              sampleId: f.sample_id,
              regressionId: f.regression_test_id,
              outputId: output.output_id,
              command: f.command,
              sampleName: f.sample_name,
            })
          }
        >
          diff
        </button>
      )}

      {admin && output && !result && (
        <div className="relative shrink-0">
          <button
            className="cursor-pointer rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-7 z-20 w-56 rounded-lg border bg-card p-1 shadow-pop">
              <button
                className="w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                onClick={() => {
                  setMenu(false);
                  setConfirming(true);
                }}
              >
                Promote this output to baseline…
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Replace baseline of test #${f.regression_test_id}?`}
        body={
          <>
            The output this run produced becomes the expected baseline{" "}
            <b>for every future run, on all platforms</b>. The current baseline hash
            is discarded, and the only way back is promoting another output.
          </>
        }
        confirmLabel={busy ? "Promoting…" : "Replace baseline"}
        busy={busy}
        onConfirm={doApprove}
      />

      <DiffDrawer target={diff} onClose={() => setDiff(null)} />
    </div>
  );
}
