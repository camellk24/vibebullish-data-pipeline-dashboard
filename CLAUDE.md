# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static HTML/JS monitoring dashboard for the VibeBullish data pipeline. Displays pipeline health, vibe score analytics, and system status by polling the Go backend API. Deployed on Vercel. No build step required.

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

The backend URL is hardcoded in `index.html`:
```javascript
const BACKEND_URL = 'https://vibebullish-backend-production.up.railway.app';
```

Change this for local development or to point at a different environment.

## Architecture

Single-page application — all code lives in `index.html` with supporting files:

```
index.html              → Main SPA (navigation, all page logic, API calls)
enhanced-dashboard.html → Extended dashboard view
js/                     → Supporting JS modules
styles/                 → CSS
vercel.json             → Vercel deployment config
```

The dashboard polls these backend endpoints every 30 seconds:
- `GET /api/data-pipeline/dashboard` — metrics
- `GET /api/data-pipeline/reports` — recent reports
- `GET /health` — backend health check

### Adding a New Page

1. Add a nav link in the `.nav` section of `index.html`
2. Add a page `<div>` with id `[page-name]-page`
3. Add a `case` in the `showPage()` switch statement
4. Implement the page's data loading function
