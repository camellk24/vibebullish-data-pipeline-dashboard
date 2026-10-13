// node --test api/*.test.js
//
// Loader coverage for the Strategies tab in js/ops-console.js
// (OpsConsole.loadStrategies → /api/ops/strategy-diagnostics). Loads the real
// shipped IIFE against a minimal fake window/document, as
// api/ops_console_sleeves.test.js does. Rendering itself is covered in
// js/strategy-diagnostics-format.test.js.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', 'js', 'ops-console.js');
const FORMAT_PATH = path.join(__dirname, '..', 'js', 'strategy-diagnostics-format.js');

function makeEl(id) {
    return {
        id,
        innerHTML: '',
        textContent: '',
        className: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAttribute() { return null; },
        setAttribute() {},
        closest() { return null; },
    };
}

function flushAsync(turns) {
    let p = Promise.resolve();
    for (let i = 0; i < (turns || 4); i++) {
        p = p.then(() => new Promise(resolve => setTimeout(resolve, 0)));
    }
    return p;
}

function jsonResponse(status, body) {
    return { status, async json() { return body; } };
}

// `responder(callIndex)` returns a response or a promise of one.
function loadConsole(responder) {
    delete require.cache[require.resolve(MODULE_PATH)];
    delete require.cache[require.resolve(FORMAT_PATH)];
    const elements = new Map();
    const doc = {
        readyState: 'complete',
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeEl(id));
            return elements.get(id);
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
    };
    const calls = [];
    const win = { addEventListener() {} };
    win.VBAuth = {
        isAdmin: true,
        async fetch(p) {
            calls.push(p);
            return responder(calls.length - 1);
        },
    };
    global.window = win;
    global.document = doc;
    require(FORMAT_PATH);
    require(MODULE_PATH);
    return { win, doc, calls };
}

const BODY = {
    status: 'DIAGNOSTIC',
    degraded: false,
    generated_at: '2026-10-13T19:45:30Z',
    params: { corr_window_sessions: 60, corr_min_sessions: 30, corr_floor_sessions: 10, benchmark: 'SPY' },
    books: [{ book_id: 57, label: 'pure_quant', presentation: 'diagnostic', registry: 'A21', sessions_observed: 17 }],
    correlation: { pairs: [], cap: { state: 'policy_pending' } },
};

test.after(() => {
    delete global.window;
    delete global.document;
});

test('loadStrategies: reads /api/ops/strategy-diagnostics and renders the card and badge', async () => {
    const { win, doc, calls } = loadConsole(() => jsonResponse(200, BODY));
    await win.OpsConsole.loadStrategies();
    assert.deepStrictEqual(calls, ['/api/ops/strategy-diagnostics']);
    assert.match(doc.getElementById('ops-sd-panel').innerHTML, /pure_quant/);
    assert.strictEqual(doc.getElementById('ops-sd-summary').textContent, '1 books · 0 pairs · 0 observed');
});

test('loadStrategies: a proxy error renders the unavailable state, never stale numbers', async () => {
    let n = 0;
    const { win, doc } = loadConsole(() =>
        n++ === 0
            ? jsonResponse(200, BODY)
            : jsonResponse(502, { error: 'upstream_error', message: 'Backend returned HTTP 503.' }));
    await win.OpsConsole.loadStrategies();
    assert.match(doc.getElementById('ops-sd-panel').innerHTML, /pure_quant/);
    await win.OpsConsole.loadStrategies();
    const html = doc.getElementById('ops-sd-panel').innerHTML;
    assert.match(html, /Backend unavailable/);
    assert.doesNotMatch(html, /pure_quant/);
});

test('loadStrategies: a body without a books list is malformed, not an empty card', async () => {
    const { win, doc } = loadConsole(() => jsonResponse(200, { status: 'DIAGNOSTIC' }));
    await win.OpsConsole.loadStrategies();
    assert.match(doc.getElementById('ops-sd-panel').innerHTML, /Malformed response/);
});

test('loadStrategies: a slower earlier response never overwrites a newer one', async () => {
    let releaseFirst;
    const first = new Promise(resolve => { releaseFirst = resolve; });
    const { win, doc } = loadConsole(i =>
        i === 0
            ? first.then(() => jsonResponse(200, Object.assign({}, BODY, { books: [{ book_id: 1, label: 'OLD_BOOK' }] })))
            : jsonResponse(200, BODY));
    const p1 = win.OpsConsole.loadStrategies();
    await win.OpsConsole.loadStrategies();
    releaseFirst();
    await p1;
    await flushAsync();
    const html = doc.getElementById('ops-sd-panel').innerHTML;
    assert.match(html, /pure_quant/);
    assert.doesNotMatch(html, /OLD_BOOK/);
});

test('loadStrategies: a response that lands after sign-out is dropped', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { win, doc } = loadConsole(() => gate.then(() => jsonResponse(200, BODY)));
    const p = win.OpsConsole.loadStrategies();
    win.VBAuth.isAdmin = false;               // signed out while the read was in flight
    doc.getElementById('ops-sd-panel').innerHTML = '';
    release();
    await p;
    await flushAsync();
    assert.strictEqual(doc.getElementById('ops-sd-panel').innerHTML, '');
});

test('loadStrategies: not an admin → no request at all', async () => {
    const { win, calls } = loadConsole(() => jsonResponse(200, BODY));
    win.VBAuth.isAdmin = false;
    await win.OpsConsole.loadStrategies();
    assert.deepStrictEqual(calls, []);
});
