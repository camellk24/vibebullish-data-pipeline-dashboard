// GET /api/ops/shadow?view=status|evidence|diffs|attribution|alerts
//
// One function for the Shadow-book tab's five reads (Phase D task 5 endpoints).
// Admin-verified through _verified_proxy; the internal token stays server-side.
//
// Only an explicit allow-list of query parameters is forwarded, and each is
// validated here, so a crafted browser query cannot reshape the upstream call.

const { verifiedProxy, send } = require('../_verified_proxy.js');

// view → { path, params } where params are the query keys this view forwards.
const VIEWS = {
    status: { path: '/api/internal/shadow/status', params: ['book_id'] },
    evidence: { path: '/api/internal/shadow/evidence', params: ['book_id', 'sessions'] },
    diffs: { path: '/api/internal/shadow/diffs', params: ['book_id', 'sessions'] },
    attribution: {
        path: '/api/internal/shadow/attribution',
        params: ['book_id', 'valuation_date'],
    },
    alerts: { path: '/api/internal/ops/alerts', params: ['limit'] },
};

const INT_PARAMS = new Set(['book_id', 'sessions', 'limit']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function queryOf(req) {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
        const u = new URL(req.url, 'http://localhost');
        return Object.fromEntries(u.searchParams.entries());
    } catch (_e) {
        return {};
    }
}

function first(v) {
    return Array.isArray(v) ? v[0] : v;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }

    const q = queryOf(req);
    const view = String(first(q.view) || '').trim();
    const spec = VIEWS[view];
    if (!spec) {
        return send(res, 400, {
            error: 'bad_request',
            message: `Unknown view "${view}". Expected one of: ${Object.keys(VIEWS).join(', ')}.`,
        });
    }

    const parts = [];
    for (const key of spec.params) {
        const raw = first(q[key]);
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const val = String(raw).trim();

        if (INT_PARAMS.has(key)) {
            if (!/^\d{1,12}$/.test(val)) {
                return send(res, 400, {
                    error: 'bad_request',
                    message: `Query parameter "${key}" must be a non-negative integer.`,
                });
            }
        } else if (key === 'valuation_date' && !DATE_RE.test(val)) {
            return send(res, 400, {
                error: 'bad_request',
                message: 'Query parameter "valuation_date" must be YYYY-MM-DD.',
            });
        }
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }

    const upstreamPath = spec.path + (parts.length ? '?' + parts.join('&') : '');
    return verifiedProxy(req, res, upstreamPath, { method: 'GET' });
};
