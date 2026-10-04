// Admin sign-in for the ops console (Phase D, task 6).
//
// WHAT THIS IS FOR
// ----------------
// The dashboard is ONE deployment. The existing tabs stay public and
// unauthenticated. The two ops tabs (Shadow book, Heartbeats) read token-gated
// backend data, so they are revealed only after a Google sign-in whose Firebase
// UID the backend recognises as an admin.
//
// The browser never holds INTERNAL_API_TOKEN. It holds a short-lived Firebase ID
// token, which it sends to same-origin /api/ops/* functions; those verify it
// against the backend's GET /api/admin/whoami before forwarding anything.
//
// Public config (apiKey / authDomain / appId) is served by /api/config from
// Vercel env. A Firebase web apiKey is an identifier, not a secret.
//
// This file is a MODULE (Firebase Web SDK v10 modular, gstatic CDN). It talks to
// the rest of the dashboard through `window.VBAuth` and a `vb-auth-change`
// CustomEvent, so classic scripts (js/ops-console.js) need no module plumbing.
//
// AUTH GENERATION. `VBAuth.gen` increments on every identity change and at
// sign-out ENTRY. Sign-out revokes local access synchronously — isAdmin false,
// token acquisition latched off, vb-auth-change emitted — BEFORE Firebase is
// awaited, so nothing can start an authenticated read in the gap. A pending
// admin check whose generation has moved changes nothing. Access comes back
// only through a fresh identity → admin verification.
//
// Firebase is attached through a small adapter (`bind`) so the lifecycle can
// be driven by a fake in js/auth.test.js without the SDK.

const FB_APP = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FB_AUTH = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// state: 'loading' | 'unconfigured' | 'signed_out' | 'checking' | 'admin' | 'not_admin' | 'error'
const state = {
    state: 'loading',
    email: null,
    uid: null,
    message: '',
};

let authRef = null;
let providerRef = null;
let signInFnRef = null;
let signOutFnRef = null;
let currentUser = null;
let authGen = 0;      // see AUTH GENERATION above
let revoked = false;  // sign-out began; no token until a fresh identity arrives

function bumpGen() {
    authGen++;
    window.VBAuth.gen = authGen;
}

function emit() {
    window.VBAuth.state = state.state;
    window.VBAuth.isAdmin = state.state === 'admin';
    window.VBAuth.email = state.email;
    window.VBAuth.gen = authGen;
    window.dispatchEvent(new CustomEvent('vb-auth-change', { detail: Object.assign({ gen: authGen }, state) }));
}

function setState(next, patch) {
    state.state = next;
    Object.assign(state, patch || {});
    renderHeader();
    emit();
}

// ── header UI ────────────────────────────────────────────────────────────────

// Attribute-safe: these strings land inside quoted HTML attributes (title="…"),
// so quotes MUST be escaped too — a textContent/innerHTML round-trip does not
// escape them and would let `" onmouseover=` break out of the attribute.
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderHeader() {
    const el = document.getElementById('auth-slot');
    if (!el) return;

    switch (state.state) {
        case 'loading':
            el.innerHTML = '<span class="auth-note">…</span>';
            break;
        case 'unconfigured':
            el.innerHTML = `<span class="auth-note auth-note-warn" title="${esc(state.message)}">sign-in not configured</span>`;
            break;
        case 'signed_out':
            el.innerHTML = '<button class="auth-btn" id="auth-signin">Sign in</button>';
            break;
        case 'checking':
            el.innerHTML = '<span class="auth-note">checking access…</span>';
            break;
        case 'admin':
            el.innerHTML =
                `<span class="auth-note auth-note-ok" title="${esc(state.email || '')}">admin · ${esc(state.email || 'signed in')}</span>` +
                '<button class="auth-btn auth-btn-ghost" id="auth-signout">Sign out</button>';
            break;
        case 'not_admin':
            el.innerHTML =
                `<span class="auth-note auth-note-warn">not an admin${state.email ? ' · ' + esc(state.email) : ''}</span>` +
                '<button class="auth-btn auth-btn-ghost" id="auth-signout">Sign out</button>';
            break;
        case 'verify_failed':
            // NOT the same as "not an admin": the check itself did not complete,
            // so claiming the account lacks access would be a guess.
            el.innerHTML =
                `<span class="auth-note auth-note-warn" title="${esc(state.message)}">could not verify sign-in</span>` +
                '<button class="auth-btn" id="auth-recheck">Retry</button>' +
                '<button class="auth-btn auth-btn-ghost" id="auth-signout">Sign out</button>';
            break;
        default:
            el.innerHTML =
                `<span class="auth-note auth-note-warn" title="${esc(state.message)}">sign-in unavailable</span>` +
                '<button class="auth-btn auth-btn-ghost" id="auth-retry">Retry</button>';
    }

    const signIn = document.getElementById('auth-signin');
    if (signIn) signIn.addEventListener('click', () => window.VBAuth.signIn());
    const signOut = document.getElementById('auth-signout');
    if (signOut) signOut.addEventListener('click', () => window.VBAuth.signOut());
    const retry = document.getElementById('auth-retry');
    if (retry) retry.addEventListener('click', () => boot());
    const recheck = document.getElementById('auth-recheck');
    if (recheck) recheck.addEventListener('click', () => checkAdmin());
}

// ── public surface ───────────────────────────────────────────────────────────

window.VBAuth = {
    state: 'loading',
    isAdmin: false,
    email: null,
    gen: 0,

    // A fresh ID token, or null when signed out / revoked / unavailable.
    async getIdToken(forceRefresh) {
        if (revoked || !currentUser) return null;
        try {
            const t = await currentUser.getIdToken(!!forceRefresh);
            return revoked ? null : t;
        } catch (_e) {
            return null;
        }
    },

    // fetch() with the Bearer ID token attached; resolves to a Response like
    // fetch does. Ops panels use it for every /api/ops/* call.
    //
    // opts.requireAuth: the token is read per request and the call REJECTS
    // before any network when the token is absent, or when sign-out began (the
    // generation moved) while the token was being acquired. The recovered
    // tabs' reads (js/reads.js) always pass it. Without the option the
    // behaviour is unchanged: a tokenless call goes out without Authorization.
    async fetch(url, opts) {
        const requireAuth = !!(opts && opts.requireAuth);
        const gen = authGen;
        const token = await window.VBAuth.getIdToken();
        if (requireAuth && (!token || gen !== authGen || revoked)) {
            const err = new Error('Not signed in as an admin.');
            err.unauthenticated = true;
            throw err;
        }
        const headers = Object.assign({ Accept: 'application/json' }, (opts && opts.headers) || {});
        if (token) headers.Authorization = 'Bearer ' + token;
        const fetchOpts = Object.assign({}, opts, { headers });
        delete fetchOpts.requireAuth;
        return fetch(url, fetchOpts);
    },

    async signIn() {
        if (!authRef || !signInFnRef) return;
        try {
            await signInFnRef(authRef, providerRef);
        } catch (err) {
            const code = (err && err.code) || '';
            // A popup the user dismissed is not an error worth shouting about.
            if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
            setState('error', { message: String((err && err.message) || err) });
        }
    },

    async signOut() {
        // Revoke locally FIRST, synchronously: nothing may start an
        // authenticated read while Firebase's sign-out is in flight.
        bumpGen();
        revoked = true;
        currentUser = null;
        setState('signed_out', { email: null, uid: null, message: '' });
        if (!authRef || !signOutFnRef) return;
        try {
            await signOutFnRef(authRef);
        } catch (_e) {
            /* onAuthStateChanged still fires the truth */
        }
    },

    // bind(adapter): attach an auth backend. adapter.onAuthStateChanged(cb)
    // calls cb(user|null) on every identity change; adapter.signOut() signs
    // out. A `user` exposes getIdToken(force) and email. boot() binds Firebase;
    // the tests bind a fake.
    bind(adapter) {
        authRef = adapter;
        signOutFnRef = () => adapter.signOut();
        adapter.onAuthStateChanged(onIdentityChange);
    },
};

function onIdentityChange(user) {
    bumpGen();
    currentUser = user || null;
    revoked = false;
    if (!user) {
        setState('signed_out', { email: null, uid: null, message: '' });
        return;
    }
    state.email = user.email || null;
    checkAdmin();
}

// ── boot ─────────────────────────────────────────────────────────────────────

async function checkAdmin() {
    // Every completion path re-checks the generation captured here: a verdict
    // for an identity that has since signed out (or changed) changes nothing.
    const gen = authGen;
    const stale = () => gen !== authGen;
    setState('checking', {});
    let resp;
    try {
        resp = await window.VBAuth.fetch('/api/ops/whoami');
    } catch (err) {
        if (stale()) return;
        // The network never answered — an outage, not a verdict on this account.
        setState('verify_failed', { message: 'Could not reach /api/ops/whoami.' });
        return;
    }
    if (stale()) return;

    let body = null;
    try {
        body = await resp.json();
    } catch (_e) {
        body = null;
    }
    if (stale()) return;

    if (resp.status === 200 && body && body.admin) {
        setState('admin', {
            uid: (body && body.uid) || null,
            email: (body && body.email) || state.email,
            message: '',
        });
        return;
    }
    if (resp.status === 503) {
        setState('unconfigured', {
            message: (body && body.message) || 'The ops proxy is not configured.',
        });
        return;
    }

    // A 403 means EITHER "this account is not an admin" OR "we could not ask" —
    // the verified proxy fails closed, so an unreachable whoami also lands here.
    // Only the first is a statement about the user; conflating them tells an
    // admin they have been demoted during a backend blip.
    const msg = String((body && body.message) || '');
    const outage =
        resp.status >= 500 ||
        resp.status === 0 ||
        /unreachable|time(?:d)? ?out|could not verify|temporar/i.test(msg);
    if (outage) {
        setState('verify_failed', {
            message: msg || `Access check failed (HTTP ${resp.status}).`,
        });
        return;
    }

    setState('not_admin', { message: msg || 'Not an admin.' });
}

async function boot() {
    setState('loading', {});

    let cfg;
    try {
        const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });
        cfg = await r.json();
        if (!r.ok || cfg.error) {
            setState('unconfigured', {
                message:
                    (cfg && cfg.message) ||
                    'Firebase web config is unavailable (is this running under `vercel dev`?).',
            });
            return;
        }
    } catch (_e) {
        // Plain `npx serve .` has no serverless functions — that is a normal
        // local-dev state, not a failure of the public tabs.
        setState('unconfigured', {
            message: '/api/config is unavailable. Run `vercel dev` to exercise sign-in locally.',
        });
        return;
    }

    let appMod, authMod;
    try {
        [appMod, authMod] = await Promise.all([import(FB_APP), import(FB_AUTH)]);
    } catch (err) {
        setState('error', { message: 'Firebase SDK failed to load from the CDN.' });
        return;
    }

    try {
        const app = appMod.getApps && appMod.getApps().length
            ? appMod.getApps()[0]
            : appMod.initializeApp(cfg);
        const fbAuthRef = authMod.getAuth(app);
        providerRef = new authMod.GoogleAuthProvider();
        signInFnRef = (_adapter, provider) => authMod.signInWithPopup(fbAuthRef, provider);
        const signOutFnRef0 = auth => authMod.signOut(auth);
        authRef = fbAuthRef;

        const fbAuth = authRef;
        window.VBAuth.bind({
            onAuthStateChanged: cb => authMod.onAuthStateChanged(fbAuth, cb),
            signOut: () => signOutFnRef0(fbAuth),
        });
    } catch (err) {
        setState('error', { message: String((err && err.message) || err) });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
