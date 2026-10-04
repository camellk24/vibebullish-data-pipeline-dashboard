// js/reads.js — the ONE client path for the six recovered tabs' data reads.
//
// Every read goes to the same-origin, admin-verified proxy GET /api/ops/reads
// (api/ops/reads.js) through VBAuth.fetch(…, { requireAuth: true }), which
// attaches the signed-in admin's Firebase ID token or rejects BEFORE any
// network call. Nothing in this file, or in any tab script, calls fetch()
// itself; js/signed-in-reads.test.js pins that inventory.
//
// Loaded as a classic <script> before every tab script (index.html), and
// requireable from node for the tests. Also hosts the shared attribute-safe
// escaper `esc()` (& < > " ') that every recovered renderer uses — the old
// textContent/innerHTML round-trip left quotes intact inside title="…".

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

(function () {
    var ENDPOINT = '/api/ops/reads';
    var SIGN_IN_MESSAGE = 'Sign in with an admin Google account to view this tab.';

    function isAdmin() {
        return !!(typeof window !== 'undefined' && window.VBAuth && window.VBAuth.isAdmin);
    }
    function authGen() {
        return typeof window !== 'undefined' && window.VBAuth && typeof window.VBAuth.gen === 'number'
            ? window.VBAuth.gen : 0;
    }

    // num: a backend field that must be a finite number, or null. Renderers
    // use it before any `.toFixed` / interpolation so an HTML-bearing value in
    // a nominally numeric field shows the invalid-value state, never markup.
    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        var n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
        return Number.isFinite(n) ? n : null;
    }
    // fixed: num() then toFixed, or the invalid-value dash.
    function fixed(v, d) {
        var n = num(v);
        return n === null ? '—' : n.toFixed(d == null ? 2 : d);
    }

    // get(view, params) → {ok:true, body, gen} | {ok:false, kind, message, gen}
    // kinds: unauthenticated | forbidden | not_configured | not_found |
    //        bad_request | unreachable | upstream_error
    async function get(view, params) {
        var g = authGen();
        if (!isAdmin()) {
            return { ok: false, kind: 'unauthenticated', message: SIGN_IN_MESSAGE, gen: g };
        }
        var qs = new URLSearchParams();
        qs.set('view', String(view));
        var p = params || {};
        for (var k in p) {
            if (!Object.prototype.hasOwnProperty.call(p, k)) continue;
            var v = p[k];
            if (v === undefined || v === null || v === '') continue;
            if (typeof v !== 'string' && typeof v !== 'number') continue;
            qs.set(k, String(v));
        }
        var res;
        try {
            res = await window.VBAuth.fetch(ENDPOINT + '?' + qs.toString(), { requireAuth: true });
        } catch (err) {
            if (err && err.unauthenticated) {
                return { ok: false, kind: 'unauthenticated', message: SIGN_IN_MESSAGE, gen: g };
            }
            return { ok: false, kind: 'unreachable', message: String((err && err.message) || err), gen: g };
        }
        var body = null;
        try { body = await res.json(); } catch (_e) { body = null; }
        if (res.status === 200 && body && !body.error) return { ok: true, body: body, gen: g };
        var kind = (body && body.error)
            || (res.status === 401 ? 'unauthenticated'
                : res.status === 403 ? 'forbidden'
                : res.status === 404 ? 'not_found'
                : 'unreachable');
        return {
            ok: false,
            kind: kind,
            message: (body && body.message) || ('HTTP ' + res.status),
            upstreamStatus: body && body.upstream_status,
            gen: g,
        };
    }

    function titleFor(kind) {
        return kind === 'unauthenticated' || kind === 'forbidden' ? 'Admin sign-in required'
            : kind === 'not_found' ? 'Not available on this backend yet'
            : kind === 'not_configured' ? 'Ops proxy is not configured'
            : kind === 'bad_request' ? 'Invalid request'
            : kind === 'empty' ? 'Nothing recorded yet'
            : 'Backend unavailable';
    }

    // unavailable(el, kind, message): the one explicit "no data to show, and
    // why" state. It REPLACES whatever the panel showed before — a stale
    // number read as current is the failure these tabs must never produce.
    function unavailable(el, kind, message) {
        if (!el) return;
        var hint = kind === 'not_found'
            ? 'The endpoint is not deployed on this backend. Nothing is shown rather than something stale.'
            : kind === 'not_configured'
            ? 'Set INTERNAL_API_TOKEN on the Vercel project (Production + Preview) and redeploy.'
            : kind === 'unauthenticated' || kind === 'forbidden' || kind === 'empty'
            ? ''
            : 'Nothing is shown, because the last-known numbers here would read as current state.';
        el.innerHTML =
            '<div class="ops-unavailable">' +
            '<div class="ops-unavailable-title">' + esc(titleFor(kind)) + '</div>' +
            (message ? '<div class="ops-unavailable-msg">' + esc(message) + '</div>' : '') +
            (hint ? '<div class="ops-unavailable-hint">' + esc(hint) + '</div>' : '') +
            '</div>';
    }

    var VBReads = {
        ENDPOINT: ENDPOINT,
        SIGN_IN_MESSAGE: SIGN_IN_MESSAGE,
        get: get,
        esc: esc,
        num: num,
        fixed: fixed,
        unavailable: unavailable,
        titleFor: titleFor,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = VBReads;
    if (typeof window !== 'undefined') window.VBReads = VBReads;
})();
