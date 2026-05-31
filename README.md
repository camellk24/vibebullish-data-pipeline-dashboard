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
js/llm-analysis-logs.js     LLM analysis logs
js/catalyst-accuracy.js     Catalyst accuracy
js/scanner-metrics.js       Scanner metrics (System Health tab)
styles/dashboard.css        Dark theme (matches iOS Theme.swift)
vercel.json                 Vercel deployment config
```

Backend base URL is `https://api.vibebullish.com`, set per-script (e.g. `API_BASE` in
`js/dashboard.js`). Tabs poll endpoints such as:

- `GET /api/llm-usage`, `/api/llm-analysis-log`, `/api/llm-catalyst-accuracy`
- `GET /api/quant/{backtests,live-predictions,live-stats,training-runs,health}`
- `GET /api/action-engine/backtest/{stats,trend,calibration}`
- `GET /api/scanner/metrics`, `/api/data-collector/health`, `/api/internal/ws-status`

## Setup

```bash
# Local development
npx serve . -l 3000
# or
python -m http.server 8000

# Deploy to production
vercel --prod
```
