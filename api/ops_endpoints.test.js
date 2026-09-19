// node --test api/*.test.js
//
// Direct coverage of each ops endpoint function, on top of the shared-proxy
// contract in _verified_proxy.test.js.

const test = require('node:test');
const assert = require('node:assert');

const {
    TOKEN,
    fakeRes,
    fakeReq,
    upstreamResponse,
    installFetch,
    withEnv,
    responseSurface,
} = require('./_test_helpers.js');

const heartbeats = require('./ops/heartbeats.js');
const whoami = require('./ops/whoami.js');
const config = require('./config.js');
const shadow = require('./ops/shadow.js');

const adminOK = () => upstreamResponse(200, { uid: 'admin-uid', email: 'a@b.c' });

// ── api/ops/heartbeats.js ────────────────────────────────────────────────────

test('heartbeats: admin → forwards to /api/internal/heartbeat/latest with the internal token', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': adminOK,
            '/api/internal/heartbeat/latest': () =>
                upstreamResponse(200, { routines: [{ routine: 'dq_daily', last_status: 'PASS' }] }),
        });
        const res = fakeRes();
        await heartbeats(fakeReq({ headers: { authorization: 'Bearer id-token' } }), res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(JSON.parse(res.body).routines[0].routine, 'dq_daily');
        const fwd = calls.find(c => c.url.includes('/api/internal/'));
        assert.strictEqual(fwd.url, 'https://backend.test/api/internal/heartbeat/latest');
        assert.strictEqual(fwd.opts.headers['X-Internal-Token'], TOKEN);
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('heartbeats: the caller\'s query string is NEVER forwarded', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': adminOK,
            '/api/internal/heartbeat/latest': () => upstreamResponse(200, { routines: [] }),
        });
        const res = fakeRes();
        await heartbeats(
            fakeReq({
                url: '/api/ops/heartbeats?limit=9999&routine=../../secret',
                query: { limit: '9999', routine: '../../secret' },
                headers: { authorization: 'Bearer id-token' },
            }),
            res
        );
        const fwd = calls.find(c => c.url.includes('/api/internal/'));
        assert.strictEqual(fwd.url, 'https://backend.test/api/internal/heartbeat/latest');
        assert.ok(!fwd.url.includes('?'), 'no query string is appended');
        assert.ok(!fwd.url.includes('secret'));
    });
});

test('heartbeats: non-admin → 403 and the upstream is never contacted', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': () => upstreamResponse(403, { error: 'not_admin' }),
        });
        const res = fakeRes();
        await heartbeats(fakeReq({ headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(calls.length, 1);
    });
});

// ── api/ops/whoami.js ────────────────────────────────────────────────────────

test('whoami: admin → {admin:true} with the uid, and no internal token anywhere', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': adminOK });
        const res = fakeRes();
        await whoami(fakeReq({ headers: { authorization: 'Bearer id-token' } }), res);

        assert.strictEqual(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.admin, true);
        assert.strictEqual(body.uid, 'admin-uid');
        assert.strictEqual(body.email, 'a@b.c');
        // The gate asks the backend exactly once and forwards nothing internal.
        assert.strictEqual(calls.length, 1);
        assert.ok(!calls[0].url.includes('/api/internal/'));
        assert.ok(!JSON.stringify(calls[0].opts.headers).includes(TOKEN));
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('whoami: non-admin → 403 {admin:false} with a message that is NOT an outage', async () => {
    await withEnv(async () => {
        installFetch({ '/api/admin/whoami': () => upstreamResponse(403, { error: 'nope' }) });
        const res = fakeRes();
        await whoami(fakeReq({ headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 403);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.admin, false);
        assert.strictEqual(body.error, 'forbidden');
        // js/auth.js distinguishes these two 403s by this message.
        assert.ok(/not an admin/i.test(body.message));
        assert.ok(!/unreachable/i.test(body.message));
    });
});

test('whoami: identity check unreachable → 403 whose message marks it an OUTAGE', async () => {
    await withEnv(async () => {
        installFetch({
            '/api/admin/whoami': () => {
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            },
        });
        const res = fakeRes();
        await whoami(fakeReq({ headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 403);
        // The word js/auth.js keys on to show "could not verify sign-in".
        assert.ok(/unreachable/i.test(JSON.parse(res.body).message));
    });
});

test('whoami: no Bearer → 401 unauthenticated, no network call', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await whoami(fakeReq(), res);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(JSON.parse(res.body).admin, false);
        assert.strictEqual(calls.length, 0);
    });
});

// ── api/config.js ────────────────────────────────────────────────────────────

function withFirebaseEnv(values, fn) {
    const keys = ['FIREBASE_WEB_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_APP_ID', 'INTERNAL_API_TOKEN'];
    const prev = {};
    for (const k of keys) prev[k] = process.env[k];
    for (const k of keys) {
        if (values[k] === undefined) delete process.env[k];
        else process.env[k] = values[k];
    }
    return Promise.resolve(fn()).finally(() => {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
    });
}

test('config: returns only PUBLIC values and never the internal token', async () => {
    await withFirebaseEnv(
        {
            FIREBASE_WEB_API_KEY: 'AIza-public-key',
            FIREBASE_AUTH_DOMAIN: 'vibebullish.firebaseapp.com',
            FIREBASE_APP_ID: '1:718084292276:web:abc',
            INTERNAL_API_TOKEN: TOKEN,
        },
        async () => {
            const res = fakeRes();
            await config(fakeReq({ url: '/api/config' }), res);

            assert.strictEqual(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.deepStrictEqual(Object.keys(body).sort(), [
                'apiKey',
                'appId',
                'authDomain',
                'messagingSenderId',
                'projectId',
            ]);
            assert.strictEqual(body.projectId, 'vibebullish');
            assert.strictEqual(body.messagingSenderId, '718084292276');
            assert.ok(!responseSurface(res).includes(TOKEN), 'internal token must never appear');
            assert.strictEqual(res.headers['Cache-Control'], 'no-store, max-age=0');
        }
    );
});

test('config: missing env → 503 naming each missing variable, still token-free', async () => {
    await withFirebaseEnv({ FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com', INTERNAL_API_TOKEN: TOKEN }, async () => {
        const res = fakeRes();
        await config(fakeReq({ url: '/api/config' }), res);
        assert.strictEqual(res.statusCode, 503);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.error, 'not_configured');
        assert.deepStrictEqual(body.missing, ['FIREBASE_WEB_API_KEY', 'FIREBASE_APP_ID']);
        assert.ok(!responseSurface(res).includes(TOKEN));
    });
});

test('config: non-GET → 405', async () => {
    await withFirebaseEnv({}, async () => {
        const res = fakeRes();
        await config(fakeReq({ method: 'POST' }), res);
        assert.strictEqual(res.statusCode, 405);
    });
});

// ── prototype pollution on ?view= ────────────────────────────────────────────

for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    test(`shadow: ?view=${evil} → 400, never resolved off the prototype chain`, async () => {
        await withEnv(async () => {
            const calls = installFetch({});
            const res = fakeRes();
            await shadow(
                fakeReq({ query: { view: evil }, headers: { authorization: 'Bearer t' } }),
                res
            );
            assert.strictEqual(res.statusCode, 400, `${evil} must not select a view`);
            assert.strictEqual(JSON.parse(res.body).error, 'bad_request');
            assert.strictEqual(calls.length, 0, 'no network call for a bogus view');
        });
    });
}

// ── sleeve 2 (task 7): view=sleeves, counterpart_book_id ────────────────────

test('shadow: view=diffs, counterpart_book_id=../x → 400 before any upstream call', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': adminOK });
        const res = fakeRes();
        await shadow(
            fakeReq({
                query: { view: 'diffs', book_id: '61', counterpart_book_id: '../x' },
                headers: { authorization: 'Bearer t' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(JSON.parse(res.body).error, 'bad_request');
        assert.match(JSON.parse(res.body).message, /counterpart_book_id/);
        assert.strictEqual(calls.length, 0, 'validation fails before whoami/upstream is ever reached');
    });
});

test('shadow: view=diffs forwards a valid counterpart_book_id alongside book_id', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': adminOK,
            '/api/internal/shadow/diffs': () =>
                upstreamResponse(200, { book_id: 62, counterpart_book_id: 56, kind: 'legacy', runs: [] }),
        });
        const res = fakeRes();
        await shadow(
            fakeReq({
                query: { view: 'diffs', book_id: '62', counterpart_book_id: '56', sessions: '20' },
                headers: { authorization: 'Bearer t' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/internal/'));
        assert.ok(fwd.url.includes('book_id=62'));
        assert.ok(fwd.url.includes('counterpart_book_id=56'));
        assert.ok(fwd.url.includes('sessions=20'));
    });
});

test('shadow: view=sleeves forwards to the fixed path with NO query, ignoring anything the caller sent', async () => {
    await withEnv(async () => {
        const calls = installFetch({
            '/api/admin/whoami': adminOK,
            '/api/internal/shadow/sleeves': () => upstreamResponse(200, { sleeves: [] }),
        });
        const res = fakeRes();
        await shadow(
            fakeReq({
                query: { view: 'sleeves', book_id: '999', counterpart_book_id: '../evil', sessions: '9999' },
                headers: { authorization: 'Bearer t' },
            }),
            res
        );
        assert.strictEqual(res.statusCode, 200);
        const fwd = calls.find(c => c.url.includes('/api/internal/'));
        assert.strictEqual(fwd.url, 'https://backend.test/api/internal/shadow/sleeves');
        assert.ok(!fwd.url.includes('?'), 'no query string is appended');
    });
});

test('shadow: view=sleeves, non-admin → 403 and the upstream is never contacted', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, { error: 'not_admin' }) });
        const res = fakeRes();
        await shadow(fakeReq({ query: { view: 'sleeves' }, headers: { authorization: 'Bearer t' } }), res);
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(calls.length, 1);
    });
});
