// node --test api/
//
// The security contract of the ops console, pinned:
//   1. INTERNAL_API_TOKEN never appears in a response body or a response header.
//   2. A non-200 from /api/admin/whoami yields 403 WITHOUT contacting the
//      upstream internal endpoint at all.
//   3. Upstream response headers are never echoed.
//   4. The forward carries X-Internal-Token and the browser's Bearer token is
//      NOT forwarded to the internal endpoint.

const test = require('node:test');
const assert = require('node:assert');

const proxy = require('./_verified_proxy.js');
const { verifiedProxy, verifyAdmin } = proxy;

const {
    TOKEN,
    fakeRes,
    fakeReq,
    upstreamResponse,
    installFetch,
    withEnv,
    responseSurface,
} = require('./_test_helpers.js');

// ── tests ────────────────────────────────────────────────────────────────────

test('401 from whoami → 403 forbidden and the upstream is never contacted', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(401, { error: 'unauthorized' }),
            '/api/internal/': () => {
                throw new Error('upstream MUST NOT be contacted after a failed whoami');
            },
        });

        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/heartbeat/latest'
        );

        assert.strictEqual(res.statusCode, 403);
        assert.deepStrictEqual(JSON.parse(res.body).error, 'forbidden');
        assert.strictEqual(calls.length, 1, 'exactly one fetch (the whoami check)');
        assert.ok(calls[0].url.includes('/api/admin/whoami'));
        assert.ok(!responseSurface(res).includes(TOKEN), 'token must not leak');
    });
});

test('403 from whoami → 403 forbidden, no upstream call', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(403, { error: 'not_admin' }),
        });
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/shadow/status'
        );
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(calls.length, 1);
    });
});

test('missing Bearer token → 401, no fetch at all', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await verifiedProxy(fakeReq(), res, '/api/internal/heartbeat/latest');
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(JSON.parse(res.body).error, 'unauthenticated');
        assert.strictEqual(calls.length, 0);
    });
});

test('admin path forwards with X-Internal-Token and never echoes the token', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'admin-uid' }),
            '/api/internal/heartbeat/latest': () =>
                upstreamResponse(
                    200,
                    { routines: [{ routine: 'shadow_engine', status: 'PASS' }] },
                    // An upstream header carrying the token: it must NOT be echoed.
                    { 'x-echo-token': TOKEN, 'set-cookie': 'session=abc' }
                ),
        });

        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/heartbeat/latest'
        );

        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(res.body).routines[0].routine, 'shadow_engine');

        // The forward carried the internal token...
        const forward = calls.find(c => c.url.includes('/api/internal/'));
        assert.ok(forward, 'upstream was contacted');
        assert.strictEqual(forward.opts.headers['X-Internal-Token'], TOKEN);
        // ...and did NOT carry the browser's Firebase token.
        assert.ok(!('Authorization' in forward.opts.headers));
        assert.ok(!JSON.stringify(forward.opts.headers).includes('test-id-token-9a7f3c1e5b2d'));

        // Nothing the browser can read contains the token, and no upstream
        // header was copied through.
        const surface = responseSurface(res);
        assert.ok(!surface.includes(TOKEN), 'token must not leak');
        assert.ok(!('x-echo-token' in res.headers));
        assert.ok(!('set-cookie' in res.headers));
        assert.strictEqual(res.headers['Cache-Control'], 'no-store, max-age=0');
    });
});

test('upstream 404 → typed not_found (renderable "unavailable"), token-free', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'admin-uid' }),
            '/api/internal/shadow/diffs': () => upstreamResponse(404, 'not found'),
        });
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/shadow/diffs?sessions=20'
        );
        assert.strictEqual(res.statusCode, 404);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.error, 'not_found');
        assert.strictEqual(body.upstream_status, 404);
        assert.strictEqual(body.upstream_path, '/api/internal/shadow/diffs');
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('upstream 500 → 502 upstream_error, upstream body never echoed', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/internal/shadow/status': () =>
                upstreamResponse(500, `boom ${TOKEN} was in the upstream body`),
        });
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/shadow/status'
        );
        assert.strictEqual(res.statusCode, 502);
        assert.strictEqual(JSON.parse(res.body).error, 'upstream_error');
        assert.ok(!responseSurface(res).includes(TOKEN), 'upstream body must not be echoed');
    });
});

test('whoami unreachable → fail closed with 403, no upstream call', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => {
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            },
        });
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/heartbeat/latest'
        );
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(JSON.parse(res.body).error, 'forbidden');
        assert.strictEqual(calls.length, 1);
    });
});

test('unset INTERNAL_API_TOKEN → 503 not_configured before any network call', async () => {
    const prev = process.env.INTERNAL_API_TOKEN;
    const prevFetch = globalThis.fetch;
    delete process.env.INTERNAL_API_TOKEN;
    const calls = installFetch({});
    try {
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/heartbeat/latest'
        );
        assert.strictEqual(res.statusCode, 503);
        assert.strictEqual(JSON.parse(res.body).error, 'not_configured');
        assert.strictEqual(calls.length, 0);
    } finally {
        if (prev === undefined) delete process.env.INTERNAL_API_TOKEN;
        else process.env.INTERNAL_API_TOKEN = prev;
        globalThis.fetch = prevFetch;
    }
});

test('non-GET is rejected before any verification', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ method: 'POST', headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res,
            '/api/internal/heartbeat/latest'
        );
        assert.strictEqual(res.statusCode, 405);
        assert.strictEqual(calls.length, 0);
    });
});

test('verifyAdmin returns the whoami claims on success', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'u1', email: 'a@b.c' }),
        });
        const v = await verifyAdmin(fakeReq({ headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }));
        assert.strictEqual(v.ok, true);
        assert.strictEqual(v.claims.uid, 'u1');
    });
});

// ── the shadow view router ───────────────────────────────────────────────────

const shadowHandler = require('./ops/shadow.js');

test('shadow: unknown view → 400 without any network call', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await shadowHandler(
            fakeReq({ url: '/api/ops/shadow?view=wat', query: { view: 'wat' }, headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' } }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});

test('shadow: only allow-listed, validated params are forwarded', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/internal/shadow/evidence': () => upstreamResponse(200, { rows: [] }),
        });
        const res = fakeRes();
        await shadowHandler(
            fakeReq({
                url: '/api/ops/shadow',
                query: { view: 'evidence', book_id: '57', sessions: '30', evil: '../../etc' },
                headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        const forward = calls.find(c => c.url.includes('/api/internal/'));
        assert.strictEqual(
            forward.url,
            'https://backend.test/api/internal/shadow/evidence?book_id=57&sessions=30'
        );
        assert.ok(!forward.url.includes('evil'));
    });
});

test('shadow: a non-numeric book_id is rejected with 400', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await shadowHandler(
            fakeReq({
                query: { view: 'status', book_id: "1 OR 1=1" },
                headers: { authorization: 'Bearer test-id-token-9a7f3c1e5b2d' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});

// ── forwarding modes (signed-in reads, api/ops/reads.js) ─────────────────────

const BEARER = 'eyJhbGciOiJSUzI1NiJ9.firebase-id-token-7c1d9e4b2a';
const bearerReq = () => fakeReq({ headers: { authorization: `Bearer ${BEARER}` } });

function withoutInternalToken(fn) {
    const prev = process.env.INTERNAL_API_TOKEN;
    const prevBase = process.env.BACKEND_API_BASE;
    const prevFetch = globalThis.fetch;
    delete process.env.INTERNAL_API_TOKEN;
    process.env.BACKEND_API_BASE = 'https://backend.test';
    return Promise.resolve(fn()).finally(() => {
        if (prev === undefined) delete process.env.INTERNAL_API_TOKEN;
        else process.env.INTERNAL_API_TOKEN = prev;
        if (prevBase === undefined) delete process.env.BACKEND_API_BASE;
        else process.env.BACKEND_API_BASE = prevBase;
        globalThis.fetch = prevFetch;
    });
}

test('forwardAuth: an unsupported mode → 500 misconfigured before any network call', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/quant/health', { forwardAuth: 'anonymous' });
        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(JSON.parse(res.body).error, 'misconfigured');
        assert.strictEqual(calls.length, 0);
    });
});

test('forwardAuth: omitted or null means internal (unchanged default behaviour)', async () => {
    for (const opts of [undefined, {}, { forwardAuth: null }, { forwardAuth: undefined }]) {
        await withEnv(async () => {
            const calls = installFetch({
                '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
                '/api/internal/heartbeat/latest': () => upstreamResponse(200, { ok: 1 }),
            });
            const res = fakeRes();
            await verifiedProxy(bearerReq(), res, '/api/internal/heartbeat/latest', opts);
            assert.strictEqual(res.statusCode, 200);
            const fwd = calls.find(c => c.url.includes('/api/internal/'));
            assert.strictEqual(fwd.opts.headers['X-Internal-Token'], TOKEN);
            assert.ok(!('Authorization' in fwd.opts.headers));
        });
    }
});

test('bearer mode: succeeds with INTERNAL_API_TOKEN absent, forwards the verified bearer, never the internal header', async () => {
    await withoutInternalToken(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/quant/health': () => upstreamResponse(200, { training_metrics: null }),
        });
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/quant/health', { forwardAuth: 'bearer' });
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/quant/health'));
        assert.ok(fwd, 'upstream contacted');
        assert.strictEqual(fwd.opts.headers.Authorization, `Bearer ${BEARER}`);
        assert.ok(!('X-Internal-Token' in fwd.opts.headers));
        assert.strictEqual(fwd.opts.redirect, 'manual');
        assert.strictEqual(res.headers['Cache-Control'], 'no-store, max-age=0');
    });
});

test('bearer mode: never attaches X-Internal-Token even when it IS configured', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/llm-usage/week': () => upstreamResponse(200, { days: [] }),
        });
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/llm-usage/week', { forwardAuth: 'bearer' });
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/llm-usage/week'));
        assert.ok(!('X-Internal-Token' in fwd.opts.headers));
        assert.ok(!JSON.stringify(fwd.opts.headers).includes(TOKEN));
        assert.strictEqual(fwd.opts.headers.Authorization, `Bearer ${BEARER}`);
    });
});

test('both mode: sends both credentials; internal/both → 503 without network when the secret is absent', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/internal/ws-status': () => upstreamResponse(200, { healthy: true }),
        });
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/internal/ws-status', { forwardAuth: 'both' });
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/internal/ws-status'));
        assert.strictEqual(fwd.opts.headers['X-Internal-Token'], TOKEN);
        assert.strictEqual(fwd.opts.headers.Authorization, `Bearer ${BEARER}`);
    });
    for (const mode of ['internal', 'both']) {
        await withoutInternalToken(async () => {
            const calls = installFetch({});
            const res = fakeRes();
            await verifiedProxy(bearerReq(), res, '/api/internal/ws-status', { forwardAuth: mode });
            assert.strictEqual(res.statusCode, 503, mode);
            assert.strictEqual(JSON.parse(res.body).error, 'not_configured');
            assert.strictEqual(calls.length, 0, mode);
        });
    }
});

test('every mode: failed verification → no upstream call', async () => {
    for (const mode of ['internal', 'bearer', 'both']) {
        await withEnv(async () => {
            const calls = installFetch({
                '/api/admin/whoami': () => upstreamResponse(403, { error: 'not_admin' }),
            });
            const res = fakeRes();
            await verifiedProxy(bearerReq(), res, '/api/quant/health', { forwardAuth: mode });
            assert.strictEqual(res.statusCode, 403, mode);
            assert.strictEqual(calls.length, 1, mode);
        });
    }
});

test('credential echo: a successful payload carrying either credential is withheld with a fixed 502', async () => {
    const cases = [
        ['bearer in a string value', { note: `token=${BEARER}` }],
        ['internal token in a string value', { note: `x ${TOKEN} y` }],
        ['internal token in a nested property NAME', { rows: [{ [TOKEN]: 1 }] }],
        ['bearer in a nested array value', { a: { b: [1, 'ok', BEARER + '!'] } }],
    ];
    for (const [label, payload] of cases) {
        await withEnv(async () => {
            installFetch({
                '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
                '/api/quant/health': () => upstreamResponse(200, payload),
            });
            const res = fakeRes();
            await verifiedProxy(bearerReq(), res, '/api/quant/health', { forwardAuth: 'bearer' });
            assert.strictEqual(res.statusCode, 502, label);
            assert.deepStrictEqual(JSON.parse(res.body), { error: 'upstream_error', message: 'Backend response withheld.' }, label);
            const surface = responseSurface(res);
            assert.ok(!surface.includes(TOKEN) && !surface.includes(BEARER), label);
        });
    }
});

test('credential echo: JSON-escaped credentials are caught; an absent internal token is never scanned', async () => {
    // A credential containing a quote is JSON-escaped on the wire, so a scan
    // of the raw text alone would miss it; the decoded scan catches it.
    const quoted = 'cred"with"quotes-5e8d2c1b9a7f';
    await withoutInternalToken(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/quant/health': () => upstreamResponse(200, { msg: quoted }),
        });
        const res = fakeRes();
        await verifiedProxy(
            fakeReq({ headers: { authorization: `Bearer ${quoted}` } }),
            res, '/api/quant/health', { forwardAuth: 'bearer' }
        );
        assert.strictEqual(res.statusCode, 502);
    });
    // Internal token unset + bearer mode: an ordinary payload (which contains
    // the empty string everywhere) must NOT be withheld.
    await withoutInternalToken(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/quant/health': () => upstreamResponse(200, { msg: 'plain', n: 1, '': 'empty-key' }),
        });
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/quant/health', { forwardAuth: 'bearer' });
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(JSON.parse(res.body).msg, 'plain');
    });
});

test('credential echo: existing internal-mode routes also withhold a payload that echoes the internal token', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': () => upstreamResponse(200, { uid: 'a' }),
            '/api/internal/heartbeat/latest': () => upstreamResponse(200, { debug: TOKEN }),
        });
        const res = fakeRes();
        await verifiedProxy(bearerReq(), res, '/api/internal/heartbeat/latest');
        assert.strictEqual(res.statusCode, 502);
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('containsCredential: non-empty credentials only; values, keys and raw text', () => {
    const { containsCredential } = proxy;
    assert.strictEqual(containsCredential({ a: 1 }, '{"a":1}', ['', null, undefined]), false);
    assert.strictEqual(containsCredential({ a: 'zz-secret-zz' }, '', ['secret']), true);
    assert.strictEqual(containsCredential({ 'k-secret': 1 }, '', ['secret']), true);
    assert.strictEqual(containsCredential({ a: 1 }, 'raw secret text', ['secret']), true);
    assert.strictEqual(containsCredential({ a: [{ b: 'fine' }] }, '{"a":[{"b":"fine"}]}', ['secret']), false);
});
