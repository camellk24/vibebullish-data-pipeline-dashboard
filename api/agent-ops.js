// Server-side proxy for the token-gated backend route GET /api/internal/agent-ops.
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
// Required Vercel env var (Production + Preview):  INTERNAL_API_TOKEN
// Optional:                                       BACKEND_API_BASE
//
// The token is never echoed into a response body, a header, or a log line.

const { verifiedProxy } = require('./_verified_proxy.js');

module.exports = async function handler(req, res) {
    return verifiedProxy(req, res, '/api/internal/agent-ops', { method: 'GET' });
};
