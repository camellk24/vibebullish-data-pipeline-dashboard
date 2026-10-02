'use strict';

// Personal research mode: the dashboard's direct (anonymous) data reads are off.
// Pins (1) the read stub itself, (2) the exact set of bare fetch() calls left in
// js/, (3) that loading and driving every formerly-reading module performs no
// request at all, and (4) the static notice on exactly the disabled tabs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { vbPersonalModeRead, NOTICE } = require('./personal-mode.js');

const JS = __dirname;
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

test('vbPersonalModeRead rejects with a personal-mode error and never calls fetch', async () => {
    const prev = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({}) }; };
    try {
        await assert.rejects(vbPersonalModeRead('https://example.test/x'), (e) => e.personalMode === true && e.message === NOTICE);
        assert.equal(calls, 0);
    } finally { globalThis.fetch = prev; }
});

test('the only bare fetch() calls left in js/ are same-origin or the authenticated wrapper', () => {
    // Strip comments so prose mentioning fetch() does not count.
    // Line comments first: a line comment may contain '/*' (e.g. "/api/ops/*").
    const code = (src) => src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    const found = {};
    for (const f of fs.readdirSync(JS).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))) {
        for (const line of code(read(f)).split('\n')) {
            if (/(^|[^\w.])fetch\(/.test(line)) (found[f] = found[f] || []).push(line.trim());
        }
    }
    assert.deepEqual(found, {
        'agent-ops.js': [": await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });"], // ENDPOINT = '/api/agent-ops' (verified proxy)
        'auth.js': [
            'async fetch(url, opts) {',                                             // the VBAuth.fetch method definition
            'return fetch(url, Object.assign({}, opts, { headers }));',            // inside VBAuth.fetch: Bearer token attached
            "const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });",
        ],
        'ops-console.js': ['const res = await fetch(`js/fixtures/${FIXTURE}.sample.json`);'],
    });
    assert.match(read('agent-ops.js'), /const ENDPOINT = '\/api\/agent-ops';/);
});

// ── Minimal DOM sandbox ────────────────────────────────────────────────────
function fakeEl() {
    const el = {
        textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, children: [],
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
        querySelector: () => fakeEl(), querySelectorAll: () => [], closest: () => null, matches: () => false,
        insertAdjacentHTML() {}, remove() {},
    };
    return el;
}

function sandbox() {
    const fetchCalls = [];
    const domReady = [];
    const timers = [];
    const document = {
        readyState: 'complete',
        getElementById: () => fakeEl(),
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        createElement: () => fakeEl(),
        addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') domReady.push(fn); },
        head: fakeEl(), body: fakeEl(),
    };
    const ctx = {
        document, console: { log() {}, warn() {}, error() {} },
        fetch: (...a) => { fetchCalls.push(String(a[0])); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); },
        setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {},
        setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
        location: { search: '', hash: '', href: 'https://dashboard.example.test/' },
        URLSearchParams, Promise, Date, Math, JSON, Error, Number, String, Object, Array, isNaN, encodeURIComponent,
    };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    return { ctx, fetchCalls, domReady, timers, attempted: [] };
}

const DISABLED_MODULES = ['dashboard.js', 'quant.js', 'data-collector.js', 'catalyst-accuracy.js', 'scanner-metrics.js'];

async function driveAll(sb, extraScripts = []) {
    const { ctx, domReady, timers } = sb;
    vm.runInContext(read('personal-mode.js'), ctx, { filename: 'personal-mode.js' });
    // Record what each call site asked for (call sites resolve the global at call time).
    const stub = ctx.vbPersonalModeRead;
    ctx.vbPersonalModeRead = (url) => { sb.attempted.push(new URL(String(url)).pathname); return stub(url); };
    for (const f of DISABLED_MODULES) vm.runInContext(read(f), ctx, { filename: f });
    for (const src of extraScripts) vm.runInContext(src, ctx);
    for (const fn of domReady) fn();
    // Every entry point that used to read the backend.
    await vm.runInContext(`Promise.allSettled([
        refresh(), fetchWSStatus(), fetchActionEngineBacktest(),
        refreshQuantHealth(), refreshQuantLive(), refreshQuantTrainingRuns(), refreshQuantBacktests(), refreshQuantileReport(),
        refreshDataCollectorHealth(),
    ])`, ctx);
    // Interval and timeout callbacks (auto-refresh, lazy tab loads), twice.
    for (let i = 0; i < 2; i++) for (const fn of timers.slice()) { try { await fn(); } catch (_e) { /* DOM stub gaps are not under test */ } }
    await new Promise((r) => setImmediate(r));
}

test('loading and driving every formerly-reading module makes no request', async () => {
    const sb = sandbox();
    await driveAll(sb);
    assert.deepEqual(sb.fetchCalls, []);
    // Not vacuous: every former read site was reached and went to the stub.
    const reached = [...new Set(sb.attempted)].sort();
    assert.deepEqual(reached, [
        '/api/action-engine/backtest/stats', '/api/action-engine/backtest/trend',
        '/api/data-collector/health', '/api/internal/ws-status',
        '/api/llm-catalyst-accuracy', '/api/llm-usage/scanner', '/api/llm-usage/today', '/api/llm-usage/week',
        '/api/quant/backtests', '/api/quant/health', '/api/quant/live-predictions', '/api/quant/training-runs',
        '/api/quantile-report', '/api/scanner/metrics',
    ]);
});

test('control: the sandbox does detect a request', async () => {
    const sb = sandbox();
    await driveAll(sb, ["fetch('https://example.test/control');"]);
    assert.deepEqual(sb.fetchCalls, ['https://example.test/control']);
});

test('index.html: static notice on exactly the six disabled tabs; personal-mode.js loads first', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const disabled = [...html.matchAll(/<div id="tab-([a-z0-9-]+)" class="personal-mode-disabled"[^>]*>\s*<div class="personal-mode-notice" role="status">\s*<strong>Disabled in personal research mode\.<\/strong>/g)].map((m) => m[1]);
    assert.deepEqual(disabled, ['llm-usage', 'system-health', 'action-engine', 'quant-quality', 'data-collector', 'catalyst-accuracy']);
    for (const kept of ['agent-ops', 'ops-shadow', 'ops-heartbeats', 'ops-r4']) {
        assert.match(html, new RegExp(`<div id="tab-${kept}"(?![^>]*personal-mode-disabled)[^>]*>`), kept);
    }
    const scripts = [...html.matchAll(/<script[^>]*src="(js\/[^"]+)"/g)].map((m) => m[1]);
    assert.equal(scripts[0], 'js/personal-mode.js');
    assert.ok(scripts.includes('js/auth.js'), 'auth plumbing still loaded');
    const css = fs.readFileSync(path.join(ROOT, 'styles', 'dashboard.css'), 'utf8');
    assert.match(css, /\.personal-mode-disabled > :not\(\.personal-mode-notice\) \{ display: none !important; \}/);
});
