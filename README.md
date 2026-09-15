# VibeBullish Data Pipeline Dashboard

Static HTML/JS monitoring dashboard for VibeBullish. Surfaces LLM usage/cost, quant
(LightGBM) backtests and live predictions, data-collector health, catalyst accuracy,
and scanner metrics by polling the Go backend API. Dark theme matching the iOS app.
Deployed on Vercel, no build step.

## Architecture

Single-page app with no build step. `index.html` loads one script per tab:

```
index.html                  Main SPA (navigation, layout)
js/dashboard.js             LLM usage + cost estimation
js/quant.js                 LightGBM backtests, live predictions/stats, training runs
js/data-collector.js        Data-collector health
js/catalyst-accuracy.js     Catalyst accuracy
js/scanner-metrics.js       Scanner metrics (System Health tab)
js/agent-ops.js             Agents tab (agent-role health + accountability)
js/agent-ops-fixture.js     Fixture data for the Agents tab — dev only, loaded
                            lazily and only when the URL carries ?fixture=...
api/agent-ops.js            Vercel serverless proxy holding INTERNAL_API_TOKEN
styles/dashboard.css        Dark theme (matches iOS Theme.swift)
vercel.json                 Vercel deployment config
```

Backend base URL is `https://api.vibebullish.com`, set per-script (e.g. `API_BASE` in
`js/dashboard.js`). Tabs poll endpoints such as:

- `GET /api/llm-usage`, `/api/llm-catalyst-accuracy`
- `GET /api/quant/{backtests,live-predictions,live-stats,training-runs,health}`
- `GET /api/action-engine/backtest/{stats,trend,calibration}`
- `GET /api/scanner/metrics`, `/api/data-collector/health`, `/api/internal/ws-status`

## Agents tab

Shows every declared LLM/model/deterministic agent role: what it produced today, whether
it is healthy right now, and — the point of the view — whether anything grades its output.
`not_graded` and `unknown` render as their own visible states, never as a zero or a blank,
so a role that has never been graded looks different from one that was graded and scored
zero. Unhealthy and trade-gating rows sort to the top; dormant roles render dimmed at the
bottom. The panel auto-refreshes every 45s and shows "updated Ns ago".

### Required environment variable

The Agents tab reads the backend's token-gated `GET /api/internal/agent-ops`. **This site
is public and must never embed that token.** Instead, `api/agent-ops.js` — a Vercel
serverless function in this project — reads the token server-side and proxies the call;
the browser only ever talks to the same-origin `/api/agent-ops`.

Set on the Vercel project (`vibebullish-dashboard`) → Settings → Environment Variables,
for **Production and Preview**, then redeploy:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `INTERNAL_API_TOKEN` | yes | — | Backend internal-route secret. Server-side only; never referenced from `js/`. |
| `BACKEND_API_BASE` | no | `https://api.vibebullish.com` | Override to point at a different backend. |

If `INTERNAL_API_TOKEN` is missing the function returns HTTP 503 `{"error":"not_configured"}`
and the tab renders an explicit **"Agents view is not configured"** panel naming the
variable — never a blank panel or stale numbers.

### Previewing without the backend

The Agents tab ships with committed fixture data behind an explicit flag, so it can be
developed and screenshotted before the backend endpoint exists:

```
http://localhost:3000/?fixture=1                 full roster (every status)
http://localhost:3000/?fixture=unreachable       backend down
http://localhost:3000/?fixture=notconfigured     missing env var
http://localhost:3000/?fixture=upstream          backend rejected the token
http://localhost:3000/?fixture=1&expand=<role_id>[,<role_id>]   pre-open detail rows
```

Without a `?fixture=` parameter the fixture script is never requested and the tab talks
only to `/api/agent-ops`.

## Setup

```bash
# Local development
npx serve . -l 3000
# or
python -m http.server 8000

# Deploy to production (manual — there is no Vercel<->GitHub integration)
npx vercel --prod --yes
```

`vercel dev` is needed to exercise `api/agent-ops.js` locally; `npx serve .` serves the
static files only, so `/api/agent-ops` 404s and the tab shows its unreachable state. Use
`?fixture=1` for UI work.
