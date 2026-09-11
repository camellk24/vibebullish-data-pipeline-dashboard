// Agents tab — what every declared agent role in the system did today, whether
// it is healthy right now, and whether anyone checks its output.
//
// Data comes from /api/agent-ops, a Vercel serverless function in this project
// that holds INTERNAL_API_TOKEN server-side and proxies the token-gated backend
// route GET /api/internal/agent-ops. The browser never sees the token.
//
// DESIGN RULE — honesty by construction. "Not graded" and "unknown" are their
// own rendered states. They are never collapsed into a 0, a dash, or an empty
// cell, because an empty cell reads like health. A role that has never been
// graded must look different from a role that was graded and scored zero.

(function () {
    const ENDPOINT = '/api/agent-ops';
    const REFRESH_MS = 45_000;
    const TICK_MS = 1_000;

    let refreshTimer = null;
    let tickTimer = null;
    let lastSuccessAt = null; // ms epoch of the last successful payload
    let errored = false;      // last attempt failed — the ticker must keep saying so
    let expanded = new Set(); // role ids whose detail row is open
    let inFlight = false;

    // ?fixture=1 | unreachable | notconfigured | upstream  — dev only.
    const FIXTURE = new URLSearchParams(location.search).get('fixture');

    // ── helpers ──────────────────────────────────────────────────────────────

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    function num(v) {
        return isNum(v) ? v.toLocaleString('en-US') : null;
    }

    // A count we do not have is "unknown", not zero.
    function countCell(v, opts) {
        const cls = (opts && opts.cls) || '';
        if (!isNum(v)) return `<td class="r ao-unknown-cell" title="Not reported by the backend"><span>unknown</span></td>`;
        const zero = v === 0 ? ' ao-zero' : '';
        return `<td class="r ${cls}${zero}">${esc(num(v))}</td>`;
    }

    function relTime(iso) {
        if (!iso) return null;
        const t = Date.parse(iso);
        if (isNaN(t)) return null;
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.round(s / 60) + 'm ago';
        if (s < 172800) return Math.round(s / 3600) + 'h ago';
        return Math.round(s / 86400) + 'd ago';
    }

    function shortDur(seconds) {
        if (!isNum(seconds)) return null;
        if (seconds < 90) return seconds + 's';
        if (seconds < 5400) return Math.round(seconds / 60) + 'm';
        if (seconds < 172800) return Math.round(seconds / 3600) + 'h';
        return Math.round(seconds / 86400) + 'd';
    }

    const STATUS_LABEL = {
        healthy: 'healthy',
        stale: 'stale',
        idle: 'idle',
        dormant: 'dormant',
        unknown: 'unknown',
    };

    function statusPill(status) {
        const key = STATUS_LABEL[status] ? status : 'unknown';
        const title =
            key === 'unknown'
                ? 'The backend could not determine this role’s state — this is not a pass.'
                : '';
        return `<span class="ao-pill ao-pill-${key}"${title ? ` title="${esc(title)}"` : ''}>${esc(STATUS_LABEL[key])}</span>`;
    }

    function isUngraded(r) {
        return r.graded !== true || r.grading === 'not_graded';
    }

    // ── sorting: unhealthy and trade-gating first, dormant dimmed at the end ──

    function tierOf(r) {
        if (r.status === 'dormant') return 4;
        const unhealthy = r.status === 'stale' || r.status === 'unknown';
        if (unhealthy || (r.gates_trades && isUngraded(r))) return 0;
        if (r.gates_trades) return 1;
        if (r.status === 'idle') return 2;
        return 3; // healthy, ungating
    }

    const SEVERITY = { stale: 0, unknown: 1, idle: 2, healthy: 3, dormant: 4 };

    function sortRoles(roles) {
        return roles.slice().sort((a, b) => {
            const ta = tierOf(a), tb = tierOf(b);
            if (ta !== tb) return ta - tb;
            const ga = a.gates_trades ? 0 : 1, gb = b.gates_trades ? 0 : 1;
            if (ga !== gb) return ga - gb;
            const sa = SEVERITY[a.status] != null ? SEVERITY[a.status] : 9;
            const sb = SEVERITY[b.status] != null ? SEVERITY[b.status] : 9;
            if (sa !== sb) return sa - sb;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
    }

    // ── summary strip ────────────────────────────────────────────────────────

    function renderSummary(summary) {
        const el = document.getElementById('ao-summary');
        if (!el) return;
        const s = summary || {};
        const gating = s.gating_trades_ungraded;
        const gatingBad = isNum(gating) && gating > 0;

        const cards = [
            { label: 'Roles declared', value: s.roles, cls: '' },
            { label: 'Healthy now', value: s.healthy, cls: 'ao-val-good' },
            { label: 'Stale', value: s.stale, cls: isNum(s.stale) && s.stale > 0 ? 'ao-val-bad' : '' },
            { label: 'Ungraded', value: s.ungraded, cls: isNum(s.ungraded) && s.ungraded > 0 ? 'ao-val-warn' : '' },
        ];

        const html = cards
            .map(
                (c) => `
            <div class="metric-card">
                <div class="metric-label">${esc(c.label)}</div>
                <div class="metric-value ${c.cls}">${isNum(c.value) ? esc(num(c.value)) : '<span class="ao-unknown-val">unknown</span>'}</div>
            </div>`
            )
            .join('');

        // The one number that matters most.
        const hero = `
            <div class="metric-card hero ${gatingBad ? 'ao-hero-alarm' : ''}">
                <div class="metric-label">Gating trades while ungraded</div>
                <div class="metric-value ${gatingBad ? 'ao-val-bad' : 'ao-val-good'}">${
                    isNum(gating) ? esc(num(gating)) : '<span class="ao-unknown-val">unknown</span>'
                }</div>
                <div class="metric-sub">${
                    gatingBad
                        ? 'roles decide real positions with no verifier'
                        : isNum(gating)
                        ? 'every trade-gating role is graded'
                        : 'backend did not report this'
                }</div>
            </div>`;

        el.innerHTML = hero + html;
    }

    // ── table ────────────────────────────────────────────────────────────────

    function badges(r) {
        const out = [];
        if (r.gates_trades) {
            out.push(
                '<span class="ao-badge ao-badge-gates" title="This role’s output decides real positions.">GATES TRADES</span>'
            );
        }
        if (isUngraded(r)) {
            out.push(
                '<span class="ao-badge ao-badge-ungraded" title="Nothing scores this role’s output against reality.">UNGRADED</span>'
            );
        }
        if (r.provenance !== true) {
            out.push(
                '<span class="ao-badge ao-badge-noprov" title="Outputs carry no prompt version or model stamp — they cannot be traced to what produced them.">NO PROVENANCE</span>'
            );
        }
        return out.join('');
    }

    function lastOutputCell(r) {
        const rel = relTime(r.last_output_at);
        if (!rel) {
            return `<td class="r ao-never" title="No output has ever been recorded for this role."><span>never</span></td>`;
        }
        const late =
            r.status === 'stale'
                ? ' ao-late'
                : '';
        return `<td class="r ao-rel${late}" title="${esc(r.last_output_at)}">${esc(rel)}</td>`;
    }

    function detailRow(r, colspan) {
        const kv = [];
        function row(k, v, cls) {
            kv.push(
                `<div class="ao-kv"><div class="ao-k">${esc(k)}</div><div class="ao-v ${cls || ''}">${v}</div></div>`
            );
        }

        row('Purpose', r.purpose ? esc(r.purpose) : '<span class="ao-unknown-val">not declared</span>');
        row('Trigger', r.trigger ? `<code>${esc(r.trigger)}</code>` : '<span class="ao-unknown-val">not declared</span>');

        const expected = shortDur(r.expected_cadence_seconds);
        row(
            'Cadence',
            (r.cadence ? esc(r.cadence) : '<span class="ao-unknown-val">not declared</span>') +
                (expected ? ` <span class="ao-dimnote">(expected every ${esc(expected)})</span>` : '')
        );

        const thresh = shortDur(r.staleness_threshold_seconds);
        row(
            'Stale after',
            thresh ? esc(thresh) + ' without output' : '<span class="ao-unknown-val">no threshold declared</span>'
        );

        row('Writes to', r.writes_to ? `<code>${esc(r.writes_to)}</code>` : '<span class="ao-unknown-val">not declared</span>');

        // Grading — the honest bit.
        if (isUngraded(r)) {
            row(
                'Verifier',
                '<span class="ao-notgraded">NOT GRADED</span>' +
                    (r.grading_reason ? ` <span class="ao-dimnote">${esc(r.grading_reason)}</span>` : ''),
                'ao-v-warn'
            );
        } else {
            row('Verifier', esc(r.grading));
        }

        row(
            'Failure mode',
            r.failure_mode
                ? `<span class="ao-fmode ao-fmode-${esc(String(r.failure_mode).replace(/[^a-z-]/gi, ''))}">${esc(r.failure_mode)}</span>` +
                      ' <span class="ao-dimnote">' +
                      esc(
                          r.failure_mode === 'fail-open'
                              ? 'on failure the pipeline continues without it'
                              : r.failure_mode === 'fail-closed'
                              ? 'on failure the dependent step is blocked'
                              : 'failures are not surfaced anywhere'
                      ) +
                      '</span>'
                : '<span class="ao-unknown-val">not declared</span>'
        );

        row(
            'Provenance',
            r.provenance === true
                ? 'outputs carry model + prompt version'
                : '<span class="ao-notgraded">NONE</span> <span class="ao-dimnote">outputs cannot be traced to what produced them</span>'
        );

        // Latest quality result, if one exists at all.
        let quality;
        if (isUngraded(r)) {
            quality = `<div class="ao-quality ao-quality-none">No quality result exists — this role has never been graded. That is different from scoring zero.</div>`;
        } else if (r.quality && typeof r.quality === 'object' && Object.keys(r.quality).length) {
            const items = Object.keys(r.quality)
                .map((k) => {
                    const v = r.quality[k];
                    const label = k.replace(/_/g, ' ');
                    let val;
                    if (k === 'last_scored_at') {
                        val = relTime(v) || esc(String(v));
                    } else if (isNum(v)) {
                        val = esc(v.toLocaleString('en-US'));
                    } else {
                        val = esc(String(v));
                    }
                    return `<div class="ao-q-item"><div class="ao-q-val">${val}</div><div class="ao-q-lbl">${esc(label)}</div></div>`;
                })
                .join('');
            quality = `<div class="ao-quality"><div class="ao-q-title">Latest quality result</div><div class="ao-q-grid">${items}</div></div>`;
        } else {
            quality = `<div class="ao-quality ao-quality-none">Graded, but no scored result has landed yet.</div>`;
        }

        return `<tr class="ao-detail-row" data-detail-for="${esc(r.id)}"><td colspan="${colspan}"><div class="ao-detail">${kv.join(
            ''
        )}${quality}</div></td></tr>`;
    }

    function renderTable(roles) {
        const el = document.getElementById('ao-table');
        if (!el) return;

        if (!roles || !roles.length) {
            el.innerHTML = '<div class="ao-empty">The backend reported no agent roles at all. That is itself a finding — the roster should never be empty.</div>';
            return;
        }

        const sorted = sortRoles(roles);
        const COLS = 7;

        const head = `
        <table class="data-table ao-table">
            <thead><tr>
                <th>Role</th>
                <th>Status</th>
                <th class="r">Last output</th>
                <th class="r">Outputs today</th>
                <th class="r">LLM calls</th>
                <th class="r">Failures</th>
                <th>Accountability</th>
            </tr></thead>
            <tbody>`;

        const body = sorted
            .map((r) => {
                const dim = r.status === 'dormant' ? ' ao-row-dormant' : '';
                const open = expanded.has(r.id);
                const failCls = isNum(r.failures_today) && r.failures_today > 0 ? 'ao-val-bad' : '';
                return (
                    `<tr class="ao-row${dim}${open ? ' ao-row-open' : ''}" data-role="${esc(r.id)}" tabindex="0" role="button" aria-expanded="${open}">
                        <td class="ao-role-cell">
                            <span class="ao-caret" aria-hidden="true">›</span>
                            <span class="ao-role-name">${esc(r.name || r.id)}</span>
                            <span class="ao-owner ao-owner-${esc(r.owner === 'pipeline' ? 'pipeline' : 'backend')}">${esc(r.owner || 'unknown')}</span>
                            ${r.kind ? `<span class="ao-kind">${esc(r.kind)}</span>` : ''}
                        </td>
                        <td>${statusPill(r.status)}</td>
                        ${lastOutputCell(r)}
                        ${countCell(r.outputs_today)}
                        ${countCell(r.llm_calls_today)}
                        ${countCell(r.failures_today, { cls: failCls })}
                        <td class="ao-badges">${badges(r) || '<span class="ao-dimnote">graded · traceable</span>'}</td>
                    </tr>` + (open ? detailRow(r, COLS) : '')
                );
            })
            .join('');

        el.innerHTML = head + body + '</tbody></table>';
    }

    function toggleRow(id) {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        if (lastPayload) renderTable(lastPayload.roles);
    }

    // ── error / status states ────────────────────────────────────────────────

    function renderError(kind, message) {
        errored = true;
        const summary = document.getElementById('ao-summary');
        const table = document.getElementById('ao-table');
        const title =
            kind === 'not_configured'
                ? 'Agents view is not configured'
                : kind === 'upstream_error'
                ? 'Backend rejected the request'
                : 'Backend unreachable';
        const hint =
            kind === 'not_configured'
                ? 'The serverless proxy at <code>/api/agent-ops</code> has no <code>INTERNAL_API_TOKEN</code>. Set it on the Vercel project (Production + Preview) and redeploy.'
                : 'Nothing below is being shown, because showing the last-known numbers here would read as current health.';

        // Never leave stale numbers on screen pretending to be current.
        if (summary) summary.innerHTML = '';
        if (table) {
            table.innerHTML = `
            <div class="ao-error">
                <div class="ao-error-title">${esc(title)}</div>
                <div class="ao-error-msg">${esc(message || '')}</div>
                <div class="ao-error-hint">${hint}</div>
                ${
                    lastSuccessAt
                        ? `<div class="ao-error-hint">Last successful read: ${esc(relTime(new Date(lastSuccessAt).toISOString()))}.</div>`
                        : ''
                }
            </div>`;
        }
        setUpdatedLabel();
    }

    function setUpdatedLabel() {
        const el = document.getElementById('ao-updated');
        if (!el) return;
        if (!lastSuccessAt) {
            el.textContent = errored ? 'never loaded' : 'loading…';
            el.className = 'ao-updated ao-updated-stale';
            return;
        }
        const s = Math.max(0, Math.round((Date.now() - lastSuccessAt) / 1000));
        const txt = s < 60 ? `updated ${s}s ago` : `updated ${Math.round(s / 60)}m ago`;
        el.textContent = errored ? txt + ' · refresh failed' : txt;
        el.className = 'ao-updated' + (errored || s > REFRESH_MS / 1000 + 30 ? ' ao-updated-stale' : '');
    }

    // ── fetch ────────────────────────────────────────────────────────────────

    let lastPayload = null;

    function loadFixtureScript() {
        return new Promise((resolve, reject) => {
            if (window.__AGENT_OPS_FIXTURE__) return resolve();
            const s = document.createElement('script');
            s.src = 'js/agent-ops-fixture.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('fixture script failed to load'));
            document.head.appendChild(s);
        });
    }

    async function load() {
        if (inFlight) return;
        inFlight = true;
        try {
            let status, body;

            if (FIXTURE) {
                await loadFixtureScript();
                const f = window.__AGENT_OPS_FIXTURE__(FIXTURE);
                status = f.__status;
                body = f.body;
            } else {
                const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
                status = res.status;
                try {
                    body = await res.json();
                } catch (_e) {
                    body = { error: 'bad_response', message: `Proxy returned HTTP ${res.status} with a non-JSON body.` };
                }
            }

            if (status !== 200 || (body && body.error)) {
                renderError((body && body.error) || 'unreachable', body && body.message);
                return;
            }

            lastPayload = body;
            lastSuccessAt = Date.now();
            errored = false;
            renderSummary(body.summary);
            renderTable(body.roles);
            setUpdatedLabel();
        } catch (err) {
            renderError('unreachable', String((err && err.message) || err));
        } finally {
            inFlight = false;
        }
    }

    // ── lifecycle ────────────────────────────────────────────────────────────

    function start() {
        load();
        stop();
        refreshTimer = setInterval(load, REFRESH_MS);
        tickTimer = setInterval(setUpdatedLabel, TICK_MS);
    }

    function stop() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }

    function init() {
        const tabs = document.querySelector('.dashboard-tabs');
        if (tabs) {
            tabs.addEventListener('click', (e) => {
                const t = e.target.closest('.tab');
                if (!t) return;
                if (t.dataset.tab === 'agent-ops') start();
                else stop();
            });
        }

        const table = document.getElementById('ao-table');
        if (table) {
            table.addEventListener('click', (e) => {
                const row = e.target.closest('.ao-row');
                if (!row) return;
                toggleRow(row.dataset.role);
            });
            table.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const row = e.target.closest('.ao-row');
                if (!row) return;
                e.preventDefault();
                toggleRow(row.dataset.role);
            });
        }

        const panel = document.getElementById('tab-agent-ops');
        if (panel && panel.style.display !== 'none') start();

        // Fixture mode only: land straight on the tab, and optionally pre-open
        // rows via ?expand=id,id so a headless screenshot needs no clicks.
        if (FIXTURE) {
            const pre = new URLSearchParams(location.search).get('expand');
            if (pre) pre.split(',').filter(Boolean).forEach((id) => expanded.add(id.trim()));
            const btn = document.querySelector('.tab[data-tab="agent-ops"]');
            if (btn) btn.click();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
