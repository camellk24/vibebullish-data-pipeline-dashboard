// node --test api/
//
// The signed-in reads route (api/ops/reads.js): the exact view table, method
// and view validation (incl. prototype-like names), per-parameter rules
// through BOTH query representations, dropped extras, and a simulated
// pre-#449 / post-#449 upstream for every forwarding mode in the table.

const test = require('node:test');
const assert = require('node:assert');

const handler = require('./reads.js');
const { VIEWS, queryOf } = handler;
const {
    TOKEN, fakeRes, fakeReq, upstreamResponse, installFetch, withEnv, responseSurface,
} = require('../_test_helpers.js');

const BEARER = 'eyJhbGciOiJSUzI1NiJ9.firebase-id-token-3f9a7c2e1d';
const H = { authorization: `Bearer ${BEARER}` };
const admin200 = () => upstreamResponse(200, { uid: 'admin-uid' });

// The table is the contract. Change it deliberately, in both places.
const EXPECTED_TABLE = {
    'llm-today':              ['/api/llm-usage/today',              ['date'],               'bearer'],
    'llm-week':               ['/api/llm-usage/week',               [],                     'bearer'],
    'llm-scanner':            ['/api/llm-usage/scanner',            ['date'],               'bearer'],
    'catalyst-accuracy':      ['/api/llm-catalyst-accuracy',        ['dimension', 'days'],  'bearer'],
    'scanner-metrics':        ['/api/scanner/metrics',              ['hours'],              'bearer'],
    'ae-stats':               ['/api/action-engine/backtest/stats', ['days'],               'bearer'],
    'ae-trend':               ['/api/action-engine/backtest/trend', ['days'],               'bearer'],
    'quant-health':           ['/api/quant/health',                 [],                     'bearer'],
    'quant-live-predictions': ['/api/quant/live-predictions',       ['timeframe', 'limit'], 'bearer'],
    'quant-training-runs':    ['/api/quant/training-runs',          ['limit'],              'bearer'],
    'quant-backtests':        ['/api/quant/backtests',              ['limit'],              'bearer'],
    'quantile-report':        ['/api/quantile-report',              [],                     'bearer'],
    'data-collector-health':  ['/api/data-collector/health',        [],                     'bearer'],
    'ws-status':              ['/api/internal/ws-status',           [],                     'bearer'],
};

test('the view table is exactly the 14 recovered reads, with path, params and mode pinned', () => {
    const actual = {};
    for (const k of Object.keys(VIEWS)) actual[k] = [VIEWS[k].path, VIEWS[k].params, VIEWS[k].forwardAuth];
    assert.deepStrictEqual(actual, EXPECTED_TABLE);
    assert.strictEqual(Object.getPrototypeOf(VIEWS), null);
    // Every view is human-class since backend #449: bearer only, no internal token anywhere.
    assert.deepStrictEqual(Object.keys(VIEWS).filter(k => VIEWS[k].forwardAuth !== 'bearer'), []);
});

test('non-GET → 405, no network', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ method: 'POST', query: { view: 'llm-week' }, headers: H }), res);
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(calls.length, 0);
    });
});

test('unknown and prototype-like view names → 400, no network', async () => {
    for (const view of ['wat', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'LLM-WEEK']) {
        await withEnv(async () => {
            const calls = installFetch({});
            const res = fakeRes();
            await handler(fakeReq({ query: { view }, headers: H }), res);
            assert.strictEqual(res.statusCode, 400, JSON.stringify(view));
            assert.strictEqual(JSON.parse(res.body).error, 'bad_request');
            assert.strictEqual(calls.length, 0, JSON.stringify(view));
        });
    }
    // A missing view (no query at all) is the same refusal.
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ url: '/api/ops/reads', headers: H }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});

async function forwardFor(query, url) {
    let fwd = null;
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': admin200,
            'https://backend.test/api/': () => upstreamResponse(200, { ok: true }),
        });
        const res = fakeRes();
        const req = url ? fakeReq({ url, headers: H }) : fakeReq({ query, headers: H });
        await handler(req, res);
        assert.strictEqual(res.statusCode, 200, res.body);
        fwd = calls.find(c => !c.url.includes('/api/admin/whoami'));
    });
    return fwd;
}

async function rejectFor(query, url) {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        const req = url ? fakeReq({ url, headers: H }) : fakeReq({ query, headers: H });
        await handler(req, res);
        assert.strictEqual(res.statusCode, 400, JSON.stringify(query || url));
        assert.strictEqual(JSON.parse(res.body).error, 'bad_request');
        assert.strictEqual(calls.length, 0, 'no network on a rejected parameter');
    });
}

test('each parameter rule: valid values are forwarded, invalid ones are rejected without network', async () => {
    assert.strictEqual((await forwardFor({ view: 'llm-today', date: '2026-10-04' })).url, 'https://backend.test/api/llm-usage/today?date=2026-10-04');
    await rejectFor({ view: 'llm-today', date: '10/04/2026' });
    await rejectFor({ view: 'llm-today', date: "2026-10-04' OR 1=1" });
    assert.strictEqual((await forwardFor({ view: 'catalyst-accuracy', dimension: 'event_type', days: '30' })).url,
        'https://backend.test/api/llm-catalyst-accuracy?dimension=event_type&days=30');
    await rejectFor({ view: 'catalyst-accuracy', dimension: 'ticker', days: '30' });
    await rejectFor({ view: 'catalyst-accuracy', dimension: 'model', days: '30.5' });
    await rejectFor({ view: 'catalyst-accuracy', dimension: 'model', days: '12345' });
    await rejectFor({ view: 'catalyst-accuracy', dimension: 'model', days: '-1' });
    assert.strictEqual((await forwardFor({ view: 'scanner-metrics', hours: '24' })).url, 'https://backend.test/api/scanner/metrics?hours=24');
    assert.strictEqual((await forwardFor({ view: 'quant-live-predictions', timeframe: '1d', limit: '10' })).url,
        'https://backend.test/api/quant/live-predictions?timeframe=1d&limit=10');
    await rejectFor({ view: 'quant-live-predictions', timeframe: '5d', limit: '10' });
    await rejectFor({ view: 'quant-training-runs', limit: 'ten' });
    // Empty values are treated as absent, not as errors.
    assert.strictEqual((await forwardFor({ view: 'llm-today', date: '' })).url, 'https://backend.test/api/llm-usage/today');
});

test('extras (incl. the cache-buster t), a view-foreign allow-listed key, and path tricks are never forwarded', async () => {
    const fwd = await forwardFor({
        view: 'quant-health', t: '1759600000000', limit: '5', evil: '../../etc', date: '2026-10-04', view2: 'x',
    });
    assert.strictEqual(fwd.url, 'https://backend.test/api/quant/health');
    const fwd2 = await forwardFor({ view: 'llm-week', date: '2026-10-04' }); // date not allowed on week
    assert.strictEqual(fwd2.url, 'https://backend.test/api/llm-usage/week');
});

test('duplicates: first value wins in BOTH query representations', async () => {
    // req.query arrays (Vercel's shape for repeated keys)
    assert.strictEqual((await forwardFor({ view: ['llm-today', 'ws-status'], date: ['2026-10-01', '2026-10-02'] })).url,
        'https://backend.test/api/llm-usage/today?date=2026-10-01');
    await rejectFor({ view: 'llm-today', date: ['bad', '2026-10-02'] });            // invalid-first → 400
    assert.strictEqual((await forwardFor({ view: 'llm-today', date: ['2026-10-02', 'bad'] })).url, // valid-first → forwarded
        'https://backend.test/api/llm-usage/today?date=2026-10-02');
    // req.url fallback (no req.query)
    assert.strictEqual((await forwardFor(null, '/api/ops/reads?view=llm-today&view=ws-status&date=2026-10-01&date=2026-10-02')).url,
        'https://backend.test/api/llm-usage/today?date=2026-10-01');
    await rejectFor(null, '/api/ops/reads?view=llm-today&date=bad&date=2026-10-02');
    assert.strictEqual((await forwardFor(null, '/api/ops/reads?view=llm-today&date=2026-10-02&date=bad')).url,
        'https://backend.test/api/llm-usage/today?date=2026-10-02');
    // queryOf itself, directly
    assert.deepStrictEqual({ ...queryOf({ query: { a: ['1', '2'], b: 'x' } }) }, { a: '1', b: 'x' });
    assert.deepStrictEqual({ ...queryOf({ url: '/r?a=1&a=2&b=x' }) }, { a: '1', b: 'x' });
    assert.strictEqual(Object.getPrototypeOf(queryOf({ url: '/r?__proto__=1' })), null);
});

test('no view ever carries the internal token upstream, with or without INTERNAL_API_TOKEN configured', async () => {
    for (const view of Object.keys(VIEWS)) {
        await withEnv(async () => {
            const calls = installFetch({
                '/api/admin/whoami': admin200,
                'https://backend.test/api/': () => upstreamResponse(200, { ok: view }),
            });
            const res = fakeRes();
            const q = { view };
            if (view === 'catalyst-accuracy') Object.assign(q, { dimension: 'model', days: '30' });
            await handler(fakeReq({ query: q, headers: H }), res);
            assert.strictEqual(res.statusCode, 200, `${view}: ${res.body}`);
            const fwd = calls.find(c => !c.url.includes('/api/admin/whoami'));
            assert.ok(fwd.url.startsWith('https://backend.test' + VIEWS[view].path), view);
            assert.ok(!('X-Internal-Token' in fwd.opts.headers), view);
            assert.strictEqual(fwd.opts.headers.Authorization, `Bearer ${BEARER}`, view);
            assert.ok(!responseSurface(res).includes(TOKEN), view);
        });
    }
});

test('simulated post-#449 upstream (every route human-class: bearer + admin): every view passes', async () => {
    const human = (opts) => opts.headers.Authorization === `Bearer ${BEARER}`
        ? upstreamResponse(200, { ok: true })
        : upstreamResponse(401, { error: 'unauthenticated' });
    for (const view of Object.keys(VIEWS)) {
        await withEnv(async () => {
            installFetch({ '/api/admin/whoami': admin200, 'https://backend.test/api/': human });
            const res = fakeRes();
            const q = { view };
            if (view === 'catalyst-accuracy') Object.assign(q, { dimension: 'model', days: '30' });
            await handler(fakeReq({ query: q, headers: H }), res);
            assert.strictEqual(res.statusCode, 200, `${view}: ${res.body}`);
        });
    }
});

test('failed verification → no target request (ws-status included)', async () => {
    for (const view of ['quant-health', 'ws-status']) {
        await withEnv(async () => {
            const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, {}) });
            const res = fakeRes();
            await handler(fakeReq({ query: { view }, headers: H }), res);
            assert.strictEqual(res.statusCode, 403, view);
            assert.strictEqual(calls.length, 1, view);
        });
    }
    // No bearer at all → 401 and zero network (verifyAdmin short-circuits).
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ query: { view: 'quant-health' } }), res);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(calls.length, 0);
    });
});

test('responses are no-store and never echo upstream headers', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': admin200,
            '/api/quant/health': () => upstreamResponse(200, { ok: 1 }, { 'set-cookie': 's=1', 'x-echo': TOKEN }),
        });
        const res = fakeRes();
        await handler(fakeReq({ query: { view: 'quant-health' }, headers: H }), res);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['Cache-Control'], 'no-store, max-age=0');
        assert.ok(!('set-cookie' in res.headers) && !('x-echo' in res.headers));
    });
});
