'use strict';
// /api/ops/harness — admin gate, Blob configuration states, read path, veto
// read-modify-write. A fake blob client and a fake verifyAdmin are injected
// through createHandler(deps); the real verifyAdmin path is exercised once
// with a mocked backend whoami to pin the fail-closed contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, fakeReq, upstreamResponse, installFetch, withEnv } = require('./_test_helpers.js');
const route = require('./ops/harness.js');
const schema = require('./_harness_schema.js');

const { createHandler } = route;
const ENV = { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_fake_123' };
const NOW = new Date('2026-10-09T20:00:00.000Z');

const ADMIN = async () => ({ ok: true, claims: { uid: 'owner-uid', email: 'o@example.test' } });
const DENY = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'nope' } });
const ANON = async () => ({ ok: false, status: 401, body: { error: 'unauthenticated', message: 'sign in' } });

function streamOf(text) {
    return new Response(text).body;
}

// fakeBlob(files): files is { pathname: string }. Records every call.
function fakeBlob(files, opts) {
    opts = opts || {};
    const calls = [];
    const etags = {};
    let n = 0;
    for (const k of Object.keys(files)) etags[k] = 'etag-' + (++n);
    return {
        calls,
        files,
        async get(pathname, o) {
            calls.push({ op: 'get', pathname, opts: o });
            if (opts.getError) throw opts.getError;
            if (!Object.prototype.hasOwnProperty.call(files, pathname)) return null;
            return { statusCode: 200, stream: streamOf(files[pathname]), headers: new Headers(), blob: { etag: etags[pathname], pathname } };
        },
        async put(pathname, body, o) {
            calls.push({ op: 'put', pathname, body, opts: o });
            if (opts.putError) throw opts.putError;
            files[pathname] = body;
            etags[pathname] = 'etag-' + (++n);
            return { pathname, url: 'https://x.private.blob.vercel-storage.com/' + pathname };
        },
    };
}

const STATE = {
    schema_version: 1,
    status: { mode: 'running', heartbeat_at: '2026-10-09T19:58:00Z', lanes: [{ id: 'lane-1', task_id: 't1' }], synced_at: '2026-10-09T19:58:00Z' },
    tasks: [{ id: 't1', title: 'Do a thing', state: 'implementing', risk: 'low' }, { id: 'q1', title: 'Queued', state: 'queued', rank: 1 }],
    needs: [],
    events: [],
};

function handlerWith(blob, verify, env) {
    return createHandler({ blob, verifyAdmin: verify || ADMIN, env: env || ENV, now: () => NOW });
}

async function call(h, reqOpts) {
    const res = fakeRes();
    await h(fakeReq(reqOpts), res);
    let body = null;
    try { body = JSON.parse(res.body); } catch (_e) { body = res.body; }
    return { res, body };
}

const POST = (body, extra) => Object.assign({ method: 'POST', url: '/api/ops/harness?view=veto', query: { view: 'veto' }, body }, extra || {});

// ── GET ───────────────────────────────────────────────────────────────────

test('GET unauthenticated → 401, no blob call, no-store', async () => {
    const blob = fakeBlob({});
    const { res, body } = await call(handlerWith(blob, ANON), { query: {} });
    assert.equal(res.statusCode, 401);
    assert.equal(body.error, 'unauthenticated');
    assert.equal(blob.calls.length, 0);
    assert.match(res.headers['Cache-Control'], /no-store/);
});

test('GET non-admin → 403 with NO blob call', async () => {
    const blob = fakeBlob({ [schema.STATE_PATH]: JSON.stringify(STATE) });
    const { res, body } = await call(handlerWith(blob, DENY), { query: {} });
    assert.equal(res.statusCode, 403);
    assert.equal(body.error, 'forbidden');
    assert.deepEqual(blob.calls, []);
});

test('GET with the real verifyAdmin: no bearer → 401, whoami 403 → 403, neither touches the blob', async () => {
    await withEnv(async () => {
        const fetches = installFetch({ '/api/admin/whoami': () => upstreamResponse(403, { error: 'no' }) });
        const blob = fakeBlob({ [schema.STATE_PATH]: JSON.stringify(STATE) });
        const h = createHandler({ blob, env: ENV });
        let r = await call(h, { query: {} });
        assert.equal(r.res.statusCode, 401);
        r = await call(h, { query: {}, headers: { authorization: 'Bearer some-id-token' } });
        assert.equal(r.res.statusCode, 403);
        assert.equal(fetches.length, 1);
        assert.deepEqual(blob.calls, []);
    });
});

test('GET Blob not configured → 503 not_configured naming what to set', async () => {
    const blob = fakeBlob({});
    const { res, body } = await call(handlerWith(blob, ADMIN, {}), { query: {} });
    assert.equal(res.statusCode, 503);
    assert.equal(body.error, 'not_configured');
    assert.match(body.message, /BLOB_READ_WRITE_TOKEN/);
    assert.match(body.message, /BLOB_STORE_ID/);
    assert.equal(blob.calls.length, 0);
    assert.match(res.headers['Cache-Control'], /no-store/);
});

test('GET counts BLOB_STORE_ID (OIDC) as configured; an SDK credential error is still not_configured', async () => {
    const err = new Error('Vercel Blob: No blob credentials found. Pass a `token` option …');
    const blob = fakeBlob({}, { getError: err });
    const { res, body } = await call(handlerWith(blob, ADMIN, { BLOB_STORE_ID: 'store_abc' }), { query: {} });
    assert.equal(res.statusCode, 503);
    assert.equal(body.error, 'not_configured');
});

test('GET missing state blob → 200 state:null, empty vetoes', async () => {
    const blob = fakeBlob({});
    const { res, body } = await call(handlerWith(blob), { query: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(body.state, null);
    assert.deepEqual(body.vetoes, {});
    assert.equal(body.read_at, NOW.toISOString());
});

test('GET happy path: both private blobs read uncached, payload returned, no-store', async () => {
    const vetoes = { schema_version: 1, vetoes: { q1: { action: 'skip', at: '2026-10-09T19:00:00Z', by_uid: 'owner-uid' } } };
    const blob = fakeBlob({ [schema.STATE_PATH]: JSON.stringify(STATE), [schema.VETOES_PATH]: JSON.stringify(vetoes) });
    const { res, body } = await call(handlerWith(blob), { query: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.state, STATE);
    assert.deepEqual(body.vetoes, vetoes.vetoes);
    assert.match(res.headers['Cache-Control'], /no-store/);
    const gets = blob.calls.filter(c => c.op === 'get');
    assert.deepEqual(gets.map(c => c.pathname), [schema.STATE_PATH, schema.VETOES_PATH]);
    for (const g of gets) assert.deepEqual(g.opts, { access: 'private', useCache: false });
    assert.equal(blob.calls.filter(c => c.op === 'put').length, 0);
});

test('GET blob error → 502 unreachable, internals never echoed', async () => {
    const err = new Error('Vercel Blob: Failed to fetch blob: 500 secret-internal-detail token=abc');
    const blob = fakeBlob({}, { getError: err });
    const { res, body } = await call(handlerWith(blob), { query: {} });
    assert.equal(res.statusCode, 502);
    assert.equal(body.error, 'unreachable');
    assert.ok(!res.body.includes('secret-internal-detail'));
    assert.ok(!res.body.includes('token=abc'));
});

test('GET state that is not valid JSON or not schema v1 → 502 bad_blob', async () => {
    for (const bad of ['{not json', JSON.stringify({ schema_version: 2, tasks: [] }), JSON.stringify({ schema_version: 1, tasks: [{ id: 'x', state: 'nope' }] })]) {
        const blob = fakeBlob({ [schema.STATE_PATH]: bad });
        const { res, body } = await call(handlerWith(blob), { query: {} });
        assert.equal(res.statusCode, 502, bad);
        assert.equal(body.error, 'bad_blob');
    }
});

test('wrong method / unknown view', async () => {
    const blob = fakeBlob({});
    let r = await call(handlerWith(blob), { method: 'POST', query: {} });
    assert.equal(r.res.statusCode, 405);
    r = await call(handlerWith(blob), { method: 'GET', query: { view: 'veto' } });
    assert.equal(r.res.statusCode, 405);
    r = await call(handlerWith(blob), { method: 'GET', query: { view: 'state' } });
    assert.equal(r.res.statusCode, 400);
    assert.equal(blob.calls.length, 0);
    assert.match(r.res.headers['Cache-Control'], /no-store/);
});

// ── POST ?view=veto ───────────────────────────────────────────────────────

test('POST non-admin → 403 with no blob call', async () => {
    const blob = fakeBlob({});
    const { res } = await call(handlerWith(blob, DENY), POST({ task_id: 'q1', action: 'skip' }));
    assert.equal(res.statusCode, 403);
    assert.equal(blob.calls.length, 0);
});

test('POST validation: bad action, bad task_id, bad JSON, oversize → 4xx, no blob call', async () => {
    const blob = fakeBlob({});
    const h = handlerWith(blob);
    const cases = [
        [{ task_id: 'q1', action: 'delete' }, 400],
        [{ task_id: 'q1' }, 400],
        [{ task_id: 'bad id with spaces', action: 'skip' }, 400],
        [{ task_id: '<script>', action: 'skip' }, 400],
        [{ task_id: 'x'.repeat(81), action: 'skip' }, 400],
        [{ task_id: 42, action: 'skip' }, 400],
        ['{not json', 400],
        [['q1', 'skip'], 400],
        [{ task_id: 'q1', action: 'skip', pad: 'x'.repeat(3000) }, 413],
        [JSON.stringify({ task_id: 'q1', action: 'skip', pad: 'x'.repeat(3000) }), 413],
    ];
    for (const [body, status] of cases) {
        const { res } = await call(h, POST(body));
        assert.equal(res.statusCode, status, JSON.stringify(body).slice(0, 60));
        assert.match(res.headers['Cache-Control'], /no-store/);
    }
    assert.equal(blob.calls.length, 0);
});

test('POST skip on a missing vetoes file creates it with by_uid; top adds; undo deletes', async () => {
    const blob = fakeBlob({});
    const h = handlerWith(blob);

    let r = await call(h, POST({ task_id: 'q1', action: 'skip' }));
    assert.equal(r.res.statusCode, 200);
    assert.deepEqual(r.body.vetoes, { q1: { action: 'skip', at: NOW.toISOString(), by_uid: 'owner-uid' } });
    let put = blob.calls.filter(c => c.op === 'put').pop();
    assert.equal(put.pathname, schema.VETOES_PATH);
    assert.deepEqual(put.opts, { access: 'private', allowOverwrite: true, contentType: 'application/json', addRandomSuffix: false });
    assert.deepEqual(JSON.parse(put.body), { schema_version: 1, vetoes: r.body.vetoes });

    r = await call(h, POST(JSON.stringify({ task_id: 'q2', action: 'top' })));
    assert.equal(r.res.statusCode, 200);
    assert.deepEqual(Object.keys(r.body.vetoes).sort(), ['q1', 'q2']);
    assert.equal(r.body.vetoes.q2.action, 'top');
    put = blob.calls.filter(c => c.op === 'put').pop();
    assert.equal(put.opts.ifMatch, 'etag-1', 'second write is conditional on the version read');

    r = await call(h, POST({ task_id: 'q1', action: 'undo' }));
    assert.equal(r.res.statusCode, 200);
    assert.deepEqual(Object.keys(r.body.vetoes), ['q2']);
    assert.deepEqual(Object.keys(JSON.parse(blob.files[schema.VETOES_PATH]).vetoes), ['q2']);
    // Every write went through a read first.
    const ops = blob.calls.map(c => c.op).join(',');
    assert.equal(ops, 'get,put,get,put,get,put');
});

test('POST undo of an absent key does not write', async () => {
    const blob = fakeBlob({});
    const { res, body } = await call(handlerWith(blob), POST({ task_id: 'q9', action: 'undo' }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(body.vetoes, {});
    assert.equal(blob.calls.filter(c => c.op === 'put').length, 0);
});

test('POST never overwrites an unreadable vetoes file', async () => {
    const blob = fakeBlob({ [schema.VETOES_PATH]: '{"schema_version":7}' });
    const { res, body } = await call(handlerWith(blob), POST({ task_id: 'q1', action: 'skip' }));
    assert.equal(res.statusCode, 502);
    assert.equal(body.error, 'bad_blob');
    assert.equal(blob.calls.filter(c => c.op === 'put').length, 0);
});

test('POST put failure → 502 unreachable; precondition failure → 409 conflict', async () => {
    let blob = fakeBlob({}, { putError: new Error('Vercel Blob: boom internal') });
    let r = await call(handlerWith(blob), POST({ task_id: 'q1', action: 'skip' }));
    assert.equal(r.res.statusCode, 502);
    assert.equal(r.body.error, 'unreachable');
    assert.ok(!r.res.body.includes('boom internal'));

    class BlobPreconditionFailedError extends Error {}
    blob = fakeBlob({}, { putError: new BlobPreconditionFailedError('etag mismatch') });
    r = await call(handlerWith(blob), POST({ task_id: 'q1', action: 'top' }));
    assert.equal(r.res.statusCode, 409);
    assert.equal(r.body.error, 'conflict');
});

test('POST by_uid is null when the verified claims carry no uid', async () => {
    const blob = fakeBlob({});
    const { body } = await call(handlerWith(blob, async () => ({ ok: true, claims: null })), POST({ task_id: 'q1', action: 'top' }));
    assert.equal(body.vetoes.q1.by_uid, null);
});

// ── schema helpers ────────────────────────────────────────────────────────

test('validateState accepts the v1 shape and names each problem', () => {
    assert.deepEqual(schema.validateState(STATE), []);
    assert.deepEqual(schema.validateState({ schema_version: 1 }), []);
    const errs = schema.validateState({ schema_version: 2, status: { mode: 'flying' }, tasks: [{ id: 'a b', state: 'x', risk: 'huge' }], needs: 'no' });
    assert.ok(errs.some(e => /schema_version/.test(e)));
    assert.ok(errs.some(e => /status\.mode/.test(e)));
    assert.ok(errs.some(e => /tasks\[0\]\.id/.test(e)));
    assert.ok(errs.some(e => /tasks\[0\]\.state/.test(e)));
    assert.ok(errs.some(e => /tasks\[0\]\.risk/.test(e)));
    assert.ok(errs.some(e => /needs must be an array/.test(e)));
    assert.deepEqual(schema.validateState(null), ['state must be a JSON object']);
});

test('normalizeVetoes drops malformed entries and rejects non-v1 documents', () => {
    assert.equal(schema.normalizeVetoes({ schema_version: 2, vetoes: {} }), null);
    assert.equal(schema.normalizeVetoes([]), null);
    const n = schema.normalizeVetoes({ schema_version: 1, vetoes: { ok: { action: 'top', at: 'x', by_uid: 'u' }, 'bad id': { action: 'top' }, k: { action: 'nuke' } } });
    assert.deepEqual(n, { schema_version: 1, vetoes: { ok: { action: 'top', at: 'x', by_uid: 'u' } } });
});

// ── scripts/harness-push.mjs (no network: dry run, validation, usage) ──────

test('harness-push: dry run validates; bad files exit 3; missing token exits 2; the token is never printed', () => {
    const { spawnSync } = require('node:child_process');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-push-'));
    const script = path.join(__dirname, '..', 'scripts', 'harness-push.mjs');
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(good, JSON.stringify(STATE));
    fs.writeFileSync(bad, JSON.stringify({ schema_version: 1, tasks: [{ id: 'x', state: 'flying' }] }));
    const secret = 'vercel_blob_rw_FAKEstore_s3cr3t';
    const run = (args, env) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: Object.assign({ PATH: process.env.PATH }, env || {}) });

    let r = run(['--dry-run', good], { BLOB_READ_WRITE_TOKEN: secret });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ok \(dry run\): 2 tasks/);
    r = run(['--dry-run', bad], { BLOB_READ_WRITE_TOKEN: secret });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /tasks\[0\]\.state/);
    r = run(['--pull-vetoes']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOB_READ_WRITE_TOKEN is not set/);
    r = run([]);
    assert.equal(r.status, 2);
    r = run([path.join(dir, 'missing.json')], { BLOB_READ_WRITE_TOKEN: secret });
    assert.equal(r.status, 2);
    for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(secret));
    fs.rmSync(dir, { recursive: true, force: true });
});
