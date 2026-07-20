# Deploying the demo

The demo is a **static site with no backend** — all data is baked in and the
app intercepts its own API calls (`src/lib/demo.ts`). It runs anywhere that
serves static files. Uses hash routing, so no server-side rewrites are needed.

> **Demo builds are for showcasing only.** Any credentials sign in as admin
> and a banner says so in the UI. Never use a demo build as the starting
> point for a production deploy — production is a plain `npm run build`
> served behind Nginx next to the real API (`deploy/nginx.example.conf`),
> and the committed `netlify.toml` / `vercel.json` are demo configs.

Build it:

```bash
npm run build:demo      # outputs dist/  (VITE_DEMO=1, relative base)
```

Sign in with **any** email/password (the fields are pre-filled).

## Fastest: drag-and-drop (no CLI)

1. Run `npm run build:demo`.
2. Go to **https://app.netlify.com/drop**.
3. Drag the `dist` folder onto the page.
4. You get a public URL like `https://random-name.netlify.app` — share that.

## Vercel (CLI)

```bash
npm i -g vercel
npm run build:demo
vercel deploy dist --prod --yes --name sample-platform-demo
```

## GitHub Pages

1. Create a repo, push this folder.
2. Enable Pages → Source: GitHub Actions.
3. Add `.github/workflows/pages.yml`:

```yaml
name: demo
on: { push: { branches: [main] } }
permissions: { pages: write, id-token: write }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build:demo
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/deploy-pages@v4
```

Hash routing means it works under a project subpath (`/repo/`) with no extra config.

## Preview locally

```bash
npm run build:demo
npx serve dist          # or: python -m http.server 4188 -d dist
```
