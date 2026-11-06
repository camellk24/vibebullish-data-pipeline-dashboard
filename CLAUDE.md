# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Monitoring and ops console for VibeBullish (see `README.md`). Single-page static app, dark theme
matching the iOS app, deployed on Vercel with no build step. It has twelve tabs (`index.html`):

- **Signed-in tabs** (personal research mode, admin-verified reads via `api/ops/reads.js`):
  LLM Usage, System Health, Action Engine, Quant Quality, Data Collector, Catalyst Accuracy.
- **Agents** — agent-role health, accountability and the risk-flagger / curated-picks / tripwire
  scorecards (`api/agent-ops.js`, internal token server-side).
- **Ops console** (admin only, hidden until the admin check passes): Overview, Harness,
  Shadow book, Heartbeats, Strategies.

The LLM Usage tab is the original dashboard; its sections are listed at the end of this file.

## Commands

```bash
# Serve locally
npx serve . -l 3000
# or
python -m http.server 8000

# Production deploys happen automatically: the Vercel project is GitHub-linked,
# so a merge to main produces a production deployment within about a minute.
# (The old "Deploy to Vercel" GitHub Action was removed 2026-10-04: it duplicated
# the Git deploy and had been failing with "Could not retrieve Project Settings".)
```

## Configuration

The backend base URL lives server-side only (`BACKEND_API_BASE` on Vercel, default
`https://api.vibebullish.com`, read by `api/_verified_proxy.js`). No script under `js/` names the
backend host.

## Architecture

```
index.html          → Single page with all sections
js/reads.js         → VBReads: the one client read path for the six signed-in tabs (+ esc())
js/dashboard.js     → VBTabs controller, LLM Usage / System Health / Action Engine loaders + renderers
js/agent-ops.js     → Agents tab (agent-role health + accountability) + scorecard loader
js/agent-scorecards-format.js → Agents tab scorecard cards (risk-flagger coverage, curated-picks,
                      tripwire push copy): pure renderer, tests in js/agent-scorecards-format.test.js
js/harness.js       → Harness tab (admin only): agent-harness board; fixture js/harness-fixture.js
js/strategy-diagnostics-format.js → Strategies tab (admin only) book diagnostics card: pure renderer
                      (correlation, turnover, capacity); loader in js/ops-console.js
api/ops/reads.js    → admin-verified proxy for the six tabs' 14 reads (bearer forwarding)
api/agent-ops.js    → Agents-tab proxy (admin-verified, INTERNAL_API_TOKEN server-side); ?view= allow-list:
                      roles (default) | risk-flagger | curated-picks | tripwire → the fixed backend
                      /api/internal/{agent-ops,risk-flagger-stats,curated-picks-scorecard,tripwire-scorecard};
                      one function for all four (functions cap), no caller params forwarded
api/ops/strategy-diagnostics.js → admin-verified proxy for GET /api/internal/ops/strategy-diagnostics
                      (machine class, internal token; no caller params forwarded)
api/ops/harness.js  → Harness tab data: admin-verified read of private Vercel Blob harness/state.json
                      + owner vetoes written to harness/vetoes.json (schema: api/_harness_schema.js)
scripts/harness-push.mjs → uploader the harness runs on the owner's Mac (BLOB_READ_WRITE_TOKEN)
styles/dashboard.css → Dark theme (matches iOS app Theme.swift)
vercel.json         → Vercel deployment config (zero-config + rewrites)
```

### Secrets

This site is **public**. No script under `js/` may ever contain a token. An internal,
token-gated backend route is reached only through a serverless function under `api/`,
which reads the secret from a Vercel environment variable server-side. See the Agents
tab section of `README.md` for the required variables.

**Signed-in reads (personal research mode):** the LLM Usage, System Health, Action Engine,
Quant Quality, Data Collector and Catalyst Accuracy tabs read the backend ONLY through the
admin-verified proxy `GET /api/ops/reads?view=<name>` (`api/ops/reads.js`, 14 allow-listed views
with validated params), reached from the browser via `VBReads.get()` (`js/reads.js`) →
`VBAuth.fetch(…, {requireAuth:true})`. The proxy verifies the Firebase admin, then forwards the
same bearer (`forwardAuth: 'bearer'`; these are human-class backend routes under backend PR #449),
for all 14 views (`ws-status` forwarded `'both'` until backend #449 deployed). Signed out, the six tabs are
gated (`.vb-gated`, no request); `VBTabs` in `js/dashboard.js` owns activation, the single poll
timer and request invalidation (auth generation + per-tab sequence). Never add a bare `fetch()` to
a tab script: `js/signed-in-reads.test.js` pins the exact native-fetch inventory, drives the whole
page in a fake DOM derived from `index.html` (sign-in, every tab, timers, date/window changes,
deferred sign-out, re-sign-in, Agents/ops tabs) and runs HTML-injection regressions on every
recovered renderer. `esc()` (attribute-safe, from `js/reads.js`) is the one escaper. The Agents and
ops tabs are unchanged (machine-class proxies, internal token).

The LLM Usage tab reads, through the proxy, `GET /api/llm-usage/today?date=YYYY-MM-DD` (usage
summary for a date, default today ET), `GET /api/llm-usage/week` (last 7 days) and
`GET /api/llm-usage/scanner?date=…`; it polls every 60 seconds (auto-refresh pauses on a
historical date).

A date picker in the header allows navigating to any historical date with arrow buttons, a date input, and a Today button.

### LLM Usage tab sections

- **Hero metrics** — total calls, models used, unique tickers, estimated cost
- **7-day trend** — bar chart of daily totals
- **By model** — horizontal bar chart with percentage
- **Hourly distribution** — 24-hour bar chart (ET timezone)
- **By service / endpoint** — table breakdowns
- **Top tickers** — chip grid showing per-ticker call counts
- **Cost estimation** — current spend + what-if analysis for model switching
