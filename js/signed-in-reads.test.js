'use strict';
// The six recovered tabs read ONLY through VBReads → VBAuth.fetch(requireAuth)
// → /api/ops/reads, only while an admin is signed in, and never leave a stale
// number behind. Pins: the native-fetch inventory, index.html/CSS wiring, and a
// full lifecycle drive of the real scripts (incl. the real js/auth.js bound to
// a fake identity adapter) in a persistent fake DOM derived from index.html.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSandbox, offendingMarkup, read, ROOT } = require('./_test_dom.js');

const JS = __dirname;
const SCRIPTS = [...read('index.html').matchAll(/<script[^>]*src="(js\/[^"]+)"/g)].map(m => m[1]);

const EVIL = '<img src=x onerror=alert(1)>';
const EVIL_ATTR = '" onmouseover="alert(1)';

// ── static pins ─────────────────────────────────────────────────────────────

test('native fetch inventory: exactly auth.js (transport + /api/config), agent-ops.js, ops-console.js — qualified forms included', () => {
    const code = (src) => src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    const found = {};
    for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('_'))) {
        for (const line of code(read('js/' + f)).split('\n')) {
            if (/(^|[^\w.])fetch\(/.test(line) || /(window|globalThis|self)\.fetch\(/.test(line)) (found[f] = found[f] || []).push(line.trim());
        }
    }
    assert.deepEqual(found, {
        'agent-ops.js': [": await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });"],
        'auth.js': [
            'async fetch(url, opts) {',
            'return fetch(url, fetchOpts);',
            "const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });",
        ],
        'ops-console.js': ['const res = await fetch(`js/fixtures/${FIXTURE}.sample.json`);'],
    });
    // No script names the backend host or the removed personal-mode stub.
    for (const f of fs.readdirSync(JS).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
        const src = read('js/' + f);
        assert.ok(!/api\.vibebullish\.com/.test(src), f + ' names the backend host');
        assert.ok(!/vbPersonalModeRead|personal-mode/.test(src), f + ' references personal mode');
    }
});

test('index.html: reads.js loads before every tab script, no personal-mode remains, six gates, eleven tab buttons', () => {
    const html = read('index.html');
    assert.equal(SCRIPTS[0], 'js/reads.js');
    assert.ok(SCRIPTS.indexOf('js/dashboard.js') < SCRIPTS.indexOf('js/quant.js'));
    assert.ok(!SCRIPTS.includes('js/personal-mode.js'));
    assert.ok(!/personal-mode/.test(html));
    const gates = [...html.matchAll(/<div id="tab-([a-z0-9-]+)"[^>]*>\s*<div class="vb-gate" role="status" hidden><\/div>/g)].map(m => m[1]);
    assert.deepEqual(gates, ['llm-usage', 'system-health', 'action-engine', 'quant-quality', 'data-collector', 'catalyst-accuracy']);
    for (const kept of ['agent-ops', 'harness', 'ops-shadow', 'ops-heartbeats', 'ops-r4']) assert.ok(!new RegExp(`id="tab-${kept}"[^>]*>\\s*<div class="vb-gate"`).test(html), kept);
    assert.equal([...html.matchAll(/<button class="tab[^"]*" data-tab=/g)].length, 11);
    const css = read('styles/dashboard.css');
    assert.match(css, /\.vb-gated > :not\(\.vb-gate\) \{ display: none !important; \}/);
    assert.ok(!/personal-mode/.test(css));
    assert.ok(!fs.existsSync(path.join(JS, 'personal-mode.js')));
});

// ── lifecycle harness ───────────────────────────────────────────────────────

const VIEWS_BY_TAB = {
    'llm-usage': ['llm-today', 'llm-week', 'llm-scanner'],
    'system-health': ['ws-status', 'scanner-metrics'],
    'action-engine': ['ae-stats', 'ae-trend'],
    'quant-quality': ['quant-health', 'quant-training-runs', 'quant-backtests', 'ae-stats', 'quant-live-predictions', 'quantile-report'],
    'data-collector': ['data-collector-health'],
    'catalyst-accuracy': ['catalyst-accuracy'],
};
const ALL_VIEWS = [
    'ae-stats', 'ae-trend', 'catalyst-accuracy', 'data-collector-health', 'llm-scanner', 'llm-today', 'llm-week',
    'quant-backtests', 'quant-health', 'quant-live-predictions', 'quant-training-runs', 'quantile-report', 'scanner-metrics', 'ws-status',
];

function fakeAdapter() {
    const a = { cb: null, gate: null, signOutCalls: 0 };
    a.onAuthStateChanged = cb => { a.cb = cb; };
    a.signOut = () => { a.signOutCalls++; return a.gate || Promise.resolve(); };
    return a;
}
const user = (token) => ({ email: 'k@example.test', uid: 'u1', getIdToken: async () => token });

async function page(opts) {
    const errors = [];
    const sb = createSandbox(Object.assign({ console: { log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) } }, opts || {}));
    sb.errors = errors;
    for (const s of SCRIPTS) sb.load(s);          // same order as index.html; auth.js last
    await sb.flush();
    sb.adapter = fakeAdapter();
    sb.ctx.VBAuth.bind(sb.adapter);
    sb.signIn = async (token) => { sb.adapter.cb(user(token || 'tok-1')); await sb.flush(); };
    sb.signOut = async () => { const p = sb.ctx.VBAuth.signOut(); sb.adapter.cb(null); await sb.flush(); return p; };
    return sb;
}
const views = (sb) => sb.readCalls().map(c => c.view).sort();
const gated = (sb, tab) => sb.panels[tab]._cls.has('vb-gated');

test('startup before any sign-in: no recovered read, LLM tab gated with the sign-in message, no timers for recovered tabs', async () => {
    const sb = await page();
    assert.deepEqual(sb.readCalls(), []);
    assert.equal(sb.activeTab(), 'llm-usage');
    assert.equal(gated(sb, 'llm-usage'), true);
    const gate = sb.panels['llm-usage'].querySelector('.vb-gate');
    assert.equal(gate.hidden, false);
    assert.match(gate.textContent, /Sign-in is not configured|Sign in with an admin/);
    for (const t of Object.keys(VIEWS_BY_TAB)) assert.equal(gated(sb, t), true, t);
    assert.deepEqual(sb.errors, []);
});

test('sign-in loads exactly the active tab through the proxy with the bearer; each tab click loads its full view set with the right params', async () => {
    const sb = await page();
    await sb.signIn('tok-A');
    assert.equal(sb.ctx.VBAuth.isAdmin, true);
    assert.deepEqual(views(sb), [...VIEWS_BY_TAB['llm-usage']].sort());
    for (const c of sb.readCalls()) { assert.equal(c.auth, 'Bearer tok-A'); assert.ok(c.url.startsWith('/api/ops/reads?view=')); }
    assert.equal(gated(sb, 'llm-usage'), false);
    // Today: no date param forwarded.
    assert.deepEqual(sb.readCalls().find(c => c.view === 'llm-today').params, {});

    const seen = new Set(views(sb));
    for (const tab of ['system-health', 'action-engine', 'quant-quality', 'data-collector', 'catalyst-accuracy']) {
        sb.resetCalls();
        sb.clickTab(tab);
        await sb.flush();
        assert.equal(sb.activeTab(), tab);
        assert.deepEqual([...new Set(views(sb))], [...VIEWS_BY_TAB[tab]].sort(), tab);
        assert.equal(sb.readCalls().length, tab === 'catalyst-accuracy' ? 4 : VIEWS_BY_TAB[tab].length, tab + ' call count');
        sb.readCalls().forEach(c => seen.add(c.view));
    }
    assert.deepEqual([...seen].sort(), ALL_VIEWS);
    const byView = Object.fromEntries(sb.readCalls().map(c => [c.view, c.params]));
    assert.deepEqual(byView['catalyst-accuracy'], { dimension: 'horizon', days: '30' });
    const calls = sb.readCalls().filter(c => c.view === 'catalyst-accuracy').map(c => c.params.dimension).sort();
    assert.deepEqual(calls, ['event_type', 'extractor', 'horizon', 'model']);
    sb.resetCalls(); sb.clickTab('quant-quality'); await sb.flush();
    const q = Object.fromEntries(sb.readCalls().map(c => [c.view, c.params]));
    assert.deepEqual(q['quant-live-predictions'], { timeframe: '1d', limit: '10' });
    assert.deepEqual(q['quant-training-runs'], { limit: '10' });
    assert.deepEqual(q['quant-backtests'], { limit: '20' });
    assert.deepEqual(q['ae-stats'], { days: '30' });
    sb.resetCalls(); sb.clickTab('action-engine'); await sb.flush();
    const ae = Object.fromEntries(sb.readCalls().map(c => [c.view, c.params]));
    assert.deepEqual(ae, { 'ae-stats': { days: '30' }, 'ae-trend': { days: '7' } });
    sb.resetCalls(); sb.clickTab('system-health'); await sb.flush();
    assert.deepEqual(Object.fromEntries(sb.readCalls().map(c => [c.view, c.params])), { 'ws-status': {}, 'scanner-metrics': { hours: '24' } });
    assert.deepEqual(sb.errors, []);
});

test('timers: at most one recovered-tab interval at a time, only while admin and that tab is active; a tick reloads that tab only', async () => {
    const sb = await page();
    const recoveredIntervals = () => sb.timers.intervals.filter(t => t.ms === 60000 || t.ms === 30000);
    assert.equal(recoveredIntervals().length, 0);
    await sb.signIn();
    assert.equal(recoveredIntervals().length, 1); // llm-usage, 60 s
    sb.clickTab('data-collector'); await sb.flush();
    assert.equal(recoveredIntervals().length, 1);
    assert.equal(recoveredIntervals()[0].ms, 30000);
    sb.resetCalls(); sb.tickIntervals(); await sb.flush();
    assert.deepEqual(views(sb), ['data-collector-health']);
    sb.clickTab('action-engine'); await sb.flush(); // no poll for this tab
    assert.equal(recoveredIntervals().length, 0);
    sb.clickTab('agent-ops'); await sb.flush();     // leaving the six: no recovered interval
    assert.equal(recoveredIntervals().length, 0);
});

test('LLM date: controls route through reload, the date is forwarded only to today/scanner, a historical date suppresses the poll, and a stale response is dropped', async () => {
    const sb = await page();
    await sb.signIn();
    sb.resetCalls();
    const picker = sb.byId.get('date-picker');
    picker.value = '2026-10-01';
    picker.dispatch('change');
    await sb.flush();
    const byView = {};
    for (const c of sb.readCalls()) byView[c.view] = c.params;
    assert.deepEqual(byView, { 'llm-today': { date: '2026-10-01' }, 'llm-week': {}, 'llm-scanner': { date: '2026-10-01' } });
    // Historical date: the poll tick issues nothing.
    sb.resetCalls(); sb.tickIntervals(); await sb.flush();
    assert.deepEqual(sb.readCalls(), []);
    // Deferred responses: change date mid-flight; the first date's response must not render.
    sb.state.deferReads = true;
    sb.state.responses['llm-today'] = { total_calls: 111, date: 'STALE', by_model: {}, unique_tickers: 1 };
    sb.resetCalls();
    sb.byId.get('date-prev').click();           // → 2026-09-30, load A (pending)
    await sb.flush();
    assert.equal(sb.readCalls().filter(c => c.view === 'llm-today')[0].params.date, '2026-09-30');
    const pendingA = sb.pending.splice(0);     // hold A
    sb.state.responses['llm-today'] = { total_calls: 222, date: 'FRESH', by_model: {}, unique_tickers: 2 };
    sb.byId.get('date-today').click();         // load B (today)
    await sb.flush();
    sb.releasePending(); await sb.flush();     // B resolves first
    assert.equal(sb.byId.get('m-date').textContent, 'FRESH');
    for (const p of pendingA) p.resolve();     // A arrives late
    await sb.flush();
    assert.equal(sb.byId.get('m-date').textContent, 'FRESH', 'late response for the old date must not render');
    assert.deepEqual(sb.errors, []);
});

test('catalyst: Refresh and the window selector reload through the controller with one snapshot per load; rapid changes and a departure drop stale results', async () => {
    const sb = await page();
    await sb.signIn();
    sb.clickTab('catalyst-accuracy'); await sb.flush();
    sb.resetCalls();
    sb.byId.get('ca-refresh').click(); await sb.flush();
    assert.equal(sb.readCalls().length, 4);
    assert.ok(sb.readCalls().every(c => c.params.days === '30'));
    const sel = sb.byId.get('ca-filter-days');
    sb.state.deferReads = true;
    sb.resetCalls();
    sel.value = '7'; sel.dispatch('change'); await sb.flush();
    sel.value = '90'; sel.dispatch('change'); await sb.flush();
    assert.deepEqual(sb.readCalls().map(c => c.params.days), ['7', '7', '7', '7', '90', '90', '90', '90']);
    sb.state.responses['catalyst-accuracy'] = { rows: [{ groupValue: 'G', n: 3, directionalHits: 2, directionalPct: 66.7, magnitudePct: 33.3, avgRealized: 1.5 }] };
    sb.releasePending(); await sb.flush();
    assert.match(sb.byId.get('ca-meta').textContent, /last 90 days/, 'the meta line reflects the LAST window only');
    // Departure, deferred SUCCESS: configured before the request, resolved after leaving the tab.
    sb.state.responses['catalyst-accuracy'] = { rows: [{ groupValue: 'LATE-OK', n: 9, directionalHits: 9, directionalPct: 100, magnitudePct: 100, avgRealized: 9 }] };
    sb.resetCalls();
    sel.value = '60'; sel.dispatch('change'); await sb.flush();
    let held = sb.pending.splice(0);
    sb.clickTab('data-collector'); await sb.flush();
    sb.releasePending(); await sb.flush();
    const panelBefore = sb.byId.get('ca-by-model').innerHTML;
    const metaBefore = sb.byId.get('ca-meta').textContent;
    for (const p of held) p.resolve();
    await sb.flush();
    assert.equal(sb.byId.get('ca-by-model').innerHTML, panelBefore, 'late success did not render');
    assert.equal(sb.byId.get('ca-meta').textContent, metaBefore);
    assert.ok(!panelBefore.includes('LATE-OK'));
    // Departure, deferred FAILURE: configured before the request, resolved after leaving the tab.
    sb.clickTab('catalyst-accuracy'); await sb.flush();
    sb.releasePending(); await sb.flush();
    const okPanel = sb.byId.get('ca-by-model').innerHTML;
    assert.ok(okPanel.includes('LATE-OK'), 'control: the same payload renders while the tab is active');
    sb.state.fail['catalyst-accuracy'] = { status: 502, body: { error: 'upstream_error', message: 'late failure' } };
    sb.resetCalls();
    sel.value = '7'; sel.dispatch('change'); await sb.flush();
    held = sb.pending.splice(0);
    sb.clickTab('data-collector'); await sb.flush();
    sb.releasePending(); await sb.flush();
    for (const p of held) p.resolve();
    await sb.flush();
    assert.equal(sb.byId.get('ca-by-model').innerHTML, okPanel, 'late failure did not replace the panel');
    assert.ok(!sb.byId.get('ca-by-model').innerHTML.includes('late failure'));
    assert.deepEqual(sb.errors, []);
});

test('sign-out with Firebase deferred: a timer tick and a manual reload issue NO recovered read; timers cleared; six tabs gated and cleared; late responses dropped; re-sign-in loads again', async () => {
    const sb = await page();
    await sb.signIn('tok-A');
    sb.clickTab('quant-quality'); await sb.flush();
    assert.ok(sb.byId.get('quant-live-stats').innerHTML.length > 0);
    // Leave one load in flight, then sign out while Firebase is still working.
    sb.state.deferReads = true;
    sb.byId.get('ca-refresh'); // (exists)
    sb.resetCalls();
    sb.tickIntervals(); await sb.flush();            // quant poll → 6 pending reads
    const inflight = sb.pending.splice(0);
    let release; sb.adapter.gate = new Promise(r => { release = r; });
    const p = sb.ctx.VBAuth.signOut();               // synchronous revoke; Firebase pending
    assert.equal(sb.ctx.VBAuth.isAdmin, false);
    for (const t of Object.keys(VIEWS_BY_TAB)) assert.equal(gated(sb, t), true, t + ' gated at sign-out entry');
    assert.equal(sb.byId.get('quant-live-stats').innerHTML, '', 'data cleared at sign-out entry');
    assert.equal(sb.timers.intervals.filter(t => t.ms === 60000 || t.ms === 30000).length, 0);
    sb.resetCalls();
    sb.tickIntervals(); sb.tickTimeouts(); await sb.flush();          // any surviving timer
    sb.ctx.VBTabs.reload(); sb.byId.get('ca-refresh').click(); sb.byId.get('date-today').click(); await sb.flush();
    sb.clickTab('data-collector'); await sb.flush();
    assert.deepEqual(sb.readCalls(), [], 'no recovered read during the sign-out gap');
    for (const q of inflight) q.resolve();           // late admin-era responses
    await sb.flush();
    assert.equal(sb.byId.get('quant-live-stats').innerHTML, '', 'late response did not render');
    release(); await p; sb.adapter.cb(null); await sb.flush();
    assert.deepEqual(sb.readCalls(), []);
    // Re-sign-in: the active tab (data-collector) loads under the new token.
    sb.state.deferReads = false;
    await sb.signIn('tok-B');
    assert.deepEqual(views(sb), ['data-collector-health']);
    assert.equal(sb.readCalls()[0].auth, 'Bearer tok-B');
    assert.equal(gated(sb, 'data-collector'), false);
    assert.deepEqual(sb.errors, []);
});

test('Agents and ops tabs keep their own behaviour; sign-out while an ops tab is active falls back to the first public tab with zero recovered reads', async () => {
    const sb = await page();
    await sb.signIn();
    // Ops buttons revealed for an admin; Agents tab has its own timers + fetch.
    assert.equal(sb.tabButton('ops-shadow').style.display, '');
    sb.resetCalls();
    sb.clickTab('agent-ops'); await sb.flush();
    assert.ok(sb.fetchCalls.some(c => c.url === '/api/agent-ops'), 'Agents tab fetched its own endpoint');
    assert.deepEqual(sb.readCalls(), []);
    const agentTimers = sb.timers.intervals.length;
    assert.ok(agentTimers >= 1, 'Agents tab owns its timers');
    sb.resetCalls();
    sb.clickTab('ops-shadow'); await sb.flush();
    assert.ok(sb.fetchCalls.some(c => c.url.startsWith('/api/ops/shadow')), 'Shadow tab dispatched through OpsConsole');
    assert.deepEqual(sb.readCalls(), []);
    sb.clickTab('ops-heartbeats'); await sb.flush();
    assert.ok(sb.fetchCalls.some(c => c.url.startsWith('/api/ops/heartbeats')));
    sb.clickTab('ops-r4'); await sb.flush();
    assert.ok(sb.fetchCalls.some(c => c.url.startsWith('/api/ops/r4')));
    const opsCallsBefore = sb.fetchCalls.length;
    sb.clickTab('ops-shadow'); await sb.flush();
    assert.ok(sb.fetchCalls.length > opsCallsBefore);
    sb.resetCalls();
    await sb.signOut();
    assert.equal(sb.activeTab(), 'llm-usage', 'ops-console synthetic click fell back to the first public tab');
    assert.equal(sb.tabButton('ops-shadow').style.display, 'none');
    assert.equal(gated(sb, 'llm-usage'), true);
    assert.deepEqual(sb.readCalls(), []);
});

// ── renderer hardening ──────────────────────────────────────────────────────

function evilPayloads() {
    const bucket = { key: EVIL_ATTR, n_decisions: EVIL, n_resolved: EVIL, n_graded: 6, n_graded_days: EVIL, hit_pct: EVIL, baseline_pct: EVIL, edge_pp: EVIL, avg_return_pct: EVIL };
    return {
        'llm-today': { total_calls: EVIL, date: EVIL_ATTR, unique_tickers: '7', by_model: { [EVIL]: 5, 'gpt-4o': EVIL, [EVIL_ATTR]: 2 }, by_service: { [EVIL_ATTR]: 3 }, by_component: { [EVIL]: 2, crypto_x: EVIL }, hourly_calls: [EVIL, 1, '2'], top_tickers: [{ ticker: EVIL, calls: EVIL, models: { [EVIL]: EVIL } }] },
        'llm-week': [{ date: EVIL_ATTR, total_calls: EVIL }, { date: '2026-10-01', total_calls: 5 }],
        'llm-scanner': { web_search_llm_calls: EVIL, ticker_scans: [{ source: 'web_search', ticker: EVIL }] },
        'catalyst-accuracy': { rows: [{ groupValue: EVIL, n: EVIL, directionalHits: EVIL_ATTR, directionalPct: EVIL, magnitudePct: '55', avgRealized: EVIL }, { groupValue: EVIL_ATTR, n: 3, directionalHits: 2, directionalPct: 66.6, magnitudePct: 0, avgRealized: 0 }] },
        'scanner-metrics': { unique_tickers: EVIL, total_dispatches: 3, by_source: [{ source: EVIL_ATTR, dispatches: EVIL, errors: EVIL, avg_duration_ms: EVIL, unique_tickers: EVIL, llm_calls: EVIL }] },
        'ae-stats': { window_days: EVIL, total_decisions: EVIL, resolved_decisions: 1, resolution_coverage_pct: EVIL, graded_decisions: 10, overall_hit_pct: EVIL, overall_baseline_pct: 50, overall_avg_return_pct: EVIL, overall_avg_abs_error_pt: 1, graded_days: EVIL, computed_at: EVIL, by_horizon: [bucket, Object.assign({}, bucket, { key: '60d', n_resolved: 0 })], by_trigger: [bucket], by_action_predicate: [bucket], recent_resolutions: [{ ticker: EVIL, predicted_pct: EVIL, horizon: EVIL_ATTR, trigger_type: EVIL, realized_return_pct: EVIL, hit: EVIL, resolved_at: EVIL }] },
        'ae-trend': { points: [{ date: EVIL_ATTR, n_decisions: EVIL, n_resolved: EVIL, n_graded: EVIL, hit_pct: EVIL, baseline_pct: EVIL, avg_return_pct: EVIL }] },
        'quant-health': { training_metrics: { metrics: { '1d': { r2: EVIL, rmse: EVIL, mae: EVIL, train_samples: EVIL } }, tickers: EVIL, rows: EVIL, duration_s: EVIL, trained_at: EVIL } },
        'quant-live-predictions': { predictions: [{ prediction_date: EVIL_ATTR, y_pred: EVIL, entry_price: EVIL, y_true: EVIL, exit_price: EVIL, pred_rank: EVIL, ticker: EVIL, target_date: EVIL }] },
        'quant-training-runs': { runs: [evilRun()] },
        'quant-backtests': { backtests: [{ created_at: EVIL_ATTR, cohort_id: EVIL, timeframe: EVIL, top_n: EVIL, cost_bps: EVIL, n_periods: EVIL, cumulative_return_pct: EVIL, annualized_return_pct: EVIL, spy_annualized_return_pct: EVIL, alpha_annualized_pct: EVIL, sharpe_annualized: EVIL, max_drawdown_pct: EVIL, hit_rate_pct: EVIL, date_range_start: EVIL_ATTR, date_range_end: EVIL }] },
        'quantile-report': { window_start: EVIL, window_end: EVIL, top_vs_middle_pp: EVIL, configs: [{ label: EVIL, key: EVIL, rows: Array.from({ length: 10 }, () => ({ MeanFwd: EVIL })) }] },
        'data-collector-health': { queue: { Pending: EVIL, InProgress: EVIL, CompletedLastHr: 1, FailedLastHr: EVIL, AvgCompletionMs: EVIL, BySource: { scanner: { Pending: EVIL, Completed: EVIL, Failed: EVIL, AvgMs: EVIL } }, ByDataType: { ohlcv: EVIL } }, tables: { ticker_fundamentals: { total_rows: EVIL, updated_last_24h: EVIL, stalest_ticker: EVIL_ATTR, stalest_age_hours: EVIL, null_coverage: { [EVIL]: EVIL, [EVIL_ATTR]: '50' } }, daily_bars: { total_tickers: EVIL, latest_date: EVIL, tickers_with_today: EVIL, tickers_stale_7d: EVIL } }, api_usage: { polygon_calls_last_hour: EVIL, polygon_errors_last_hour: EVIL }, recent_errors: [{ ticker: EVIL, data_type: EVIL_ATTR, at: EVIL, error: EVIL_ATTR }] },
        'ws-status': { healthy: EVIL, connected_since: EVIL, bars_per_sec: EVIL, cache_size: EVIL, bars_received: EVIL, catalyst_triggers_today: EVIL, uptime_pct_24h: EVIL, last_bar_at: EVIL, last_disconnect: EVIL },
    };
}
function evilRun() {
    return { run_id: EVIL, cohort_id: EVIL_ATTR, status: EVIL, notes: EVIL, promoted: EVIL, n_rows: EVIL, n_tickers: EVIL, tickers: [EVIL], git_sha: EVIL, feature_set: EVIL, label_mode: EVIL, duration_s: EVIL, random_seed: EVIL_ATTR, started_at: EVIL, error: EVIL,
        metrics: { '20d': { rank_ic_mean: EVIL, n_test_dates: EVIL, r2: EVIL }, '60d': { top_decile_excess: EVIL, n_test_dates: EVIL, r2: EVIL, early_stop: EVIL_ATTR, direction_acc: EVIL }, pretrain_checks: { status: EVIL, blocking: true, checks: [{ status: EVIL, name: EVIL, detail: EVIL_ATTR }] }, feature_set: EVIL, feature_count: EVIL, lookback_days: EVIL, feature_names_sha: EVIL } };
}

test('offendingMarkup control: flags real breakouts and injected elements, not escaped text', () => {
    assert.equal(offendingMarkup('<td title="&quot; onmouseover=&quot;alert(1)">&lt;img src=x onerror=alert(1)&gt;</td>').length, 0);
    assert.ok(offendingMarkup('<td title="" onmouseover="alert(1)">x</td>').length > 0);
    assert.ok(offendingMarkup('<td><img src=x onerror=alert(1)></td>').length > 0);
});

test('every recovered renderer: HTML tags, quote breakouts and HTML in numeric fields render as literal text or the invalid-value state — no injected elements, no on* attributes, no render fallbacks', async () => {
    const sb = await page();
    Object.assign(sb.state.responses, evilPayloads());
    await sb.signIn();
    for (const tab of Object.keys(VIEWS_BY_TAB)) { sb.clickTab(tab); await sb.flush(); }
    // Open a training-run report card (built lazily on row click) with the evil run.
    const card = sb.ctx.buildRunReportCard(evilRun());
    const htmls = [...sb.allHtml(), card];
    const offenders = [];
    for (const h of htmls) for (const o of offendingMarkup(h)) offenders.push(o);
    assert.deepEqual(offenders, []);
    // Numeric fields that carried HTML rendered as the dash, never the string.
    assert.equal(sb.byId.get('m-total').textContent, '0');
    assert.ok(sb.byId.get('ae-hero').innerHTML.includes('—'));
    // The weekly chart really rendered its hostile rows (array payload), and
    // only the valid day counted.
    assert.match(sb.byId.get('weekly-chart').innerHTML, /class="w-bar"/);
    assert.equal(sb.byId.get('week-total').textContent, '5 total');
    // Catalyst: invalid measurements are dashes; valid zeroes are still percentages.
    const ca = sb.byId.get('ca-by-model').innerHTML;
    const cells = [...ca.matchAll(/width:54px;">([^<]*)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(cells, ['—', '55.0%', '66.6%', '0.0%']);
    assert.ok(ca.includes('>—</td>') && ca.includes('>0.00%</td>'));
    // Text contexts keep the literal: the escaped form is present.
    assert.ok(htmls.some(h => h.includes('&lt;img src=x onerror=alert(1)&gt;')));
    assert.ok(htmls.some(h => h.includes('&quot; onmouseover=&quot;alert(1)')));
    // No renderer needed the "could not be rendered" fallback.
    assert.deepEqual(sb.errors.filter(e => /render failed/.test(e)), []);
    // Every panel rendered something.
    for (const id of ['model-breakdown', 'weekly-chart', 'ws-status-content', 'scanner-by-source-content', 'ae-hero', 'ae-trend', 'quant-runs-table', 'quant-backtests-table', 'quant-live-stats', 'quant-live-predictions', 'quantile-configs', 'q-training-metrics', 'dc-by-source', 'dc-errors', 'ca-by-model']) {
        const el = sb.byId.get(id);
        assert.ok(el.innerHTML.length > 0 || el.children.length > 0 || el.textContent.length > 0, id + ' rendered');
    }
});

test('success followed by failure: every independently rendered panel replaces its data with the typed unavailable state; auth failures show the sign-in state', async () => {
    const sb = await page();
    sb.state.responses['quant-training-runs'] = { runs: [{ run_id: 'r1', started_at: '2026-10-01T00:00:00Z', n_rows: 10, metrics: {}, status: 'completed' }] };
    sb.state.responses['quant-backtests'] = { backtests: [{ created_at: '2026-10-01T00:00:00Z', cohort_id: 'c1' }] };
    sb.state.responses['data-collector-health'] = { queue: { Pending: 42, BySource: {}, ByDataType: {} }, tables: {}, api_usage: {}, recent_errors: [] };
    await sb.signIn();
    sb.clickTab('quant-quality'); await sb.flush();
    assert.ok(sb.byId.get('quant-runs-table').children.length > 0 || sb.byId.get('quant-runs-table').innerHTML.length > 0);
    assert.ok(sb.byId.get('quant-backtests-table').children.length > 0);
    // Now fail each quant view differently.
    sb.state.fail['quant-training-runs'] = { status: 404, body: { error: 'not_found', message: 'Backend returned HTTP 404 for /api/quant/training-runs.' } };
    sb.state.fail['quant-backtests'] = { status: 502, body: { error: 'upstream_error', message: 'Backend response withheld.' } };
    sb.state.fail['quant-health'] = { status: 503, body: { error: 'not_configured', message: 'INTERNAL_API_TOKEN missing' } };
    sb.state.fail['quantile-report'] = { status: 502, body: { error: 'unreachable', message: 'Backend did not respond within 12s.' } };
    sb.state.fail['quant-live-predictions'] = { status: 404, body: { error: 'not_found', message: 'gone' } };
    sb.state.fail['ae-stats'] = { status: 502, body: { error: 'upstream_error', message: 'boom' } };
    sb.ctx.VBTabs.reload(); await sb.flush();
    for (const [id, title] of [['quant-runs-table', 'Not available on this backend yet'], ['quant-backtests-table', 'Backend unavailable'], ['q-training-metrics', 'Ops proxy is not configured'], ['quantile-configs', 'Backend unavailable'], ['quant-live-predictions', 'Not available on this backend yet'], ['quant-live-stats', 'Backend unavailable']]) {
        const el = sb.byId.get(id);
        assert.ok(el.innerHTML.includes('ops-unavailable'), id + ' shows the unavailable state');
        assert.ok(el.innerHTML.includes(title), id + ': ' + title);
        assert.equal(el.children.length, 0, id + ' dropped its previous table');
    }
    assert.equal(sb.byId.get('quant-runs-count').textContent, '');
    assert.equal(sb.byId.get('quantile-window').textContent, '');
    // Data collector: success then failure clears the hero metrics too.
    sb.clickTab('data-collector'); await sb.flush();
    assert.equal(sb.byId.get('dc-pending').textContent, '42');
    sb.state.fail['data-collector-health'] = { status: 502, body: { error: 'upstream_error', message: 'x' } };
    sb.ctx.VBTabs.reload(); await sb.flush();
    assert.equal(sb.byId.get('dc-pending').textContent, '—');
    assert.ok(sb.byId.get('dc-by-source').innerHTML.includes('ops-unavailable'));
    // A SUCCESSFUL response whose queue is missing must not keep the old hero readings either.
    delete sb.state.fail['data-collector-health'];
    sb.ctx.VBTabs.reload(); await sb.flush();
    assert.equal(sb.byId.get('dc-pending').textContent, '42', 'control: success restores the reading');
    sb.state.responses['data-collector-health'] = { queue: null, tables: {}, api_usage: {}, recent_errors: [] };
    sb.ctx.VBTabs.reload(); await sb.flush();
    assert.equal(sb.byId.get('dc-pending').textContent, '—', 'null queue clears the hero metric');
    assert.ok(sb.byId.get('dc-by-source').innerHTML.includes('ops-unavailable'));
    sb.errors.length = 0; // the render-failed log line above is the intended path here
    sb.state.responses['data-collector-health'] = { queue: { Pending: 42, BySource: {}, ByDataType: {} }, tables: {}, api_usage: {}, recent_errors: [] };
    // Auth failure from the proxy (e.g. admin revoked server-side) → sign-in state on the panel.
    sb.state.fail['data-collector-health'] = { status: 403, body: { error: 'forbidden', message: 'This Google account is not an admin of VibeBullish.' } };
    sb.ctx.VBTabs.reload(); await sb.flush();
    assert.ok(sb.byId.get('dc-by-source').innerHTML.includes('Admin sign-in required'));
    // LLM: a real success first (summary badges populated), then a failure
    // replaces the hero numbers, every region AND the summary badges.
    sb.state.responses['llm-today'] = { total_calls: 23, date: '2026-10-04', unique_tickers: 7, by_model: { 'gpt-4o': 23 }, top_tickers: [{ ticker: 'AAPL', calls: 23, models: {} }] };
    sb.state.responses['llm-week'] = [{ date: '2026-10-03', total_calls: 23 }];
    sb.state.responses['llm-scanner'] = { web_search_llm_calls: 9, ticker_scans: [] };
    sb.clickTab('llm-usage'); await sb.flush();
    assert.equal(sb.byId.get('week-total').textContent, '23 total');
    assert.equal(sb.byId.get('ticker-count').textContent, '7 unique');
    assert.equal(sb.byId.get('web-search-count').textContent, '9 LLM calls');
    sb.state.fail['llm-week'] = { status: 502, body: { error: 'upstream_error', message: 'x' } };
    sb.ctx.VBTabs.reload(); await sb.flush();
    assert.equal(sb.byId.get('m-total').textContent, '—');
    assert.ok(sb.byId.get('weekly-chart').innerHTML.includes('ops-unavailable'));
    assert.equal(sb.byId.get('last-updated').textContent, 'Error — backend unavailable');
    for (const id of ['week-total', 'ticker-count', 'web-search-count', 'm-date', 'cost-note']) {
        assert.equal(sb.byId.get(id).textContent, '', id + ' summary cleared on failure');
    }
    assert.deepEqual(sb.errors, []);
});
