// GET /api/ops/strategy-diagnostics
//
// The Strategies tab's book diagnostics card: pairwise book-return
// correlation, 20-session turnover and capacity per active paper book
// (backend GET /api/internal/ops/strategy-diagnostics, machine class).
// Admin-verified through _verified_proxy; the internal token stays server-side.
// The upstream takes no parameters, so nothing from the caller's query string
// is forwarded.

const { verifiedProxy, send } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }
    return verifiedProxy(req, res, '/api/internal/ops/strategy-diagnostics', { method: 'GET' });
};
