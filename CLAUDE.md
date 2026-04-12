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

The backend API URL is set in `js/dashboard.js`:
```javascript
const API = 'https://api.vibebullish.com/api/llm-usage';
```

## Architecture

```
index.html          → Single page with all sections
js/dashboard.js     → Fetch + render logic, cost estimation model
styles/dashboard.css → Dark theme (matches iOS app Theme.swift)
vercel.json         → Vercel deployment config
```

The dashboard polls two backend endpoints every 60 seconds (auto-refresh pauses when viewing historical dates):
- `GET /api/llm-usage/today?date=YYYY-MM-DD` — usage summary for a specific date (defaults to today ET)
- `GET /api/llm-usage/week` — last 7 days of daily summaries

A date picker in the header allows navigating to any historical date with arrow buttons, a date input, and a Today button.

### Sections

- **Hero metrics** — total calls, models used, unique tickers, estimated cost
- **7-day trend** — bar chart of daily totals
- **By model** — horizontal bar chart with percentage
- **Hourly distribution** — 24-hour bar chart (ET timezone)
- **By service / endpoint** — table breakdowns
- **Top tickers** — chip grid showing per-ticker call counts
- **Cost estimation** — current spend + what-if analysis for model switching
