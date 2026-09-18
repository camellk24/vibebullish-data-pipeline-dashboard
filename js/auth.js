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

function emit() {
    window.VBAuth.state = state.state;
    window.VBAuth.isAdmin = state.state === 'admin';
    window.VBAuth.email = state.email;
    window.dispatchEvent(new CustomEvent('vb-auth-change', { detail: Object.assign({}, state) }));
}

function setState(next, patch) {
    state.state = next;
    Object.assign(state, patch || {});
    renderHeader();
    emit();
}

// ── header UI ────────────────────────────────────────────────────────────────

function renderHeader() {
    const el = document.getElementById('auth-slot');
    if (!el) return;

    const esc = s => {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    };

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
}

// ── public surface ───────────────────────────────────────────────────────────

window.VBAuth = {
    state: 'loading',
    isAdmin: false,
    email: null,

    // A fresh ID token, or null when signed out / unavailable.
    async getIdToken(forceRefresh) {
        if (!currentUser) return null;
        try {
            return await currentUser.getIdToken(!!forceRefresh);
        } catch (_e) {
            return null;
        }
    },

    // fetch() with the Bearer ID token attached. Ops panels use this for every
    // /api/ops/* call; it resolves to a Response like fetch does.
    async fetch(url, opts) {
        const token = await window.VBAuth.getIdToken();
        const headers = Object.assign({ Accept: 'application/json' }, (opts && opts.headers) || {});
        if (token) headers.Authorization = 'Bearer ' + token;
        return fetch(url, Object.assign({}, opts, { headers }));
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
        if (!authRef || !signOutFnRef) return;
        try {
            await signOutFnRef(authRef);
        } catch (_e) {
            /* onAuthStateChanged still fires the truth */
        }
    },
};

// ── boot ─────────────────────────────────────────────────────────────────────

async function checkAdmin() {
    setState('checking', {});
    let resp;
    try {
        resp = await window.VBAuth.fetch('/api/ops/whoami');
    } catch (err) {
        setState('error', { message: 'Could not reach /api/ops/whoami.' });
        return;
    }

    let body = null;
    try {
        body = await resp.json();
    } catch (_e) {
        body = null;
    }

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
    setState('not_admin', { message: (body && body.message) || 'Not an admin.' });
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
        authRef = authMod.getAuth(app);
        providerRef = new authMod.GoogleAuthProvider();
        signInFnRef = authMod.signInWithPopup;
        signOutFnRef = authMod.signOut;

        authMod.onAuthStateChanged(authRef, user => {
            currentUser = user || null;
            if (!user) {
                setState('signed_out', { email: null, uid: null, message: '' });
                return;
            }
            state.email = user.email || null;
            checkAdmin();
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
