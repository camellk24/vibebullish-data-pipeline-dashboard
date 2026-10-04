# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

LLM usage dashboard for VibeBullish. Single-page static app showing daily and weekly LLM call breakdowns, cost estimation, and per-ticker usage. Dark theme matching the iOS app. Deployed on Vercel, no build step.

## Commands

```bash
# Serve locally
npx serve . -l 3000
# or
python -m http.server 8000

# Deploy to production
vercel --prod
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
js/agent-ops.js     → Agents tab (agent-role health + accountability)
api/ops/reads.js    → admin-verified proxy for the six tabs' 14 reads (bearer forwarding)
api/agent-ops.js    → Vercel serverless proxy (holds INTERNAL_API_TOKEN)
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
except `ws-status`, which forwards both the bearer and `INTERNAL_API_TOKEN` (`'both'`) until #449
is confirmed deployed — then flip it to `'bearer'` in a follow-up. Signed out, the six tabs are
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

### Sections

- **Hero metrics** — total calls, models used, unique tickers, estimated cost
- **7-day trend** — bar chart of daily totals
- **By model** — horizontal bar chart with percentage
- **Hourly distribution** — 24-hour bar chart (ET timezone)
- **By service / endpoint** — table breakdowns
- **Top tickers** — chip grid showing per-ticker call counts
- **Cost estimation** — current spend + what-if analysis for model switching
