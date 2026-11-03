// GET /api/ops/overview
//
// The ops console Overview tab: one chip per pipeline stage plus the overall
// status (backend GET /api/internal/ops/overview, machine class; spec
// vibebullish-docs docs/superpowers/specs/2026-11-03-ops-overview-tab-spec.md §5).
// Admin-verified through _verified_proxy; the internal token stays server-side.
// The upstream takes no parameters, so nothing from the caller's query string
// is forwarded.

const { verifiedProxy, send } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }
    return verifiedProxy(req, res, '/api/internal/ops/overview', { method: 'GET' });
};
