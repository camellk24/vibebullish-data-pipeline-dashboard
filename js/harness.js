// Harness tab (admin only) — the agent harness's board: what each of the two
// lanes is building, what is queued next, what needs the owner, and what
// finished. Ported from the standalone prototype (research_notes/…/harness-board.html).
//
// ACCESS: the tab button is hidden until /api/ops/whoami says admin
// (js/ops-console.js owns show/hide for every [data-ops-tab] button). Reads
// and writes go to same-origin /api/ops/harness with the Firebase ID token
// (VBAuth.fetch, requireAuth), which verifies the admin before touching the
// private Vercel Blob store. Signed out, nothing is requested and the panel
// shows an explicit sign-in state.
//
// DATA: GET /api/ops/harness → {state, vetoes, read_at}. state is the
// harness's schema v1 harness/state.json (null until it first reports);
// vetoes is the owner's {task_id: {action: skip|top, at, by_uid}} map.
// Do next / Skip / Undo POST /api/ops/harness?view=veto and re-render from
// the response. Polls every 60 s, only while this tab is active AND the page
// is visible. Times are shown in PT (America/Los_Angeles).
//
// HONESTY: an error state replaces the board; it never leaves the last-known
// numbers on screen reading as current.
//
// DEV: ?fixture=harness[-empty|-notconfigured|-forbidden|-signedout|-unreachable]
// loads js/harness-fixture.js and renders without sign-in (Agents-tab
// precedent); without that flag the fixture script is never requested.

(function () {
    'use strict';

    const ENDPOINT = '/api/ops/harness';
    const TAB = 'harness';
    const POLL_MS = 60_000;
    const LANES_DEFAULT = 2;
    const STEPS = [
        ['implementing', 'Build'], ['verifying', 'Verify'], ['reviewing', 'Astra'], ['merging', 'Merge'],
        ['deploying', 'Deploy'], ['checking', 'Check'], ['done', 'Done'],
    ];
    const ACTIVE = new Set(STEPS.map(s => s[0]).filter(s => s !== 'done'));
    const RISK = { low: 'ao-pill-healthy', medium: 'hz-pill-warn', high: 'ao-pill-stale' };

    const RAW_FIXTURE = new URLSearchParams(location.search).get('fixture');
    const FIXTURE = RAW_FIXTURE && /^harness(-[a-z]+)?$/.test(RAW_FIXTURE) ? RAW_FIXTURE : null;

    const model = { state: null, vetoes: {}, readAt: null, loaded: false };
    let lastSuccessAt = null;
    let timer = null;
    let inFlight = false;
    let busy = false;        // a veto request is in flight: every queue button is disabled
    let actionError = '';
    let generation = 0;      // bumped on sign-out; a response from an older generation is dropped

    // ── helpers ──────────────────────────────────────────────────────────────

    // The dashboard's one attribute-safe escaper (js/reads.js), with an
    // identical local fallback so this file also works on its own.
    const esc = (window.VBReads && window.VBReads.esc) || function (s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    const $ = id => document.getElementById(id);
    const arr = v => (Array.isArray(v) ? v : []);
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

    function ts(v) {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }

    function pt(v, withDay) {
        const d = ts(v);
        if (!d) return '—';
        const o = { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false };
        if (withDay !== false) Object.assign(o, { weekday: 'short', month: 'numeric', day: 'numeric' });
        return d.toLocaleString('en-US', o) + ' PT';
    }

    function dur(a, b) {
        const A = ts(a), B = ts(b);
        if (!A || !B) return '—';
        const s = Math.max(0, (B - A) / 1000);
        if (s < 3600) return Math.round(s / 60) + ' m';
        if (s < 172800) return (s / 3600).toFixed(1) + ' h';
        return (s / 86400).toFixed(1) + ' d';
    }

    function ago(v) {
        const d = ts(v);
        if (!d) return 'never';
        const m = (Date.now() - d) / 60000;
        if (m < 1) return 'just now';
        if (m < 60) return Math.round(m) + ' min ago';
        if (m < 2880) return (m / 60).toFixed(1) + ' h ago';
        return Math.round(m / 1440) + ' d ago';
    }

    // Only http(s) links are rendered as links; anything else is text.
    function safeHref(u) {
        return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
    }

    function riskPill(r) {
        return r
            ? `<span class="ao-pill ${RISK[r] || 'ao-pill-idle'}">${esc(r)} risk</span>`
            : '<span class="ao-pill ao-pill-dormant">not rated</span>';
    }

    function prLink(t) {
        if (!t.pr) return '—';
        const label = t.pr_label || String(t.pr).replace(/^https:\/\/github\.com\/camellk24\/vibebullish-/, '').replace('/pull/', ' #');
        const href = safeHref(t.pr);
        return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
    }

    function tasks() { return arr(model.state && model.state.tasks).filter(obj); }
    function status() { return obj(model.state && model.state.status); }

    // ── renderers ────────────────────────────────────────────────────────────

    function renderStrip() {
        const box = $('hz-strip');
        if (!box) return;
        const s = status();
        let dot = 'hz-dot';
        let text;
        const extra = [];
        if (!model.state) {
            text = 'The harness has not reported yet';
        } else if (!s || s.mode === 'not_started' || (!s.heartbeat_at && s.mode !== 'paused')) {
            text = 'Harness not started';
        } else if (s.mode === 'paused') {
            text = 'Paused';
        } else {
            const beat = ts(s.heartbeat_at);
            const age = beat ? (Date.now() - beat) / 60000 : Infinity;
            if (age <= 45) { dot = 'hz-dot hz-dot-live'; text = 'Running · beat ' + ago(s.heartbeat_at); }
            else { dot = 'hz-dot hz-dot-bad'; text = 'No heartbeat for ' + ago(s.heartbeat_at).replace(' ago', ''); }
        }
        if (s && obj(s.deploy_window)) {
            const open = !!s.deploy_window.open;
            extra.push(`<span class="ao-pill ${open ? 'ao-pill-healthy' : 'hz-pill-warn'}" title="${esc(s.deploy_window.note || '')}">${open ? 'Deploy window open' : 'Deploys closed'}</span>`);
        }
        if (s && s.next_tick_at) extra.push(`<span class="hz-meta">next tick ${esc(pt(s.next_tick_at, false))}</span>`);
        box.innerHTML = `<span class="${dot}"></span><span class="hz-strip-text">${esc(text)}</span>${extra.join('')}`;
    }

    function renderKpis() {
        const box = $('hz-kpis');
        if (!box) return;
        const t = tasks();
        const week = Date.now() - 7 * 864e5;
        const lanes = arr(status() && status().lanes).length || LANES_DEFAULT;
        const running = t.filter(x => ACTIVE.has(x.state)).length;
        const queued = t.filter(x => x.state === 'queued').length;
        const needs = arr(model.state && model.state.needs).filter(n => obj(n) && !n.resolved).length;
        const done = t.filter(x => x.state === 'done');
        const done7 = done.filter(x => { const d = ts(x.done_at); return d && d.getTime() > week; }).length;
        const eng = t
            .map(x => { const a = ts(x.started_at), b = ts(x.engineering_ready_at); return a && b ? (b - a) / 60000 : null; })
            .filter(v => v != null)
            .sort((a, b) => a - b);
        const med = eng.length ? eng[Math.floor(eng.length / 2)] : null;
        box.innerHTML = `
            <div class="metric-card hero"><div class="metric-label">Running now</div><div class="metric-value">${running}</div><div class="metric-sub">of ${lanes} lanes · ${queued} queued</div></div>
            <div class="metric-card${needs ? ' hz-alert' : ''}"><div class="metric-label">Needs you</div><div class="metric-value">${needs}</div></div>
            <div class="metric-card"><div class="metric-label">Done · 7 days</div><div class="metric-value">${done7}</div><div class="metric-sub">${done.length} all time</div></div>
            <div class="metric-card"><div class="metric-label">Build → ready</div><div class="metric-value">${med == null ? '—' : Math.round(med) + 'm'}</div><div class="metric-sub">median</div></div>
            <div class="metric-card"><div class="metric-label">Queued</div><div class="metric-value">${queued}</div></div>`;
    }

    function renderNeeds() {
        const card = $('hz-needs-card');
        const badge = $('hz-needs-badge');
        const box = $('hz-needs');
        const open = arr(model.state && model.state.needs)
            .filter(n => obj(n) && !n.resolved)
            .sort((a, b) => String(a.since || '').localeCompare(String(b.since || '')));
        if (badge) badge.textContent = open.length + ' open';
        if (card) card.classList.toggle('hz-needs-open', open.length > 0);
        if (!box) return;
        box.innerHTML = open.length
            ? open.map(n => {
                const href = safeHref(n.link);
                return `<div class="hz-need"><span class="hz-need-q">${esc(n.question || '(no question)')}</span>
                    ${n.detail ? `<span class="hz-need-detail">${esc(n.detail)}</span>` : ''}
                    <span class="hz-meta-row">${n.kind ? `<span>${esc(n.kind)}</span>` : ''}<span>since ${esc(pt(n.since))}</span>${n.task_id ? `<span>${esc(n.task_id)}</span>` : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">details</a>` : ''}</span></div>`;
            }).join('')
            : '<p class="hz-empty">Nothing waiting on you.</p>';
    }

    function stepper(t) {
        const idx = STEPS.findIndex(s => s[0] === t.state);
        const stopAt = typeof t.stopped_at_step === 'number' ? t.stopped_at_step : 0;
        return `<ol class="hz-steps">${STEPS.map(([, label], i) => {
            let c = i < idx ? 'done' : i === idx ? 'now' : '';
            if (t.state === 'stopped' && i === stopAt) c = 'stop';
            return `<li class="${c}">${esc(label)}</li>`;
        }).join('')}</ol>`;
    }

    function renderLanes() {
        const box = $('hz-lanes');
        if (!box) return;
        const s = status();
        const lanes = s && arr(s.lanes).filter(obj).length ? arr(s.lanes).filter(obj) : [{ id: 'lane-1' }, { id: 'lane-2' }];
        const all = tasks();
        box.innerHTML = lanes.map((ln, i) => {
            const t = (ln.task_id && all.find(x => x.id === ln.task_id)) ||
                all.find(x => x.lane === ln.id && (ACTIVE.has(x.state) || x.state === 'stopped'));
            if (!t) {
                return `<div class="card hz-lane"><div class="card-header"><h2>Lane ${i + 1}</h2><span class="ao-pill ao-pill-dormant">idle</span></div><p class="hz-empty">No task in this lane.</p></div>`;
            }
            const st = t.state === 'stopped'
                ? '<span class="ao-pill ao-pill-stale">stopped</span>'
                : `<span class="ao-pill hz-pill-accent">${esc(t.repo || '')}</span>`;
            return `<div class="card hz-lane"><div class="card-header"><h2>Lane ${i + 1}</h2><span class="hz-pills">${st}${riskPill(t.risk)}</span></div>
                <h3 class="hz-lane-title">${esc(t.title || t.id)}</h3>${stepper(t)}
                <div class="hz-meta-row">${t.source ? `<span>${esc(t.source)}</span>` : ''}<span>Astra r${esc(t.rounds == null ? 0 : t.rounds)}</span><span>started ${esc(ago(t.started_at))}</span><span>${prLink(t)}</span>${t.head ? `<span>${esc(String(t.head).slice(0, 8))}</span>` : ''}</div>
                ${t.summary ? `<div class="hz-summary">${esc(t.summary)}</div>` : ''}${t.stop_reason ? `<div class="hz-summary hz-bad">${esc(t.stop_reason)}</div>` : ''}</div>`;
        }).join('');
    }

    function renderQueue() {
        const box = $('hz-queue');
        const badge = $('hz-queue-badge');
        const errLine = $('hz-action-error');
        if (errLine) {
            errLine.textContent = actionError;
            errLine.hidden = !actionError;
        }
        const q = tasks().filter(x => x.state === 'queued')
            .sort((a, b) => (a.rank == null ? 999 : a.rank) - (b.rank == null ? 999 : b.rank));
        if (badge) badge.textContent = q.length + ' queued';
        if (!box) return;
        if (!q.length) {
            box.innerHTML = '<p class="hz-empty">The queue is empty. The harness fills it from the roadmaps each morning.</p>';
            return;
        }
        const dis = busy ? ' disabled' : '';
        box.innerHTML = `<div class="hz-scroll"><table class="data-table hz-table hz-table-q"><thead><tr><th>#</th><th>Task</th><th>Repo</th><th class="r">Your call</th></tr></thead><tbody>${q.map((t, i) => {
            const v = obj(model.vetoes) && obj(model.vetoes[t.id]);
            const id = esc(t.id);
            const ctl = v
                ? `<div class="hz-btns"><span class="ao-pill hz-pill-warn">${v.action === 'skip' ? 'skip' : 'do next'} sent</span><button type="button" class="hz-btn" data-hz-act="undo" data-hz-id="${id}"${dis}>Undo</button></div>`
                : `<div class="hz-btns"><button type="button" class="hz-btn" data-hz-act="top" data-hz-id="${id}"${dis}>Do next</button><button type="button" class="hz-btn" data-hz-act="skip" data-hz-id="${id}"${dis}>Skip</button></div>`;
            return `<tr><td class="hz-mono">${i + 1}</td><td class="hz-t">${esc(t.title || t.id)}<span class="hz-sub">${esc(t.source || '')}${t.why ? ' · ' + esc(t.why) : ''}</span></td><td class="hz-mono">${esc(t.repo || '')}</td><td class="r">${ctl}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }

    function outcome(t) {
        if (t.state === 'done') return `<span class="ao-pill ao-pill-healthy">${esc(t.outcome || 'merged + verified')}</span>`;
        if (t.state === 'vetoed') return '<span class="ao-pill ao-pill-dormant">skipped by you</span>';
        return `<span class="ao-pill ao-pill-stale">stopped</span>${t.stop_reason ? `<span class="hz-sub">${esc(t.stop_reason)}</span>` : ''}`;
    }

    function renderDone() {
        const box = $('hz-done');
        const badge = $('hz-done-badge');
        const d = tasks()
            .filter(x => x.state === 'done' || x.state === 'vetoed' || (x.state === 'stopped' && !x.lane))
            .sort((a, b) => String(b.done_at || b.updated_at || '').localeCompare(String(a.done_at || a.updated_at || '')));
        if (badge) badge.textContent = String(d.length);
        if (!box) return;
        if (!d.length) {
            box.innerHTML = '<p class="hz-empty">No finished tasks yet.</p>';
            return;
        }
        box.innerHTML = `<div class="hz-scroll"><table class="data-table hz-table hz-table-done"><thead><tr><th>Task</th><th>Repo</th><th>Outcome</th><th>Risk</th><th class="r">Astra rounds</th><th class="r">Build → ready</th><th class="r">Ready → live</th><th>PR</th></tr></thead><tbody>${d.map(t => `<tr>
            <td class="hz-t">${esc(t.title || t.id)}<span class="hz-sub">${esc(t.id)} · ${esc(pt(t.done_at || t.updated_at))}</span></td>
            <td class="hz-mono">${esc(t.repo || '')}</td><td class="hz-outcome">${outcome(t)}</td><td>${t.risk ? riskPill(t.risk) : '<span class="dim">—</span>'}</td>
            <td class="r">${esc(t.rounds == null ? '—' : t.rounds)}</td><td class="r">${esc(dur(t.started_at, t.engineering_ready_at))}</td>
            <td class="r">${esc(dur(t.engineering_ready_at, t.live_at || t.done_at))}</td><td class="hz-mono">${prLink(t)}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function renderFeed() {
        const box = $('hz-feed');
        if (!box) return;
        const ev = arr(model.state && model.state.events).filter(obj)
            .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
            .slice(0, 40);
        box.innerHTML = ev.length
            ? ev.map(e => `<li><span class="hz-when">${esc(pt(e.ts))}</span><span class="hz-what"><span class="hz-kind">${esc(e.kind || 'event')}</span>${e.task_id ? `<span class="hz-mono dim">${esc(e.task_id)}</span> · ` : ''}${esc(e.text || '')}</span></li>`).join('')
            : '<li><span class="hz-when">—</span><span class="hz-what dim">No events yet.</span></li>';
    }

    function renderFoot() {
        const foot = $('hz-foot');
        if (foot) {
            const s = status();
            foot.textContent = s && s.synced_at
                ? `Last written by the harness ${ago(s.synced_at)} · ${pt(s.synced_at)}`
                : 'The harness has not written to this board yet.';
        }
        const up = $('hz-updated');
        if (up) {
            up.textContent = lastSuccessAt ? 'read ' + pt(new Date(lastSuccessAt).toISOString(), false) : 'loading…';
            up.className = 'ao-updated';
        }
    }

    function showBoard(on) {
        const board = $('hz-board');
        if (board) board.style.display = on ? '' : 'none';
    }

    function setMessage(html) {
        const m = $('hz-message');
        if (!m) return;
        m.innerHTML = html || '';
        m.hidden = !html;
    }

    function renderBoard() {
        showBoard(true);
        setMessage(model.state ? '' : `
            <div class="ops-unavailable hz-notice">
                <div class="ops-unavailable-title">The harness has not reported yet</div>
                <div class="ops-unavailable-hint">Nothing is in <code>harness/state.json</code>. The board fills in after the harness's first <code>scripts/harness-push.mjs</code> upload.</div>
            </div>`);
        renderStrip();
        renderKpis();
        renderNeeds();
        renderLanes();
        renderQueue();
        renderFeed();
        renderDone();
        renderFoot();
    }

    const STATE_TITLES = {
        unauthenticated: 'Admin sign-in required',
        forbidden: 'This account is not an admin',
        not_configured: 'Harness board is not configured',
        unreachable: 'Harness board unavailable',
    };

    // renderState(kind, message): replace the board with an explicit state.
    function renderState(kind, message) {
        const k = STATE_TITLES[kind] ? kind : 'unreachable';
        const hint =
            k === 'unauthenticated' ? 'Sign in with an admin Google account using the button in the header.'
            : k === 'forbidden' ? 'Only VibeBullish admins can see the harness board.'
            : k === 'not_configured' ? 'Connect a <strong>private</strong> Vercel Blob store to the <code>vibebullish-dashboard</code> project (Production + Preview) and redeploy. See README → Harness tab.'
            : 'Nothing is shown, because the last-known board would read as current.' +
              (lastSuccessAt ? ` Last successful read: ${esc(pt(new Date(lastSuccessAt).toISOString()))}.` : '');
        showBoard(false);
        setMessage(`
            <div class="ops-unavailable hz-state hz-state-${esc(k)}">
                <div class="ops-unavailable-title">${esc(STATE_TITLES[k])}</div>
                ${message ? `<div class="ops-unavailable-msg">${esc(message)}</div>` : ''}
                <div class="ops-unavailable-hint">${hint}</div>
            </div>`);
        const up = $('hz-updated');
        if (up) { up.textContent = k === 'unreachable' && lastSuccessAt ? 'refresh failed' : ''; up.className = 'ao-updated ao-updated-stale'; }
    }

    function clearBoard() {
        model.state = null;
        model.vetoes = {};
        model.loaded = false;
        lastSuccessAt = null;
        actionError = '';
        ['hz-strip', 'hz-kpis', 'hz-needs', 'hz-lanes', 'hz-queue', 'hz-feed', 'hz-done'].forEach(id => {
            const e = $(id);
            if (e) e.innerHTML = '';
        });
    }

    // ── data ─────────────────────────────────────────────────────────────────

    function loadFixtureScript() {
        return new Promise((resolve, reject) => {
            if (window.__HARNESS_FIXTURE__) return resolve();
            const s = document.createElement('script');
            s.src = 'js/harness-fixture.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('fixture script failed to load'));
            document.head.appendChild(s);
        });
    }

    // request(path, opts) → {status, body}. Throws {unauthenticated} when
    // signed out (VBAuth.fetch requireAuth rejects before any network).
    async function request(path, opts) {
        const res = await window.VBAuth.fetch(path, Object.assign({ requireAuth: true }, opts || {}));
        let body = null;
        try {
            body = await res.json();
        } catch (_e) {
            body = { error: 'unreachable', message: `HTTP ${res.status} with a non-JSON body.` };
        }
        return { status: res.status, body };
    }

    function authGate() {
        if (FIXTURE) return null;
        const st = window.VBAuth ? window.VBAuth.state : 'loading';
        if (window.VBAuth && window.VBAuth.isAdmin) return null;
        if (st === 'not_admin') return ['forbidden', 'Signed in, but this account is not an admin.'];
        if (st === 'unconfigured') return ['unauthenticated', 'Sign-in is not configured on this deployment.'];
        if (st === 'loading' || st === 'checking') return ['unauthenticated', 'Checking admin access…'];
        if (st === 'verify_failed') return ['unauthenticated', 'Could not verify admin access. Retry from the header.'];
        return ['unauthenticated', ''];
    }

    function apply(status, body) {
        if (status === 200 && body && !body.error) {
            model.state = obj(body.state);
            model.vetoes = obj(body.vetoes) || {};
            model.readAt = body.read_at || null;
            model.loaded = true;
            lastSuccessAt = Date.now();
            renderBoard();
            return;
        }
        const kind = (body && body.error) || (status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'unreachable');
        renderState(kind, body && body.message);
    }

    async function load() {
        const gate = authGate();
        if (gate) { clearBoard(); renderState(gate[0], gate[1]); return; }
        if (inFlight) return;
        inFlight = true;
        const gen = generation;
        try {
            let r;
            if (FIXTURE) {
                await loadFixtureScript();
                r = window.__HARNESS_FIXTURE__(FIXTURE);
            } else {
                r = await request(ENDPOINT);
            }
            if (gen !== generation) return; // signed out meanwhile
            apply(r.status, r.body);
        } catch (err) {
            if (gen !== generation) return;
            if (err && err.unauthenticated) { clearBoard(); renderState('unauthenticated', ''); }
            else renderState('unreachable', String((err && err.message) || err));
        } finally {
            inFlight = false;
        }
    }

    // veto(taskId, action): Do next (top) / Skip / Undo. Every queue button is
    // disabled while one is in flight; the board re-renders from the response.
    async function veto(taskId, action) {
        if (busy || !model.loaded) return;
        busy = true;
        actionError = '';
        renderQueue();
        const gen = generation;
        let r;
        try {
            if (FIXTURE) {
                await loadFixtureScript();
                r = window.__HARNESS_FIXTURE_VETO__(taskId, action);
            } else {
                r = await request(ENDPOINT + '?view=veto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId, action }),
                });
            }
        } catch (err) {
            r = { status: 0, body: { error: err && err.unauthenticated ? 'unauthenticated' : 'unreachable', message: String((err && err.message) || err) } };
        }
        busy = false;
        if (gen !== generation) return;
        if (r.status === 200 && r.body && !r.body.error) {
            model.vetoes = obj(r.body.vetoes) || {};
        } else {
            const m = (r.body && r.body.message) || `HTTP ${r.status}`;
            actionError = `That change did not save (${(r.body && r.body.error) || 'error'}): ${m}`;
        }
        renderQueue();
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    function isActive() {
        const t = document.querySelector('.tab.active');
        return !!t && t.dataset.tab === TAB;
    }

    function pageVisible() {
        return !document.hidden && document.visibilityState !== 'hidden';
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function start() {
        stop();
        load();
        timer = setInterval(() => {
            if (!isActive()) { stop(); return; }
            if (!pageVisible()) return;
            load();
        }, POLL_MS);
    }

    function onAuthChange() {
        if (FIXTURE) return;
        const admin = !!(window.VBAuth && window.VBAuth.isAdmin);
        if (!admin) {
            generation++;
            stop();
            clearBoard();
            const g = authGate() || ['unauthenticated', ''];
            renderState(g[0], g[1]);
            return;
        }
        if (isActive()) start();
    }

    function onClick(e) {
        const b = e.target && e.target.closest ? e.target.closest('button[data-hz-act]') : null;
        if (!b || b.disabled) return;
        veto(b.getAttribute('data-hz-id'), b.getAttribute('data-hz-act'));
    }

    function init() {
        const tabs = document.querySelector('.dashboard-tabs');
        if (tabs) {
            tabs.addEventListener('click', e => {
                const t = e.target && e.target.closest ? e.target.closest('.tab') : null;
                if (!t) return;
                if (t.dataset.tab === TAB) start();
                else stop();
            });
        }
        const panel = $('tab-' + TAB);
        if (panel) panel.addEventListener('click', onClick);
        window.addEventListener('vb-auth-change', onAuthChange);
        document.addEventListener('visibilitychange', () => {
            if (pageVisible() && isActive() && timer) load();
        });

        // Fixture mode only: make this ONE button an ordinary tab for this
        // page load (so the admin gate does not hide it or bounce away from
        // it) and land on it, so a screenshot needs no sign-in or clicks.
        if (FIXTURE) {
            const btn = document.querySelector('.tab[data-tab="' + TAB + '"]');
            if (btn) {
                btn.removeAttribute('data-ops-tab');
                btn.style.display = '';
                btn.click();
            }
        }
    }

    window.HarnessTab = {
        load, veto, apply, renderState, start, stop,
        _model: model,
        _fixture: FIXTURE,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
