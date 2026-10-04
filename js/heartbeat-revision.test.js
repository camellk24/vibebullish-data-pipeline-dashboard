const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the shipped console renderer; only the DOM and HTTP boundary are doubled.
function consoleFor(rows) {
    const elements = new Map();
    const document = {
        readyState: 'complete',
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', style: {},
                classList: { add() {}, remove() {}, contains: () => false } });
            return elements.get(id);
        },
    };
    const window = { DQReadinessFormat: require('./dq-readiness-format.js'), addEventListener() {}, VBAuth: { isAdmin: true, async fetch(url) {
        return { status: 200, async json() { return url.includes('heartbeats') ? rows : { enabled: false }; } };
    } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'ops-console.js'), 'utf8'), {
        window, document, URLSearchParams, location: { search: '' },
    });
    return { rows, window, document, html: () => document.getElementById('ops-hb-table').innerHTML };
}

function beat(detail, status = 'PASS') {
    return { routine: 'daily_bars_eod', last_status: status, enabled: true, late: false,
        last_ran_at: '2026-10-02T22:00:00Z', last_detail: detail };
}
const revision = { session_date: '2026-10-02', note: 'Accepted bars retained; no repair required.',
    post_publish_revision: { accepted_id: 42, batch_id: 'batch-7', differing_tickers_count: 3, rows_parsed: 100 } };

test('daily-bars revision is expandable and preserves the backend status', async () => {
    const c = consoleFor([beat(revision)]);
    await c.window.OpsConsole.loadHeartbeats();
    assert.match(c.html(), /<details[^>]*>/);
    assert.match(c.html(), /<summary>Post-publication revision<\/summary>/);
    for (const text of ['Accepted bars retained', '2026-10-02', 'batch-7', 'Changed tickers: 3', 'Accepted snapshot: 42']) assert.ok(c.html().includes(text), text);
    assert.match(c.html(), />PASS</);
    assert.doesNotMatch(c.html(), />WARN<|>FAIL<|<details[^>]*\bopen\b/);
});

test('detail is escaped and does not override a warning status', async () => {
    const c = consoleFor([beat({ ...revision, note: '<img src=x onerror=alert(1)>',
        session_date: '<session>', post_publish_revision: { ...revision.post_publish_revision, batch_id: '<batch>' } }, 'WARN')]);
    await c.window.OpsConsole.loadHeartbeats();
    assert.match(c.html(), /&lt;img/);
    assert.match(c.html(), /&lt;batch&gt;/);
    assert.match(c.html(), /&lt;session&gt;/);
    assert.doesNotMatch(c.html(), /<img|<batch>|<session>/);
    assert.match(c.html(), />WARN</);
});

test('older or malformed payloads and other routines do not invent revision notes', async () => {
    for (const detail of [undefined, null, 'bad', [], {}, { note: 'no revision' }, { post_publish_revision: [] }]) {
        const c = consoleFor([beat(detail)]);
        await c.window.OpsConsole.loadHeartbeats();
        assert.doesNotMatch(c.html(), /<details/);
        assert.match(c.html(), />PASS</);
    }
    const c = consoleFor([{ ...beat(revision), routine: 'dq_daily' }]);
    await c.window.OpsConsole.loadHeartbeats();
    assert.doesNotMatch(c.html(), /<details/);
});

test('zero counts remain zero and a later heartbeat clears the note', async () => {
    const c = consoleFor([beat({ ...revision, post_publish_revision: { ...revision.post_publish_revision, differing_tickers_count: 0 } })]);
    await c.window.OpsConsole.loadHeartbeats();
    assert.match(c.html(), /Changed tickers: 0/);
    c.rows[0] = beat(null);
    await c.window.OpsConsole.loadHeartbeats();
    assert.doesNotMatch(c.html(), /<details|Accepted bars retained/);
});
