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
// FORWARDING MODES (opts.forwardAuth, resolved before any env or network step):
//   'internal' (default) — X-Internal-Token only. Machine-class upstreams.
//   'bearer'             — the SAME Firebase ID token verifyAdmin just verified,
//                          as `Authorization: Bearer …`; X-Internal-Token is never
//                          attached, even when configured. Human-class upstreams
//                          (admin-only routes that authenticate the person).
//   'both'               — both headers. Only for an upstream that is machine-
//                          class today and becomes human-class later.
//   INTERNAL_API_TOKEN is required (503) only for 'internal' and 'both'.
//   verifyAdmin runs in EVERY mode: it is the only admin gate in front of a
//   public upstream, and a duplicate identity check behind an admin one.
//
// CREDENTIAL ECHO: a successful upstream payload is scanned (decoded values,
// property names, and the raw text) for every non-empty credential in play —
// the bearer token, and INTERNAL_API_TOKEN whenever it is configured — and a
// match is withheld with a fixed, credential-free 502. Empty credentials are
// never scanned; there is no minimum-length bypass.
//
// Required Vercel env: INTERNAL_API_TOKEN (not for 'bearer'-only routes)
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

// MAX_FORWARD_BODY_BYTES caps a forwarded POST body. The only writer today is
// the R4 label form (three enum answers + a short note); anything larger is a
// mistake, not a use case.
const MAX_FORWARD_BODY_BYTES = 16 * 1024;

// parseJSONBody returns the request's JSON body as a plain object, or null.
// Vercel parses JSON bodies into req.body; a raw string is parsed here. This
// is the ONE place a browser body is parsed, so a route validates the same
// value the proxy would have seen.
function parseJSONBody(req) {
    let body = req && req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (_e) {
            return null;
        }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
}

// forwardBody returns the JSON body to forward for a POST, or an error body.
// A route that has already built an allow-listed payload passes it as
// opts.body; otherwise the request body is parsed once. Only a plain object
// is forwarded, re-serialized here so the upstream never sees raw bytes.
function forwardBody(req, opts) {
    let body = opts && Object.prototype.hasOwnProperty.call(opts, 'body') ? opts.body : req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (_e) {
            return { error: { status: 400, body: { error: 'bad_json', message: 'Body must be JSON.' } } };
        }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: { status: 400, body: { error: 'bad_json', message: 'Body must be a JSON object.' } } };
    }
    const text = JSON.stringify(body);
    if (Buffer.byteLength(text, 'utf8') > MAX_FORWARD_BODY_BYTES) {
        return { error: { status: 413, body: { error: 'too_large', message: 'Body too large.' } } };
    }
    return { text };
}

const FORWARD_AUTH_MODES = ['internal', 'bearer', 'both'];

// containsCredential: true when any non-empty credential appears, as a complete
// substring, in the raw upstream text, in any decoded string value, or in any
// property name (searched recursively).
function containsCredential(payload, rawText, credentials) {
    const creds = credentials.filter(c => typeof c === 'string' && c.length > 0);
    if (!creds.length) return false;
    const hit = s => creds.some(c => s.includes(c));
    if (typeof rawText === 'string' && hit(rawText)) return true;
    const stack = [payload];
    while (stack.length) {
        const v = stack.pop();
        if (typeof v === 'string') {
            if (hit(v)) return true;
        } else if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
                if (hit(k)) return true;
                stack.push(v[k]);
            }
        }
    }
    return false;
}

// verifiedProxy: admin-verify, then forward `upstreamPath` (path + query) to the
// backend with the credential(s) selected by opts.forwardAuth (see the header
// comment). opts.method: 'GET' (default) or 'POST'; a POST forwards opts.body if
// given (a route-built, allow-listed object), else the request's JSON body,
// capped. opts.requireUidEnv names an env var holding the ONE Firebase UID
// allowed through: the verified admin's uid must equal it, else 403 — and an
// unset var fails closed with 503, never open.
async function verifiedProxy(req, res, upstreamPath, opts) {
    const method = ((opts && opts.method) || 'GET').toUpperCase();

    if (req.method !== method && !(method === 'GET' && req.method === 'HEAD')) {
        return send(res, 405, {
            error: 'method_not_allowed',
            message: `${method} only.`,
        });
    }

    // The forwarding mode is a route-author constant, resolved before any env
    // or network step. An unknown value is a programming error: fail closed.
    const forwardAuth =
        opts && opts.forwardAuth !== undefined && opts.forwardAuth !== null ? opts.forwardAuth : 'internal';
    if (!FORWARD_AUTH_MODES.includes(forwardAuth)) {
        return send(res, 500, {
            error: 'misconfigured',
            message: 'This route names an unsupported forwarding mode; it is closed.',
        });
    }
    const sendsInternal = forwardAuth === 'internal' || forwardAuth === 'both';
    const sendsBearer = forwardAuth === 'bearer' || forwardAuth === 'both';

    const token = process.env.INTERNAL_API_TOKEN || '';
    if (sendsInternal && !token) {
        return send(res, 503, {
            error: 'not_configured',
            message:
                'INTERNAL_API_TOKEN is not set on this Vercel project. Set it under ' +
                'Project Settings → Environment Variables (Production + Preview) and redeploy.',
        });
    }

    const requireUidEnv = opts && opts.requireUidEnv;
    let requiredUid = '';
    if (requireUidEnv) {
        requiredUid = String(process.env[requireUidEnv] || '').trim();
        if (!requiredUid) {
            return send(res, 503, {
                error: 'not_configured',
                message: `${requireUidEnv} is not set on this Vercel project; this route is closed until it is.`,
            });
        }
    }

    const verdict = await verifyAdmin(req);
    if (!verdict.ok) {
        // NOTE: no upstream call has happened at this point, by construction.
        return send(res, verdict.status, verdict.body);
    }
    if (requiredUid) {
        const uid = verdict.claims && typeof verdict.claims.uid === 'string' ? verdict.claims.uid : '';
        if (!uid || uid !== requiredUid) {
            return send(res, 403, {
                error: 'forbidden',
                message: 'This route is restricted to the registered grader.',
            });
        }
    }

    const idToken = bearerToken(req); // non-empty: verifyAdmin accepted it above
    const fetchOpts = {
        method,
        headers: { Accept: 'application/json' },
        redirect: 'manual',
    };
    if (sendsInternal) fetchOpts.headers['X-Internal-Token'] = token;
    if (sendsBearer) fetchOpts.headers.Authorization = `Bearer ${idToken}`;
    if (method === 'POST') {
        const fb = forwardBody(req, opts);
        if (fb.error) return send(res, fb.error.status, fb.error.body);
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = fb.text;
    }

    let upstream;
    try {
        upstream = await fetchWithTimeout(backendBase() + upstreamPath, fetchOpts, UPSTREAM_TIMEOUT_MS);
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
        // Recognize one documented, non-secret sentinel for the saved-report
        // panel. Never forward arbitrary upstream error text.
        if (opts && opts.recognizeMissingSnapshot && upstream.status === 503) {
            let failure;
            try { failure = JSON.parse(text); } catch (_e) { failure = null; }
            if (failure && failure.error === 'inference health snapshot missing') {
                return send(res, 404, {
                    error: 'snapshot_missing', message: 'No saved model-health report yet.',
                });
            }
        }
        // The upstream body is NOT echoed: a token-gated 4xx body can carry
        // header echoes. We report the status only, typed, so the panel can
        // render an explicit "unavailable" state (e.g. 404 = not deployed yet).
        // A POST's validation statuses (400/404/409/423) are passed through as
        // their own typed kinds so the form can say WHY, still body-free.
        const postKinds = { 400: 'rejected', 404: 'not_found', 409: 'conflict', 423: 'locked' };
        if (method === 'POST' && postKinds[upstream.status]) {
            return send(res, upstream.status, {
                error: postKinds[upstream.status],
                upstream_status: upstream.status,
                upstream_path: upstreamPath.split('?')[0],
                message: `Backend returned HTTP ${upstream.status} for ${upstreamPath.split('?')[0]}.`,
            });
        }
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

    // Every credential in play — the bearer always, the internal token whenever
    // it is configured (even on a bearer-only route) — must be absent from what
    // the browser receives. Fixed body: nothing about the match is described.
    if (containsCredential(payload, text, [idToken, token])) {
        return send(res, 502, {
            error: 'upstream_error',
            message: 'Backend response withheld.',
        });
    }

    return send(res, 200, payload);
}

module.exports = {
    verifiedProxy,
    verifyAdmin,
    containsCredential,
    FORWARD_AUTH_MODES,
    send,
    forwardBody,
    parseJSONBody,
    MAX_FORWARD_BODY_BYTES,
    bearerToken,
    DEFAULT_BACKEND,
    WHOAMI_PATH,
    WHOAMI_TIMEOUT_MS,
    UPSTREAM_TIMEOUT_MS,
};
