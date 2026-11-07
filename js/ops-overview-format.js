// Pure render helpers for the ops console Overview tab
// (GET /api/ops/overview → backend /api/internal/ops/overview). Spec:
// vibebullish-docs docs/superpowers/specs/2026-11-03-ops-overview-tab-spec.md
// §3 and §5; build plan docs/superpowers/plans/2026-11-03-ops-overview-tab-build.md
// Task 6.
//   - the formatter recomputes NO status: every chip is the backend's value;
//   - UNKNOWN, DIAGNOSTIC and NOT_BUILT are never green, each with its own text;
//   - the unmeasured count sits beside the overall chip, so a green chip never
//     reads as "everything is measured";
//   - a FAIL line whose routing is off says "not paged";
//   - a view older than 5 minutes is marked stale and its overall chip greyed.
//
// No DOM dependency: render takes `esc` and returns strings, so
// js/ops-console.js renders with it in the browser and
// js/ops-overview-format.test.js runs it under node:test.
// UMD-lite, like js/strategy-diagnostics-format.js.

(function () {
    'use strict';

    const STALE_AFTER_MS = 5 * 60 * 1000;

    const CHIP = { PASS: 'ops-chip-ok', WARN: 'ops-chip-warn', FAIL: 'ops-chip-bad' };

    const STAGE_LABEL = {
        data_substrate: 'Data & substrate',
        data_quality: 'Data quality',
        model: 'Model',
        strategies: 'Strategies',
        execution: 'Execution',
        agents: 'Agents',
        registry_research: 'Registry & research',
        cost_usage: 'Cost & usage',
        routines: 'Routines',
    };

    // Display names only: the status of a line is never derived from these. An
    // id or reason not listed here is still shown, with underscores as spaces.
    const LINE_LABEL = {
        substrate_freshness: 'Substrate freshness',
        available_at_lag: 'Available-at lag',
        extractor_liveness: 'Extractor liveness',
        dq_readiness: 'DQ readiness',
        dq_history: 'DQ history',
        inference_health: 'Inference health',
        rank_ic: 'Rank IC',
        calibration_bias: 'Calibration bias',
        correlation_cap: 'Correlation cap',
        books_paused: 'Books paused',
        halt_feed: 'Halt feed',
        execution_audit: 'Execution audit',
        agent_roles: 'Agent roles',
        llm_budget: 'LLM budget',
        read_dates: 'Read dates',
        daily_spend: 'Daily spend',
        heartbeats: 'Heartbeats',
    };

    const REASON_LABEL = {
        timeout: 'timed out',
        no_result: 'no result today',
        beat_warn: 'a routine warned',
        beat_fail: 'a routine failed',
        late: 'a routine is late',
        never_beaten: 'a routine has never reported',
        missing: 'no snapshot',
        evidence_unavailable: 'source unavailable',
        panic: 'source crashed',
        unmapped_value: 'unrecognised value',
        execution_failed: 'run failed',
        gating_ungraded: 'gating trades ungraded',
        insufficient_sample: 'too few samples',
    };

    const DAY_MS = 24 * 60 * 60 * 1000;

    const PT_FORMAT = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    function str(v) {
        return typeof v === 'string' && v ? v : null;
    }

    function lineLabel(id) {
        return LINE_LABEL[id] || String(id).replace(/_/g, ' ');
    }

    function reasonLabel(reason) {
        return REASON_LABEL[reason] || String(reason).replace(/_/g, ' ');
    }

    function isDateOnly(v) {
        return /^\d{4}-\d{2}-\d{2}$/.test(v);
    }

    // '2026-11-03 14:05 PT'; an unparseable value is returned as given.
    function shortTs(iso) {
        const t = new Date(iso);
        if (isNaN(t.getTime())) return String(iso);
        if (isDateOnly(iso)) return iso; // a session date stays a date
        const p = {};
        PT_FORMAT.formatToParts(t).forEach(x => { p[x.type] = x.value; });
        return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} PT`;
    }

    // ' · 34 d old' once a reading is a day old, so an old date doesn't read
    // like a fresh one. Text only: the verdict stays the backend's.
    function ageNote(iso, now) {
        if (isDateOnly(iso) || !Number.isFinite(now)) return '';
        const t = new Date(iso).getTime();
        if (!Number.isFinite(t) || now - t < DAY_MS) return '';
        return ` · ${Math.floor((now - t) / DAY_MS)} d old`;
    }

    // A chip for a backend status. Anything not PASS/WARN/FAIL — UNKNOWN,
    // DIAGNOSTIC, NOT_BUILT, or a value this formatter has never seen — is the
    // dashed grey chip with its own text: never green.
    function chip(status, esc) {
        const s = str(status) || 'UNKNOWN';
        const cls = CHIP[s] || 'ops-chip-unknown';
        return `<span class="ops-chip ${cls}">${esc(s.replace('_', ' '))}</span>`;
    }

    // Age of the view: server-side age at receipt plus time since receipt.
    function ageMs(payload, opts) {
        const gen = new Date(payload && payload.generated_at).getTime();
        const rec = opts && Number.isFinite(opts.receivedAt) ? opts.receivedAt : NaN;
        const now = opts && Number.isFinite(opts.now) ? opts.now : NaN;
        if (!Number.isFinite(gen) || !Number.isFinite(rec) || !Number.isFinite(now)) return Infinity;
        return (rec - gen) + (now - rec);
    }

    function isStale(payload, opts) {
        return ageMs(payload, opts) > STALE_AFTER_MS;
    }

    function lineRow(l, esc, now) {
        const asOf = str(l.as_of) ? esc(shortTs(l.as_of) + ageNote(l.as_of, now)) : 'no timestamp';
        const reason = str(l.reason) ? ` <span class="ov-reason">${esc(reasonLabel(l.reason))}</span>` : '';
        const paged = l.status === 'FAIL'
            ? (l.routing_active ? ' <span class="ov-paged">paged</span>' : ' <span class="ov-not-paged">not paged</span>')
            : '';
        return `<li class="ov-line"><span class="ov-line-id">${esc(lineLabel(l.id))}</span> ${chip(l.status, esc)}${paged}${reason}` +
            `<span class="ov-asof">${asOf}</span></li>`;
    }

    function stageTile(st, esc, now) {
        const label = STAGE_LABEL[st.stage] || st.stage;
        const lines = asArray(st.lines).filter(l => l.status !== 'NOT_BUILT');
        const link = str(st.tab)
            ? `<button type="button" class="ov-open" data-target="${esc(st.tab)}">Open tab</button>`
            : '';
        const body = lines.length
            ? `<ul class="ov-lines">${lines.map(l => lineRow(l, esc, now)).join('')}</ul>`
            : '<div class="ov-empty">No verdict source yet.</div>';
        return `<div class="ov-tile">
            <div class="ov-tile-head"><span class="ov-stage">${esc(label)}</span>${chip(st.status, esc)}${link}</div>
            ${body}
        </div>`;
    }

    // render(payload, esc, {receivedAt, now}) → {html, badge, badgeBad, stale}
    function render(payload, esc, opts) {
        const stages = payload && Array.isArray(payload.stages) ? payload.stages : null;
        if (!stages) {
            return {
                html: '<div class="ops-unavailable">Malformed response: no stages list.</div>',
                badge: 'unavailable',
                badgeBad: true,
                stale: false,
            };
        }
        const stale = isStale(payload, opts);
        const counts = payload.counts || {};
        const measured = Number.isSafeInteger(counts.measured) ? counts.measured : null;
        const total = Number.isSafeInteger(counts.stages) ? counts.stages : stages.length;
        const unmeasured = asArray(payload.unmeasured);
        const overall = stale ? 'UNKNOWN' : payload.status;

        const failing = [];
        stages.forEach(st => asArray(st.lines).forEach(l => {
            if (l.status === 'FAIL') failing.push(l);
        }));
        const paging = failing.length
            ? `<div class="ov-paging"><span class="ov-paging-h">FAIL lines</span>${failing.map(l =>
                `<span class="ov-paging-item">${esc(lineLabel(l.id))} · ${l.routing_active ? 'paged' : 'not paged'}</span>`).join('')}</div>`
            : '';

        const staleNote = stale
            ? `<div class="ov-stale">stale — this view is more than 5 minutes old (generated ${esc(shortTs(payload.generated_at))}); waiting for a fresh read</div>`
            : '';

        const unmeasuredList = unmeasured.length
            ? `<details class="ov-unmeasured"><summary>Unmeasured lines (${unmeasured.length})</summary><ul>${unmeasured.map(u =>
                `<li>${esc(STAGE_LABEL[u.stage] || u.stage)} · ${esc(lineLabel(u.line))} ${chip(u.status, esc)}</li>`).join('')}</ul></details>`
            : '';

        // Stages and lines are different counts: 9 stages, each with its own lines.
        const measuredText = measured == null
            ? 'measured count unknown'
            : `${measured} of ${total} stages measured · ${unmeasured.length} ${unmeasured.length === 1 ? 'line' : 'lines'} unmeasured`;

        const now = opts && opts.now;
        const html = `
            <div class="ov-overall">${chip(overall, esc)}<span class="ov-measured">${esc(measuredText)}</span>
                <span class="ov-generated">generated ${esc(shortTs(payload.generated_at))}</span></div>
            ${staleNote}
            ${paging}
            <div class="ov-grid">${stages.map(st => stageTile(st, esc, now)).join('')}</div>
            ${unmeasuredList}`;

        // The overall chip in the panel carries the status and counts, so the
        // card header stays empty unless the view itself can't be trusted.
        return {
            html,
            badge: stale ? 'stale' : '',
            badgeBad: stale,
            stale,
        };
    }

    const OpsOverviewFormat = { render, isStale, chip, STALE_AFTER_MS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = OpsOverviewFormat;
    }
    if (typeof window !== 'undefined') {
        window.OpsOverviewFormat = OpsOverviewFormat;
    }
})();
