'use strict';
// Harness tab (js/harness.js): every fixture variant renders without
// throwing and says what it should; data-derived HTML is escaped; the live
// path reads /api/ops/harness only with the admin bearer, polls only while
// the tab is active and the page visible, and Do next / Skip / Undo POST,
// disable the buttons while in flight, and show an inline error on failure.
// Runs the real page scripts in the fake DOM derived from index.html.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, offendingMarkup, read } = require('./_test_dom.js');

const SCRIPTS = [...read('index.html').matchAll(/<script[^>]*src="(js\/[^"]+)"/g)].map(m => m[1]);

async function page(search, opts) {
    const errors = [];
    const sb = createSandbox({ search: search || '', console: { log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) } });
    sb.errors = errors;
    if (opts && opts.fixture) sb.load('js/harness-fixture.js'); // a real browser injects it lazily
    for (const s of SCRIPTS) sb.load(s);
    await sb.flush();
    sb.adapter = { cb: null, onAuthStateChanged(cb) { this.cb = cb; }, signOut: () => Promise.resolve() };
    sb.ctx.VBAuth.bind(sb.adapter);
    sb.signIn = async () => { sb.adapter.cb({ email: 'k@example.test', uid: 'u1', getIdToken: async () => 'tok-H' }); await sb.flush(); };
    sb.signOut = async () => { const p = sb.ctx.VBAuth.signOut(); sb.adapter.cb(null); await sb.flush(); return p; };
    sb.html = id => sb.byId.get(id).innerHTML;
    sb.harnessCalls = () => sb.fetchCalls.filter(c => c.url.startsWith('/api/ops/harness'));
    return sb;
}

function routeHarness(sb, fn) {
    const orig = sb.ctx.fetch;
    sb.ctx.fetch = (url, o) => (String(url).startsWith('/api/ops/harness') ? (sb.fetchCalls.push({ url: String(url), opts: o || {}, headers: (o && o.headers) || {} }), fn(String(url), o || {})) : orig(url, o));
}
const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

// ── fixture variants ──────────────────────────────────────────────────────

test('fixture=harness: lands on the tab without sign-in and renders every section', async () => {
    const sb = await page('?fixture=harness', { fixture: true });
    assert.equal(sb.activeTab(), 'harness');
    assert.equal(sb.tabButton('harness').hasAttribute('data-ops-tab'), false, 'fixture makes the one button an ordinary tab');
    assert.equal(sb.byId.get('hz-board').style.display, '');
    assert.equal(sb.byId.get('hz-message').hidden, true);
    assert.match(sb.html('hz-strip'), /Running · beat 3 min ago/);
    assert.match(sb.html('hz-strip'), /Deploys closed/);
    assert.match(sb.html('hz-strip'), /next tick \d\d:\d\d PT/);
    const kpis = sb.html('hz-kpis');
    for (const s of ['Running now', 'of 2 lanes · 3 queued', 'Needs you', 'Done · 7 days', 'Build → ready', 'Queued']) assert.ok(kpis.includes(s), s);
    assert.match(kpis, /hz-alert/);
    assert.match(sb.html('hz-needs'), /Approve a backend start/);
    assert.ok(!sb.html('hz-needs').includes('Old resolved question'));
    assert.equal(sb.byId.get('hz-needs-badge').textContent, '1 open');
    assert.ok(sb.byId.get('hz-needs-card').classList.contains('hz-needs-open'));
    const lanes = sb.html('hz-lanes');
    assert.match(lanes, /Retire the dead v2_reason readers/);
    assert.match(lanes, /Mobile Lab: keep the rank band legend/);
    assert.equal((lanes.match(/<ol class="hz-steps">/g) || []).length, 2);
    assert.match(lanes, /<li class="now">Astra<\/li>/);
    assert.match(lanes, /<li class="now">Deploy<\/li>/);
    const q = sb.html('hz-queue');
    assert.equal((q.match(/<tr>/g) || []).length, 4, 'header + 3 queued rows');
    assert.match(q, /data-hz-act="top" data-hz-id="pipeline-203"/);
    assert.match(q, /skip sent/);
    assert.match(q, /data-hz-act="undo" data-hz-id="backend-529"/);
    assert.equal(sb.byId.get('hz-queue-badge').textContent, '3 queued');
    assert.equal((sb.html('hz-feed').match(/<li>/g) || []).length, 10);
    const done = sb.html('hz-done');
    for (const s of ['docs-410', 'merged + published', 'skipped by you', 'stopped', 'ios-140']) assert.ok(done.includes(s), s);
    assert.equal(sb.byId.get('hz-done-badge').textContent, '5');
    assert.match(sb.byId.get('hz-foot').textContent, /Last written by the harness .* PT$/);
    assert.equal(sb.harnessCalls().length, 0, 'fixture mode never calls the API');
    assert.deepEqual(sb.errors, []);
});

test('fixture=harness: Do next / Undo round-trip through the in-memory fixture', async () => {
    const sb = await page('?fixture=harness', { fixture: true });
    await sb.ctx.HarnessTab.veto('pipeline-203', 'top');
    assert.match(sb.html('hz-queue'), /do next sent/);
    await sb.ctx.HarnessTab.veto('pipeline-203', 'undo');
    assert.match(sb.html('hz-queue'), /data-hz-act="top" data-hz-id="pipeline-203"/);
});

const STATES = [
    ['harness-empty', /The harness has not reported yet/, true],
    ['harness-notconfigured', /Harness board is not configured[\s\S]*BLOB_READ_WRITE_TOKEN/, false],
    ['harness-forbidden', /This account is not an admin/, false],
    ['harness-signedout', /Admin sign-in required/, false],
    ['harness-unreachable', /Harness board unavailable/, false],
];
for (const [kind, re, boardShown] of STATES) {
    test(`fixture=${kind}: explicit state, no stale board`, async () => {
        const sb = await page('?fixture=' + kind, { fixture: true });
        assert.equal(sb.activeTab(), 'harness');
        assert.match(sb.html('hz-message'), re);
        assert.equal(sb.byId.get('hz-message').hidden, false);
        assert.equal(sb.byId.get('hz-board').style.display, boardShown ? '' : 'none');
        if (boardShown) {
            assert.match(sb.html('hz-strip'), /has not reported yet/);
            assert.match(sb.html('hz-queue'), /The queue is empty/);
            assert.match(sb.html('hz-done'), /No finished tasks yet/);
            assert.match(sb.html('hz-lanes'), /No task in this lane/);
        }
        assert.deepEqual(sb.errors, []);
    });
}

test('other fixture values do not trigger the Harness fixture (and harness values do not trigger the Agents one)', async () => {
    const sb = await page('?fixture=1');
    assert.equal(sb.ctx.HarnessTab._fixture, null);
    assert.equal(sb.tabButton('harness').hasAttribute('data-ops-tab'), true);
    const sb2 = await page('?fixture=harness', { fixture: true });
    assert.ok(!sb2.fetchCalls.some(c => c.url === '/api/agent-ops'));
});

// ── escaping ──────────────────────────────────────────────────────────────

test('data-derived HTML is escaped everywhere (titles, needs, events, links, ids)', async () => {
    const sb = await page('?fixture=harness', { fixture: true });
    const X = '<script>alert(1)</script>';
    const Q = '" onmouseover="alert(1)';
    const now = new Date().toISOString();
    sb.ctx.HarnessTab.apply(200, {
        state: {
            schema_version: 1,
            status: { mode: 'running', heartbeat_at: now, lanes: [{ id: 'lane-1', task_id: 'a' }], deploy_window: { open: true, note: Q }, synced_at: now },
            tasks: [
                { id: 'a', title: X, source: X, repo: X, state: 'implementing', risk: 'low', pr: 'javascript:alert(1)', pr_label: X, head: X, summary: X, stop_reason: X },
                { id: 'q', title: X, source: Q, why: X, repo: Q, state: 'queued', rank: 1 },
                { id: 'd', title: X, repo: X, state: 'done', outcome: X, pr: 'https://github.com/camellk24/vibebullish-x/pull/1' + Q, done_at: now },
            ],
            needs: [{ question: X, detail: X, kind: X, task_id: X, since: now, link: 'https://example.test/' + Q }],
            events: [{ ts: now, kind: X, task_id: X, text: X }],
        },
        vetoes: {},
    });
    const all = sb.allHtml().join('\n');
    assert.deepEqual(offendingMarkup(all), []);
    assert.ok(all.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!/href="javascript:/i.test(all), 'non-http links are not rendered as links');
    assert.deepEqual(sb.errors, []);
});

// ── live path ─────────────────────────────────────────────────────────────

test('signed out: the tab button is hidden, a forced click shows the sign-in state and requests nothing', async () => {
    const sb = await page('');
    assert.equal(sb.tabButton('harness').style.display, 'none');
    sb.clickTab('harness');
    await sb.flush();
    assert.match(sb.html('hz-message'), /Admin sign-in required/);
    assert.equal(sb.byId.get('hz-board').style.display, 'none');
    assert.equal(sb.harnessCalls().length, 0);
});

test('admin: reads with the bearer, renders, polls every 60 s only while active and visible, stops on leaving', async () => {
    const sb = await page('');
    routeHarness(sb, () => json(200, { state: null, vetoes: {}, read_at: new Date().toISOString() }));
    await sb.signIn();
    assert.equal(sb.tabButton('harness').style.display, '');
    sb.clickTab('harness');
    await sb.flush();
    let calls = sb.harnessCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/ops/harness');
    assert.equal(calls[0].headers.Authorization, 'Bearer tok-H');
    assert.match(sb.html('hz-message'), /has not reported yet/);
    const poll = sb.timers.intervals.filter(t => t.ms === 60000);
    assert.equal(poll.length, 1);

    poll[0].fn(); await sb.flush();
    assert.equal(sb.harnessCalls().length, 2);

    sb.doc.hidden = true;
    poll[0].fn(); await sb.flush();
    assert.equal(sb.harnessCalls().length, 2, 'no poll while the page is hidden');
    sb.doc.hidden = false;

    sb.clickTab('agent-ops'); await sb.flush();
    assert.equal(sb.timers.intervals.filter(t => t.fn === poll[0].fn).length, 0, 'poll timer cleared on leaving the tab');
});

test('admin: API error kinds render their states; sign-out clears the board', async () => {
    const sb = await page('');
    let next = json(503, { error: 'not_configured', message: 'No Vercel Blob store is connected … BLOB_READ_WRITE_TOKEN …' });
    routeHarness(sb, () => next);
    await sb.signIn();
    sb.clickTab('harness'); await sb.flush();
    assert.match(sb.html('hz-message'), /Harness board is not configured/);
    next = json(502, { error: 'unreachable', message: 'The Blob store did not answer.' });
    await sb.ctx.HarnessTab.load();
    assert.match(sb.html('hz-message'), /Harness board unavailable/);
    next = json(200, { state: { schema_version: 1, status: null, tasks: [{ id: 'q1', title: 'Queued one', state: 'queued' }] }, vetoes: {} });
    await sb.ctx.HarnessTab.load();
    assert.equal(sb.byId.get('hz-board').style.display, '');
    assert.match(sb.html('hz-queue'), /Queued one/);

    await sb.signOut();
    assert.equal(sb.html('hz-queue'), '');
    assert.equal(sb.activeTab(), 'llm-usage', 'ops-console falls back to a public tab');
    assert.match(sb.html('hz-message'), /Admin sign-in required/);
});

test('veto: POSTs the body with the bearer, disables every button while in flight, re-renders from the response', async () => {
    const sb = await page('');
    let release;
    routeHarness(sb, (url, o) => {
        if (o.method === 'POST') return new Promise(r => { release = () => r({ ok: true, status: 200, json: async () => ({ vetoes: { q1: { action: 'skip', at: 'x', by_uid: 'u1' } } }) }); });
        return json(200, { state: { schema_version: 1, tasks: [{ id: 'q1', title: 'One', state: 'queued', rank: 1 }, { id: 'q2', title: 'Two', state: 'queued', rank: 2 }] }, vetoes: {} });
    });
    await sb.signIn();
    sb.clickTab('harness'); await sb.flush();

    // A click on a rendered button routes through the panel's delegated listener.
    const btn = new sb.El('button', { 'data-hz-act': 'skip', 'data-hz-id': 'q1' });
    sb.panels.harness.appendChild(btn);
    btn.click();
    await sb.flush();
    const post = sb.harnessCalls().find(c => c.opts.method === 'POST');
    assert.equal(post.url, '/api/ops/harness?view=veto');
    assert.equal(post.headers.Authorization, 'Bearer tok-H');
    assert.deepEqual(JSON.parse(post.opts.body), { task_id: 'q1', action: 'skip' });
    const during = sb.html('hz-queue');
    assert.equal((during.match(/ disabled>/g) || []).length, 4, 'all four buttons disabled while in flight');

    // A second click while busy is ignored.
    await sb.ctx.HarnessTab.veto('q2', 'top');
    assert.equal(sb.harnessCalls().filter(c => c.opts.method === 'POST').length, 1);

    release(); await sb.flush();
    const after = sb.html('hz-queue');
    assert.match(after, /skip sent/);
    assert.match(after, /data-hz-act="undo" data-hz-id="q1"/);
    assert.ok(!/ disabled>/.test(after));
    assert.equal(sb.byId.get('hz-action-error').hidden, true);
});

test('veto failure shows an inline error line and re-enables the buttons', async () => {
    const sb = await page('');
    routeHarness(sb, (url, o) => o.method === 'POST'
        ? json(409, { error: 'conflict', message: 'The vetoes file changed while this request was saving. Try again.' })
        : json(200, { state: { schema_version: 1, tasks: [{ id: 'q1', title: 'One', state: 'queued' }] }, vetoes: {} }));
    await sb.signIn();
    sb.clickTab('harness'); await sb.flush();
    await sb.ctx.HarnessTab.veto('q1', 'top');
    const err = sb.byId.get('hz-action-error');
    assert.equal(err.hidden, false);
    assert.match(err.textContent, /did not save \(conflict\)/);
    assert.ok(!/ disabled>/.test(sb.html('hz-queue')));
    assert.match(sb.html('hz-queue'), /data-hz-act="top" data-hz-id="q1"/);
});

test('queue: a task id of __proto__ / constructor shows Do next + Skip until a veto is really saved', async () => {
    const sb = await page('');
    // JSON.parse yields {} for vetoes: inherited keys must not read as an existing veto.
    routeHarness(sb, () => json(200, JSON.parse(JSON.stringify({ state: { schema_version: 1, tasks: [
        { id: '__proto__', title: 'Proto task', state: 'queued', rank: 1 },
        { id: 'constructor', title: 'Ctor task', state: 'queued', rank: 2 },
    ] }, vetoes: {} }))));
    await sb.signIn();
    sb.clickTab('harness'); await sb.flush();
    const q = sb.html('hz-queue');
    assert.doesNotMatch(q, /Undo/);
    assert.equal((q.match(/Do next/g) || []).length, 2);
});
