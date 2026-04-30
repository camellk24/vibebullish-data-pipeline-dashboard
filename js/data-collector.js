// js/data-collector.js
var DC_API = API_BASE + '/api/data-collector/health';
var DC_REFRESH_MS = 30000;

async function refreshDataCollectorHealth() {
  try {
    const r = await fetch(DC_API + '?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    renderDCHero(data.queue);
    renderDCBySource(data.queue);
    renderDCByType(data.queue);
    renderDCTables(data.tables);
    renderDCAPI(data.api_usage);
    renderDCErrors(data.recent_errors || []);
  } catch (err) {
    console.error('Data collector fetch failed:', err);
  }
}

function dcFmt(n) { return Number(n || 0).toLocaleString(); }

function renderDCHero(q) {
  if (!q) return;
  document.getElementById('dc-pending').textContent = dcFmt(q.Pending);
  document.getElementById('dc-inprogress').textContent = dcFmt(q.InProgress);
  document.getElementById('dc-completed').textContent = dcFmt(q.CompletedLastHr);
  document.getElementById('dc-failed').textContent = dcFmt(q.FailedLastHr);
  document.getElementById('dc-latency').textContent = (q.AvgCompletionMs || 0) + 'ms';
}

function renderDCBySource(q) {
  const c = document.getElementById('dc-by-source');
  c.innerHTML = '';
  const sources = q && q.BySource ? q.BySource : {};

  const t = document.createElement('table');
  t.className = 'data-table';
  t.innerHTML = `
    <thead><tr>
      <th>Source</th><th class="r">Pending</th><th class="r">Completed/hr</th>
      <th class="r">Failed/hr</th><th class="r">Avg Latency</th><th class="r">Success Rate</th>
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');

  const all = ['scanner', 'sweep', 'user', 'lightgbm', 'compute_force_refresh'];
  all.forEach(src => {
    const s = sources[src] || { Pending: 0, Completed: 0, Failed: 0, AvgMs: 0 };
    const total = s.Completed + s.Failed;
    const rate = total > 0 ? ((s.Completed / total) * 100).toFixed(1) + '%' : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${src}</td>
      <td class="r" style="font-family:'JetBrains Mono',monospace">${dcFmt(s.Pending)}</td>
      <td class="r" style="font-family:'JetBrains Mono',monospace;color:#00E5A0">${dcFmt(s.Completed)}</td>
      <td class="r" style="font-family:'JetBrains Mono',monospace;color:${s.Failed>0?'#FF4560':'#8a8a9e'}">${dcFmt(s.Failed)}</td>
      <td class="r" style="font-family:'JetBrains Mono',monospace">${s.AvgMs}ms</td>
      <td class="r" style="font-family:'JetBrains Mono',monospace">${rate}</td>`;
    tbody.appendChild(tr);
  });
  c.appendChild(t);
}

function renderDCByType(q) {
  const c = document.getElementById('dc-by-type');
  c.innerHTML = '';
  const types = q && q.ByDataType ? q.ByDataType : {};
  const max = Math.max(1, ...Object.values(types));
  ['fundamentals','short_data','earnings','ohlcv'].forEach(dt => {
    const count = types[dt] || 0;
    const pct = (count / max) * 100;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 0';
    row.innerHTML = `
      <div style="width:120px;font-size:0.85rem">${dt}</div>
      <div style="flex:1;height:18px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#A855F7,#00E5A0)"></div>
      </div>
      <div style="width:60px;text-align:right;font-family:'JetBrains Mono',monospace">${dcFmt(count)}</div>`;
    c.appendChild(row);
  });
}

function renderDCTables(tables) {
  const c = document.getElementById('dc-tables');
  c.innerHTML = '';
  if (!tables) return;

  const cards = [
    { name: 'ticker_fundamentals', data: tables.ticker_fundamentals },
    { name: 'ticker_short_data', data: tables.ticker_short_data },
    { name: 'earnings_calendar', data: tables.earnings_calendar },
    { name: 'daily_bars', data: tables.daily_bars },
  ];

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px';
  cards.forEach(({ name, data }) => {
    if (!data) return;
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px';
    let body = `
      <div style="font-size:0.75rem;color:#8a8a9e;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px">${name}</div>`;
    if (data.total_rows !== undefined) {
      body += `<div style="font-size:1.4rem;font-weight:700;font-family:'JetBrains Mono',monospace">${dcFmt(data.total_rows)} rows</div>`;
      body += `<div style="color:#8a8a9e;font-size:0.8rem;margin-top:4px">Updated last 24h: ${dcFmt(data.updated_last_24h || 0)}</div>`;
      if (data.stalest_ticker) {
        body += `<div style="color:#8a8a9e;font-size:0.8rem">Stalest: ${data.stalest_ticker} (${(data.stalest_age_hours || 0).toFixed(1)}h)</div>`;
      }
      if (data.null_coverage) {
        body += '<div style="margin-top:10px">';
        Object.entries(data.null_coverage).slice(0, 6).forEach(([col, cov]) => {
          const color = cov > 80 ? '#00E5A0' : cov > 50 ? '#FBBF24' : '#FF4560';
          body += `
            <div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;margin:3px 0">
              <div style="width:120px;color:#8a8a9e">${col}</div>
              <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${cov}%;background:${color}"></div>
              </div>
              <div style="width:50px;text-align:right;color:${color};font-family:'JetBrains Mono',monospace">${cov.toFixed(0)}%</div>
            </div>`;
        });
        body += '</div>';
      }
    } else if (data.total_tickers !== undefined) {
      body += `<div style="font-size:1.4rem;font-weight:700;font-family:'JetBrains Mono',monospace">${dcFmt(data.total_tickers)} tickers</div>`;
      body += `<div style="color:#8a8a9e;font-size:0.8rem;margin-top:4px">Latest: ${data.latest_date || '—'}</div>`;
      body += `<div style="color:#8a8a9e;font-size:0.8rem">Today: ${dcFmt(data.tickers_with_today || 0)} • Stale 7d+: ${dcFmt(data.tickers_stale_7d || 0)}</div>`;
    }
    card.innerHTML = body;
    grid.appendChild(card);
  });
  c.appendChild(grid);
}

function renderDCAPI(api) {
  const c = document.getElementById('dc-api');
  c.innerHTML = '';
  if (!api) return;
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
  ['polygon', 'finnhub'].forEach(vendor => {
    const calls = api[vendor + '_calls_last_hour'] || 0;
    const errs = api[vendor + '_errors_last_hour'] || 0;
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px';
    card.innerHTML = `
      <div style="font-size:0.75rem;color:#8a8a9e;letter-spacing:0.06em;text-transform:uppercase">${vendor}</div>
      <div style="font-size:1.4rem;font-weight:700;font-family:'JetBrains Mono',monospace;margin-top:4px">${dcFmt(calls)} calls</div>
      <div style="color:${errs > 0 ? '#FF4560' : '#8a8a9e'};font-size:0.85rem">${dcFmt(errs)} errors</div>`;
    grid.appendChild(card);
  });
  c.appendChild(grid);
}

function renderDCErrors(errors) {
  const c = document.getElementById('dc-errors');
  c.innerHTML = '';
  if (!errors.length) {
    c.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem">No recent errors.</p>';
    return;
  }
  const t = document.createElement('table');
  t.className = 'data-table';
  t.style.tableLayout = 'fixed';
  t.style.width = '100%';
  t.innerHTML = `
    <thead><tr>
      <th style="width:80px">Ticker</th>
      <th style="width:120px">Type</th>
      <th style="width:90px">When</th>
      <th>Error</th>
    </tr></thead><tbody></tbody>`;
  const tbody = t.querySelector('tbody');
  const escapeAttr = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  errors.forEach(e => {
    const tr = document.createElement('tr');
    const when = e.at ? new Date(e.at).toLocaleTimeString() : '—';
    tr.innerHTML = `
      <td style="font-family:'JetBrains Mono',monospace">${e.ticker}</td>
      <td style="color:#A855F7">${e.data_type}</td>
      <td style="color:#8a8a9e;font-size:0.8rem">${when}</td>
      <td style="color:#FF4560;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0" title="${escapeAttr(e.error)}">${e.error}</td>`;
    tbody.appendChild(tr);
  });
  c.appendChild(t);
}

// Auto-refresh when tab is active
setInterval(() => {
  const tab = document.querySelector('.tab[data-tab="data-collector"]');
  if (tab && tab.classList.contains('active')) {
    refreshDataCollectorHealth();
  }
}, DC_REFRESH_MS);
