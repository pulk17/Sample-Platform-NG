import { Link, useParams } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { DiffDrawer, type DiffTarget } from "@/components/DiffDrawer";
import { RunStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  useRun,
  useRunProgress,
  useRunSamples,
  type RunFailure,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STAGES = ["preparation", "testing", "completed"] as const;
const STAGE_LABEL: Record<string, string> = {
  preparation: "Preparation",
  testing: "Testing",
  completed: "Completed",
  canceled: "Canceled",
};

/**
 * Dedicated per-run page (one platform run) — parity with the old SP
 * /test/<id>: metadata, progress stepper, and results grouped by category
 * with expandable diffs.
 */
export function RunDetail() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const id = Number(runId);
  const { data: run } = useRun(id);
  const { data: progress = [] } = useRunProgress(id);
  const { data: samples = [], isLoading } = useRunSamples(id);

  // Reached-stage set for the stepper.
  const reached = new Set(progress.map((p) => p.status));
  const canceled = reached.has("canceled");

  // Group results by category; a category "fails" if any test in it fails.
  const categories = useMemo(() => {
    const byCat = new Map<string, RunFailure[]>();
    for (const s of samples) {
      const cat = s.categories[0] ?? "Uncategorized";
      byCat.set(cat, [...(byCat.get(cat) ?? []), s]);
    }
    return [...byCat.entries()]
      .map(([name, rows]) => ({
        name,
        rows,
        failed: rows.filter((r) => r.status !== "pass").length,
      }))
      .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name));
  }, [samples]);

  return (
    <div>
      <div className="sticky top-0 z-10 border-b bg-card/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link to="/runs">
            <Button variant="ghost" size="icon"><ChevronLeft /></Button>
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight">Run {id}</h1>
          {run && <RunStatusBadge status={run.status} />}
          {run?.github_link && (
            <a href={run.github_link} target="_blank" rel="noreferrer" className="ml-auto">
              <Button size="sm" variant="secondary">
                <ExternalLink /> View on GitHub
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-5">
        {/* Metadata */}
        {run && (
          <div className="mb-6 overflow-hidden rounded-xl border shadow-card">
            <MetaRow label={run.pr_number ? "Pull request" : "Commit"}>
              {run.pr_number ? (
                <span className="inline-flex items-center gap-1.5">
                  <GitPullRequest className="size-3.5 text-primary" />
                  <a href={run.github_link ?? "#"} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    #{run.pr_number}
                  </a>
                  <span className="text-faint">(commit {run.commit_sha.slice(0, 7)})</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <GitCommitHorizontal className="size-3.5" /> {run.commit_sha.slice(0, 9)}
                </span>
              )}
            </MetaRow>
            <MetaRow label="Platform"><span className="capitalize">{run.platform}</span></MetaRow>
            <MetaRow label="Repository">{run.repository}</MetaRow>
            <MetaRow label="Branch">{run.branch}</MetaRow>
            <MetaRow label="Start time">{fmt(run.started_at ?? run.created_at)}</MetaRow>
            <MetaRow label="End time" last>{fmt(run.completed_at)}</MetaRow>
          </div>
        )}

        {/* Progress stepper */}
        <div className="mb-8 px-4">
          <div className="flex items-center">
            {STAGES.map((stage, i) => {
              const done = reached.has(stage) || (stage === "completed" && reached.has("completed"));
              const isCanceledEnd = canceled && stage === "completed";
              return (
                <div key={stage} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {isCanceledEnd ? "Canceled" : STAGE_LABEL[stage]}
                    </div>
                    <div
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border-2 transition-colors",
                        done && !isCanceledEnd && "border-success bg-success text-white",
                        isCanceledEnd && "border-faint bg-faint text-white",
                        !done && !isCanceledEnd && "border-border bg-card text-faint",
                      )}
                    >
                      {done && <Check className="size-3.5" />}
                    </div>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div
                      className={cn(
                        "mx-1 mt-5 h-0.5 flex-1 rounded",
                        reached.has(STAGES[i + 1]) ? "bg-success" : "bg-border",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Results by category */}
        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Test results</h2>
        <p className="mb-3 text-[13px] text-faint">
          Click a category to expand; click a failing test to see its diff.
        </p>
        {isLoading && (
          <div className="flex flex-col gap-1.5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {categories.map((c) => (
            <CategoryBlock key={c.name} {...c} runId={id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryBlock({
  name, rows, failed, runId,
}: {
  name: string;
  rows: RunFailure[];
  failed: number;
  runId: number;
}) {
  const [open, setOpen] = useState(failed > 0);
  const [diff, setDiff] = useState<DiffTarget | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronDown className={cn("size-4 text-faint transition-transform", open && "rotate-180")} />
        <span className={cn("text-[13px] font-medium", failed > 0 ? "text-destructive" : "text-success")}>
          {name} — {failed > 0 ? `${failed} failed` : "Pass"}
        </span>
        <span className="ml-auto text-[11px] text-faint">{rows.length} tests</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t bg-muted/20">
              {rows.map((r) => {
                const failing = r.status !== "pass";
                const output = r.outputs.find((o) => o.status === "fail") ?? r.outputs[0];
                return (
                  <div
                    key={r.regression_test_id}
                    className="flex items-center gap-2.5 border-b px-3 py-1.5 text-[12px] last:border-0"
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        r.status === "pass" && "bg-success",
                        failing && "bg-destructive",
                      )}
                    />
                    <Link
                      to="/tests"
                      search={{ t: r.regression_test_id }}
                      className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
                    >
                      <code className="text-faint">#{r.regression_test_id}</code>
                      <code className="min-w-0 flex-1 truncate">{r.command}</code>
                    </Link>
                    {failing && output ? (
                      <button
                        className="shrink-0 cursor-pointer font-medium text-destructive hover:underline"
                        onClick={() =>
                          setDiff({
                            runId,
                            sampleId: r.sample_id,
                            regressionId: r.regression_test_id,
                            outputId: output.output_id,
                            command: r.command,
                            sampleName: r.sample_name,
                          })
                        }
                      >
                        Fail
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 text-[11px]",
                          r.status === "pass" ? "text-success" : "text-warning",
                        )}
                      >
                        {r.status === "pass" ? "Pass" : r.status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DiffDrawer target={diff} onClose={() => setDiff(null)} />
    </div>
  );
}

function MetaRow({
  label, children, last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("grid grid-cols-[150px_1fr] items-center bg-card", !last && "border-b")}>
      <div className="bg-muted/40 px-3 py-2 text-[12px] font-medium text-muted-foreground">
        {label}
      </div>
      <div className="px-3 py-2 text-[13px]">{children}</div>
    </div>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
