// Server-side proxy for the token-gated backend routes behind the Agents tab.
//
//   GET /api/agent-ops                     → backend GET /api/internal/agent-ops
//   GET /api/agent-ops?view=risk-flagger   → backend GET /api/internal/risk-flagger-stats
//   GET /api/agent-ops?view=curated-picks  → backend GET /api/internal/curated-picks-scorecard
//   GET /api/agent-ops?view=tripwire       → backend GET /api/internal/tripwire-scorecard
//
// WHY THIS EXISTS: the dashboard is a public static site. It must never hold
// INTERNAL_API_TOKEN — anything shipped to the browser is readable by anyone who
// opens devtools. This Vercel serverless function runs on the server, reads the
// token from a Vercel project environment variable, and is the only thing that
// ever sees it.
//
// BEHAVIOR CHANGE (Phase D, task 6): this route now goes through the shared
// VERIFIED proxy — the caller must present a Firebase ID token for an admin UID
// (checked against the backend's GET /api/admin/whoami) before the token-gated
// upstream is contacted at all. The Agents tab therefore requires admin sign-in;
// signed out it renders its "unauthenticated" state rather than data.
//
// The scorecard views share this one function rather than adding three: the
// project is close to the Vercel functions cap. Every upstream is machine class
// (internal token) and fixed — no caller parameter is ever forwarded. An unknown
// view is a 400 before any network call.
//
// Required Vercel env var (Production only):       INTERNAL_API_TOKEN
// Optional:                                       BACKEND_API_BASE
//
// The token is never echoed into a response body, a header, or a log line.

const { verifiedProxy, send } = require('./_verified_proxy.js');

// Null-prototype map: `__proto__` / `constructor` never resolve to a view.
const VIEWS = Object.assign(Object.create(null), {
    roles: '/api/internal/agent-ops',
    'risk-flagger': '/api/internal/risk-flagger-stats',
    'curated-picks': '/api/internal/curated-picks-scorecard',
    tripwire: '/api/internal/tripwire-scorecard',
});

function viewOf(req) {
    let v;
    if (req.query && typeof req.query === 'object') {
        v = req.query.view;
    } else {
        try {
            v = new URL(req.url, 'http://localhost').searchParams.get('view');
        } catch (_e) {
            v = undefined;
        }
    }
    if (Array.isArray(v)) v = v[0];
    return v === undefined || v === null || String(v).trim() === '' ? 'roles' : String(v).trim();
}

module.exports = async function handler(req, res) {
    const view = viewOf(req);
    const path = Object.prototype.hasOwnProperty.call(VIEWS, view) ? VIEWS[view] : null;
    if (!path) {
        return send(res, 400, {
            error: 'bad_request',
            message: `Unknown view "${view}". Expected one of: ${Object.keys(VIEWS).join(', ')}.`,
        });
    }
    return verifiedProxy(req, res, path, { method: 'GET' });
};
