// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish LLM Usage Dashboard
// ═══════════════════════════════════════════════════════════════════════════

const API = 'https://api.vibebullish.com/api/llm-usage';
const REFRESH_MS = 60_000;
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
    renderSimpleTable(container, data.by_component, data.total_calls);
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

initDatePicker();
refresh();
startAutoRefresh();
