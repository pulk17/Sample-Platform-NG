// Session handling. Login mints a bearer token via POST /auth/tokens, then
// asks /auth/me for the server-side role. The role only gates what the UI
// shows — every mutation is re-checked on the server.

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

  // Fetch the role the server actually assigned to this account.
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
