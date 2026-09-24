// node --test api/
//
// The R4 route's contract: only registered views and rounds are forwarded, a
// POST forwards the JSON body (capped) with the internal token, the browser
// can never set the rater, and validation statuses come back typed and
// body-free.

const test = require('node:test');
const assert = require('node:assert');

const handler = require('./ops/r4.js');
const { MAX_FORWARD_BODY_BYTES } = require('./_verified_proxy.js');
const { TOKEN, fakeRes, fakeReq, upstreamResponse, installFetch, withEnv, responseSurface } = require('./_test_helpers.js');

const whoamiOK = () => upstreamResponse(200, { uid: 'admin' });

test('r4: unknown view / bad round → 400 without any network call', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        let res = fakeRes();
        await handler(fakeReq({ url: '/api/ops/r4?view=__proto__', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 400);
        res = fakeRes();
        await handler(fakeReq({ url: '/api/ops/r4?view=next&round=all', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});

test('r4: next forwards only the validated round with the token', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': whoamiOK,
            '/api/internal/r4/next': () => upstreamResponse(200, { done: false, item: { ticker: 'TEM' } }),
        });
        const res = fakeRes();
        await handler(
            fakeReq({ url: '/api/ops/r4?view=next&round=DEV1&rater=astra_flagger&x=1', headers: { authorization: 'Bearer t' } }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/internal/r4/next'));
        assert.strictEqual(fwd.url, 'https://backend.test/api/internal/r4/next?round=dev1');
        assert.strictEqual(fwd.opts.headers['X-Internal-Token'], TOKEN);
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('r4: label POST forwards the JSON body, token attached, 201 passed through', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': whoamiOK,
            '/api/internal/r4/label': () => upstreamResponse(201, { id: 7 }),
        });
        const res = fakeRes();
        const body = { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable', note: 'n' };
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(res.body), { id: 7 });
        const fwd = calls.find(c => c.url.includes('/api/internal/r4/label'));
        assert.strictEqual(fwd.opts.method, 'POST');
        assert.strictEqual(fwd.opts.headers['Content-Type'], 'application/json');
        assert.deepStrictEqual(JSON.parse(fwd.opts.body), body);
        assert.strictEqual(fwd.opts.headers['X-Internal-Token'], TOKEN);
        assert.strictEqual(fwd.opts.headers.Authorization, undefined);
    });
});

test('r4: the browser cannot set the rater', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': whoamiOK });
        const res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                body: { round: 'dev1', cluster_id: 'x', h1: 'yes', h2: 'bullish', h3: 'notable', rater: 'astra_flagger' } }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});

test('r4: POST validation statuses come back typed and body-free', async () => {
    for (const [status, kind] of [[400, 'rejected'], [409, 'conflict'], [423, 'locked'], [404, 'not_found']]) {
        await withEnv(async () => {
            installFetch({
                '/api/admin/whoami': whoamiOK,
                '/api/internal/r4/label': () => upstreamResponse(status, { error: 'secret-detail ' + TOKEN }),
            });
            const res = fakeRes();
            await handler(
                fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                    body: { round: 'dev1' } }),
                res
            );
            assert.strictEqual(res.statusCode, status);
            assert.strictEqual(JSON.parse(res.body).error, kind);
            assert.ok(!responseSurface(res).includes('secret-detail'));
            assert.ok(!responseSurface(res).includes(TOKEN));
        });
    }
});

test('r4: POST with a non-object or oversized body is refused before any upstream call', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': whoamiOK });
        let res = fakeRes();
        await handler(fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body: '[1]' }), res);
        assert.strictEqual(res.statusCode, 400);
        res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                body: { note: 'x'.repeat(MAX_FORWARD_BODY_BYTES + 1) } }),
            res
        );
        assert.strictEqual(res.statusCode, 413);
        assert.ok(!calls.some(c => c.url.includes('/api/internal/')));
    });
});

test('r4: a non-admin never reaches the upstream, GET or POST', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, {}) });
        const res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body: { round: 'dev1' } }),
            res
        );
        assert.strictEqual(res.statusCode, 403);
        assert.ok(!calls.some(c => c.url.includes('/api/internal/')));
    });
});

test('r4: GET on the label view is rejected as method_not_allowed', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ method: 'GET', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(calls.length, 0);
    });
});
