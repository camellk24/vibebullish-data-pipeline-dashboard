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

    // Field names below are the backend's (GET /api/internal/agent-ops,
    // vibebullish-backend internal/api/handlers/agent_ops_handler.go). The
    // first version of this tab was written against a fixture with its own
    // names (cadence, writes_to, provenance:true, grading, name) and rendered
    // every live role as "not declared" / "NONE". js/agent-ops-fixture.js now
    // mirrors the real payload; keep the two in lockstep.

    function isUngraded(r) {
        return r.graded !== true || (r.quality && r.quality.state === 'not_graded');
    }

    // provenance is {model_persisted, prompt_version_persisted,
    // timestamp_persisted, note}. Full = all three; none = zero.
    function provenanceLevel(r) {
        const p = r.provenance;
        if (!p || typeof p !== 'object') return 'none';
        const n = [p.model_persisted, p.prompt_version_persisted, p.timestamp_persisted].filter((v) => v === true).length;
        return n === 3 ? 'full' : n === 0 ? 'none' : 'partial';
    }

    function roleName(r) {
        return r.display_name || r.id;
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
            return String(roleName(a)).localeCompare(String(roleName(b)));
        });
    }

    // ── summary strip ────────────────────────────────────────────────────────

    function renderSummary(summary) {
        const el = document.getElementById('ao-summary');
        if (!el) return;
        const s = summary || {};
        const gating = s.gating_trades_but_ungraded;
        const gatingBad = isNum(gating) && gating > 0;

        const cards = [
            { label: 'Live roles', value: s.live, sub: isNum(s.roles_total) ? `of ${num(s.roles_total)} declared` : '', cls: '' },
            { label: 'Healthy now', value: s.healthy, cls: 'ao-val-good' },
            { label: 'Stale', value: s.stale, cls: isNum(s.stale) && s.stale > 0 ? 'ao-val-bad' : '' },
            // ungraded_gaps excludes roles ungraded by design and dormant ones —
            // the backend's honest ungraded number (summary.ungraded counts both).
            { label: 'Ungraded gaps', value: s.ungraded_gaps, cls: isNum(s.ungraded_gaps) && s.ungraded_gaps > 0 ? 'ao-val-warn' : '' },
        ];

        const html = cards
            .map(
                (c) => `
            <div class="metric-card">
                <div class="metric-label">${esc(c.label)}</div>
                <div class="metric-value ${c.cls}">${isNum(c.value) ? esc(num(c.value)) : '<span class="ao-unknown-val">unknown</span>'}</div>
                ${c.sub ? `<div class="metric-sub">${esc(c.sub)}</div>` : ''}
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
        if (provenanceLevel(r) === 'none') {
            out.push(
                '<span class="ao-badge ao-badge-noprov" title="Outputs carry no model, prompt version or timestamp — they cannot be traced to what produced them.">NO PROVENANCE</span>'
            );
        }
        return out.join('');
    }

    function lastOutputCell(r) {
        const rel = relTime(r.last_output_at);
        // Memory-only roles judged on their LLM calls have no output row;
        // show the latest call instead of a misleading "never".
        if (!rel && r.status_basis === 'llm_calls') {
            const callRel = relTime(r.last_llm_call_at);
            const late = r.status === 'stale' ? ' ao-late' : '';
            return callRel
                ? `<td class="r ao-rel${late}" title="Latest tagged LLM call ${esc(r.last_llm_call_at)} — output is in memory, not counted"><span class="ao-dimnote">call</span> ${esc(callRel)}</td>`
                : `<td class="r ao-never" title="No tagged LLM call in the last 14 days."><span>no call</span></td>`;
        }
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
        const cadenceLabel = r.event_driven ? 'event-driven' : expected ? `every ${esc(expected)}` : '';
        row(
            'Cadence',
            (cadenceLabel || r.cadence_note
                ? (cadenceLabel ? `<strong>${cadenceLabel}</strong> ` : '') + (r.cadence_note ? `<span class="ao-dimnote">${esc(r.cadence_note)}</span>` : '')
                : '<span class="ao-unknown-val">not declared</span>')
        );

        if (r.status_basis === 'llm_calls') {
            row(
                'Status basis',
                '<strong>LLM calls</strong> <span class="ao-dimnote">output lives in memory, so status is judged on the latest tagged call' +
                    (r.last_llm_call_at ? ` (${esc(relTime(r.last_llm_call_at))})` : ' (none in 14 days)') +
                    ' — proof the role ran, not that its output was good</span>'
            );
        }

        const thresh = shortDur(r.staleness_threshold_seconds);
        row(
            'Stale after',
            thresh
                ? esc(thresh) + (r.market_days_only ? ' of market-day time' : '') + ' without output' +
                      (r.market_days_only ? ' <span class="ao-dimnote">(weekends + NYSE holidays do not count)</span>' : '')
                : '<span class="ao-unknown-val">no threshold declared</span>'
        );

        const tables = Array.isArray(r.output_tables) ? r.output_tables : [];
        row(
            'Writes to',
            tables.length
                ? tables.map((t) => `<code>${esc(t)}</code>`).join(' ')
                : '<span class="ao-unknown-val">nothing persisted</span>' +
                      (r.observability_note ? ` <span class="ao-dimnote">${esc(r.observability_note)}</span>` : '')
        );

        // Grading — the honest bit.
        if (isUngraded(r)) {
            const reason = r.quality && r.quality.reason;
            row(
                'Verifier',
                '<span class="ao-notgraded">NOT GRADED</span>' +
                    (reason ? ` <span class="ao-dimnote">${esc(reason)}</span>` : r.grading_note ? ` <span class="ao-dimnote">${esc(r.grading_note)}</span>` : ''),
                'ao-v-warn'
            );
        } else {
            row(
                'Verifier',
                (r.verifier ? esc(r.verifier) : '<span class="ao-unknown-val">not declared</span>') +
                    (r.grading_note ? ` <span class="ao-dimnote">${esc(r.grading_note)}</span>` : '')
            );
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
                      '</span>' +
                      (r.failure_note ? `<div class="ao-dimnote">${esc(r.failure_note)}</div>` : '')
                : '<span class="ao-unknown-val">not declared</span>'
        );

        const prov = r.provenance && typeof r.provenance === 'object' ? r.provenance : {};
        const level = provenanceLevel(r);
        const mark = (ok, label) => `${ok === true ? '✓' : '✗'} ${label}`;
        const parts = [mark(prov.model_persisted, 'model'), mark(prov.prompt_version_persisted, 'prompt version'), mark(prov.timestamp_persisted, 'timestamp')].join(' · ');
        row(
            'Provenance',
            (level === 'full'
                ? '<strong>FULL</strong>'
                : level === 'partial'
                ? '<strong>PARTIAL</strong>'
                : '<span class="ao-notgraded">NONE</span>') +
                ` <span class="ao-dimnote">${esc(parts)}</span>` +
                (prov.note ? `<div class="ao-dimnote">${esc(prov.note)}</div>` : '')
        );

        if (r.lifecycle && r.lifecycle !== 'live') {
            row('Lifecycle', `<strong>${esc(r.lifecycle)}</strong>` + (r.lifecycle_note ? ` <span class="ao-dimnote">${esc(r.lifecycle_note)}</span>` : ''));
        }

        // Latest quality result, if one exists at all.
        // quality = {state: graded|not_graded|unknown, kind, source,
        // metric_name, metric_value, as_of, reason}. A not_graded role may
        // still report a completeness metric (risk flagger: coverage) — show
        // it, labelled as what it is, never as a grade.
        const q = r.quality && typeof r.quality === 'object' ? r.quality : {};
        const qItem = (val, lbl) => `<div class="ao-q-item"><div class="ao-q-val">${val}</div><div class="ao-q-lbl">${esc(lbl)}</div></div>`;
        const metricItems = () =>
            [
                isNum(q.metric_value) ? qItem(esc(q.metric_value.toLocaleString('en-US')), (q.metric_name || 'metric').replace(/_/g, ' ')) : '',
                q.as_of ? qItem(esc(relTime(q.as_of) || q.as_of), 'as of') : '',
                q.kind ? qItem(esc(q.kind), 'kind') : '',
            ].join('');
        let quality;
        if (q.state === 'unknown') {
            quality = `<div class="ao-quality ao-quality-none">Quality could not be read${q.reason ? ` — ${esc(q.reason)}` : ''}. Unknown is not a pass.</div>`;
        } else if (isUngraded(r)) {
            quality =
                `<div class="ao-quality ao-quality-none">No quality result exists — this role has never been graded. That is different from scoring zero.</div>` +
                (isNum(q.metric_value)
                    ? `<div class="ao-quality"><div class="ao-q-title">Completeness only — not a grade</div><div class="ao-q-grid">${metricItems()}</div>${
                          q.source ? `<div class="ao-dimnote">${esc(q.source)}</div>` : ''
                      }</div>`
                    : '');
        } else if (isNum(q.metric_value) || q.as_of) {
            quality = `<div class="ao-quality"><div class="ao-q-title">Latest quality result</div><div class="ao-q-grid">${metricItems()}</div>${
                q.source ? `<div class="ao-dimnote">${esc(q.source)}</div>` : ''
            }</div>`;
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
                            <span class="ao-role-name" title="${esc(r.id)}">${esc(roleName(r))}</span>
                            <span class="ao-owner ao-owner-${esc(r.owner === 'pipeline' ? 'pipeline' : 'backend')}">${esc(r.owner || 'unknown')}</span>
                            ${r.kind ? `<span class="ao-kind">${esc(r.kind)}</span>` : ''}
                        </td>
                        <td>${statusPill(r.status)}${r.status_basis === 'llm_calls' ? '<div class="ao-dimnote" title="Judged on the latest tagged LLM call — the output itself is in memory">via LLM calls</div>' : ''}</td>
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
                : kind === 'unauthenticated' || kind === 'forbidden'
                ? 'Admin sign-in required'
                : kind === 'upstream_error'
                ? 'Backend rejected the request'
                : 'Backend unreachable';
        const hint =
            kind === 'not_configured'
                ? 'The serverless proxy at <code>/api/agent-ops</code> has no <code>INTERNAL_API_TOKEN</code>. Set it on the Vercel project (Production + Preview) and redeploy.'
                : kind === 'unauthenticated' || kind === 'forbidden'
                ? 'This view reads a token-gated backend route. Sign in with an admin Google account using the button in the header.'
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
                // Phase D: /api/agent-ops is now admin-verified server-side, so the
                // request must carry the signed-in user's Firebase ID token.
                const res = window.VBAuth
                    ? await window.VBAuth.fetch(ENDPOINT)
                    : await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
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
        // Phase D: the proxy is admin-verified, so a load that raced sign-in
        // shows "Admin sign-in required". Retry once access changes.
        window.addEventListener('vb-auth-change', () => {
            const active = document.querySelector('.tab.active');
            if (active && active.dataset.tab === 'agent-ops') load();
        });

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
