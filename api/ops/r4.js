// /api/ops/r4 — the R4 news-label audit's rating form (registry R4 rev 3.1).
//
//   GET  ?view=next&round=dev1      → backend GET  /api/internal/r4/next?round=dev1
//   GET  ?view=progress&round=dev1  → backend GET  /api/internal/r4/progress?round=dev1
//   POST ?view=label                → backend POST /api/internal/r4/label (JSON body)
//
// Admin-verified through _verified_proxy; the internal token stays server-side.
// Only `round` is forwarded, validated against the registered round names, so
// a crafted query cannot reshape the upstream call. The rater is never taken
// from the browser: the backend defaults it to the owner.

const { verifiedProxy, send } = require('../_verified_proxy.js');

const ROUNDS = new Set(['dev1', 'dev2', 'conf', 'relook']);

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

module.exports = async function handler(req, res) {
    const q = queryOf(req);
    const view = String(q.view || '');
    if (!Object.prototype.hasOwnProperty.call(VIEWS, view)) {
        return send(res, 400, { error: 'bad_view', message: 'view must be next, progress or label.' });
    }
    const v = VIEWS[view];
    let path = v.path;
    if (v.method === 'GET') {
        const round = String(q.round || '').toLowerCase();
        if (!ROUNDS.has(round)) {
            return send(res, 400, { error: 'bad_round', message: 'round must be dev1, dev2, conf or relook.' });
        }
        path += '?round=' + encodeURIComponent(round);
    } else if (req.body && typeof req.body === 'object' && 'rater' in req.body) {
        // The browser never picks the rater.
        return send(res, 400, { error: 'rejected', message: 'rater is not a browser field.' });
    }
    return verifiedProxy(req, res, path, { method: v.method });
};
