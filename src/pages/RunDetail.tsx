import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { DiffDrawer, type DiffTarget } from "@/components/DiffDrawer";
import { RunStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import {
  cancelRun,
  useInfraErrors,
  useRun,
  useRunArtifacts,
  useRunProgress,
  useRunSamples,
  type RunFailure,
} from "@/lib/api";
import { canOperateCi, getSession } from "@/lib/auth";
import { githubUrl } from "@/lib/validate";
import { cn } from "@/lib/utils";

const STAGES = ["preparation", "testing", "completed"] as const;
const STAGE_LABEL: Record<string, string> = {
  preparation: "Preparation",
  testing: "Testing",
  completed: "Completed",
  canceled: "Canceled",
};

/**
 * One platform run: metadata, progress stepper, and results grouped by
 * category. Failing tests open their diff in a drawer.
 */
export function RunDetail() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const id = Number(runId);
  const { data: run } = useRun(id);
  const { data: progress = [] } = useRunProgress(id);
  const { data: samples = [], isLoading } = useRunSamples(id);
  const { data: infraErrors = [] } = useInfraErrors(id);
  const gh = githubUrl(run?.github_link);
  const qc = useQueryClient();

  // Reached-stage set for the stepper.
  const reached = new Set(progress.map((p) => p.status));
  const canceled = reached.has("canceled");

  const finished =
    !run || ["pass", "fail", "canceled", "error"].includes(run.status);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const doCancel = async () => {
    setCanceling(true);
    try {
      await cancelRun(id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["run", id] }),
        qc.invalidateQueries({ queryKey: ["run-progress", id] }),
        qc.invalidateQueries({ queryKey: ["runs"] }),
      ]);
    } finally {
      setCanceling(false);
      setConfirmCancel(false);
    }
  };

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
          <div className="ml-auto flex items-center gap-2">
            {!finished && canOperateCi(getSession()) && (
              <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)}>
                <Ban /> Cancel run
              </Button>
            )}
            {gh && (
              <a href={gh} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  <ExternalLink /> View on GitHub
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel run ${id}?`}
        body="The VM stops as soon as it notices, and results collected so far are kept. This can't be resumed — a new run has to be queued."
        confirmLabel={canceling ? "Canceling…" : "Cancel run"}
        busy={canceling}
        onConfirm={doCancel}
      />

      <div className="mx-auto max-w-4xl px-6 py-5">
        {infraErrors.length > 0 && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 p-3.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="text-[13px]">
              <div className="font-medium text-warning">
                Infrastructure problem — failures here may not be caused by the code
              </div>
              <ul className="mt-1 text-[12px] text-muted-foreground">
                {infraErrors.slice(0, 3).map((e, i) => (
                  <li key={i}>
                    <span className="uppercase text-[10px] tracking-wider text-faint">{e.type}</span>{" "}
                    {e.message}
                  </li>
                ))}
                {infraErrors.length > 3 && (
                  <li className="text-faint">+ {infraErrors.length - 3} more</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Metadata */}
        {run && (
          <div className="mb-6 overflow-hidden rounded-xl border shadow-card">
            <MetaRow label={run.pr_number ? "Pull request" : "Commit"}>
              {run.pr_number ? (
                <span className="inline-flex items-center gap-1.5">
                  <GitPullRequest className="size-3.5 text-primary" />
                  {gh ? (
                    <a href={gh} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      #{run.pr_number}
                    </a>
                  ) : (
                    <span className="text-primary">#{run.pr_number}</span>
                  )}
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

        {finished && <ArtifactsSection runId={id} />}

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

/** Build log and output files of a finished run, with download links where
 * storage still has the file (GCS-backed runs get signed URLs). */
function ArtifactsSection({ runId }: { runId: number }) {
  const { data: artifacts = [], isLoading } = useRunArtifacts(runId);
  const [showAll, setShowAll] = useState(false);

  if (!isLoading && artifacts.length === 0) return null;
  const visible = showAll ? artifacts : artifacts.slice(0, 8);

  return (
    <div className="mb-8">
      <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Artifacts</h2>
      <p className="mb-3 text-[13px] text-faint">
        Files this run produced — build log and expected/actual outputs.
      </p>
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-faint">
          <Loader2 className="size-3 animate-spin" /> loading artifact list
        </div>
      )}
      <div className="overflow-hidden rounded-xl border shadow-card">
        {visible.map((a) => (
          <div
            key={a.artifact_id}
            className="flex items-center gap-3 border-b bg-card px-3.5 py-2 text-[12px] last:border-0"
          >
            <span className="w-28 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {a.type.replace(/_/g, " ")}
            </span>
            <code className="min-w-0 flex-1 truncate">{a.filename}</code>
            {a.size_bytes != null && (
              <span className="shrink-0 tabular-nums text-faint">
                {(a.size_bytes / 1024).toFixed(0)} KB
              </span>
            )}
            {a.download_url ? (
              <a
                href={a.download_url}
                download={a.filename}
                className="flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
              >
                <Download className="size-3" /> download
              </a>
            ) : (
              <span className="shrink-0 text-[11px] text-faint">
                {a.storage_status === "ok" ? "on server" : a.storage_status}
              </span>
            )}
          </div>
        ))}
      </div>
      {artifacts.length > 8 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-1.5 cursor-pointer text-[11px] text-faint hover:text-foreground"
        >
          {showAll ? "show fewer" : `show all ${artifacts.length}`}
        </button>
      )}
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
