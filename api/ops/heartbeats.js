// Admin-only heartbeat and saved model-health reads. Caller query parameters
// never reach the backend; model health MUST stay on source=snapshot.
const { verifiedProxy, send } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    const view = req.query && req.query.view;
    if (view === 'model-health') {
        return verifiedProxy(req, res, '/api/internal/inference-health?source=snapshot',
            { method: 'GET', recognizeMissingSnapshot: true });
    }
    if (view !== undefined) {
        return send(res, 400, { error: 'bad_request', message: 'Unknown heartbeat view.' });
    }
    return verifiedProxy(req, res, '/api/internal/heartbeat/latest', { method: 'GET' });
};
