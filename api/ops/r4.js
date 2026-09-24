// /api/ops/r4 — the R4 news-label audit's rating form (registry R4 rev 3.1).
//
//   GET  ?view=next&round=dev1      → backend GET  /api/internal/r4/next?round=dev1
//   GET  ?view=progress&round=dev1  → backend GET  /api/internal/r4/progress?round=dev1
//   POST ?view=label                → backend POST /api/internal/r4/label (JSON body)
//
// Admin-verified through _verified_proxy AND bound to ONE person: the verified
// admin's Firebase uid must equal R4_OWNER_UID (Vercel env), because the
// backend records every dashboard answer as the registered human rater. Any
// other admin gets 403; an unset R4_OWNER_UID closes the route (503).
//
// The POST body is parsed ONCE here (string or object), validated field by
// field, and rebuilt as an allow-listed payload. Nothing else from the browser
// reaches the backend — in particular no `rater`, which the backend defaults
// to the owner.

const { verifiedProxy, send, parseJSONBody } = require('../_verified_proxy.js');

const ROUNDS = new Set(['dev1', 'dev2', 'conf', 'relook']);
const H1 = new Set(['yes', 'passing_mention', 'no']);
const H2 = new Set(['bullish', 'bearish', 'neutral', 'unclear']);
const H3 = new Set(['filler', 'notable', 'material', 'major']);
const CLUSTER_RE = /^[0-9a-f]{16}$/;
const NOTE_MAX = 2000;
const OWNER_UID_ENV = 'R4_OWNER_UID';

const VIEWS = Object.assign(Object.create(null), {
    next: { path: '/api/internal/r4/next', method: 'GET' },
    progress: { path: '/api/internal/r4/progress', method: 'GET' },
    label: { path: '/api/internal/r4/label', method: 'POST' },
});

function queryOf(req) {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
        const u = new URL(req.url, 'http://localhost');
        return Object.fromEntries(u.searchParams.entries());
    } catch (_e) {
        return {};
    }
}

function lower(v) {
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// labelPayload validates the browser body and returns the exact object to
// forward, or an error body. Unknown keys are dropped, never forwarded.
function labelPayload(req) {
    const b = parseJSONBody(req);
    if (!b) return { error: { error: 'bad_json', message: 'Body must be a JSON object.' } };
    const round = lower(b.round);
    const clusterId = typeof b.cluster_id === 'string' ? b.cluster_id.trim() : '';
    const h1 = lower(b.h1), h2 = lower(b.h2), h3 = lower(b.h3);
    if (!ROUNDS.has(round)) return { error: { error: 'rejected', message: 'round must be dev1, dev2, conf or relook.' } };
    if (!CLUSTER_RE.test(clusterId)) return { error: { error: 'rejected', message: 'cluster_id must be 16 hex characters.' } };
    if (!H1.has(h1) || !H2.has(h2) || !H3.has(h3)) {
        return { error: { error: 'rejected', message: 'h1/h2/h3 outside the registered vocabulary.' } };
    }
    let note = typeof b.note === 'string' ? b.note : '';
    if (note.length > NOTE_MAX) note = note.slice(0, NOTE_MAX);
    return { body: { round, cluster_id: clusterId, h1, h2, h3, note } };
}

module.exports = async function handler(req, res) {
    const q = queryOf(req);
    const view = String(q.view || '');
    if (!Object.prototype.hasOwnProperty.call(VIEWS, view)) {
        return send(res, 400, { error: 'bad_view', message: 'view must be next, progress or label.' });
    }
    const v = VIEWS[view];
    if (v.method === 'GET') {
        const round = lower(q.round);
        if (!ROUNDS.has(round)) {
            return send(res, 400, { error: 'bad_round', message: 'round must be dev1, dev2, conf or relook.' });
        }
        return verifiedProxy(req, res, v.path + '?round=' + encodeURIComponent(round), {
            method: 'GET',
            requireUidEnv: OWNER_UID_ENV,
        });
    }
    if (req.method !== 'POST') {
        return send(res, 405, { error: 'method_not_allowed', message: 'POST only.' });
    }
    const p = labelPayload(req);
    if (p.error) return send(res, 400, p.error);
    return verifiedProxy(req, res, v.path, { method: 'POST', body: p.body, requireUidEnv: OWNER_UID_ENV });
};

module.exports.labelPayload = labelPayload;
