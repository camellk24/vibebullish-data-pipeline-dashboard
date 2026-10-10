// /api/ops/harness — the admin-only Harness tab's data path (Vercel Blob).
//
//   GET                → { state, vetoes, read_at }
//   POST ?view=veto    body {task_id, action: "skip"|"top"|"undo"} → { vetoes, read_at }
//
// DATA: two PRIVATE blobs in the project's Blob store.
//   harness/state.json   uploaded by the harness on the owner's Mac
//                        (scripts/harness-push.mjs) after every change.
//   harness/vetoes.json  written ONLY here: the owner's Do next / Skip calls,
//                        which the harness reads on its next tick.
//
// ACCESS: verifyAdmin (api/_verified_proxy.js) runs before any blob call, in
// both methods, and fails closed exactly like every other ops route: no
// bearer → 401, anything but a 200 from the backend's whoami → 403. A
// non-admin never causes a blob read or write.
//
// ERRORS: Blob not configured → 503 not_configured naming what to set; any
// blob failure → 502 unreachable with a fixed message (blob internals are
// never echoed). Every response is Cache-Control: no-store (via send()).
//
// Blob auth (@vercel/blob 2.8.0, resolveBlobAuth): an OIDC token
// (VERCEL_OIDC_TOKEN, present on Vercel) together with BLOB_STORE_ID wins;
// otherwise BLOB_READ_WRITE_TOKEN. Connecting a Blob store to the project sets
// one of them.
//
// TESTS: createHandler(deps) takes { verifyAdmin, blob: {get, put}, env, now }
// so api/harness.test.js never touches the network.

const proxy = require('../_verified_proxy.js');
const schema = require('../_harness_schema.js');

const { send, parseJSONBody } = proxy;
const MAX_VETO_BODY_BYTES = 2 * 1024;
const MAX_VETOES = 500;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

const NOT_CONFIGURED_MESSAGE =
    'No Vercel Blob store is connected to this project. Create a PRIVATE Blob store, connect it to ' +
    'the vibebullish-dashboard project for Production + Preview (this sets BLOB_READ_WRITE_TOKEN, or ' +
    'BLOB_STORE_ID for OIDC auth), and redeploy.';

function trimmed(v) {
    return typeof v === 'string' ? v.trim() : '';
}

function blobConfigured(env) {
    return !!(trimmed(env.BLOB_READ_WRITE_TOKEN) || trimmed(env.BLOB_STORE_ID));
}

// A credential problem surfaced by the SDK at call time (e.g. BLOB_STORE_ID
// set but no OIDC token) is a configuration state, not an outage.
function isCredentialError(err) {
    const m = String((err && err.message) || '');
    return /No blob credentials|No read-write token|unable to extract store ID|no storeId was found/i.test(m);
}

class BlobReadError extends Error {}

function queryOf(req) {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
        const u = new URL(req.url, 'http://localhost');
        return Object.fromEntries(u.searchParams.entries());
    } catch (_e) {
        return {};
    }
}

async function streamText(stream) {
    // A web ReadableStream (what get() returns) → string, with a size cap.
    const text = await new Response(stream).text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BLOB_BYTES) throw new BlobReadError('blob too large');
    return text;
}

// readJSON → { missing: true } | { doc, etag }. Throws on blob failure
// (propagated) or BlobReadError on an unreadable document.
async function readJSON(blob, pathname) {
    const r = await blob.get(pathname, { access: 'private', useCache: false });
    if (!r) return { missing: true };
    if (r.statusCode !== 200 || !r.stream) throw new BlobReadError('unexpected blob response');
    const text = await streamText(r.stream);
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (_e) {
        throw new BlobReadError(pathname + ' is not valid JSON');
    }
    return { doc, etag: (r.blob && r.blob.etag) || '' };
}

function failure(res, err, which) {
    if (isCredentialError(err)) {
        return send(res, 503, { error: 'not_configured', message: NOT_CONFIGURED_MESSAGE });
    }
    if (err instanceof BlobReadError) {
        return send(res, 502, {
            error: 'bad_blob',
            message: `${which} could not be read as a schema v1 document.`,
        });
    }
    const name = (err && err.constructor && err.constructor.name) || '';
    if (name === 'BlobPreconditionFailedError') {
        return send(res, 409, {
            error: 'conflict',
            message: 'The vetoes file changed while this request was saving. Try again.',
        });
    }
    return send(res, 502, { error: 'unreachable', message: 'The Blob store did not answer. Nothing was changed.' });
}

function vetoBody(req) {
    const raw = req && req.body;
    if (typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') > MAX_VETO_BODY_BYTES) {
        return { status: 413, body: { error: 'too_large', message: 'Body too large.' } };
    }
    const b = parseJSONBody(req);
    if (!b) return { status: 400, body: { error: 'bad_json', message: 'Body must be a JSON object.' } };
    if (Buffer.byteLength(JSON.stringify(b), 'utf8') > MAX_VETO_BODY_BYTES) {
        return { status: 413, body: { error: 'too_large', message: 'Body too large.' } };
    }
    const taskId = typeof b.task_id === 'string' ? b.task_id : '';
    if (!schema.TASK_ID_RE.test(taskId)) {
        return { status: 400, body: { error: 'rejected', message: 'task_id must be 1–80 characters of A–Z a–z 0–9 . _ : -' } };
    }
    if (!schema.VETO_ACTIONS.includes(b.action)) {
        return { status: 400, body: { error: 'rejected', message: 'action must be skip, top or undo.' } };
    }
    return { taskId, action: b.action };
}

function createHandler(deps) {
    deps = deps || {};
    const verify = deps.verifyAdmin || proxy.verifyAdmin;
    const env = deps.env || process.env;
    const now = deps.now || (() => new Date());
    let blobClient = deps.blob || null;
    const blob = () => {
        if (!blobClient) {
            const b = require('@vercel/blob');
            blobClient = { get: b.get, put: b.put };
        }
        return blobClient;
    };

    async function handleGet(req, res) {
        let state = null;
        let vetoes;
        try {
            const s = await readJSON(blob(), schema.STATE_PATH);
            if (!s.missing) {
                const problems = schema.validateState(s.doc);
                if (problems.length) throw new BlobReadError('invalid state');
                state = s.doc;
            }
        } catch (err) {
            return failure(res, err, schema.STATE_PATH);
        }
        try {
            const v = await readJSON(blob(), schema.VETOES_PATH);
            const doc = v.missing ? schema.emptyVetoes() : schema.normalizeVetoes(v.doc);
            if (!doc) throw new BlobReadError('invalid vetoes');
            vetoes = doc.vetoes;
        } catch (err) {
            return failure(res, err, schema.VETOES_PATH);
        }
        return send(res, 200, { state, vetoes, read_at: now().toISOString() });
    }

    async function handleVeto(req, res, claims) {
        const p = vetoBody(req);
        if (p.status) return send(res, p.status, p.body);

        let doc;
        let etag = '';
        try {
            const v = await readJSON(blob(), schema.VETOES_PATH);
            doc = v.missing ? schema.emptyVetoes() : schema.normalizeVetoes(v.doc);
            // Never overwrite a file we cannot understand.
            if (!doc) throw new BlobReadError('invalid vetoes');
            etag = v.etag || '';
        } catch (err) {
            return failure(res, err, schema.VETOES_PATH);
        }

        const had = Object.prototype.hasOwnProperty.call(doc.vetoes, p.taskId);
        if (p.action === 'undo') {
            if (!had) return send(res, 200, { vetoes: doc.vetoes, read_at: now().toISOString() });
            delete doc.vetoes[p.taskId];
        } else {
            if (!had && Object.keys(doc.vetoes).length >= MAX_VETOES) {
                return send(res, 409, { error: 'conflict', message: `More than ${MAX_VETOES} open vetoes; undo some first.` });
            }
            const uid = claims && typeof claims.uid === 'string' ? claims.uid : null;
            doc.vetoes[p.taskId] = { action: p.action, at: now().toISOString(), by_uid: uid };
        }

        const putOpts = {
            access: 'private',
            allowOverwrite: true,
            contentType: 'application/json',
            addRandomSuffix: false,
        };
        // Optimistic concurrency: only replace the version we read.
        if (etag) putOpts.ifMatch = etag;
        try {
            await blob().put(schema.VETOES_PATH, JSON.stringify(doc), putOpts);
        } catch (err) {
            return failure(res, err, schema.VETOES_PATH);
        }
        return send(res, 200, { vetoes: doc.vetoes, read_at: now().toISOString() });
    }

    return async function handler(req, res) {
        const q = queryOf(req);
        const view = q.view === undefined ? '' : String(q.view);
        const isRead = req.method === 'GET' || req.method === 'HEAD';

        if (view === '') {
            if (!isRead) return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
        } else if (view === 'veto') {
            if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed', message: 'POST only.' });
        } else {
            return send(res, 400, { error: 'bad_view', message: 'view must be omitted (read) or veto.' });
        }

        // Admin first: nothing below runs for anyone else.
        const verdict = await verify(req);
        if (!verdict || !verdict.ok) {
            const v = verdict || { status: 403, body: { error: 'forbidden', message: 'Admin check failed.' } };
            return send(res, v.status, v.body);
        }

        if (!blobConfigured(env)) {
            return send(res, 503, { error: 'not_configured', message: NOT_CONFIGURED_MESSAGE });
        }

        return view === 'veto' ? handleVeto(req, res, verdict.claims) : handleGet(req, res);
    };
}

const handler = createHandler();
module.exports = handler;
module.exports.default = handler;
module.exports.createHandler = createHandler;
module.exports.blobConfigured = blobConfigured;
module.exports.MAX_VETO_BODY_BYTES = MAX_VETO_BODY_BYTES;
