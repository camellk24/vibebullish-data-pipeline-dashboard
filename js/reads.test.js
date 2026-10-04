'use strict';
// VBReads.get (js/reads.js): the only client path for the recovered reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshReads(win) {
    global.window = win;
    delete require.cache[require.resolve('./reads.js')];
    const mod = require('./reads.js');
    return mod;
}
function restore() { delete global.window; }

test('no VBAuth at all → unauthenticated, zero network', async () => {
    const R = freshReads({});
    try {
        const r = await R.get('quant-health');
        assert.equal(r.ok, false); assert.equal(r.kind, 'unauthenticated');
    } finally { restore(); }
});

test('isAdmin false → unauthenticated, VBAuth.fetch is never called', async () => {
    let calls = 0;
    const R = freshReads({ VBAuth: { isAdmin: false, gen: 3, fetch: async () => { calls++; } } });
    try {
        const r = await R.get('llm-today', { date: '2026-10-04' });
        assert.deepEqual([r.ok, r.kind, r.gen, calls], [false, 'unauthenticated', 3, 0]);
    } finally { restore(); }
});

test('admin → one VBAuth.fetch to /api/ops/reads with requireAuth, allow-listed params only, cache-buster never sent', async () => {
    const seen = [];
    const R = freshReads({ VBAuth: { isAdmin: true, gen: 7, fetch: async (url, opts) => { seen.push({ url, opts }); return { status: 200, json: async () => ({ rows: [1] }) }; } } });
    try {
        const r = await R.get('catalyst-accuracy', { dimension: 'model', days: 30, t: undefined, nothing: null, empty: '', obj: { a: 1 }, fn: () => 1 });
        assert.equal(r.ok, true); assert.deepEqual(r.body, { rows: [1] }); assert.equal(r.gen, 7);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].url, '/api/ops/reads?view=catalyst-accuracy&dimension=model&days=30');
        assert.equal(seen[0].opts.requireAuth, true);
    } finally { restore(); }
});

test('caller input is query-encoded, never concatenated', async () => {
    const seen = [];
    const R = freshReads({ VBAuth: { isAdmin: true, gen: 1, fetch: async (url) => { seen.push(url); return { status: 200, json: async () => ({}) }; } } });
    try {
        await R.get('llm-today', { date: '2026-10-04&view=ws-status#x' });
        assert.equal(seen[0], '/api/ops/reads?view=llm-today&date=2026-10-04%26view%3Dws-status%23x');
    } finally { restore(); }
});

test('token failure / sign-out during acquisition → requireAuth rejection maps to unauthenticated (no body read)', async () => {
    const R = freshReads({ VBAuth: { isAdmin: true, gen: 1, fetch: async () => { const e = new Error('x'); e.unauthenticated = true; throw e; } } });
    try {
        const r = await R.get('quant-health');
        assert.deepEqual([r.ok, r.kind], [false, 'unauthenticated']);
    } finally { restore(); }
});

test('typed proxy errors map to kinds; a network throw is unreachable', async () => {
    const cases = [
        [{ status: 404, body: { error: 'not_found', message: 'nope', upstream_status: 404 } }, 'not_found'],
        [{ status: 503, body: { error: 'not_configured', message: 'set token' } }, 'not_configured'],
        [{ status: 403, body: { error: 'forbidden', message: 'no' } }, 'forbidden'],
        [{ status: 401, body: { error: 'unauthenticated' } }, 'unauthenticated'],
        [{ status: 502, body: { error: 'upstream_error', message: 'Backend response withheld.' } }, 'upstream_error'],
        [{ status: 400, body: { error: 'bad_request' } }, 'bad_request'],
        [{ status: 500, body: null }, 'unreachable'],
        [{ status: 200, body: { error: 'weird' } }, 'weird'],
    ];
    for (const [resp, kind] of cases) {
        const R = freshReads({ VBAuth: { isAdmin: true, gen: 1, fetch: async () => ({ status: resp.status, json: async () => { if (resp.body === null) throw new Error('bad json'); return resp.body; } }) } });
        try {
            const r = await R.get('quant-health');
            assert.equal(r.ok, false, kind); assert.equal(r.kind, kind);
        } finally { restore(); }
    }
    const R = freshReads({ VBAuth: { isAdmin: true, gen: 1, fetch: async () => { throw new Error('offline'); } } });
    try {
        const r = await R.get('quant-health');
        assert.deepEqual([r.ok, r.kind, r.message], [false, 'unreachable', 'offline']);
    } finally { restore(); }
});

test('esc is attribute-safe; num/fixed reject non-finite and HTML-bearing values', () => {
    const R = freshReads({});
    try {
        assert.equal(R.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
        assert.equal(R.esc(null), ''); assert.equal(R.esc(undefined), '');
        assert.equal(R.num('12.5'), 12.5); assert.equal(R.num(3), 3);
        for (const bad of ['<img>', 'NaN', Infinity, '', null, undefined, {}, [], 'abc']) assert.equal(R.num(bad), null, String(bad));
        assert.equal(R.fixed('1.234', 2), '1.23'); assert.equal(R.fixed('<img src=x>', 1), '—');
    } finally { restore(); }
});

test('unavailable() renders an escaped, typed state that replaces prior content', () => {
    const R = freshReads({});
    try {
        const el = { innerHTML: '<b>old 42</b>' };
        R.unavailable(el, 'not_found', 'Backend returned HTTP 404 for /api/quant/health <img src=x onerror=1>');
        assert.ok(el.innerHTML.includes('Not available on this backend yet'));
        assert.ok(!el.innerHTML.includes('old 42'));
        assert.ok(!el.innerHTML.includes('<img'));
        assert.ok(el.innerHTML.includes('&lt;img src=x onerror=1&gt;'));
        R.unavailable(null, 'x', 'y'); // no-op, no throw
    } finally { restore(); }
});

test('reads.js has zero native fetch calls and exactly one requireAuth VBAuth.fetch call site', () => {
    const src = require('node:fs').readFileSync(path.join(__dirname, 'reads.js'), 'utf8')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    const native = src.split('\n').filter(l => /(^|[^\w.])fetch\(/.test(l) || /(window|globalThis|self)\.fetch\(/.test(l));
    assert.deepEqual(native, []);
    const authFetch = src.split('\n').filter(l => /VBAuth\.fetch\(/.test(l));
    assert.equal(authFetch.length, 1);
    assert.match(authFetch[0], /requireAuth:\s*true/);
});
