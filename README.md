# Sample Platform — Web Console (prototype)

Workflow-first frontend prototype for the CCExtractor Sample Platform
modernization (see `MODERNIZATION_PLAN.md` in the sample-platform repo).

Runs entirely on **real production data** — fixtures under
`src/mocks/generated/` were extracted from the June 2026 prod DB dump
(237 regression tests, 178 samples, 15 categories, 30 recent runs) by
`extract_fixtures.py`. The data layer (`src/lib/api.ts`) is a seam: each
accessor swaps to a generated OpenAPI client once the `mod_api` write
endpoints land.

## Surfaces

- **Triage** (`/`) — the landing page is an inbox, not a stats dashboard:
  new failures per run × platform × category, expandable, with accept/dismiss
  actions (W2/W3 in the plan).
- **Runs** (`/runs`) — timeline of logical runs (Linux+Windows paired),
  inline failure breakdown with real infra-error messages.
- **Test Studio** (`/tests`) — IDE-style 3-pane workspace: category rail with
  live health → test list → always-editable detail panel. Deep-linkable via
  `?t=<id>`. No CRUD pages, no modals.
- **Test Builder** (`/tests/new`) — the anti-SQL wizard: pick sample →
  compose command (presets mined from the real suite) → dry-run on CI →
  bless output as baseline → categorize.
- **Samples** (`/samples`) — searchable gallery with extension facets.

## Stack

Vite · React 19 · TypeScript · Tailwind 4 · TanStack Router · motion ·
Radix primitives. Design language modeled on Linear (light-first,
near-monochrome + indigo accent, status dots, spring animations).

## Dev

```
npm install
npm run dev   # http://localhost:5173
```
