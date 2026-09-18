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
js/auth.js                  Firebase Google sign-in (module) — admin gate
js/ops-console.js           Shadow book + Heartbeats tabs (admin only)
api/_verified_proxy.js      Shared admin-verified proxy holding INTERNAL_API_TOKEN
api/config.js               Public Firebase web config from Vercel env
api/agent-ops.js            Agents-tab proxy (now admin-verified)
api/ops/whoami.js           "is this account an admin?"
api/ops/shadow.js           Shadow status/evidence/diffs/attribution/alerts
api/ops/heartbeats.js       Routine registry + lateness
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

## Ops console (admin only)

Two tabs — **Shadow book** and **Heartbeats** — read the backend's token-gated
`/api/internal/*` Phase D endpoints. They are part of the SAME deployment as the public
tabs: the existing tabs are untouched and stay unauthenticated, while the two ops tab
buttons are hidden until the signed-in Google account is confirmed as an admin.

How the gate works, and why the token stays server-side:

1. The browser signs in with Google (Firebase Web SDK v10, loaded from the gstatic CDN by
   `js/auth.js`). The public web config comes from `/api/config` — a Firebase web `apiKey`
   is an identifier, not a secret.
2. The browser calls same-origin `/api/ops/*` with `Authorization: Bearer <Firebase ID token>`.
3. `api/_verified_proxy.js` (server-side) calls the backend's `GET /api/admin/whoami` with
   that ID token (2s timeout). Anything other than HTTP 200 → `403 {"error":"forbidden"}`
   and **the internal endpoint is never contacted**.
4. Only after a 200 does it forward to the internal path with
   `X-Internal-Token: $INTERNAL_API_TOKEN` (12s timeout, `Cache-Control: no-store`).
   Upstream response headers and non-2xx upstream bodies are never echoed, so the token
   cannot appear in anything the browser reads. `npm test` pins that invariant.

**Behavior change:** `api/agent-ops.js` now goes through the verified proxy too, so the
**Agents tab also requires admin sign-in**. Signed out, it renders its explicit
"Admin sign-in required" state instead of data.

Panels degrade independently. If a Phase D endpoint is not deployed yet (404) or the proxy
is unconfigured (503), that one panel reads **unavailable** with the reason; the page never
breaks and never leaves stale numbers on screen.

### Vercel environment variables

Set on the Vercel project (`vibebullish-dashboard`) → Settings → Environment Variables for
**Production and Preview**, then redeploy:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `INTERNAL_API_TOKEN` | yes | — | Backend internal-route secret. Server-side only; never referenced from `js/`. |
| `FIREBASE_WEB_API_KEY` | yes | — | Public Firebase web API key, served by `/api/config`. |
| `FIREBASE_AUTH_DOMAIN` | yes | — | e.g. `vibebullish.firebaseapp.com`. |
| `FIREBASE_APP_ID` | yes | — | Public Firebase web app id. |
| `BACKEND_API_BASE` | no | `https://api.vibebullish.com` | Override to point at a different backend. |

`projectId` (`vibebullish`) and `messagingSenderId` (`718084292276`) are constants in
`api/config.js`, not env vars.

**Also required, outside Vercel:** add the dashboard origin
(`vibebullish-dashboard.vercel.app`, plus any preview origin you sign in from) to the
Firebase console → Authentication → Settings → **Authorized domains**. Without it the
Google popup fails with `auth/unauthorized-domain`.

### Manual sign-in checklist

Run against a deployment (or `vercel dev` — `npx serve .` has no serverless functions):

- [ ] Signed out: the header shows **Sign in**; the Shadow book and Heartbeats tab buttons
      are **not** in the tab bar; every public tab loads normally with no console errors.
- [ ] Click **Sign in** → Google popup → sign in with the **admin** UID: the header shows
      `admin · <email>`, and both ops tab buttons appear.
- [ ] Open **Shadow book**: the status strip, evidence, attribution, diffs and pages panels
      each render either data or an explicit "unavailable" box — never a blank card.
- [ ] Attribution: when a run reports `unpriced_lots > 0` the row is highlighted, an
      "N unpriced" chip appears, and the Unrealized tile says **incomplete** — the total is
      missing those lots, so it must not read as whole. `oldest_bar_age_days` shows as a
      "bar age Nd" chip when the backend reports it.
- [ ] Diffs: the kind filter (all / entry / exit / entry size / exit size) narrows the rows
      and leaves the filter bar itself visible; each session shows its unclassified share,
      highlighted when the backend sets `warn_unclassified`. A `kind` outside the declared
      four renders as itself with a dashed chip, never folded into a kind it is not.
- [ ] Open **Heartbeats**: routines table renders; late rows are highlighted; disabled
      routines are dimmed.
- [ ] Sign in with a **non-admin** Google account: the header reads `not an admin`, the ops
      tab buttons stay hidden, and `/api/ops/heartbeats` returns `403 {"error":"forbidden"}`.
- [ ] **Sign out** while an ops tab is open: the view falls back to a public tab and the ops
      panels are cleared.
- [ ] In devtools → Network, confirm no response body or header anywhere contains the
      internal token, and that `/api/ops/*` requests carry only the Firebase Bearer token.

## Tests

```bash
npm test          # node --test api/*.test.js
```

`api/_verified_proxy.test.js` mocks `globalThis.fetch` and asserts the security contract:
the internal token never appears in a response body or header, a 401/403/timeout from
`whoami` yields 403 **without any upstream call**, upstream headers are never echoed, and
the forward carries `X-Internal-Token` but not the browser's Firebase token.

## Setup

```bash
# Local development
npx serve . -l 3000
# or
python -m http.server 8000

# Deploy to production (manual — there is no Vercel<->GitHub integration)
npx vercel --prod --yes
```

`vercel dev` is needed to exercise the `api/` functions locally; `npx serve .` serves the
static files only, so `/api/agent-ops`, `/api/config` and `/api/ops/*` 404 — the header then
reads "sign-in not configured", the ops tabs stay hidden, and the Agents tab shows its
unreachable state. Use `?fixture=1` for Agents-tab UI work.
