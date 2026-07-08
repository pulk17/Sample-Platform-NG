import { useQuery } from "@tanstack/react-query";

import { AnimatedSheet, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { fetchDiff } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface DiffTarget {
  runId: number;
  sampleId: number;
  regressionId: number;
  outputId: number;
  command: string;
  sampleName: string;
}

/** Expected-vs-actual unified diff for one failing output, rendered natively. */
export function DiffDrawer({
  target,
  onClose,
}: {
  target: DiffTarget | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["diff", target?.runId, target?.regressionId, target?.outputId],
    enabled: target !== null,
    staleTime: Infinity,
    retry: false,
    queryFn: () => fetchDiff(target!),
  });

  return (
    <AnimatedSheet open={!!target} onOpenChange={(o) => !o && onClose()} className="max-w-2xl">
      {target && (
        <div className="flex h-full flex-col">
          <div className="border-b px-6 py-4">
            <SheetTitle className="text-[15px] font-semibold tracking-tight">
              Diff — test #{target.regressionId}
            </SheetTitle>
            <SheetDescription className="mt-0.5 truncate font-mono text-[11px] text-faint">
              {target.command} · {target.sampleName} · run {target.runId}
            </SheetDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {isLoading && (
              <div className="flex flex-col gap-1.5">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-4 animate-pulse rounded bg-muted/70" />
                ))}
              </div>
            )}
            {isError && (
              <div className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-xs text-warning">
                {error instanceof Error ? error.message : "Could not load diff"} — the
                output file for this hash isn't present in this environment's storage
                (expected locally; production serves it from the sample repository).
              </div>
            )}
            {data && (
              <pre className="rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                {data.content.trim() === "" ? (
                  <span className="text-faint">Diff is empty.</span>
                ) : (
                  data.content.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        "px-1",
                        line.startsWith("+") && !line.startsWith("+++") &&
                          "bg-success/10 text-success",
                        line.startsWith("-") && !line.startsWith("---") &&
                          "bg-destructive/10 text-destructive",
                        line.startsWith("@@") && "text-accent-foreground",
                      )}
                    >
                      {line || " "}
                    </div>
                  ))
                )}
              </pre>
            )}
          </div>
        </div>
      )}
    </AnimatedSheet>
  );
}
