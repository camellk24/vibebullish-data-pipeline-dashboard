// PUBLIC Firebase web config for the dashboard's admin sign-in.
//
// Everything returned here is public by design — a Firebase web apiKey is an
// API *identifier*, not a secret; access is enforced by the backend's admin-UID
// check (GET /api/admin/whoami) and by Firebase Auth's authorized-domain list.
// The one real secret in this project, INTERNAL_API_TOKEN, is NEVER returned
// here and never leaves api/_verified_proxy.js.
//
// Vercel env (Production + Preview): FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN,
// FIREBASE_APP_ID. projectId / messagingSenderId are fixed for VibeBullish.

const PROJECT_ID = 'vibebullish';
const MESSAGING_SENDER_ID = '718084292276';

module.exports = function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res
            .status(405)
            .send(JSON.stringify({ error: 'method_not_allowed', message: 'GET only.' }));
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY || '';
    const authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
    const appId = process.env.FIREBASE_APP_ID || '';

    const missing = [];
    if (!apiKey) missing.push('FIREBASE_WEB_API_KEY');
    if (!authDomain) missing.push('FIREBASE_AUTH_DOMAIN');
    if (!appId) missing.push('FIREBASE_APP_ID');

    if (missing.length) {
        // Explicit, renderable state — the header shows "sign-in not configured"
        // instead of a dead button.
        return res.status(503).send(
            JSON.stringify({
                error: 'not_configured',
                missing,
                message:
                    'Firebase web config is incomplete on this Vercel project. Missing: ' +
                    missing.join(', ') +
                    '. Set them under Project Settings → Environment Variables and redeploy.',
            })
        );
    }

    return res.status(200).send(
        JSON.stringify({
            apiKey,
            authDomain,
            projectId: PROJECT_ID,
            appId,
            messagingSenderId: MESSAGING_SENDER_ID,
        })
    );
};
