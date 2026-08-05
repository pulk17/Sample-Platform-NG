import { Loader2, LogIn, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/auth";
import { DEMO } from "@/lib/demo";

/** Full-screen sign-in against POST /api/v1/auth/tokens. */
export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(DEMO ? "carlos@ccextractor.org" : "");
  const [password, setPassword] = useState(DEMO ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const [dark, setDark] = useState(() => localStorage.getItem("sp-theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("sp-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="relative flex h-full items-center justify-center bg-background">
      <button
        onClick={() => setDark(!dark)}
        aria-label="Toggle theme"
        className="absolute right-5 top-5 cursor-pointer rounded-lg border bg-card p-2 text-muted-foreground shadow-card transition-colors hover:text-foreground"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <motion.form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-pop"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="mb-6 flex items-center gap-3">
          <img src="/ccx.svg" alt="CCExtractor" className="size-10" />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Sample Platform</div>
            <div className="text-xs text-faint">CCExtractor regression testing</div>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
        <Input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mb-3"
        />
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4"
        />
        {error && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <Button className="w-full" disabled={busy || !email || !password}>
          {busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
        </Button>
        <p className="mt-4 text-center text-[11px] text-faint">
          {DEMO
            ? "Interactive demo — sign in to explore (any credentials work)."
            : "Issues an API token via /api/v1/auth/tokens — same accounts as the classic site."}
        </p>
      </motion.form>
    </div>
  );
}
