# VibeBullish Data Pipeline Dashboard

Static HTML/JS monitoring dashboard for the VibeBullish data pipeline. Displays pipeline health, vibe score analytics, and system status by polling the Go backend API. Deployed on Vercel.

## Architecture

Single-page app with no build step:

```
index.html              Main SPA (navigation, all page logic, API calls)
enhanced-dashboard.html Extended dashboard view
js/dashboard.js         Supporting JS
styles/dashboard.css    Styles
vercel.json             Vercel deployment config
```

The dashboard polls these backend endpoints every 30 seconds:
- `GET /api/data-pipeline/dashboard` — metrics
- `GET /api/data-pipeline/reports` — recent reports
- `GET /health` — backend health check

## Setup

```bash
# Local development
npx serve . -l 3000
# or
python -m http.server 8000

# Deploy to production
vercel --prod
```

## Configuration

Update the backend URL in `index.html`:

```javascript
const BACKEND_URL = 'https://vibebullish-backend-production.up.railway.app';
```
