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

const OWNER = 'owner-uid-123';
const whoamiOK = () => upstreamResponse(200, { uid: OWNER });
const whoamiOtherAdmin = () => upstreamResponse(200, { uid: 'another-admin' });

// Every case runs with the owner binding configured; the unset case is its own test.
function withOwner(fn) {
    const prev = process.env.R4_OWNER_UID;
    process.env.R4_OWNER_UID = OWNER;
    return withEnv(fn).finally(() => {
        if (prev === undefined) delete process.env.R4_OWNER_UID;
        else process.env.R4_OWNER_UID = prev;
    });
}

test('r4: unknown view / bad round → 400 without any network call', async () => {
    await withOwner(async () => {
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
    await withOwner(async () => {
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
    await withOwner(async () => {
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

test('r4: a browser-supplied rater never reaches the backend — object body OR string body', async () => {
    for (const body of [
        { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable', rater: 'astra_flagger', extra: 1 },
        JSON.stringify({ round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable', rater: 'astra_flagger' }),
    ]) {
        await withOwner(async () => {
            const calls = installFetch({
                '/api/admin/whoami': whoamiOK,
                '/api/internal/r4/label': () => upstreamResponse(201, { id: 1 }),
            });
            const res = fakeRes();
            await handler(fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body }), res);
            assert.strictEqual(res.statusCode, 200);
            const fwd = calls.find(c => c.url.includes('/api/internal/r4/label'));
            const sent = JSON.parse(fwd.opts.body);
            assert.deepStrictEqual(Object.keys(sent).sort(), ['cluster_id', 'h1', 'h2', 'h3', 'note', 'round']);
            assert.ok(!('rater' in sent));
            assert.ok(!fwd.opts.body.includes('astra_flagger'));
        });
    }
});

test('r4: an invalid field is rejected before any upstream call', async () => {
    await withOwner(async () => {
        const calls = installFetch({ '/api/admin/whoami': whoamiOK });
        for (const body of [
            { round: 'dev1', cluster_id: 'short', h1: 'yes', h2: 'bullish', h3: 'notable' },
            { round: 'dev9', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable' },
            { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'up', h3: 'notable' },
        ]) {
            const res = fakeRes();
            await handler(fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body }), res);
            assert.strictEqual(res.statusCode, 400);
        }
        assert.strictEqual(calls.length, 0);
    });
});

test('r4: another admin is refused (403) on GET and POST, no upstream call', async () => {
    await withOwner(async () => {
        const calls = installFetch({ '/api/admin/whoami': whoamiOtherAdmin });
        let res = fakeRes();
        await handler(fakeReq({ url: '/api/ops/r4?view=next&round=dev1', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 403);
        res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                body: { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable' } }),
            res
        );
        assert.strictEqual(res.statusCode, 403);
        assert.ok(!calls.some(c => c.url.includes('/api/internal/')));
    });
});

test('r4: unset R4_OWNER_UID closes the route (503) before any network call', async () => {
    await withEnv(async () => {
        delete process.env.R4_OWNER_UID;
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ url: '/api/ops/r4?view=next&round=dev1', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 503);
        assert.strictEqual(calls.length, 0);
    });
});

test('r4: POST validation statuses come back typed and body-free', async () => {
    for (const [status, kind] of [[400, 'rejected'], [409, 'conflict'], [423, 'locked'], [404, 'not_found']]) {
        await withOwner(async () => {
            installFetch({
                '/api/admin/whoami': whoamiOK,
                '/api/internal/r4/label': () => upstreamResponse(status, { error: 'secret-detail ' + TOKEN }),
            });
            const res = fakeRes();
            await handler(
                fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                    body: { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable' } }),
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
    await withOwner(async () => {
        const calls = installFetch({ '/api/admin/whoami': whoamiOK });
        let res = fakeRes();
        await handler(fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' }, body: '[1]' }), res);
        assert.strictEqual(res.statusCode, 400);
        assert.ok(!calls.some(c => c.url.includes('/api/internal/')));
    });
});

test('r4: an oversized note is truncated to 2000 chars, so the forwarded body stays under the proxy cap', async () => {
    await withOwner(async () => {
        const calls = installFetch({
            '/api/admin/whoami': whoamiOK,
            '/api/internal/r4/label': () => upstreamResponse(201, { id: 1 }),
        });
        const res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                body: { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable', note: 'x'.repeat(MAX_FORWARD_BODY_BYTES + 1) } }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/internal/r4/label'));
        assert.strictEqual(JSON.parse(fwd.opts.body).note.length, 2000);
    });
});

test('r4: a non-admin never reaches the upstream, GET or POST', async () => {
    await withOwner(async () => {
        const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, {}) });
        const res = fakeRes();
        await handler(
            fakeReq({ method: 'POST', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' },
                body: { round: 'dev1', cluster_id: '0123456789abcdef', h1: 'yes', h2: 'bullish', h3: 'notable' } }),
            res
        );
        assert.strictEqual(res.statusCode, 403);
        assert.ok(!calls.some(c => c.url.includes('/api/internal/')));
    });
});

test('r4: GET on the label view is rejected as method_not_allowed', async () => {
    await withOwner(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ method: 'GET', url: '/api/ops/r4?view=label', headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(calls.length, 0);
    });
});

test('r4: spot and spot_topup rounds are accepted and forwarded', async () => {
    for (const round of ['spot', 'spot_topup']) {
        await withOwner(async () => {
            const calls = installFetch({
                '/api/admin/whoami': whoamiOK,
                '/api/internal/r4/next': () => upstreamResponse(200, { done: false, item: { ticker: 'X' } }),
            });
            const res = fakeRes();
            await handler(fakeReq({ url: `/api/ops/r4?view=next&round=${round}`, headers: { authorization: 'Bearer t' } }), res);
            assert.strictEqual(res.statusCode, 200);
            const fwd = calls.find(c => c.url.includes('/api/internal/r4/next'));
            assert.strictEqual(fwd.url, `https://backend.test/api/internal/r4/next?round=${round}`);
        });
    }
});
