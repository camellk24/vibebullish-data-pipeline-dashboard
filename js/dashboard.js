// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish LLM Usage Dashboard
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = 'https://api.vibebullish.com';
const API = API_BASE + '/api/llm-usage';
const INTERNAL_API_TOKEN = ''; // Set to your INTERNAL_API_TOKEN value if the endpoint requires auth
const REFRESH_MS = 60_000;
const WS_STATUS_REFRESH_MS = 30_000;
let selectedDate = null; // null = today (live), string = 'YYYY-MM-DD'

// Per-model cost ($/1K tokens)
const MODELS = {
    'gpt-5-mini':        { input: 0.00030, output: 0.00120, label: 'GPT-5 Mini',        fam: 'gpt' },
    'gpt-4o':            { input: 0.00250, output: 0.01000, label: 'GPT-4o',             fam: 'gpt' },
    'gpt-4o-mini':       { input: 0.00015, output: 0.00060, label: 'GPT-4o Mini',        fam: 'gpt' },
    'claude-opus-4-6':   { input: 0.01500, output: 0.07500, label: 'Claude Opus 4.6',    fam: 'claude' },
    'claude-sonnet-4-6': { input: 0.00300, output: 0.01500, label: 'Claude Sonnet 4.6',  fam: 'claude' },
    'claude-haiku-4-5':  { input: 0.00080, output: 0.00400, label: 'Claude Haiku 4.5',   fam: 'claude' },
};
const TOK_IN = 2000, TOK_OUT = 500;

function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function fmt(n) { return Number(n).toLocaleString(); }

function costFor(calls, key) {
    const m = MODELS[key];
    if (!m) return null;
    return (calls * TOK_IN / 1000) * m.input + (calls * TOK_OUT / 1000) * m.output;
}

function modelFamily(name) {
    if (name.startsWith('gpt'))    return 'gpt';
    if (name.startsWith('claude')) return 'claude';
    if (name.includes('deepseek')) return 'deepseek';
    return 'unknown';
}

function dayName(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
}

// ── Fetchers ──────────────────────────────────────────────────────────────

async function fetchToday() {
    const dateParam = selectedDate ? `&date=${selectedDate}` : '';
    const r = await fetch(`${API}/today?t=${Date.now()}${dateParam}`);
    return r.json();
}

async function fetchWeek() {
    const r = await fetch(`${API}/week?t=${Date.now()}`);
    return r.json();
}

async function fetchScanner() {
    const dateParam = selectedDate ? `&date=${selectedDate}` : '';
    const r = await fetch(`${API}/scanner?t=${Date.now()}${dateParam}`);
    return r.json();
}

// ── Renderers ─────────────────────────────────────────────────────────────

function renderHero(data) {
    const el = (id) => document.getElementById(id);
    el('m-total').textContent = data.total_calls ? fmt(data.total_calls) : '0';
    el('m-date').textContent = data.date || '';
    el('m-total-label').textContent = selectedDate ? `Total Calls` : 'Total Calls Today';
    el('m-models').textContent = Object.keys(data.by_model || {}).length;
    el('m-tickers').textContent = data.unique_tickers || '0';

    // Cost
    let total = 0;
    for (const [model, count] of Object.entries(data.by_model || {})) {
        const c = costFor(count, model);
        if (c !== null) total += c;
    }
    el('m-cost').textContent = total > 0 ? `$${total.toFixed(2)}` : '$0.00';
}

function renderModelBreakdown(data) {
    const container = document.getElementById('model-breakdown');
    const entries = Object.entries(data.by_model || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        container.textContent = 'No data';
        return;
    }
    const max = entries[0][1];
    // Trusted backend data rendered as layout HTML
    container.innerHTML = entries.map(([model, count]) => {
        const pct = ((count / data.total_calls) * 100).toFixed(1);
        const barPct = (count / max) * 100;
        const fam = modelFamily(model);
        return `<div class="model-row">
            <div class="model-info">
                <div class="name"><span class="model-dot ${esc(fam)}"></span>${esc(model)}</div>
                <div class="count">${fmt(count)} calls</div>
            </div>
            <div class="model-bar-track">
                <div class="model-bar-fill ${esc(fam)}" style="width:${barPct}%"></div>
            </div>
            <div class="model-pct">${pct}%</div>
        </div>`;
    }).join('');
}

function renderServiceBreakdown(data) {
    const container = document.getElementById('service-breakdown');
    renderSimpleTable(container, data.by_service, data.total_calls);
}

function renderEndpointBreakdown(data) {
    const container = document.getElementById('endpoint-breakdown');
    renderComponentTable(container, data.by_component, data.total_calls);
}

function renderSimpleTable(container, map, total) {
    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        container.textContent = 'No data';
        return;
    }
    // Trusted backend data
    container.innerHTML = `<table class="data-table">
        <thead><tr><th>Name</th><th class="r">Calls</th><th class="r">%</th></tr></thead>
        <tbody>${entries.map(([k, v]) => `<tr>
            <td class="model-name">${esc(k)}</td>
            <td class="r">${fmt(v)}</td>
            <td class="r dim-val">${((v / total) * 100).toFixed(1)}%</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function renderComponentTable(container, map, total) {
    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        container.textContent = 'No data';
        return;
    }

    // Partition into crypto and stocks
    const cryptoEntries = [];
    const stockEntries = [];

    for (const [name, count] of entries) {
        if (name.startsWith('crypto_')) {
            cryptoEntries.push([name, count]);
        } else {
            stockEntries.push([name, count]);
        }
    }

    // Build table with section headers
    let rows = '';

    // Stocks section
    if (stockEntries.length > 0) {
        rows += `<tr style="border-bottom:1px solid var(--border)"><td colspan="3" style="padding-top:12px;padding-bottom:8px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;">Stocks</td></tr>`;
        rows += stockEntries.map(([k, v]) => `<tr>
            <td class="model-name">${esc(k)}</td>
            <td class="r">${fmt(v)}</td>
            <td class="r dim-val">${((v / total) * 100).toFixed(1)}%</td>
        </tr>`).join('');
    }

    // Crypto section
    if (cryptoEntries.length > 0) {
        rows += `<tr style="border-bottom:1px solid var(--border)"><td colspan="3" style="padding-top:12px;padding-bottom:8px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;">Crypto</td></tr>`;
        rows += cryptoEntries.map(([k, v]) => `<tr>
            <td class="model-name">${esc(k)}</td>
            <td class="r">${fmt(v)}</td>
            <td class="r dim-val">${((v / total) * 100).toFixed(1)}%</td>
        </tr>`).join('');
    }

    // Trusted backend data
    container.innerHTML = `<table class="data-table">
        <thead><tr><th>Name</th><th class="r">Calls</th><th class="r">%</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function renderHourly(data) {
    const container = document.getElementById('hourly-chart');
    const hours = data.hourly_calls || new Array(24).fill(0);
    const max = Math.max(...hours, 1);
    // Trusted backend data
    container.innerHTML = hours.map((c, i) => {
        const pct = (c / max) * 100;
        const lbl = i.toString().padStart(2, '0');
        return `<div class="h-bar-wrap">
            <div class="h-tooltip">${esc(lbl)}:00 — ${fmt(c)}</div>
            <div class="h-bar" style="height:${Math.max(pct, 1)}%"></div>
            <span class="h-label">${i % 3 === 0 ? esc(lbl) : ''}</span>
        </div>`;
    }).join('');
}

function renderTickers(data) {
    const section = document.getElementById('tickers-section');
    const container = document.getElementById('ticker-grid');
    const badge = document.getElementById('ticker-count');
    const tickers = data.top_tickers || [];

    badge.textContent = `${data.unique_tickers || 0} unique`;

    if (!tickers.length) {
        container.textContent = 'No ticker data yet — will populate after deploy.';
        return;
    }

    // Trusted backend data
    container.innerHTML = '';
    container.className = 'ticker-grid';
    container.innerHTML = tickers.map(t => {
        const mods = Object.entries(t.models || {})
            .map(([m, c]) => `${esc(m.replace('gpt-5-mini','g5m').replace('claude-opus-4-6','opus'))}: ${c}`)
            .join(' · ');
        return `<div class="ticker-chip">
            <span class="symbol">${esc(t.ticker)}</span>
            <span class="calls">${fmt(t.calls)} calls</span>
            <span class="models-list">${mods}</span>
        </div>`;
    }).join('');
}

function renderCost(data) {
    const currentEl = document.getElementById('cost-current');
    const whatIfEl = document.getElementById('cost-whatif');
    const noteEl = document.getElementById('cost-note');

    noteEl.textContent = `~${fmt(TOK_IN)} input + ~${fmt(TOK_OUT)} output tokens/call`;

    const byModel = data.by_model || {};
    let currentTotal = 0;

    // Current cost table (trusted backend data)
    const currentRows = Object.entries(byModel)
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => {
            const cost = costFor(count, model);
            if (cost !== null) currentTotal += cost;
            const fam = modelFamily(model);
            return `<tr>
                <td><span class="model-dot ${esc(fam)}"></span><span class="model-name">${esc(model)}</span></td>
                <td class="r">${fmt(count)}</td>
                <td class="r">${cost !== null ? '$' + cost.toFixed(2) : '—'}</td>
            </tr>`;
        }).join('');

    currentEl.innerHTML = `<table class="data-table">
        <thead><tr><th>Model</th><th class="r">Calls</th><th class="r">Cost</th></tr></thead>
        <tbody>${currentRows}</tbody>
        <tfoot><tr>
            <td style="border-top:1px solid var(--border);font-weight:600;">Total</td>
            <td class="r" style="border-top:1px solid var(--border)">${fmt(data.total_calls)}</td>
            <td class="r" style="border-top:1px solid var(--border);font-weight:600;">$${currentTotal.toFixed(2)}</td>
        </tr></tfoot>
    </table>`;

    // What-if table
    const total = data.total_calls;
    const whatIfRows = Object.entries(MODELS).map(([key, m]) => {
        const cost = costFor(total, key);
        const diff = cost - currentTotal;
        const cls = diff > 0 ? 'cost-up' : 'cost-down';
        const sign = diff > 0 ? '+' : '-';
        const fam = m.fam;
        return `<tr>
            <td><span class="model-dot ${esc(fam)}"></span><span class="model-name">${esc(m.label)}</span></td>
            <td class="r">$${cost.toFixed(2)}</td>
            <td class="r ${cls}">${sign}$${Math.abs(diff).toFixed(2)}</td>
        </tr>`;
    }).join('');

    whatIfEl.innerHTML = `<table class="data-table">
        <thead><tr><th>If all ${fmt(total)} calls used</th><th class="r">Cost</th><th class="r">vs Now</th></tr></thead>
        <tbody>${whatIfRows}</tbody>
    </table>`;
}

function renderWeekly(days) {
    const container = document.getElementById('weekly-chart');
    const badge = document.getElementById('week-total');

    if (!days || !days.length) {
        container.textContent = 'No weekly data.';
        return;
    }

    const total = days.reduce((s, d) => s + d.total_calls, 0);
    badge.textContent = `${fmt(total)} total`;

    const max = Math.max(...days.map(d => d.total_calls), 1);
    // Trusted backend data
    container.innerHTML = days.map(d => {
        const pct = (d.total_calls / max) * 100;
        const label = d.date.slice(5); // "04-10"
        const day = dayName(d.date);
        return `<div class="w-bar-wrap">
            <span class="w-count">${d.total_calls > 0 ? fmt(d.total_calls) : ''}</span>
            <div class="w-bar" style="height:${Math.max(pct, 2)}%"></div>
            <span class="w-label">${esc(label)}</span>
            <span class="w-day">${esc(day)}</span>
        </div>`;
    }).join('');
}

// ── Scanner Report ────────────────────────────────────────────────────────

const IMPACT_COLORS = { high: 'var(--negative)', moderate: 'var(--warning)', low: 'var(--text-tertiary)' };
const SENTIMENT_ICONS = { bullish: '+', bearish: '-', mixed: '~' };

function renderCatalysts(data) {
    const container = document.getElementById('catalyst-list');
    const badge = document.getElementById('catalyst-count');
    const catalysts = data.catalysts || [];

    badge.textContent = `${catalysts.length} detected`;

    if (!catalysts.length) {
        container.textContent = 'No catalysts detected.';
        return;
    }

    // Trusted backend data
    container.innerHTML = `<div class="catalyst-entries">${catalysts.map(c => {
        const impactColor = IMPACT_COLORS[c.impact] || 'var(--text-tertiary)';
        const sentIcon = SENTIMENT_ICONS[c.sentiment] || '?';
        return `<div class="catalyst-entry">
            <div class="catalyst-meta">
                <span class="catalyst-time">${esc(c.detected_at)}</span>
                <span class="catalyst-impact" style="color:${impactColor}">${esc(c.impact)}</span>
                <span class="catalyst-category">${esc(c.category)}</span>
                <span class="catalyst-sentiment">${esc(sentIcon)} ${esc(c.sentiment)}</span>
            </div>
            <div class="catalyst-text">${esc(c.catalyst)}</div>
        </div>`;
    }).join('')}</div>`;
}

function renderTickerScans(data) {
    const container = document.getElementById('ticker-scan-list');
    const badge = document.getElementById('scan-count');
    const scans = data.ticker_scans || [];

    badge.textContent = `${data.total_scans || 0} scans / ${data.unique_tickers || 0} unique`;

    if (!scans.length) {
        container.textContent = 'No ticker scans recorded yet.';
        return;
    }

    // Group by ticker, show most recent scan time + source
    const byTicker = {};
    for (const s of scans) {
        if (!byTicker[s.ticker]) {
            byTicker[s.ticker] = { count: 0, models: {}, sources: {}, lastTime: s.time };
        }
        byTicker[s.ticker].count++;
        byTicker[s.ticker].models[s.model] = (byTicker[s.ticker].models[s.model] || 0) + 1;
        if (s.source) byTicker[s.ticker].sources[s.source] = (byTicker[s.ticker].sources[s.source] || 0) + 1;
    }

    // Sort by latest scan time (descending)
    const sorted = Object.entries(byTicker).sort((a, b) => b[1].lastTime.localeCompare(a[1].lastTime));

    const LIMIT = 50;
    const needsToggle = sorted.length > LIMIT;

    // Trusted backend data — build all rows, hide extras
    const allRows = sorted.map(([ticker, info], i) => {
        const modelStr = Object.entries(info.models)
            .map(([m, c]) => c > 1 ? `${esc(m)} x${c}` : esc(m))
            .join(', ');
        const sourceStr = Object.keys(info.sources).map(s => esc(s)).join(', ') || '—';
        const hidden = i >= LIMIT ? ' class="scan-expandable" style="display:none"' : '';
        return `<tr${hidden}>
            <td class="model-name">${esc(ticker)}</td>
            <td><span class="source-tag">${sourceStr}</span></td>
            <td class="r">${info.count}</td>
            <td class="dim-val">${modelStr}</td>
            <td class="r dim-val">${esc(info.lastTime)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `<table class="data-table">
        <thead><tr><th>Ticker</th><th>Source</th><th class="r">Scans</th><th>Model</th><th class="r">Last</th></tr></thead>
        <tbody>${allRows}</tbody>
    </table>${needsToggle ? `<button class="expand-toggle" onclick="toggleScanRows(this)">Show all ${sorted.length} tickers</button>` : ''}`;
}

function toggleScanRows(btn) {
    const rows = btn.previousElementSibling.querySelectorAll('.scan-expandable');
    const expanding = rows[0] && rows[0].style.display === 'none';
    rows.forEach(r => r.style.display = expanding ? '' : 'none');
    btn.textContent = expanding ? `Show top 50` : `Show all ${rows.length + 50} tickers`;
}

// ── Web Search Catalyst Stats ──────────────────────────────────────────────

function renderWebSearchStats(data) {
    const container = document.getElementById('web-search-stats');
    const badge = document.getElementById('web-search-count');
    const calls = data.web_search_llm_calls || 0;

    badge.textContent = calls + ' LLM calls';

    // Count tickers discovered via web search from the ticker scans
    const webTickers = (data.ticker_scans || []).filter(s => s.source === 'web_search');
    const uniqueWebTickers = new Set(webTickers.map(t => t.ticker)).size;

    while (container.firstChild) container.removeChild(container.firstChild);

    if (calls === 0 && webTickers.length === 0) {
        const msg = document.createElement('span');
        msg.className = 'dim-val';
        msg.textContent = 'No web search activity yet. Source runs every 10min (market) / 2h (overnight).';
        container.appendChild(msg);
        return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:8px 0';

    [['LLM Calls', calls], ['Tickers Found', uniqueWebTickers], ['Scans Triggered', webTickers.length]].forEach(([label, value]) => {
        const cell = document.createElement('div');
        const lbl = document.createElement('div');
        lbl.className = 'dim-val';
        lbl.style.cssText = 'font-size:11px;margin-bottom:4px';
        lbl.textContent = label;
        const val = document.createElement('div');
        val.style.cssText = 'font-size:24px;font-weight:700;font-family:var(--mono)';
        val.textContent = value;
        cell.appendChild(lbl);
        cell.appendChild(val);
        grid.appendChild(cell);
    });

    container.appendChild(grid);
}

// ── Main loop ─────────────────────────────────────────────────────────────

async function refresh() {
    try {
        const [today, week, scanner] = await Promise.all([fetchToday(), fetchWeek(), fetchScanner()]);

        renderHero(today);
        renderModelBreakdown(today);
        renderServiceBreakdown(today);
        renderEndpointBreakdown(today);
        renderHourly(today);
        renderTickers(today);
        renderCost(today);
        renderWeekly(week);
        renderCatalysts(scanner);
        renderTickerScans(scanner);
        renderWebSearchStats(scanner);

        const now = new Date();
        document.getElementById('last-updated').textContent = selectedDate
            ? `Viewing ${selectedDate}`
            : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

        // Live dot: visible only when viewing today
        const dot = document.getElementById('live-dot');
        if (dot) dot.style.display = selectedDate ? 'none' : '';
    } catch (err) {
        console.error('Dashboard refresh failed:', err);
        document.getElementById('last-updated').textContent = 'Error';
    }
}

// ── Date picker ───────────────────────────────────────────────────────────

function todayET() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function initDatePicker() {
    const picker = document.getElementById('date-picker');
    const today = todayET();
    picker.value = today;
    picker.max = today;

    picker.addEventListener('change', () => {
        const val = picker.value;
        selectedDate = val === todayET() ? null : val;
        refresh();
    });

    document.getElementById('date-prev').addEventListener('click', () => {
        const current = picker.value || todayET();
        const prev = shiftDate(current, -1);
        picker.value = prev;
        selectedDate = prev === todayET() ? null : prev;
        refresh();
    });

    document.getElementById('date-next').addEventListener('click', () => {
        const current = picker.value || todayET();
        const next = shiftDate(current, 1);
        const today = todayET();
        if (next > today) return; // don't go past today
        picker.value = next;
        selectedDate = next === today ? null : next;
        refresh();
    });

    document.getElementById('date-today').addEventListener('click', () => {
        picker.value = todayET();
        selectedDate = null;
        refresh();
    });
}

// ── Init ──────────────────────────────────────────────────────────────────

let refreshTimer = null;

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        if (!selectedDate) refresh(); // only auto-refresh when viewing today
    }, REFRESH_MS);
}

function stopAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
}

// ── Tab switching ─────────────────────────────────────────────────────────

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabIds = ['tab-llm-usage', 'tab-api-usage', 'tab-system-health'];
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            tabIds.forEach(id => {
                document.getElementById(id).style.display = id === 'tab-' + tabId ? '' : 'none';
            });
            if (tabId === 'system-health') fetchWSStatus();
            if (tabId === 'api-usage') fetchAPIUsage();
        });
    });
}

// ── API Usage tab ───────────────────────────────────────────────────────

// Brave Search pricing: $5 per 1,000 requests
const BRAVE_COST_PER_REQUEST = 0.005;

async function fetchAPIUsage() {
    try {
        const dateParam = selectedDate ? `&date=${selectedDate}` : '';
        const r = await fetch(`${API}/api?t=${Date.now()}${dateParam}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderAPIUsage(data);
    } catch (e) {
        console.error('API usage fetch failed:', e);
    }
}

function renderAPIUsage(data) {
    // Hero metrics
    const el = (id) => document.getElementById(id);
    el('api-total-calls').textContent = data.total_calls || 0;
    el('api-brave-news').textContent = (data.by_api && data.by_api['brave_news_search']) || 0;
    el('api-brave-sentiment').textContent = (data.by_api && data.by_api['brave_sentiment']) || 0;

    const totalBrave = ((data.by_api && data.by_api['brave_news_search']) || 0) +
                       ((data.by_api && data.by_api['brave_sentiment']) || 0);
    const cost = (totalBrave * BRAVE_COST_PER_REQUEST).toFixed(2);
    el('api-est-cost').textContent = '$' + cost;

    // Hourly chart — build with DOM methods
    const hourlyEl = el('api-hourly-chart');
    hourlyEl.textContent = '';
    if (data.hourly_calls) {
        const max = Math.max(...data.hourly_calls, 1);
        data.hourly_calls.forEach((v, i) => {
            const col = document.createElement('div');
            col.className = 'chart-bar-col';
            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            bar.style.height = ((v / max) * 100) + '%';
            bar.title = i.toString().padStart(2, '0') + ':00 — ' + v + ' calls';
            col.appendChild(bar);
            const label = document.createElement('span');
            label.className = 'chart-label';
            label.textContent = i % 3 === 0 ? i.toString().padStart(2, '0') : '';
            col.appendChild(label);
            hourlyEl.appendChild(col);
        });
    } else {
        hourlyEl.textContent = 'No data';
    }

    // Top tickers — build with DOM methods
    const tickerEl = el('api-top-tickers');
    tickerEl.textContent = '';
    if (data.top_tickers && data.top_tickers.length > 0) {
        data.top_tickers.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = t.ticker + ' ';
            const count = document.createElement('span');
            count.className = 'dim';
            count.textContent = t.calls;
            chip.appendChild(count);
            tickerEl.appendChild(chip);
        });
    } else {
        tickerEl.textContent = 'No ticker data yet';
    }
}

// ── WebSocket health ──────────────────────────────────────────────────────

async function fetchWSStatus() {
    try {
        const headers = {};
        if (INTERNAL_API_TOKEN) headers['X-Internal-Token'] = INTERNAL_API_TOKEN;
        const r = await fetch(`${API_BASE}/api/internal/ws-status?t=${Date.now()}`, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderWSStatus(data);
        const badge = document.getElementById('ws-status-badge');
        if (badge) badge.textContent = data.healthy ? 'Connected' : 'Disconnected';
    } catch (err) {
        console.error('WS status fetch failed:', err);
        const el = document.getElementById('ws-status-content');
        if (el) {
            el.textContent = '';
            const msg = document.createElement('span');
            msg.style.color = 'var(--text-tertiary)';
            msg.textContent = 'Failed to load WebSocket status.';
            el.appendChild(msg);
        }
        const badge = document.getElementById('ws-status-badge');
        if (badge) badge.textContent = 'Error';
    }
}

function renderWSStatus(data) {
    const el = document.getElementById('ws-status-content');
    if (!el) return;
    el.textContent = '';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;';

    function addMetric(label, value, valueColor) {
        const cell = document.createElement('div');
        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-family:var(--font-body);font-weight:500;';
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.style.cssText = `color:${valueColor || 'var(--text-primary)'};font-size:22px;font-weight:700;letter-spacing:-0.03em;font-variant-numeric:tabular-nums;line-height:1;`;
        valueEl.textContent = value;
        cell.appendChild(labelEl);
        cell.appendChild(valueEl);
        grid.appendChild(cell);
    }

    const dot = data.healthy ? '\u{1F7E2}' : '\u{1F534}';
    const statusText = data.healthy ? 'Connected' : 'Disconnected';
    let uptime = '';
    if (data.connected_since) {
        const mins = Math.floor((Date.now() - new Date(data.connected_since).getTime()) / 60000);
        if (mins < 60) {
            uptime = ` ${mins}m`;
        } else {
            const hrs = Math.floor(mins / 60);
            const rem = mins % 60;
            uptime = rem > 0 ? ` ${hrs}h ${rem}m` : ` ${hrs}h`;
        }
    }
    addMetric('Status', `${dot} ${statusText}${uptime}`, data.healthy ? 'var(--positive)' : 'var(--negative)');
    addMetric('Bars/sec', (data.bars_per_sec || 0).toFixed(1));
    addMetric('Cache Size', (data.cache_size || 0).toLocaleString());
    addMetric('Bars Today', (data.bars_received || 0).toLocaleString());
    addMetric('Catalyst Triggers', String(data.catalyst_triggers_today || 0));
    addMetric('Tripwires Fired', String(data.tripwires_fired_today || 0));
    addMetric('Reconnects', String(data.reconnect_count || 0));
    addMetric('24h Uptime', (data.uptime_pct_24h || 0).toFixed(1) + '%');

    el.appendChild(grid);

    // Last bar / disconnect timestamps as a footer note
    if (data.last_bar_at || data.last_disconnect) {
        const footer = document.createElement('div');
        footer.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--text-quaternary);font-family:var(--font-mono);display:flex;gap:24px;flex-wrap:wrap;';
        if (data.last_bar_at) {
            const span = document.createElement('span');
            span.textContent = 'Last bar: ' + new Date(data.last_bar_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
            footer.appendChild(span);
        }
        if (data.last_disconnect) {
            const span = document.createElement('span');
            span.textContent = 'Last disconnect: ' + new Date(data.last_disconnect).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
            footer.appendChild(span);
        }
        el.appendChild(footer);
    }
}

let wsStatusTimer = null;

function startWSStatusPolling() {
    if (wsStatusTimer) clearInterval(wsStatusTimer);
    wsStatusTimer = setInterval(() => {
        // Only poll when system-health tab is active
        const tab = document.querySelector('.tab[data-tab="system-health"]');
        if (tab && tab.classList.contains('active')) fetchWSStatus();
    }, WS_STATUS_REFRESH_MS);
}

// ── Init ──────────────────────────────────────────────────────────────────

initDatePicker();
initTabs();
refresh();
startAutoRefresh();
startWSStatusPolling();
