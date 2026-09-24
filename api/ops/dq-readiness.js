// GET /api/ops/dq-readiness → backend GET /api/internal/dq-readiness (admin-gated; #382)

const { verifiedProxy } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    return verifiedProxy(req, res, '/api/internal/dq-readiness', { method: 'GET' });
};
