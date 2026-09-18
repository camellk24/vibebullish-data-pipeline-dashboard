// GET /api/ops/heartbeats → backend GET /api/internal/heartbeat/latest
// Admin-verified; the internal token never reaches the browser.

const { verifiedProxy } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    return verifiedProxy(req, res, '/api/internal/heartbeat/latest', { method: 'GET' });
};
