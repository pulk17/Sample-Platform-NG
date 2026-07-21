# Sample Platform NG

A modern web console for the [CCExtractor Sample Platform](https://github.com/CCExtractor/sample-platform):
regression-test triage, run results with caption diffs, suite management,
sample library and platform administration — one SPA talking to the
platform's REST API.

## Pages

| Route | What it does |
|---|---|
| `/` | Triage inbox — recent runs that finished with failures, grouped by category, with per-test diff and baseline promotion |
| `/runs` | Test results — Linux/Windows grouped per commit, live counts, links to per-run pages |
| `/runs/:id` | One run — metadata, progress stepper, results by category, diffs on failing tests |
| `/runs/new` | Queue a run against any fork/commit, full suite or a category subset |
| `/tests` | Regression tests — category rail, filterable list, editable detail panel with per-platform history |
| `/tests/new` | Guided test creation: pick sample → compose command → describe, then queue a verification run |
| `/samples` | Sample library with extension facets; drawer shows upload details, media info and cross-run history |
| `/upload` | Client-side SHA-256 duplicate check before any transfer |
| `/status` | Platform health, CI queue depth, last master run per platform |
| `/admin` | Users & roles, CI queue, API tokens |

## Running it

**Against the API** (a sample-platform instance with `mod_api`):

```
npm install
npm run dev        # http://localhost:5173, proxies /api to :5001
```

Sign in with a platform account; the app mints a scoped API token and picks
up your role from `/auth/me`. Editing and administration need
admin/contributor — everyone else gets read-only views.

**Standalone demo** (no backend — data bundled from a production snapshot):

```
npm run build:demo # static dist/, any credentials sign in
```

`vercel.json` / `netlify.toml` deploy the demo as-is;
`deploy/nginx.example.conf` shows the production layout (static app +
proxied API).

The bundled snapshot (`src/mocks/generated/`) holds only data that is
already public on the classic site — test commands, sample names/hashes,
run outcomes. No accounts, tokens or emails; `tools/extract_fixtures.py`
selects columns from an explicit allowlist, keep it that way.

## Stack

Vite, React 19, TypeScript, Tailwind 4, TanStack Router + Query, motion,
Radix primitives. Data access lives in `src/lib/api.ts`; the demo intercepts
those calls in `src/lib/demo.ts`.
