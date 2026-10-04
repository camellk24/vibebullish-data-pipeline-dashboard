'use strict';
// js/auth.js lifecycle without Firebase: generations, synchronous revoke at
// sign-out, requireAuth transport, and stale admin-check results.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox } = require('./_test_dom.js');

function fakeUser(email, token) {
    return { email, uid: 'u-' + email, getIdToken: async () => (typeof token === 'function' ? token() : token) };
}
function fakeAdapter() {
    const a = { cb: null, signOutCalls: 0, signOutGate: null };
    a.onAuthStateChanged = (cb) => { a.cb = cb; };
    a.signOut = () => { a.signOutCalls++; return a.signOutGate ? a.signOutGate : Promise.resolve(); };
    return a;
}

async function bootAuth(sb) {
    sb.load('js/auth.js');
    await sb.flush();
    assert.equal(sb.ctx.VBAuth.state, 'unconfigured', 'boot without /api/config lands in unconfigured, before the Firebase import');
    const adapter = fakeAdapter();
    sb.ctx.VBAuth.bind(adapter);
    return adapter;
}

test('sign-in verifies via /api/ops/whoami with the bearer and lands in admin; gen increments per identity change', async () => {
    const sb = createSandbox();
    const events = [];
    sb.ctx.addEventListener('vb-auth-change', e => events.push(e.detail.state));
    const adapter = await bootAuth(sb);
    const gen0 = sb.ctx.VBAuth.gen;
    adapter.cb(fakeUser('k@example.test', 'tok-A'));
    await sb.flush();
    assert.equal(sb.ctx.VBAuth.state, 'admin'); assert.equal(sb.ctx.VBAuth.isAdmin, true);
    assert.equal(sb.ctx.VBAuth.gen, gen0 + 1);
    const whoami = sb.fetchCalls.find(c => c.url === '/api/ops/whoami');
    assert.equal(whoami.headers.Authorization, 'Bearer tok-A');
    assert.deepEqual(events.slice(-2), ['checking', 'admin']);
});

test('requireAuth: tokenless → rejects before native fetch; plain fetch still goes out without Authorization', async () => {
    const sb = createSandbox();
    await bootAuth(sb); // signed out
    sb.resetCalls();
    await assert.rejects(sb.ctx.VBAuth.fetch('/api/ops/reads?view=x', { requireAuth: true }), e => e.unauthenticated === true);
    assert.equal(sb.fetchCalls.length, 0);
    await sb.ctx.VBAuth.fetch('/api/ops/whoami');
    assert.equal(sb.fetchCalls.length, 1);
    assert.ok(!('Authorization' in sb.fetchCalls[0].headers));
    assert.ok(!('requireAuth' in sb.fetchCalls[0].opts));
});

test('sign-out revokes synchronously: isAdmin false, gen bumped, vb-auth-change emitted BEFORE Firebase signOut resolves; no token is handed out in the gap', async () => {
    const sb = createSandbox();
    const adapter = await bootAuth(sb);
    adapter.cb(fakeUser('k@example.test', 'tok-A'));
    await sb.flush();
    assert.equal(sb.ctx.VBAuth.isAdmin, true);
    const genAdmin = sb.ctx.VBAuth.gen;
    let release;
    adapter.signOutGate = new Promise(r => { release = r; });
    const events = [];
    sb.ctx.addEventListener('vb-auth-change', e => events.push(e.detail.state));

    const p = sb.ctx.VBAuth.signOut(); // not awaited: Firebase is still signing out
    // Synchronous facts, before any await:
    assert.equal(sb.ctx.VBAuth.isAdmin, false);
    assert.equal(sb.ctx.VBAuth.state, 'signed_out');
    assert.equal(sb.ctx.VBAuth.gen, genAdmin + 1);
    assert.deepEqual(events, ['signed_out']);
    assert.equal(adapter.signOutCalls, 1);
    // In the gap: no token, and a requireAuth call rejects without network.
    assert.equal(await sb.ctx.VBAuth.getIdToken(), null);
    sb.resetCalls();
    await assert.rejects(sb.ctx.VBAuth.fetch('/api/ops/reads?view=x', { requireAuth: true }), e => e.unauthenticated === true);
    assert.equal(sb.fetchCalls.length, 0);
    release(); await p;
    adapter.cb(null); await sb.flush();
    assert.equal(sb.ctx.VBAuth.state, 'signed_out');
});

test('a requireAuth call whose token acquisition straddles sign-out rejects before native fetch', async () => {
    const sb = createSandbox();
    const adapter = await bootAuth(sb);
    let releaseToken;
    const slowToken = () => new Promise(r => { releaseToken = () => r('tok-slow'); });
    adapter.cb(fakeUser('k@example.test', 'tok-fast'));
    await sb.flush();
    // Swap in a user whose token is slow (same identity object semantics).
    adapter.cb({ email: 'k@example.test', uid: 'u', getIdToken: slowToken });
    // whoami for this identity is now pending on the slow token; release it so admin lands.
    releaseToken(); await sb.flush();
    assert.equal(sb.ctx.VBAuth.isAdmin, true);
    sb.resetCalls();
    const p = sb.ctx.VBAuth.fetch('/api/ops/reads?view=quant-health', { requireAuth: true }); // token acquisition starts
    sb.ctx.VBAuth.signOut(); // generation moves while the token is in flight
    releaseToken();
    await assert.rejects(p, e => e.unauthenticated === true);
    assert.equal(sb.fetchCalls.length, 0);
});

test('a stale admin-check completion (identity changed / signed out meanwhile) changes nothing', async () => {
    const sb = createSandbox();
    let releaseWhoami;
    sb.state.whoami = () => new Promise(r => { releaseWhoami = () => r({ ok: true, status: 200, json: async () => ({ admin: true, uid: 'u', email: 'k@example.test' }) }); });
    const adapter = await bootAuth(sb);
    adapter.cb(fakeUser('k@example.test', 'tok-A'));
    await sb.flush();
    assert.equal(sb.ctx.VBAuth.state, 'checking');
    // Sign out while whoami is pending, then let the old whoami answer "admin".
    sb.ctx.VBAuth.signOut();
    adapter.cb(null);
    await sb.flush();
    releaseWhoami();
    await sb.flush();
    assert.equal(sb.ctx.VBAuth.state, 'signed_out');
    assert.equal(sb.ctx.VBAuth.isAdmin, false);
});

test('re-sign-in after sign-out restores access under a new generation', async () => {
    const sb = createSandbox();
    const adapter = await bootAuth(sb);
    adapter.cb(fakeUser('k@example.test', 'tok-A')); await sb.flush();
    const g1 = sb.ctx.VBAuth.gen;
    await sb.ctx.VBAuth.signOut(); adapter.cb(null); await sb.flush();
    adapter.cb(fakeUser('k@example.test', 'tok-B')); await sb.flush();
    assert.equal(sb.ctx.VBAuth.isAdmin, true);
    assert.ok(sb.ctx.VBAuth.gen > g1 + 1);
    assert.equal(await sb.ctx.VBAuth.getIdToken(), 'tok-B');
});
