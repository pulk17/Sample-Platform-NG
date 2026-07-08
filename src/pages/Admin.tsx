import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ban, FileX, FolderTree, KeyRound, ListOrdered, Plus, Trash2, Users, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { RunStatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import {
  deriveCategories,
  revokeToken,
  snapshotTests,
  updateUserRole,
  useQueue,
  useTokens,
  useUsers,
  type PlatformUser,
} from "@/lib/api";
import { getSession } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const ROLES: PlatformUser["role"][] = ["admin", "contributor", "tester", "user"];

/**
 * "Administration": the only place suite/platform mutations live.
 * Token manager and CI queue are fully live; the rest lists the write-API
 * tasks (plan B-1c/B-2/B-6) that unlock each section.
 */
export function Admin() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="mb-1 text-[15px] font-semibold tracking-tight">Administration</h1>
      <p className="mb-6 text-[13px] text-faint">
        Changes to the suite and platform happen here — never inline on browse pages.
      </p>

      <div className="flex flex-col gap-6">
        <section>
          <SectionLabel>Regression suite</SectionLabel>
          <Link
            to="/tests/new"
            className="card-hover flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Plus className="size-4" />
            </span>
            <div>
              <div className="text-[13px] font-medium">New regression test</div>
              <div className="text-xs text-faint">
                Guided: sample → command → dry run → bless output → activate.
              </div>
            </div>
          </Link>
        </section>

        <UserSection />
        <MaintenanceSection />
        <BlockedUsersSection />
        <ForbiddenSection />
        <CategorySection />
        <QueueSection />
        <TokenSection />
      </div>
    </div>
  );
}

function MaintenanceSection() {
  const [state, setState] = useState({ linux: false, windows: false });
  return (
    <section>
      <SectionLabel>
        <Wrench className="mr-1 inline size-3.5" /> Maintenance mode
      </SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {(["linux", "windows"] as const).map((plat) => (
          <div key={plat} className="flex items-center justify-between rounded-xl border bg-card p-3.5 shadow-card">
            <div>
              <div className="text-[13px] font-medium capitalize">{plat}</div>
              <div className="text-[11px] text-faint">
                {state[plat] ? "CI paused — new runs queue but won't start" : "Accepting runs"}
              </div>
            </div>
            <button
              onClick={() => setState((s) => ({ ...s, [plat]: !s[plat] }))}
              className={cn(
                "relative h-5 w-9 cursor-pointer rounded-full transition-colors",
                state[plat] ? "bg-warning" : "bg-border-strong",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
                  state[plat] ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BlockedUsersSection() {
  const [blocked, setBlocked] = useState([
    { id: 1, login: "spam-account-42", comment: "Repeated abusive uploads" },
    { id: 2, login: "flaky-fork-bot", comment: "Broken CI spam" },
  ]);
  const [val, setVal] = useState("");
  return (
    <section>
      <SectionLabel>
        <Ban className="mr-1 inline size-3.5" /> Blocked CI users
        <span className="ml-2 font-normal normal-case">{blocked.length}</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl border shadow-card">
        {blocked.map((b) => (
          <div key={b.id} className="flex items-center gap-3 border-b bg-card px-4 py-2 text-[13px] last:border-0">
            <code className="font-medium">{b.login}</code>
            <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{b.comment}</span>
            <Button variant="ghost" size="sm" className="text-destructive"
              onClick={() => setBlocked((l) => l.filter((x) => x.id !== b.id))}>
              <Trash2 /> unblock
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="github-username to block"
            className="h-7 flex-1 rounded-md border bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" variant="secondary" disabled={!val.trim()}
            onClick={() => { setBlocked((l) => [...l, { id: Date.now(), login: val.trim(), comment: "Manually blocked" }]); setVal(""); }}>
            <Plus /> Block
          </Button>
        </div>
      </div>
    </section>
  );
}

function ForbiddenSection() {
  const [exts, setExts] = useState(["exe", "bat", "sh", "dll", "com"]);
  const [val, setVal] = useState("");
  return (
    <section>
      <SectionLabel>
        <FileX className="mr-1 inline size-3.5" /> Forbidden upload extensions
      </SectionLabel>
      <div className="rounded-xl border bg-card p-3.5 shadow-card">
        <div className="flex flex-wrap gap-1.5">
          {exts.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-2 py-0.5 font-mono text-[11px]">
              .{e}
              <button className="cursor-pointer text-faint hover:text-destructive"
                onClick={() => setExts((l) => l.filter((x) => x !== e))}>×</button>
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <input
            value={val}
            onChange={(e) => setVal(e.target.value.replace(/[^a-z0-9]/gi, ""))}
            placeholder="extension"
            className="h-7 w-40 rounded-md border bg-card px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" variant="secondary" disabled={!val.trim() || exts.includes(val)}
            onClick={() => { setExts((l) => [...l, val.trim().toLowerCase()]); setVal(""); }}>
            <Plus /> Add
          </Button>
        </div>
      </div>
    </section>
  );
}

function CategorySection() {
  const cats = deriveCategories(snapshotTests);
  return (
    <section>
      <SectionLabel>
        <FolderTree className="mr-1 inline size-3.5" /> Categories
        <span className="ml-2 font-normal normal-case">{cats.length}</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl border shadow-card">
        {cats.map((c) => (
          <div key={c.name} className="flex items-center gap-3 border-b bg-card px-4 py-2 text-[13px] last:border-0">
            <span className="font-medium">{c.name}</span>
            <span className="ml-auto text-[11px] text-faint">{c.test_count} tests</span>
            <Button variant="ghost" size="sm">Rename</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function UserSection() {
  const { data: users = [], isLoading } = useUsers();
  const qc = useQueryClient();
  const me = getSession();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const changeRole = async (u: PlatformUser, role: string) => {
    setBusy(u.user_id);
    setErr(null);
    try {
      await updateUserRole(u.user_id, role);
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Role change failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <SectionLabel>
        <Users className="mr-1 inline size-3.5" /> User management
        <span className="ml-2 font-normal normal-case">{users.length} users</span>
      </SectionLabel>
      {err && <div className="mb-2 text-[11px] text-destructive">{err}</div>}
      <div className="overflow-hidden rounded-xl border shadow-card">
        {isLoading && <div className="h-24 animate-pulse bg-muted/50" />}
        {users.map((u, i) => {
          const self = u.email === me?.email;
          return (
            <motion.div
              key={u.user_id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.015, 0.3) }}
              className="flex items-center gap-3 border-b bg-card px-4 py-2 text-[13px] last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {u.name}
                  {self && <span className="ml-1.5 text-[10px] text-faint">(you)</span>}
                </div>
                <div className="truncate text-[11px] text-faint">{u.email}</div>
              </div>
              {u.github_linked && <Badge variant="secondary">github</Badge>}
              <select
                value={u.role}
                disabled={self || busy === u.user_id}
                onChange={(e) => changeRole(u, e.target.value)}
                className={cn(
                  "h-7 cursor-pointer rounded-md border bg-card px-2 text-xs capitalize shadow-card transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  self && "cursor-not-allowed opacity-60",
                )}
                title={self ? "You can't change your own role" : "Change role"}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function QueueSection() {
  const { data } = useQueue();
  return (
    <section>
      <SectionLabel>
        <ListOrdered className="mr-1 inline size-3.5" /> CI queue
        {data && (
          <span className="ml-2 font-normal normal-case">
            {data.meta.running_count} running · {data.meta.queue_depth} queued
          </span>
        )}
      </SectionLabel>
      <div className="overflow-hidden rounded-xl border shadow-card">
        {(data?.data ?? []).map((q) => (
          <div
            key={q.run_id}
            className="flex items-center gap-3 border-b bg-card px-4 py-2.5 text-[13px] last:border-0"
          >
            <code className="text-xs text-faint">run {q.run_id}</code>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {q.platform}
            </span>
            <RunStatusBadge status={q.status as RunStatus} className="ml-auto" />
          </div>
        ))}
        {data && data.data.length === 0 && (
          <div className="bg-card px-4 py-6 text-center text-xs text-faint">Queue is empty.</div>
        )}
      </div>
    </section>
  );
}

function TokenSection() {
  const { data: tokens = [], isLoading } = useTokens();
  const qc = useQueryClient();
  const [revoking, setRevoking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const current = getSession();

  const doRevoke = async () => {
    if (revoking === null) return;
    setBusy(true);
    try {
      await revokeToken(revoking);
      await qc.invalidateQueries({ queryKey: ["tokens"] });
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };

  const active = tokens.filter((t) => !t.is_revoked);

  return (
    <section>
      <SectionLabel>
        <KeyRound className="mr-1 inline size-3.5" /> API tokens
        <span className="ml-2 font-normal normal-case">{active.length} active</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl border shadow-card">
        {isLoading && <div className="h-20 animate-pulse bg-muted/50" />}
        {active.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-center gap-3 border-b bg-card px-4 py-2.5 text-[13px] last:border-0"
          >
            <code className="text-xs">{t.token_prefix}…</code>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {t.token_name}
            </span>
            <span className="hidden gap-1 md:flex">
              {t.scopes.slice(0, 3).map((s) => (
                <Badge key={s} variant="secondary">{s}</Badge>
              ))}
              {t.scopes.length > 3 && <Badge variant="secondary">+{t.scopes.length - 3}</Badge>}
            </span>
            <span className="text-[11px] text-faint">
              expires {new Date(t.expires_at).toLocaleDateString()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setRevoking(t.id)}
            >
              <Trash2 /> revoke
            </Button>
          </motion.div>
        ))}
      </div>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this API token?"
        body={
          <>
            Anything using it loses access immediately.
            {current && " Revoking the token this session uses signs you out."}
          </>
        }
        confirmLabel={busy ? "Revoking…" : "Revoke token"}
        busy={busy}
        onConfirm={doRevoke}
      />
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </div>
  );
}
