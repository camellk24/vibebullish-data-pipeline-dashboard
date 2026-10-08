// GET /api/ops/reads?view=<name>[&allow-listed params]
//
// The signed-in read path for the six recovered dashboard tabs (LLM Usage,
// System Health, Action Engine, Quant Quality, Data Collector, Catalyst
// Accuracy). Each view maps to exactly one backend route; the browser never
// names a path, a header, or a forwarding mode.
//
// Why bearer: these upstreams are HUMAN-class routes (admin sign-in) — today
// most are still anonymous reads, and the verified proxy is their only admin
// gate; once backend #449 is deployed they require the same Firebase bearer
// this route forwards. `ws-status` was the one exception until backend #449
// deployed: it needed the internal token before, so it forwarded BOTH; it is
// human-class now, like the other 13, and forwards the bearer only.
//
// Only an explicit allow-list of query parameters is forwarded, each validated
// here; everything else — including the client's cache-buster `t` — is dropped.

const { verifiedProxy, send } = require('../_verified_proxy.js');

// Object.create(null): a plain literal would make `__proto__`, `constructor`
// and `toString` resolve to inherited values. The hasOwnProperty guard below
// is the second belt.
const VIEWS = Object.assign(Object.create(null), {
    'llm-today':             { path: '/api/llm-usage/today',               params: ['date'],               forwardAuth: 'bearer' },
    'llm-week':              { path: '/api/llm-usage/week',                params: [],                     forwardAuth: 'bearer' },
    'llm-scanner':           { path: '/api/llm-usage/scanner',             params: ['date'],               forwardAuth: 'bearer' },
    'catalyst-accuracy':     { path: '/api/llm-catalyst-accuracy',         params: ['dimension', 'days'],  forwardAuth: 'bearer' },
    'scanner-metrics':       { path: '/api/scanner/metrics',               params: ['hours'],              forwardAuth: 'bearer' },
    'ae-stats':              { path: '/api/action-engine/backtest/stats',  params: ['days'],               forwardAuth: 'bearer' },
    'ae-trend':              { path: '/api/action-engine/backtest/trend',  params: ['days'],               forwardAuth: 'bearer' },
    'quant-health':          { path: '/api/quant/health',                  params: [],                     forwardAuth: 'bearer' },
    'quant-live-predictions':{ path: '/api/quant/live-predictions',        params: ['timeframe', 'limit'], forwardAuth: 'bearer' },
    'quant-training-runs':   { path: '/api/quant/training-runs',           params: ['limit'],              forwardAuth: 'bearer' },
    'quant-backtests':       { path: '/api/quant/backtests',               params: ['limit'],              forwardAuth: 'bearer' },
    'quantile-report':       { path: '/api/quantile-report',               params: [],                     forwardAuth: 'bearer' },
    'data-collector-health': { path: '/api/data-collector/health',         params: [],                     forwardAuth: 'bearer' },
    // Human-class since backend #449 (was 'both' while it still needed the
    // internal token; dashboard #28).
    'ws-status':             { path: '/api/internal/ws-status',            params: [],                     forwardAuth: 'bearer' },
});

const DIMENSIONS = new Set(['extractor', 'model', 'event_type', 'horizon']);
const TIMEFRAMES = new Set(['1d']);
const INT_RE = /^\d{1,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RULES = Object.assign(Object.create(null), {
    date: { ok: v => DATE_RE.test(v), expect: 'YYYY-MM-DD' },
    days: { ok: v => INT_RE.test(v), expect: 'an integer of 1–4 digits' },
    hours: { ok: v => INT_RE.test(v), expect: 'an integer of 1–4 digits' },
    limit: { ok: v => INT_RE.test(v), expect: 'an integer of 1–4 digits' },
    dimension: { ok: v => DIMENSIONS.has(v), expect: 'one of ' + [...DIMENSIONS].join(', ') },
    timeframe: { ok: v => TIMEFRAMES.has(v), expect: 'one of ' + [...TIMEFRAMES].join(', ') },
});

// queryOf: both query representations, normalized FIRST-VALUE-WINS. A Vercel
// req.query repeats a key as an array (element 0 wins); the req.url fallback
// walks searchParams in order and keeps the first occurrence — never
// Object.fromEntries, which keeps the last.
function queryOf(req) {
    const out = Object.create(null);
    if (req && req.query && typeof req.query === 'object') {
        for (const k of Object.keys(req.query)) {
            const v = req.query[k];
            const first = Array.isArray(v) ? v[0] : v;
            if (!(k in out)) out[k] = first;
        }
        return out;
    }
    try {
        const u = new URL(String((req && req.url) || ''), 'http://localhost');
        for (const [k, v] of u.searchParams) if (!(k in out)) out[k] = v;
    } catch (_e) {
        /* no query */
    }
    return out;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }

    const q = queryOf(req);
    const view = String(q.view == null ? '' : q.view).trim();
    const spec = Object.prototype.hasOwnProperty.call(VIEWS, view) ? VIEWS[view] : null;
    if (!spec) {
        return send(res, 400, {
            error: 'bad_request',
            message: `Unknown view "${view}". Expected one of: ${Object.keys(VIEWS).join(', ')}.`,
        });
    }

    const parts = [];
    for (const key of spec.params) {
        const raw = q[key];
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        const val = String(raw).trim();
        const rule = RULES[key];
        if (!rule || !rule.ok(val)) {
            return send(res, 400, {
                error: 'bad_request',
                message: `Query parameter "${key}" must be ${rule ? rule.expect : 'valid'}.`,
            });
        }
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    }

    const upstreamPath = spec.path + (parts.length ? '?' + parts.join('&') : '');
    return verifiedProxy(req, res, upstreamPath, { method: 'GET', forwardAuth: spec.forwardAuth });
};

module.exports.VIEWS = VIEWS;
module.exports.queryOf = queryOf;
