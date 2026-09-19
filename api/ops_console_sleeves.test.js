// node --test api/*.test.js
//
// Render coverage for the sleeve 2 (task 7) additions to js/ops-console.js:
// the sleeve selector and the diffs panel's comparison selector, both fed by
// /api/ops/shadow?view=sleeves. js/ops-console.js is a browser IIFE (no
// module.exports, bare `window`/`document` references), so this loads it
// against a minimal fake DOM/window rather than importing it as a module —
// the same "load the real shipped source" spirit as api/escaping.test.js.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', 'js', 'ops-console.js');

// addEventListener is captured (not a no-op) so tests can fire a change event
// on a <select> the module rendered, e.g. to simulate the user picking a
// different sleeve/comparison mid-flight. `_fire(type, evt)` runs every
// listener registered for that type.
function makeEl(id) {
    const listeners = {};
    return {
        id,
        value: undefined,
        innerHTML: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAttribute() { return null; },
        setAttribute() {},
        closest() { return null; },
        _fire(type, evt) {
            (listeners[type] || []).forEach(fn => fn(evt));
        },
    };
}

// Lets in-flight promise chains (opsGet's await fetch + await json, plus any
// .then() hops added by a test's own deferred responder) settle before the
// test inspects DOM state. A couple of macrotask turns is enough for the
// chains used in this file's race tests.
function flushAsync(turns) {
    let p = Promise.resolve();
    for (let i = 0; i < (turns || 3); i++) {
        p = p.then(() => new Promise(resolve => setTimeout(resolve, 0)));
    }
    return p;
}

function makeFakeDocument() {
    const elements = new Map();
    return {
        readyState: 'complete',
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeEl(id));
            return elements.get(id);
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
    };
}

function jsonResponse(status, body) {
    return { status, async json() { return body; } };
}

// Loads a FRESH instance of js/ops-console.js against its own fake
// window/document (bust the require cache — the file is a self-executing
// IIFE, so a cached require would just hand back the previous instance's
// closure state). `routes`: URL-substring → () => {status, body} responder;
// anything unmatched answers 404 not_found, same as an undeployed endpoint.
function loadConsole(routes) {
    delete require.cache[require.resolve(MODULE_PATH)];
    const doc = makeFakeDocument();
    const calls = [];
    const win = { addEventListener() {} };
    win.VBAuth = {
        isAdmin: true,
        async fetch(p) {
            calls.push(p);
            for (const [needle, fn] of Object.entries(routes)) {
                if (p.includes(needle)) return fn(p);
            }
            return jsonResponse(404, { error: 'not_found', message: 'not deployed' });
        },
    };
    global.window = win;
    global.document = doc;
    require(MODULE_PATH);
    return { win, doc, calls };
}

const TWO_SLEEVES_FIXTURE = {
    sleeves: [
        {
            name: 'baseline_v2',
            version: 1,
            book_id: 61,
            release_id: 'baseline_v2@1',
            legacy_book_id: 53,
            routines: { engine: 'shadow_engine', dispatcher: 'shadow_dispatcher', diff: 'shadow_diff' },
            comparisons: [{ counterpart_book_id: 53, kind: 'legacy' }],
        },
        {
            name: 'trailing_v2',
            version: 1,
            book_id: 62,
            release_id: 'trailing_v2@1',
            legacy_book_id: 56,
            routines: {
                engine: 'shadow_engine.trailing_v2',
                dispatcher: 'shadow_dispatcher.trailing_v2',
                diff: 'shadow_diff.trailing_v2',
            },
            comparisons: [
                { counterpart_book_id: 56, kind: 'legacy' },
                { counterpart_book_id: 61, kind: 'sleeve' },
            ],
        },
    ],
};

function routesFor(fixture) {
    return {
        '/api/ops/shadow?view=sleeves': () => jsonResponse(200, fixture),
        '/api/ops/shadow?view=status': () => jsonResponse(200, {}),
        '/api/ops/shadow?view=evidence': () => jsonResponse(200, { rows: [] }),
        '/api/ops/shadow?view=attribution': () => jsonResponse(200, {}),
        '/api/ops/shadow?view=diffs': () => jsonResponse(200, { runs: [] }),
        '/api/ops/shadow?view=alerts': () => jsonResponse(200, { events: [] }),
    };
}

test.after(() => {
    delete global.window;
    delete global.document;
});

test('sleeve selector: renders both sleeves, defaults to the first (baseline)', async () => {
    const { win, doc } = loadConsole(routesFor(TWO_SLEEVES_FIXTURE));
    await win.OpsConsole.loadShadow();

    const wrap = doc.getElementById('ops-sleeve-select-wrap');
    assert.notStrictEqual(wrap.style.display, 'none', 'selector must be shown with two sleeves');
    assert.match(wrap.innerHTML, /<select id="ops-sleeve-select">/);
    assert.match(wrap.innerHTML, /value="61"[^>]*selected/, 'book 61 (baseline, first) is the default selection');
    assert.match(wrap.innerHTML, /baseline_v2/);
    assert.match(wrap.innerHTML, /trailing_v2/);
    // book 62's option must NOT carry `selected`.
    const opt62 = /<option value="62"([^>]*)>/.exec(wrap.innerHTML);
    assert.ok(opt62, 'book 62 option present');
    assert.ok(!/selected/.test(opt62[1]), 'book 62 is not the default');
});

test('comparison selector: defaults to the selected sleeve\'s legacy comparison', async () => {
    const { win, doc } = loadConsole(routesFor(TWO_SLEEVES_FIXTURE));
    await win.OpsConsole.loadShadow();

    const cmpWrap = doc.getElementById('ops-diffs-comparison-wrap');
    assert.notStrictEqual(cmpWrap.style.display, 'none');
    assert.match(cmpWrap.innerHTML, /<select id="ops-diffs-comparison-select">/);
    // Baseline's only declared comparison: legacy book 53.
    assert.match(cmpWrap.innerHTML, /value="53"[^>]*selected/);
    assert.match(cmpWrap.innerHTML, /legacy book 53/);
});

test('comparison selector: sleeve-kind counterpart is labeled by the OTHER sleeve\'s name', async () => {
    const { win, doc } = loadConsole(routesFor(TWO_SLEEVES_FIXTURE));
    // Switch to the trailing sleeve (book 62), which declares both a legacy
    // (56) and a sleeve (61, the baseline) comparison.
    win.OpsConsole.setBookId(62);
    await win.OpsConsole.loadShadow();

    const cmpWrap = doc.getElementById('ops-diffs-comparison-wrap');
    assert.match(cmpWrap.innerHTML, /value="56"/);
    assert.match(cmpWrap.innerHTML, /legacy book 56/);
    assert.match(cmpWrap.innerHTML, /value="61"/);
    assert.match(cmpWrap.innerHTML, /sleeve baseline_v2 \(book 61\)/);
    // Default comparison for a sleeve with a declared legacy entry is that
    // legacy counterpart, not the sleeve-vs-sleeve one.
    assert.match(cmpWrap.innerHTML, /value="56"[^>]*selected/);
});

test('diffs request carries the selected book_id and counterpart_book_id', async () => {
    const { win, calls } = loadConsole(routesFor(TWO_SLEEVES_FIXTURE));
    win.OpsConsole.setBookId(62);
    await win.OpsConsole.loadShadow();

    const diffsCall = calls.find(c => c.includes('view=diffs'));
    assert.ok(diffsCall, 'a diffs request was made');
    assert.match(diffsCall, /book_id=62/);
    assert.match(diffsCall, /counterpart_book_id=56/);
});

test('graceful degrade: /shadow/sleeves 404 (old backend) → no selectors, single-sleeve mode', async () => {
    const routes = routesFor(TWO_SLEEVES_FIXTURE);
    delete routes['/api/ops/shadow?view=sleeves']; // falls through to the 404 default
    const { win, doc, calls } = loadConsole(routes);

    await win.OpsConsole.loadShadow();

    const wrap = doc.getElementById('ops-sleeve-select-wrap');
    const cmpWrap = doc.getElementById('ops-diffs-comparison-wrap');
    assert.strictEqual(wrap.style.display, 'none');
    assert.strictEqual(wrap.innerHTML, '');
    assert.strictEqual(cmpWrap.style.display, 'none');
    assert.strictEqual(cmpWrap.innerHTML, '');

    // The diffs request goes out exactly as it did before sleeve 2 — no
    // book_id (backend default) and no counterpart_book_id.
    const diffsCall = calls.find(c => c.includes('view=diffs'));
    assert.ok(diffsCall);
    assert.ok(!diffsCall.includes('book_id='));
    assert.ok(!diffsCall.includes('counterpart_book_id='));
});

test('comparison selector: a sleeve name with HTML-special characters is escaped exactly once', async () => {
    const fixture = {
        sleeves: [
            {
                name: 'a&b<c"',
                version: 1,
                book_id: 61,
                release_id: 'a_b_c@1',
                legacy_book_id: 53,
                routines: {},
                comparisons: [{ counterpart_book_id: 53, kind: 'legacy' }],
            },
            {
                name: 'trailing_v2',
                version: 1,
                book_id: 62,
                release_id: 'trailing_v2@1',
                legacy_book_id: 56,
                routines: {},
                comparisons: [
                    { counterpart_book_id: 56, kind: 'legacy' },
                    { counterpart_book_id: 61, kind: 'sleeve' },
                ],
            },
        ],
    };
    const { win, doc } = loadConsole(routesFor(fixture));
    win.OpsConsole.setBookId(62);
    await win.OpsConsole.loadShadow();

    const cmpWrap = doc.getElementById('ops-diffs-comparison-wrap');
    // Escaped exactly once: &amp;lt; (double-escaped) must NOT appear, and the
    // correctly single-escaped form must.
    assert.ok(!cmpWrap.innerHTML.includes('&amp;amp;'), 'ampersand must not be double-escaped');
    assert.ok(!cmpWrap.innerHTML.includes('&amp;lt;'), 'the escaped "&lt;" must not itself be re-escaped');
    assert.match(cmpWrap.innerHTML, /sleeve a&amp;b&lt;c&quot; \(book 61\)/);
});

test('unavailable(): a bad_request response renders the "Invalid request" title', async () => {
    const routes = routesFor(TWO_SLEEVES_FIXTURE);
    // Simulate the backend refusing an undeclared counterpart_book_id.
    routes['/api/ops/shadow?view=diffs'] = () =>
        jsonResponse(400, { error: 'bad_request', message: 'counterpart_book_id is not declared for this sleeve.' });
    const { win, doc } = loadConsole(routes);
    await win.OpsConsole.loadShadow();

    const diffsEl = doc.getElementById('ops-shadow-diffs');
    assert.match(diffsEl.innerHTML, /Invalid request/);
    assert.match(diffsEl.innerHTML, /counterpart_book_id is not declared/);
});

test('sleeve selector: a single declared sleeve also hides the selector', async () => {
    const oneSleeve = { sleeves: [TWO_SLEEVES_FIXTURE.sleeves[0]] };
    const { win, doc } = loadConsole(routesFor(oneSleeve));
    await win.OpsConsole.loadShadow();

    const wrap = doc.getElementById('ops-sleeve-select-wrap');
    assert.strictEqual(wrap.style.display, 'none');
    assert.strictEqual(wrap.innerHTML, '');

    // But the diffs request still carries the single sleeve's book_id and its
    // default (legacy) comparison — only the SELECTOR is hidden, not the wiring.
    const cmpWrap = doc.getElementById('ops-diffs-comparison-wrap');
    assert.match(cmpWrap.innerHTML, /legacy book 53/);
});

test('out-of-order responses: a delayed response for the previously selected sleeve does not overwrite the current selection', async () => {
    // book 61 is the default sleeve. Its ?view=status and ?view=evidence
    // responses are held back until release61() is called; book 62's answer
    // immediately. This reproduces Astra's repro: pick 62, its (fast) response
    // renders, then 61's (slow, now-stale) response arrives and must be
    // discarded rather than overwriting the panel.
    let release61;
    const pending61 = new Promise(resolve => {
        release61 = resolve;
    });

    const routes = routesFor(TWO_SLEEVES_FIXTURE);
    routes['/api/ops/shadow?view=status'] = p => {
        if (p.includes('book_id=62')) {
            return jsonResponse(200, { book: { id: 62 }, mode: 'book62-mode' });
        }
        return pending61.then(() => jsonResponse(200, { book: { id: 61 }, mode: 'book61-mode' }));
    };
    routes['/api/ops/shadow?view=evidence'] = p => {
        if (p.includes('book_id=62')) {
            return jsonResponse(200, { rows: [{ ticker: 'BOOK62TICKER' }] });
        }
        return pending61.then(() => jsonResponse(200, { rows: [{ ticker: 'BOOK61TICKER' }] }));
    };

    const { win, doc } = loadConsole(routes);

    // Kick off the initial load (defaults to book 61) without awaiting it —
    // its status/evidence calls are pinned on pending61 and won't resolve
    // until we release them below.
    win.OpsConsole.loadShadow();
    await flushAsync();

    // Selector is up and still shows book 61 as the in-flight selection.
    const sel = doc.getElementById('ops-sleeve-select');
    assert.match(doc.getElementById('ops-sleeve-select-wrap').innerHTML, /value="61"[^>]*selected/);

    // User switches to book 62 while the book-61 requests are still pending.
    sel._fire('change', { target: { value: '62' } });
    await flushAsync();

    const statusEl = doc.getElementById('ops-shadow-status');
    const evidenceEl = doc.getElementById('ops-shadow-evidence');
    assert.match(statusEl.innerHTML, /book62-mode/, 'book 62 status rendered');
    assert.match(evidenceEl.innerHTML, /BOOK62TICKER/, 'book 62 evidence rendered');

    // Now the delayed book-61 response finally lands.
    release61();
    await flushAsync();

    assert.match(statusEl.innerHTML, /book62-mode/, 'stale book 61 status must not overwrite book 62');
    assert.doesNotMatch(statusEl.innerHTML, /book61-mode/);
    assert.match(evidenceEl.innerHTML, /BOOK62TICKER/, 'stale book 61 evidence must not overwrite book 62');
    assert.doesNotMatch(evidenceEl.innerHTML, /BOOK61TICKER/);
});

test('out-of-order responses: a delayed diffs response for the previous comparison does not overwrite the current one', async () => {
    // Start on the trailing sleeve (book 62), which declares two comparisons:
    // legacy book 56 (its default) and sleeve book 61. The legacy-56 diffs
    // response is held back; switching the comparison to sleeve-61 must not
    // let the late 56 response clobber the panel afterward.
    let release56;
    const pending56 = new Promise(resolve => {
        release56 = resolve;
    });

    const routes = routesFor(TWO_SLEEVES_FIXTURE);
    // A run with zero diffs still renders (only an EMPTY runs array short-
    // circuits to the "Nothing recorded yet" unavailable state before the
    // pair line is ever written), so give each response one no-diff run.
    const noDiffRun = { session_date: '2026-09-19', stage: 'reconciled', n_diffs: 0, diffs: [] };
    routes['/api/ops/shadow?view=diffs'] = p => {
        if (p.includes('counterpart_book_id=61')) {
            return jsonResponse(200, { bookId: 62, counterpartBookId: 61, kind: 'sleeve', runs: [noDiffRun] });
        }
        // counterpart_book_id=56 (the initial default for book 62)
        return pending56.then(() =>
            jsonResponse(200, { bookId: 62, counterpartBookId: 56, kind: 'legacy', runs: [noDiffRun] })
        );
    };

    const { win, doc } = loadConsole(routes);
    win.OpsConsole.setBookId(62);
    win.OpsConsole.loadShadow();
    await flushAsync();

    const cmpSel = doc.getElementById('ops-diffs-comparison-select');
    assert.match(
        doc.getElementById('ops-diffs-comparison-wrap').innerHTML,
        /value="56"[^>]*selected/,
        'legacy book 56 is the in-flight default comparison'
    );

    // User switches the comparison to the sleeve counterpart (book 61) while
    // the legacy-56 diffs request is still pending.
    cmpSel._fire('change', { target: { value: '61' } });
    await flushAsync();

    const diffsEl = doc.getElementById('ops-shadow-diffs');
    assert.match(diffsEl.innerHTML, /vs sleeve book 61/, 'sleeve-61 diffs pair line rendered');

    release56();
    await flushAsync();

    assert.match(diffsEl.innerHTML, /vs sleeve book 61/, 'stale legacy-56 diffs must not overwrite sleeve-61');
    assert.doesNotMatch(diffsEl.innerHTML, /vs legacy book 56/);
});
