// Token auth against POST /api/v1/auth/tokens (Bearer spci_*).
// Role is inferred client-side for UI gating only — the server enforces real
// permissions on every call. GET /auth/me (plan task B-1a) replaces this.

export type Role = "user" | "contributor" | "admin";

export interface Session {
  token: string;
  email: string;
  role: Role;
  expires_at: string;
}

const KEY = "sp-session";

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (new Date(s.expires_at) < new Date()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function canManage(s: Session | null): boolean {
  return s?.role === "admin" || s?.role === "contributor";
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch("/api/v1/auth/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      token_name: `web-console-${Date.now() % 100000}`,
      scopes: [
        "runs:read",
        "runs:write",
        "system:read",
        "baselines:write",
        "results:read",
        "tokens:manage",
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Login failed (${res.status})`);
  }
  const body = await res.json();

  // Real role from GET /auth/me — server-resolved, no client guessing.
  const meRes = await fetch("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${body.token}` },
  });
  const me = meRes.ok ? await meRes.json() : { role: "user" };

  const session: Session = {
    token: body.token,
    email,
    role: (me.role as Role) ?? "user",
    expires_at: body.expires_at,
  };
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  localStorage.removeItem(KEY);
  window.location.reload();
}
