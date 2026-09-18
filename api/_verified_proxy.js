// Shared server-side "verified proxy" for the admin-gated ops console.
//
// WHY THIS EXISTS
// ---------------
// The dashboard is a PUBLIC static site. The backend's ops data lives behind
// `/api/internal/*`, which is gated by the shared secret INTERNAL_API_TOKEN.
// That token must never be shipped to a browser — anything in `js/` is readable
// by anyone who opens devtools.
//
// So the browser authenticates as a PERSON (a Firebase ID token, obtained by
// signing in with Google), and this function — running on Vercel's server —
// does two things in order:
//
//   1. VERIFY: GET {BACKEND_API_BASE}/api/admin/whoami with the browser's
//      `Authorization: Bearer <idToken>`. The backend returns 200 only for
//      admin UIDs. Anything else (401, 403, 5xx, timeout) → 403 forbidden here,
//      and the upstream ops endpoint is NEVER contacted.
//   2. FORWARD: only after a 200, call the internal endpoint with
//      `X-Internal-Token: <INTERNAL_API_TOKEN>` read from server env.
//
// INVARIANTS (pinned by api/_verified_proxy.test.js):
//   - The internal token never appears in any response body or response header.
//   - Upstream response headers are NEVER echoed; we build our own response.
//   - A non-200 whoami short-circuits without any upstream call.
//   - Every response is `Cache-Control: no-store` — a stale ops number read as
//     current is the exact failure this console exists to prevent.
//
// Required Vercel env: INTERNAL_API_TOKEN
// Optional:            BACKEND_API_BASE (default https://api.vibebullish.com)

const DEFAULT_BACKEND = 'https://api.vibebullish.com';
const WHOAMI_PATH = '/api/admin/whoami';
const WHOAMI_TIMEOUT_MS = 2_000;
const UPSTREAM_TIMEOUT_MS = 12_000;

function backendBase() {
    return (process.env.BACKEND_API_BASE || DEFAULT_BACKEND).replace(/\/+$/, '');
}

// Typed error bodies, same vocabulary as api/agent-ops.js.
function send(res, status, body) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(status).send(JSON.stringify(body));
}

function bearerToken(req) {
    const raw =
        (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
    return m ? m[1].trim() : '';
}

async function fetchWithTimeout(url, opts, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    } finally {
        clearTimeout(timer);
    }
}

// verifyAdmin resolves the browser's Firebase ID token against the backend.
// Returns { ok: true } or { ok: false, status, body } ready to send.
async function verifyAdmin(req) {
    const idToken = bearerToken(req);
    if (!idToken) {
        return {
            ok: false,
            status: 401,
            body: {
                error: 'unauthenticated',
                message: 'Sign in with an admin Google account to view this panel.',
            },
        };
    }

    let resp;
    try {
        resp = await fetchWithTimeout(
            backendBase() + WHOAMI_PATH,
            {
                method: 'GET',
                headers: { Authorization: `Bearer ${idToken}`, Accept: 'application/json' },
                redirect: 'manual',
            },
            WHOAMI_TIMEOUT_MS
        );
    } catch (_err) {
        // Cannot prove admin → not admin. Fail closed.
        return {
            ok: false,
            status: 403,
            body: {
                error: 'forbidden',
                message: 'Could not verify admin access (identity check unreachable).',
            },
        };
    }

    if (!resp || resp.status !== 200) {
        return {
            ok: false,
            status: 403,
            body: {
                error: 'forbidden',
                message: 'This Google account is not an admin of VibeBullish.',
            },
        };
    }

    let claims = null;
    try {
        claims = JSON.parse(await resp.text());
    } catch (_e) {
        claims = null; // whoami said 200; a body we cannot parse is not a denial.
    }
    return { ok: true, claims };
}

// verifiedProxy: admin-verify, then forward `upstreamPath` (path + query) to the
// backend with the internal token.
async function verifiedProxy(req, res, upstreamPath, opts) {
    const method = ((opts && opts.method) || 'GET').toUpperCase();

    if (req.method !== method && !(method === 'GET' && req.method === 'HEAD')) {
        return send(res, 405, {
            error: 'method_not_allowed',
            message: `${method} only.`,
        });
    }

    const token = process.env.INTERNAL_API_TOKEN;
    if (!token) {
        return send(res, 503, {
            error: 'not_configured',
            message:
                'INTERNAL_API_TOKEN is not set on this Vercel project. Set it under ' +
                'Project Settings → Environment Variables (Production + Preview) and redeploy.',
        });
    }

    const verdict = await verifyAdmin(req);
    if (!verdict.ok) {
        // NOTE: no upstream call has happened at this point, by construction.
        return send(res, verdict.status, verdict.body);
    }

    let upstream;
    try {
        upstream = await fetchWithTimeout(
            backendBase() + upstreamPath,
            {
                method,
                headers: {
                    'X-Internal-Token': token,
                    Accept: 'application/json',
                },
                redirect: 'manual',
            },
            UPSTREAM_TIMEOUT_MS
        );
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        return send(res, 502, {
            error: 'unreachable',
            message: aborted
                ? `Backend did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
                : 'Backend is unreachable.',
        });
    }

    const text = await upstream.text();

    if (!upstream.ok) {
        // The upstream body is NOT echoed: a token-gated 4xx body can carry
        // header echoes. We report the status only, typed, so the panel can
        // render an explicit "unavailable" state (e.g. 404 = not deployed yet).
        return send(res, upstream.status === 404 ? 404 : 502, {
            error: upstream.status === 404 ? 'not_found' : 'upstream_error',
            upstream_status: upstream.status,
            upstream_path: upstreamPath.split('?')[0],
            message: `Backend returned HTTP ${upstream.status} for ${upstreamPath.split('?')[0]}.`,
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
}

module.exports = {
    verifiedProxy,
    verifyAdmin,
    send,
    bearerToken,
    DEFAULT_BACKEND,
    WHOAMI_PATH,
    WHOAMI_TIMEOUT_MS,
    UPSTREAM_TIMEOUT_MS,
};
