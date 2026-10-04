// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish LLM Usage Dashboard
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: this is a public static site — it must NEVER embed INTERNAL_API_TOKEN
// (the backend admin secret), and no script under js/ calls the backend
// directly. Every data read of the six signed-in tabs goes through
// VBReads.get() (js/reads.js) → the admin-verified proxy /api/ops/reads.
const REFRESH_MS = 60_000;
const WS_STATUS_REFRESH_MS = 30_000;
let selectedDate = null; // null = today (live), string = 'YYYY-MM-DD'

// ── Tab controller: the six recovered, signed-in tabs ─────────────────────
//
// ONE activation path for a tab click, the transition to admin, a date or
// filter change, and the per-tab poll timer. Scoped to the tabs that register
// here (LLM Usage, System Health, Action Engine, Quant Quality, Data
// Collector, Catalyst Accuracy). The Agents tab and the admin ops tabs keep
// their own listeners, timers and dispatches (js/agent-ops.js,
// js/ops-console.js, js/r4-audit.js) — this controller never touches them.
//
// Every load runs under a context {tab, seq, gen}; a result is rendered only
// while ctx.live(): same request sequence (no newer load/reload/departure),
// same auth generation, still admin, and the tab still active. Leaving admin
// stops the timer, invalidates in-flight loads, clears all six tabs' data and
// shows the sign-in gate; access returns only through vb-auth-change → admin.
const VBTabs = (function () {
    const defs = Object.create(null);
    const seq = Object.create(null);
    let active = null;
    let timer = null;

    const isAdmin = () => !!(window.VBAuth && window.VBAuth.isAdmin);
    const gen = () => (window.VBAuth && typeof window.VBAuth.gen === 'number') ? window.VBAuth.gen : 0;

    function gateMessage() {
        const st = window.VBAuth ? window.VBAuth.state : 'loading';
        if (st === 'not_admin') return 'Signed in, but this account is not an admin. This tab stays closed.';
        if (st === 'unconfigured') return 'Sign-in is not configured on this deployment, so this tab stays closed.';
        if (st === 'checking') return 'Checking admin access…';
        if (st === 'verify_failed') return 'Could not verify admin access. Retry from the header.';
        return window.VBReads ? window.VBReads.SIGN_IN_MESSAGE : 'Sign in with an admin Google account to view this tab.';
    }

    function setGate(tab, gated) {
        const panel = document.getElementById('tab-' + tab);
        if (!panel) return;
        panel.classList.toggle('vb-gated', gated);
        const gate = panel.querySelector('.vb-gate');
        if (gate) {
            gate.textContent = gated ? gateMessage() : '';
            gate.hidden = !gated;
        }
    }

    function stopTimer() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function ctxFor(tab) {
        const s = ++seq[tab];
        const g = gen();
        return {
            tab, seq: s, gen: g,
            live: () => seq[tab] === s && gen() === g && isAdmin() && active === tab,
        };
    }

    function run(tab, def) {
        const ctx = ctxFor(tab);
        Promise.resolve().then(() => def.load(ctx)).catch(err => console.error(tab + ' load failed:', err));
    }

    function startTimer(tab, def) {
        stopTimer();
        if (!def.intervalMs) return;
        timer = setInterval(() => {
            if (!isAdmin() || active !== tab) { stopTimer(); return; }
            if (def.pollWhen && !def.pollWhen()) return;
            run(tab, def);
        }, def.intervalMs);
    }

    function show(tab) {
        const def = defs[tab];
        if (!def) return;
        if (!isAdmin()) {
            stopTimer();
            seq[tab]++;
            def.clear();
            setGate(tab, true);
            return;
        }
        setGate(tab, false);
        run(tab, def);
        startTimer(tab, def);
    }

    // register(tab, {load(ctx), clear(), intervalMs?, pollWhen?()})
    function register(tab, def) {
        defs[tab] = def;
        if (!(tab in seq)) seq[tab] = 0;
        if (active === tab) show(tab);
        else setGate(tab, !isAdmin());
    }

    function activate(tab) {
        if (active && active !== tab && defs[active]) seq[active]++; // departing tab: in-flight results are dropped
        active = tab;
        stopTimer();
        if (defs[tab]) show(tab);
    }

    function reload(tab) {
        const t = tab || active;
        if (t && t === active && defs[t]) show(t);
    }

    function onAuthChange() {
        if (isAdmin()) {
            if (active && defs[active]) show(active);
            return;
        }
        stopTimer();
        for (const t in defs) {
            seq[t]++;
            defs[t].clear();
            setGate(t, true);
        }
    }
    window.addEventListener('vb-auth-change', onAuthChange);

    return { register, activate, reload, active: () => active, isAdmin };
})();
window.VBTabs = VBTabs;

// Per-model cost ($/1K tokens)
// DeepSeek prices from https://api-docs.deepseek.com/quick_start/pricing
// (fetched 2026-06-10; cache-miss input rates). `deepseek-chat` /
// `deepseek-reasoner` are legacy aliases of deepseek-v4-flash (deprecated
// upstream 2026-07-24) that may still appear in older llm_call_log rows;
// the backend canonicalizes new calls to deepseek-v4-flash / deepseek-v4-pro.
const MODELS = {
    'gpt-5-mini':         { input: 0.00030,  output: 0.00120, label: 'GPT-5 Mini',          fam: 'gpt' },
    'gpt-4o':             { input: 0.00250,  output: 0.01000, label: 'GPT-4o',              fam: 'gpt' },
    'gpt-4o-mini':        { input: 0.00015,  output: 0.00060, label: 'GPT-4o Mini',         fam: 'gpt' },
    'claude-opus-4-7':    { input: 0.00500,  output: 0.02500, label: 'Claude Opus 4.7',     fam: 'claude' },
    'claude-sonnet-4-6':  { input: 0.00300,  output: 0.01500, label: 'Claude Sonnet 4.6',   fam: 'claude' },
    'claude-haiku-4-5':   { input: 0.00080,  output: 0.00400, label: 'Claude Haiku 4.5',    fam: 'claude' },
    // R4 news-label-audit panel judges (offline research runs, component r4_panel_*).
    // List prices 2026-09-25: Astra $10/$50 per M, Opus 5.5 $4/$20 per M. Compared
    // with the cost calculated from the 2026-09-25 run's recorded token usage at the
    // applicable rates (402 calls each; NOT reconciled to provider billing): the flat
    // 2000/500 estimate is 8.8x for Astra ($18.09 vs $2.07 — 93% of its input was
    // cache-hit at $1/M) and 1.7x for Opus 5.5 ($7.24 vs $4.31). Still an ESTIMATE;
    // llm_call_log carries no token counts.
    'gpt-6-astra':        { input: 0.01000,  output: 0.05000, label: 'GPT-6 Astra',         fam: 'gpt' },
    'claude-opus-5-5':    { input: 0.00400,  output: 0.02000, label: 'Claude Opus 5.5',     fam: 'claude' },
    // deepseek-flash = DeepSeek-V4.1-Flash, the backend worker since 2026-09-29 (DeepSeek retired
    // V4-Flash 2026-09-10; the legacy name is only temporarily routed). Priced at the PEAK cache-miss
    // rates fetched 2026-09-29 ($0.30 in / $1.20 out per M; off-peak is half) — an upper bound.
    // Mirrors backend internal/services/llm_cost_model.go (one cost model, change both together).
    'deepseek-flash':     { input: 0.00030,  output: 0.00120, label: 'DeepSeek V4.1 Flash (peak rate)', fam: 'deepseek' },
    'deepseek-v4-flash':  { input: 0.00014,  output: 0.00028, label: 'DeepSeek V4 Flash',   fam: 'deepseek' },
    'deepseek-v4-pro':    { input: 0.000435, output: 0.00087, label: 'DeepSeek V4 Pro',     fam: 'deepseek' },
    'deepseek-chat':      { input: 0.00014,  output: 0.00028, label: 'DeepSeek Chat (legacy alias)',     fam: 'deepseek', alias: true },
    'deepseek-reasoner':  { input: 0.00014,  output: 0.00028, label: 'DeepSeek Reasoner (legacy alias)', fam: 'deepseek', alias: true },
};
const TOK_IN = 2000, TOK_OUT = 500;

// esc() is the shared attribute-safe escaper from js/reads.js.

function fmt(n) {
    const v = VBReads.num(n);
    return v === null ? '—' : v.toLocaleString();
}

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

// ── LLM Usage: load / clear / unavailable ─────────────────────────────────

const LLM_REGIONS = ['model-breakdown', 'hourly-chart', 'service-breakdown', 'endpoint-breakdown',
    'ticker-grid', 'weekly-chart', 'web-search-stats', 'cost-current', 'cost-whatif'];
const LLM_METRICS = ['m-total', 'm-models', 'm-tickers', 'm-cost'];

// The LLM date is snapshotted per load: today + scanner take it, week never
// does, and a result for a date the user has since left is dropped by ctx.
async function loadLLMUsage(ctx) {
    const date = selectedDate;
    const [today, week, scanner] = await Promise.all([
        VBReads.get('llm-today', { date }),
        VBReads.get('llm-week'),
        VBReads.get('llm-scanner', { date }),
    ]);
    if (!ctx.live()) return;
    const failed = [today, week, scanner].find(r => !r.ok);
    if (failed) {
        renderLLMUnavailable(failed.kind, failed.message);
        return;
    }
    try {
        renderHero(today.body, date);
        renderModelBreakdown(today.body);
        renderServiceBreakdown(today.body);
        renderEndpointBreakdown(today.body);
        renderHourly(today.body);
        renderTickers(today.body);
        renderCost(today.body);
        renderWeekly(week.body);
        renderWebSearchStats(scanner.body);
    } catch (err) {
        console.error('LLM usage render failed:', err);
        renderLLMUnavailable('upstream_error', 'The backend payload could not be rendered.');
        return;
    }
    const now = new Date();
    document.getElementById('last-updated').textContent = date
        ? `Viewing ${date}`
        : now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.display = date ? 'none' : '';
}

// Explicit state: a backend outage must not look like a zero-usage day, and
// numbers from a previous load must not survive a failure.
function renderLLMUnavailable(kind, message) {
    clearLLMUsage(); // summary badges (week total, ticker count, …) must not outlive the failure
    LLM_REGIONS.forEach(id => VBReads.unavailable(document.getElementById(id), kind, message));
    const lu = document.getElementById('last-updated');
    if (lu) lu.textContent = kind === 'unauthenticated' || kind === 'forbidden' ? 'Sign in required' : 'Error — backend unavailable';
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.display = 'none';
}

function clearLLMUsage() {
    LLM_METRICS.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    ['m-date', 'week-total', 'ticker-count', 'web-search-count', 'cost-note'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '';
    });
    LLM_REGIONS.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    const lu = document.getElementById('last-updated');
    if (lu) lu.textContent = 'Signed out';
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.display = 'none';
}

// ── Renderers ─────────────────────────────────────────────────────────────

function renderHero(data, date) {
    const el = (id) => document.getElementById(id);
    el('m-total').textContent = VBReads.num(data.total_calls) ? fmt(data.total_calls) : '0';
    el('m-date').textContent = String(data.date || '');
    el('m-total-label').textContent = date ? `Total Calls` : 'Total Calls Today';
    el('m-models').textContent = Object.keys(data.by_model || {}).length;
    el('m-tickers').textContent = VBReads.num(data.unique_tickers) === null ? '0' : fmt(data.unique_tickers);

    // Cost — surface unpriced models loudly so a missing MODELS entry
    // (which understates the headline) is self-revealing.
    let total = 0;
    let unpriced = 0;
    for (const [model, count] of Object.entries(data.by_model || {})) {
        const c = costFor(VBReads.num(count) || 0, model);
        if (c === null) unpriced++;
        else total += c;
    }
    el('m-cost').textContent = `$${total.toFixed(2)}`;
    el('m-cost-label').textContent = unpriced > 0
        ? `Est. Cost (${unpriced} model${unpriced === 1 ? '' : 's'} unpriced!)`
        : 'Est. Cost';
}

function renderModelBreakdown(data) {
    const container = document.getElementById('model-breakdown');
    const entries = Object.entries(data.by_model || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        container.textContent = 'No data';
        return;
    }
    const max = VBReads.num(entries[0][1]) || 1;
    const totalCalls = VBReads.num(data.total_calls) || 1;
    container.innerHTML = entries.map(([model, countRaw]) => {
        const count = VBReads.num(countRaw) || 0;
        const pct = ((count / totalCalls) * 100).toFixed(1);
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

function pctOf(v, total) {
    const n = VBReads.num(v), t = VBReads.num(total);
    return n === null || !t ? '—' : ((n / t) * 100).toFixed(1) + '%';
}

function renderSimpleTable(container, map, total) {
    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        container.textContent = 'No data';
        return;
    }
    container.innerHTML = `<table class="data-table">
        <thead><tr><th>Name</th><th class="r">Calls</th><th class="r">%</th></tr></thead>
        <tbody>${entries.map(([k, v]) => `<tr>
            <td class="model-name">${esc(k)}</td>
            <td class="r">${fmt(v)}</td>
            <td class="r dim-val">${pctOf(v, total)}</td>
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
            <td class="r dim-val">${pctOf(v, total)}</td>
        </tr>`).join('');
    }

    // Crypto section
    if (cryptoEntries.length > 0) {
        rows += `<tr style="border-bottom:1px solid var(--border)"><td colspan="3" style="padding-top:12px;padding-bottom:8px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;">Crypto</td></tr>`;
        rows += cryptoEntries.map(([k, v]) => `<tr>
            <td class="model-name">${esc(k)}</td>
            <td class="r">${fmt(v)}</td>
            <td class="r dim-val">${pctOf(v, total)}</td>
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
    const hours = (Array.isArray(data.hourly_calls) ? data.hourly_calls : new Array(24).fill(0))
        .map(c => VBReads.num(c) || 0);
    const max = Math.max(...hours, 1);
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

    badge.textContent = `${fmt(data.unique_tickers || 0)} unique`;

    if (!tickers.length) {
        container.textContent = 'No ticker data yet — will populate after deploy.';
        return;
    }

    // Trusted backend data
    container.innerHTML = '';
    container.className = 'ticker-grid';
    container.innerHTML = tickers.map(t => {
        const mods = Object.entries(t.models || {})
            .map(([m, c]) => `${esc(String(m).replace('gpt-5-mini','g5m').replace('claude-opus-4-7','opus'))}: ${fmt(c)}`)
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
        .map(([model, countRaw]) => {
            const count = VBReads.num(countRaw) || 0;
            const cost = costFor(count, model);
            if (cost !== null) currentTotal += cost;
            const fam = modelFamily(model);
            return `<tr>
                <td><span class="model-dot ${esc(fam)}"></span><span class="model-name">${esc(model)}</span></td>
                <td class="r">${fmt(count)}</td>
                <td class="r">${cost !== null ? '$' + cost.toFixed(2) : '<span style="color:var(--warning,#FBBF24)">n/a (unpriced)</span>'}</td>
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

    // What-if table (skip legacy alias entries — same pricing as their canonical model)
    const total = VBReads.num(data.total_calls) || 0;
    const whatIfRows = Object.entries(MODELS).filter(([, m]) => !m.alias).map(([key, m]) => {
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

    badge.textContent = '';
    if (!Array.isArray(days) || !days.length) {
        container.textContent = 'No weekly data.';
        return;
    }

    const counts = days.map(d => VBReads.num(d.total_calls) || 0);
    const total = counts.reduce((s, c) => s + c, 0);
    badge.textContent = `${fmt(total)} total`;

    const max = Math.max(...counts, 1);
    container.innerHTML = days.map((d, i) => {
        const c = counts[i];
        const pct = (c / max) * 100;
        const label = String(d.date || '').slice(5); // "04-10"
        const day = dayName(String(d.date || ''));
        return `<div class="w-bar-wrap">
            <span class="w-count">${c > 0 ? fmt(c) : ''}</span>
            <div class="w-bar" style="height:${Math.max(pct, 2)}%"></div>
            <span class="w-label">${esc(label)}</span>
            <span class="w-day">${esc(day)}</span>
        </div>`;
    }).join('');
}

// ── Web Search Catalyst Stats ──────────────────────────────────────────────

function renderWebSearchStats(data) {
    const container = document.getElementById('web-search-stats');
    const badge = document.getElementById('web-search-count');
    const calls = VBReads.num(data.web_search_llm_calls) || 0;

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

// ── Date picker ───────────────────────────────────────────────────────────
//
// Every date control routes through VBTabs.reload('llm-usage'): the next load
// snapshots the new date, and the controller drops any in-flight result for
// the old one.

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
        VBTabs.reload('llm-usage');
    });

    document.getElementById('date-prev').addEventListener('click', () => {
        const current = picker.value || todayET();
        const prev = shiftDate(current, -1);
        picker.value = prev;
        selectedDate = prev === todayET() ? null : prev;
        VBTabs.reload('llm-usage');
    });

    document.getElementById('date-next').addEventListener('click', () => {
        const current = picker.value || todayET();
        const next = shiftDate(current, 1);
        const today = todayET();
        if (next > today) return; // don't go past today
        picker.value = next;
        selectedDate = next === today ? null : next;
        VBTabs.reload('llm-usage');
    });

    document.getElementById('date-today').addEventListener('click', () => {
        picker.value = todayET();
        selectedDate = null;
        VBTabs.reload('llm-usage');
    });
}

// ── Tab switching ─────────────────────────────────────────────────────────

function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    // Navigation covers all ten tabs. The ops-* tabs are admin-only: their
    // BUTTONS are hidden until /api/ops/whoami confirms an admin
    // (js/ops-console.js), but their sections must still be listed here so the
    // router can hide them like any other. The six signed-in tabs load through
    // VBTabs.activate; the Agents tab and the ops tabs keep their own
    // listeners and the dispatches below, exactly as before.
    const tabIds = ['tab-llm-usage', 'tab-system-health', 'tab-action-engine', 'tab-quant-quality', 'tab-data-collector', 'tab-catalyst-accuracy', 'tab-agent-ops', 'tab-ops-shadow', 'tab-ops-heartbeats', 'tab-ops-r4'];
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            tabIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = id === 'tab-' + tabId ? '' : 'none';
            });
            VBTabs.activate(tabId);
            if (tabId === 'ops-shadow' && window.OpsConsole) window.OpsConsole.loadShadow();
            if (tabId === 'ops-heartbeats' && window.OpsConsole) window.OpsConsole.loadHeartbeats();
            if (tabId === 'ops-r4' && window.R4Audit) window.R4Audit.load();
        });
    });
}

// ── Action Engine backtest tab ────────────────────────────────────────────

const AE_LOADING = '<div style="color:#999;padding:1rem">Loading…</div>';

// Stats and trend load in parallel: the trend no longer waits on the (slower,
// cached server-side) stats rollup. Calibration and the V2 stance / confidence
// band cards were removed 2026-09-15 — no decision has carried a v2_stance
// since 2026-05-26, so they could never show data.
const AE_STATS_REGIONS = ['ae-hero', 'ae-by-horizon', 'ae-by-trigger', 'ae-by-action-predicate', 'ae-recent'];

async function loadActionEngine(ctx) {
    for (const id of ['ae-by-horizon', 'ae-by-trigger', 'ae-by-action-predicate', 'ae-trend', 'ae-recent']) {
        const el = document.getElementById(id);
        if (el && !String(el.innerHTML || '').trim()) el.innerHTML = AE_LOADING;
    }
    await Promise.all([loadActionEngineStats(ctx), loadActionEngineTrend(ctx)]);
}

function aeStatsUnavailable(kind, message) {
    const f = document.getElementById('ae-freshness');
    if (f) f.textContent = '';
    AE_STATS_REGIONS.forEach(id => VBReads.unavailable(document.getElementById(id), kind, message));
}

async function loadActionEngineStats(ctx) {
    const r = await VBReads.get('ae-stats', { days: 30 });
    if (!ctx.live()) return;
    if (!r.ok) { aeStatsUnavailable(r.kind, r.message); return; }
    try {
        renderActionEngineBacktest(r.body);
    } catch (err) {
        console.error('Action engine stats render failed:', err);
        aeStatsUnavailable('upstream_error', 'The backend payload could not be rendered.');
    }
}

async function loadActionEngineTrend(ctx) {
    const r = await VBReads.get('ae-trend', { days: 7 });
    if (!ctx.live()) return;
    const summary = document.getElementById('ae-trend-summary');
    if (!r.ok) {
        if (summary) summary.textContent = '';
        VBReads.unavailable(document.getElementById('ae-trend'), r.kind, r.message);
        return;
    }
    try {
        renderActionEngineTrend(r.body);
    } catch (err) {
        console.error('Action engine trend render failed:', err);
        if (summary) summary.textContent = '';
        VBReads.unavailable(document.getElementById('ae-trend'), 'upstream_error', 'The backend payload could not be rendered.');
    }
}

function clearActionEngine() {
    ['ae-freshness', 'ae-trend-summary'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    [...AE_STATS_REGIONS, 'ae-trend'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
}

function renderActionEngineTrend(d) {
    const N = v => VBReads.num(v) || 0;
    const points = (Array.isArray(d.points) ? d.points : []).map(p => ({
        date: String(p.date || ''),
        n_decisions: N(p.n_decisions), n_resolved: N(p.n_resolved), n_graded: N(p.n_graded),
        hit_pct: N(p.hit_pct), baseline_pct: N(p.baseline_pct), avg_return_pct: N(p.avg_return_pct),
    }));
    const summaryEl = document.getElementById('ae-trend-summary');
    if (points.length === 0) {
        document.getElementById('ae-trend').innerHTML = '<div style="color:#999;padding:1rem">No data in window</div>';
        if (summaryEl) summaryEl.textContent = '';
        return;
    }
    // Header summary: total resolved + cumulative hit_pct over window
    let totalGraded = 0;
    let totalHits = 0;
    let totalBaseline = 0;
    for (const p of points) {
        const g = p.n_graded || 0;
        totalGraded += g;
        totalHits += g * (p.hit_pct / 100);
        totalBaseline += g * ((p.baseline_pct || 0) / 100);
    }
    const cumHitPct = totalGraded > 0 ? (totalHits / totalGraded) * 100 : 0;
    const cumBaseline = totalGraded > 0 ? (totalBaseline / totalGraded) * 100 : 0;
    if (summaryEl) {
        const edge = cumHitPct - cumBaseline;
        summaryEl.textContent = totalGraded > 0
            ? `${cumHitPct.toFixed(1)}% vs ${cumBaseline.toFixed(1)}% baseline (${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pp) over ${totalGraded} graded`
            : 'nothing graded in window';
        summaryEl.style.color = totalGraded === 0 ? '#888' : (edge > 0 ? '#4ade80' : '#f87171');
    }

    // Find max n_decisions for bar scaling
    let maxN = 1;
    for (const p of points) {
        if (p.n_decisions > maxN) maxN = p.n_decisions;
    }

    // Render as a horizontal bar chart per day: date | bar | hit_pct | avg_ret
    const rows = points.map(p => {
        const barPct = (p.n_decisions / maxN) * 100;
        const dir = p.n_graded || 0;
        const dayEdge = p.hit_pct - (p.baseline_pct || 0);
        const hitColor = dir >= 3
            ? (dayEdge > 0 ? '#4ade80' : '#f87171')
            : '#666';
        const retColor = p.avg_return_pct > 0 ? '#4ade80' : p.avg_return_pct < 0 ? '#f87171' : '#999';
        const hitText = dir > 0 ? `${p.hit_pct.toFixed(1)}% / ${(p.baseline_pct || 0).toFixed(1)}%` : '—';
        const retText = p.n_resolved > 0
            ? `${p.avg_return_pct >= 0 ? '+' : ''}${p.avg_return_pct.toFixed(2)}%`
            : '—';
        return `
            <tr>
                <td style="padding:0.4rem 0.5rem;font-family:monospace;font-size:0.85rem;color:#888">${esc(p.date)}</td>
                <td style="padding:0.4rem 0.5rem;width:50%">
                    <div style="background:#1f2937;border-radius:3px;overflow:hidden;height:18px;position:relative">
                        <div style="background:#3b82f6;width:${barPct}%;height:100%"></div>
                        <span style="position:absolute;top:0;left:6px;font-size:0.8rem;line-height:18px;color:#fff">${p.n_decisions} dec · ${p.n_resolved} res · ${dir} graded</span>
                    </div>
                </td>
                <td style="padding:0.4rem 0.5rem;text-align:right;color:${hitColor};font-weight:600">${hitText}</td>
                <td style="padding:0.4rem 0.5rem;text-align:right;color:${retColor};font-weight:600">${retText}</td>
            </tr>
        `;
    }).join('');
    document.getElementById('ae-trend').innerHTML = `
        <table style="width:100%;border-collapse:collapse">
            <thead><tr style="color:#888;font-size:0.85rem;border-bottom:1px solid #333">
                <th style="text-align:left;padding:0.5rem">Date (UTC)</th>
                <th style="text-align:left;padding:0.5rem">Decisions / Resolved / Graded</th>
                <th style="text-align:right;padding:0.5rem" title="Sign-match rate / always-same-way baseline for that day">Hit % / baseline</th>
                <th style="text-align:right;padding:0.5rem">Avg Return</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderActionEngineBacktest(d) {
    const freshness = document.getElementById('ae-freshness');
    if (freshness) {
        freshness.textContent = d.computed_at
            ? `Computed ${new Date(d.computed_at).toLocaleString()} · refreshed at most every 10 min · grades land hourly`
            : '';
    }
    // Every numeric field is coerced (VBReads.num) before it reaches markup;
    // an HTML-bearing value in a numeric field renders as the invalid-value dash.
    const N = v => VBReads.num(v) || 0;
    const F = (v, dgt) => VBReads.fixed(v, dgt);
    const I = v => fmt(v);
    const graded = N(d.graded_decisions);
    const hit = N(d.overall_hit_pct), base = N(d.overall_baseline_pct);
    const avgRet = N(d.overall_avg_return_pct);
    const gradedDays = N(d.graded_days);
    const hero = document.getElementById('ae-hero');
    hero.innerHTML = `
        <div class="metric-card hero">
            <div class="metric-label">Decisions (${I(d.window_days)}d)</div>
            <div class="metric-value">${I(d.total_decisions)}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Resolved</div>
            <div class="metric-value">${I(d.resolved_decisions)}</div>
            <div class="metric-sub">${F(d.resolution_coverage_pct, 1)}% coverage</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Hit % vs baseline</div>
            <div class="metric-value" style="color:${graded > 0 ? ((hit - base) > 0 ? '#4ade80' : '#f87171') : '#999'}">${graded > 0 ? hit.toFixed(1) + '%' : '—'}</div>
            <div class="metric-sub">${graded > 0
                ? `baseline ${base.toFixed(1)}% (always guessing the same way) · ${(hit - base >= 0 ? '+' : '')}${(hit - base).toFixed(1)}pp · ${graded.toLocaleString()} graded over ${gradedDays} decision day${gradedDays === 1 ? '' : 's'}`
                : 'nothing graded yet'}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Avg Return</div>
            <div class="metric-value">${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%</div>
            <div class="metric-sub">avg \|PT err\|: ${F(d.overall_avg_abs_error_pt, 1)}pt</div>
        </div>
    `;

    const renderBuckets = (id, buckets, label, dim) => {
        if (!buckets || buckets.length === 0) {
            document.getElementById(id).innerHTML = '<div style="color:#999;padding:1rem">No data</div>';
            return;
        }
        const rows = buckets.map(b => {
            const graded = N(b.n_graded);
            const gradedDays = N(b.n_graded_days);
            const edge = VBReads.num(b.edge_pp);
            const ret = N(b.avg_return_pct);
            const nDec = N(b.n_decisions), nRes = N(b.n_resolved);
            const edgeColor = graded < 5 ? '#666' : (edge > 0 ? '#4ade80' : '#f87171');
            // Colour by EDGE, never by the raw rate: a 57.7% hit against a
            // 72.0% baseline is 14.2pp WORSE than guessing, and used to render green.
            const hitColor = graded >= 5 ? edgeColor : '#666';
            const retColor = ret > 0 ? '#4ade80' : ret < 0 ? '#f87171' : '#999';
            if (AEBuckets.isUnmatured60dBucket(dim, b.key, nRes)) {
                return `
                <tr>
                    <td style="font-weight:600;padding:0.4rem 0.5rem">${esc(b.key)}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right">${nDec.toLocaleString()}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right">${nRes.toLocaleString()}</td>
                    <td colspan="5" style="padding:0.4rem 0.5rem;text-align:right;color:#888;font-style:italic" title="${esc(AEBuckets.MATURITY_TITLE)}">${esc(AEBuckets.MATURITY_NOTE)}</td>
                </tr>
            `;
            }
            return `
                <tr>
                    <td style="font-weight:600;padding:0.4rem 0.5rem">${esc(b.key)}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right">${nDec.toLocaleString()}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right">${nRes.toLocaleString()}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right">${graded.toLocaleString()}${gradedDays > 0 ? `<span style="color:${gradedDays === 1 ? '#fbbf24' : '#888'};font-size:0.8rem"> / ${gradedDays}d</span>` : ''}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right;color:${hitColor};font-weight:600">${graded > 0 ? F(b.hit_pct, 1) + '%' : '—'}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right;color:#888">${graded > 0 ? F(b.baseline_pct, 1) + '%' : '—'}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right;color:${edgeColor};font-weight:600">${graded > 0 && edge != null ? (edge >= 0 ? '+' : '') + edge.toFixed(1) + 'pp' : '—'}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right;color:${retColor};font-weight:600">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</td>
                </tr>
            `;
        }).join('');
        document.getElementById(id).innerHTML = `
            <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;white-space:nowrap">
                <thead><tr style="color:#888;font-size:0.85rem;border-bottom:1px solid #333">
                    <th style="text-align:left;padding:0.5rem">${esc(label)}</th>
                    <th style="text-align:right;padding:0.5rem">Decisions</th>
                    <th style="text-align:right;padding:0.5rem">Resolved</th>
                    <th style="text-align:right;padding:0.5rem" title="Graded rows / the number of distinct decision days they come from. Thousands of rows from one day is one cross-section, not thousands of independent tests.">Graded / days</th>
                    <th style="text-align:right;padding:0.5rem" title="Share of graded predictions whose sign matched the realized move">Hit %</th>
                    <th style="text-align:right;padding:0.5rem" title="Score of always guessing the majority direction for these same rows">Baseline</th>
                    <th style="text-align:right;padding:0.5rem" title="Hit % minus baseline. Zero or below = no directional skill.">Edge</th>
                    <th style="text-align:right;padding:0.5rem">Avg Ret</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            </div>
        `;
    };

    renderBuckets('ae-by-horizon', d.by_horizon, 'Horizon', 'horizon');
    renderBuckets('ae-by-trigger', d.by_trigger, 'Trigger', 'trigger');
    renderBuckets('ae-by-action-predicate', d.by_action_predicate, 'Predicate', 'predicate');

    const recent = d.recent_resolutions || [];
    if (recent.length === 0) {
        document.getElementById('ae-recent').innerHTML = '<div style="color:#999;padding:1rem">No resolutions yet</div>';
    } else {
        const rows = recent.map(r => {
            const realized = N(r.realized_return_pct);
            const predicted = VBReads.num(r.predicted_pct);
            const retColor = realized > 0 ? '#4ade80' : realized < 0 ? '#f87171' : '#999';
            const hitBadge = r.hit === true ? '<span style="color:#4ade80">✓</span>' : '<span style="color:#f87171">✗</span>';
            const predStr = predicted !== null
                ? `<span style="color:${predicted >= 0 ? '#4ade80' : '#f87171'}">${predicted >= 0 ? '+' : ''}${predicted.toFixed(2)}%</span>`
                : '<span style="color:#666">—</span>';
            return `
                <tr>
                    <td style="padding:0.4rem 0.5rem;font-weight:600">${esc(r.ticker)}</td>
                    <td style="padding:0.4rem 0.5rem">${predStr}</td>
                    <td style="padding:0.4rem 0.5rem">${esc(r.horizon)}</td>
                    <td style="padding:0.4rem 0.5rem;font-size:0.85rem;color:#888">${esc(r.trigger_type)}</td>
                    <td style="padding:0.4rem 0.5rem;text-align:right;color:${retColor};font-weight:600">${realized >= 0 ? '+' : ''}${realized.toFixed(2)}%</td>
                    <td style="padding:0.4rem 0.5rem;text-align:center">${hitBadge}</td>
                    <td style="padding:0.4rem 0.5rem;font-size:0.8rem;color:#666">${esc(String(r.resolved_at || '').slice(0,10))}</td>
                </tr>
            `;
        }).join('');
        document.getElementById('ae-recent').innerHTML = `
            <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;white-space:nowrap">
                <thead><tr style="color:#888;font-size:0.85rem;border-bottom:1px solid #333">
                    <th style="text-align:left;padding:0.5rem">Ticker</th>
                    <th style="text-align:left;padding:0.5rem" title="adjusted_pt_pct — per-horizon LGBM prediction the hit is computed against">Predicted</th>
                    <th style="text-align:left;padding:0.5rem">Horizon</th>
                    <th style="text-align:left;padding:0.5rem">Trigger</th>
                    <th style="text-align:right;padding:0.5rem">Realized</th>
                    <th style="text-align:center;padding:0.5rem">Hit</th>
                    <th style="text-align:left;padding:0.5rem">Resolved</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }
}

// ── System Health: WebSocket health + scanner metrics ─────────────────────

async function loadWSStatus(ctx) {
    const r = await VBReads.get('ws-status');
    if (!ctx.live()) return;
    const badge = document.getElementById('ws-status-badge');
    if (!r.ok) {
        VBReads.unavailable(document.getElementById('ws-status-content'), r.kind, r.message);
        if (badge) badge.textContent = r.kind === 'unauthenticated' || r.kind === 'forbidden' ? 'Sign in' : 'Unavailable';
        return;
    }
    try {
        renderWSStatus(r.body);
        if (badge) badge.textContent = r.body.healthy === true ? 'Connected' : 'Disconnected';
    } catch (err) {
        console.error('WS status render failed:', err);
        VBReads.unavailable(document.getElementById('ws-status-content'), 'upstream_error', 'The backend payload could not be rendered.');
        if (badge) badge.textContent = 'Unavailable';
    }
}

async function loadSystemHealth(ctx) {
    await Promise.all([
        loadWSStatus(ctx),
        window.ScannerMetrics ? window.ScannerMetrics.load(ctx) : null,
    ]);
}

function clearSystemHealth() {
    const el = document.getElementById('ws-status-content');
    if (el) el.textContent = '';
    const badge = document.getElementById('ws-status-badge');
    if (badge) badge.textContent = '—';
    if (window.ScannerMetrics) window.ScannerMetrics.clear();
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

    const healthy = data.healthy === true;
    const dot = healthy ? '\u{1F7E2}' : '\u{1F534}';
    const statusText = healthy ? 'Connected' : 'Disconnected';
    let uptime = '';
    if (data.connected_since) {
        const since = new Date(data.connected_since).getTime();
        const mins = Number.isFinite(since) ? Math.floor((Date.now() - since) / 60000) : NaN;
        if (!Number.isFinite(mins)) {
            uptime = '';
        } else if (mins < 60) {
            uptime = ` ${mins}m`;
        } else {
            const hrs = Math.floor(mins / 60);
            const rem = mins % 60;
            uptime = rem > 0 ? ` ${hrs}h ${rem}m` : ` ${hrs}h`;
        }
    }
    const I = v => fmt(v == null ? 0 : v);
    addMetric('Status', `${dot} ${statusText}${uptime}`, healthy ? 'var(--positive)' : 'var(--negative)');
    addMetric('Bars/sec', VBReads.fixed(data.bars_per_sec == null ? 0 : data.bars_per_sec, 1));
    addMetric('Cache Size', I(data.cache_size));
    addMetric('Bars Today', I(data.bars_received));
    addMetric('Catalyst Triggers', I(data.catalyst_triggers_today));
    addMetric('Tripwires Fired', I(data.tripwires_fired_today));
    addMetric('Halts Today', I(data.halts_fired_today));
    addMetric('Block Clusters', I(data.block_clusters_today));
    addMetric('RVOL Spikes', I(data.rvol_spikes_today));
    addMetric('Dispatcher Drops', I(data.trade_dispatcher_drops));
    addMetric('Reconnects', I(data.reconnect_count));
    addMetric('24h Uptime', VBReads.fixed(data.uptime_pct_24h == null ? 0 : data.uptime_pct_24h, 1) + '%');

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

// ── Registration + init ───────────────────────────────────────────────────

VBTabs.register('llm-usage', {
    load: loadLLMUsage,
    clear: clearLLMUsage,
    intervalMs: REFRESH_MS,
    pollWhen: () => !selectedDate, // a historical date never auto-refreshes
});
VBTabs.register('system-health', {
    load: loadSystemHealth,
    clear: clearSystemHealth,
    intervalMs: WS_STATUS_REFRESH_MS,
});
VBTabs.register('action-engine', {
    load: loadActionEngine,
    clear: clearActionEngine,
});

initDatePicker();
initTabs();
VBTabs.activate('llm-usage');
