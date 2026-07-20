import { CheckCircle2, FileVideo, Loader2, UploadCloud, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSamples } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Picked {
  file: File;
  sha: string | null; // null while hashing
  duplicateOf: string | null;
  tooLarge?: boolean;
}

// crypto.subtle has no streaming API, so hashing means loading the whole
// file into memory. Past this size that risks killing the tab — skip the
// browser-side duplicate check and let the server catch it instead.
const HASH_LIMIT = 1024 ** 3; // 1 GiB

/**
 * Sample upload. Files are hashed in the browser and checked against the
 * library before any bytes are transferred, so duplicates get caught up
 * front instead of after a multi-gigabyte upload. The transfer itself still
 * goes through the existing FTP/HTTP pipeline until the API grows an upload
 * endpoint, so the submit button stays disabled.
 */
export function Upload() {
  const { data: samples = [] } = useSamples();
  const [items, setItems] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > HASH_LIMIT) {
        setItems((prev) => [...prev, { file, sha: null, duplicateOf: null, tooLarge: true }]);
        continue;
      }
      const entry: Picked = { file, sha: null, duplicateOf: null };
      setItems((prev) => [...prev, entry]);
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const dup = samples.find((s) => s.sha === sha);
      setItems((prev) =>
        prev.map((it) =>
          it.file === file ? { ...it, sha, duplicateOf: dup?.original_name ?? null } : it,
        ),
      );
    }
  };

  return (
    <div>
      <div className="sticky top-0 z-10 border-b bg-card/85 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Sample upload</h1>
          <span className="text-xs text-faint">
            duplicates are caught in the browser, before any transfer
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors duration-150",
            dragging ? "border-primary bg-accent/40" : "hover:border-border-strong hover:bg-muted/40",
          )}
        >
          <UploadCloud className={cn("size-8", dragging ? "text-primary" : "text-faint")} />
          <div className="text-[13px] font-medium">
            Drop media samples here, or click to browse
          </div>
          <div className="text-[11px] text-faint">
            Each file is SHA-256 hashed locally and checked against the {samples.length}-sample
            library before upload.
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {items.map((it, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-card"
            >
              <FileVideo className="size-4 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{it.file.name}</div>
                <div className="font-mono text-[10px] text-faint">
                  {(it.file.size / 1_048_576).toFixed(1)} MB
                  {it.sha && ` · ${it.sha.slice(0, 20)}…`}
                </div>
              </div>
              {it.tooLarge ? (
                <Badge variant="secondary" title="Too big to hash in the browser — the server checks for duplicates on upload">
                  dup check on server
                </Badge>
              ) : it.sha === null ? (
                <span className="flex items-center gap-1.5 text-[11px] text-faint">
                  <Loader2 className="size-3 animate-spin" /> hashing
                </span>
              ) : it.duplicateOf ? (
                <Badge variant="warning">
                  <XCircle className="size-3" /> already in library: {it.duplicateOf}
                </Badge>
              ) : (
                <Badge variant="success">
                  <CheckCircle2 className="size-3" /> new sample
                </Badge>
              )}
            </motion.div>
          ))}
        </div>

        {items.some((it) => it.sha && !it.duplicateOf) && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed bg-muted/30 p-4">
            <span className="text-[12px] text-faint">
              Direct upload isn't available yet — transfer new samples through the
              existing FTP/HTTP flow for now.
            </span>
            <Button disabled title="Upload API not available yet">
              Upload
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
