// Server-side proxy for the token-gated backend route GET /api/internal/agent-ops.
//
// WHY THIS EXISTS: the dashboard is a public static site. It must never hold
// INTERNAL_API_TOKEN — anything shipped to the browser is readable by anyone who
// opens devtools. This Vercel serverless function runs on the server, reads the
// token from a Vercel project environment variable, and is the only thing that
// ever sees it. The browser calls /api/agent-ops (no auth) and gets back JSON.
//
// Required Vercel env var (Production + Preview):  INTERNAL_API_TOKEN
// Optional:                                       BACKEND_API_BASE
//
// The token is never echoed into a response body, a header, or a log line.

const DEFAULT_BACKEND = 'https://api.vibebullish.com';
const UPSTREAM_PATH = '/api/internal/agent-ops';
const TIMEOUT_MS = 12_000;

function send(res, status, body) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Always fresh: a stale agent-health number read as current is the exact
    // failure mode this view exists to prevent.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(status).send(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed', message: 'GET only.' });
    }

    const token = process.env.INTERNAL_API_TOKEN;
    if (!token) {
        // Explicit, renderable "not configured" state — never a blank panel.
        return send(res, 503, {
            error: 'not_configured',
            message:
                'INTERNAL_API_TOKEN is not set on this Vercel project. Set it under ' +
                'Project Settings → Environment Variables (Production + Preview) and redeploy.',
        });
    }

    const base = (process.env.BACKEND_API_BASE || DEFAULT_BACKEND).replace(/\/+$/, '');
    const url = base + UPSTREAM_PATH;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const upstream = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Internal-Token': token, // backend internal routes accept either form
                Accept: 'application/json',
            },
            signal: controller.signal,
        });

        const text = await upstream.text();

        if (!upstream.ok) {
            return send(res, 502, {
                error: 'upstream_error',
                upstream_status: upstream.status,
                message: `Backend returned HTTP ${upstream.status} for ${UPSTREAM_PATH}.`,
            });
        }

        let payload;
        try {
            payload = JSON.parse(text);
        } catch (_e) {
            return send(res, 502, {
                error: 'upstream_bad_json',
                message: 'Backend response was not valid JSON.',
            });
        }

        return send(res, 200, payload);
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        return send(res, 502, {
            error: 'unreachable',
            message: aborted
                ? `Backend did not respond within ${TIMEOUT_MS / 1000}s.`
                : 'Backend is unreachable.',
        });
    } finally {
        clearTimeout(timer);
    }
};
