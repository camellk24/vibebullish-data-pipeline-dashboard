const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../api/ops/heartbeats.js');
const { TOKEN, fakeReq, fakeRes, installFetch, upstreamResponse, withEnv, responseSurface } = require('../api/_test_helpers.js');
const request = (extra = {}) => fakeReq({ headers: { authorization: 'Bearer id-token' },
    query: { view: 'model-health', source: 'live', sample: '200' }, ...extra });

test('model health proxy pins snapshot-only reads and does not forward caller knobs', async () => withEnv(async () => {
    const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(200, { uid: 'admin' }),
        '/api/internal/': () => upstreamResponse(200, { snapshot_id: 7 }) });
    const res = fakeRes(); await route(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls[1].url, 'https://backend.test/api/internal/inference-health?source=snapshot');
    assert.equal(calls[1].opts.method, 'GET');
    assert.equal(calls[1].opts.headers['X-Internal-Token'], TOKEN);
    assert.match(res.headers['Cache-Control'], /no-store/);
    assert.ok(!responseSurface(res).includes(TOKEN));
}));

test('only the exact missing snapshot response gets a missing state; other failures stay unavailable', async () => withEnv(async () => {
    for (const [body, expected] of [[{ error: 'inference health snapshot missing' }, 'snapshot_missing'],
        [{ error: 'snapshot read failed' }, 'upstream_error'], [{ error: TOKEN }, 'upstream_error']]) {
        installFetch({ '/api/admin/whoami': () => upstreamResponse(200, { uid: 'admin' }),
            '/api/internal/': () => upstreamResponse(503, body) });
        const res = fakeRes(); await route(request(), res);
        assert.equal(JSON.parse(res.body).error, expected);
        assert.ok(!responseSurface(res).includes(TOKEN));
    }
}));

test('snapshot route refuses non-admins, writes, and unknown views without an upstream read', async () => withEnv(async () => {
    for (const [req, expected] of [[request(), 403], [request({method:'POST'}),405], [request({query:{view:'live'}}),400]]) {
        const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, {}) });
        const res = fakeRes(); await route(req,res);
        assert.equal(res.statusCode,expected);
        assert.ok(calls.every(c => c.url.includes('/api/admin/whoami')));
    }
}));
