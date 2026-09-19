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

function makeEl(id) {
    return {
        id,
        innerHTML: '',
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
