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

const TOKEN = 'super-secret-internal-token-9f3a';

// ── test doubles ─────────────────────────────────────────────────────────────

function fakeRes() {
    return {
        statusCode: 0,
        headers: {},
        body: null,
        setHeader(k, v) {
            this.headers[k] = v;
        },
        status(c) {
            this.statusCode = c;
            return this;
        },
        send(b) {
            this.body = b;
            return this;
        },
    };
}

function fakeReq(opts) {
    return Object.assign({ method: 'GET', url: '/api/ops/shadow', headers: {} }, opts || {});
}

function upstreamResponse(status, bodyObj, headers) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Map(Object.entries(headers || {})),
        async text() {
            return typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        },
    };
}

// installFetch records every call and answers from `routes` (path suffix → fn).
function installFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push({ url: String(url), opts: opts || {} });
        for (const [needle, fn] of Object.entries(routes)) {
            if (String(url).includes(needle)) return fn(opts || {});
        }
        throw new Error('unexpected fetch: ' + url);
    };
    return calls;
}

function withEnv(fn) {
    const prevToken = process.env.INTERNAL_API_TOKEN;
    const prevBase = process.env.BACKEND_API_BASE;
    const prevFetch = globalThis.fetch;
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.BACKEND_API_BASE = 'https://backend.test';
    return Promise.resolve(fn()).finally(() => {
        if (prevToken === undefined) delete process.env.INTERNAL_API_TOKEN;
        else process.env.INTERNAL_API_TOKEN = prevToken;
        if (prevBase === undefined) delete process.env.BACKEND_API_BASE;
        else process.env.BACKEND_API_BASE = prevBase;
        globalThis.fetch = prevFetch;
    });
}

// Every response surface a browser can read, as one string.
function responseSurface(res) {
    return JSON.stringify({ headers: res.headers, body: res.body, status: res.statusCode });
}

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
            fakeReq({ headers: { authorization: 'Bearer some-firebase-id-token' } }),
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
            fakeReq({ headers: { authorization: 'Bearer t' } }),
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
            fakeReq({ headers: { authorization: 'Bearer id-token' } }),
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
        assert.ok(!JSON.stringify(forward.opts.headers).includes('id-token'));

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
            fakeReq({ headers: { authorization: 'Bearer id-token' } }),
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
            fakeReq({ headers: { authorization: 'Bearer id-token' } }),
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
            fakeReq({ headers: { authorization: 'Bearer id-token' } }),
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
            fakeReq({ headers: { authorization: 'Bearer id-token' } }),
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
            fakeReq({ method: 'POST', headers: { authorization: 'Bearer t' } }),
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
        const v = await verifyAdmin(fakeReq({ headers: { authorization: 'Bearer t' } }));
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
            fakeReq({ url: '/api/ops/shadow?view=wat', query: { view: 'wat' }, headers: { authorization: 'Bearer t' } }),
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
                headers: { authorization: 'Bearer t' },
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
                headers: { authorization: 'Bearer t' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(calls.length, 0);
    });
});
