// GET /api/ops/whoami — "is the signed-in Google account an admin?"
//
// The browser sends its Firebase ID token; this function asks the backend
// (GET /api/admin/whoami) and answers with a boolean. It deliberately does NOT
// forward anything to an internal endpoint, so it needs no internal token: it
// is the gate, not a data path.

const { verifyAdmin, send } = require('../_verified_proxy.js');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }

    const verdict = await verifyAdmin(req);
    if (!verdict.ok) {
        return send(res, verdict.status, Object.assign({ admin: false }, verdict.body));
    }

    const claims = verdict.claims && typeof verdict.claims === 'object' ? verdict.claims : {};
    return send(res, 200, {
        admin: true,
        uid: typeof claims.uid === 'string' ? claims.uid : null,
        email: typeof claims.email === 'string' ? claims.email : null,
    });
};
