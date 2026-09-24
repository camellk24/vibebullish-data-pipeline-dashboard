// Pure formatting helpers for the DQ readiness panel (#382 phase 3).
//
// No DOM dependency — every function takes an `esc` function as an argument
// and returns plain/HTML strings. This lets js/ops-console.js render with it
// in the browser AND lets js/dq-readiness-format.test.js exercise it under
// node:test without a DOM. UMD-lite: no build step, works as a plain
// <script> (window.DQReadinessFormat) and as a CommonJS module
// (module.exports) for node:test.

(function () {
    'use strict';

    // Same snake_case/camelCase dual-read as ops-console.js's pick() —
    // duplicated here (not imported) so this module stays dependency-free.
    function pick(obj /* , ...names */) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (let i = 1; i < arguments.length; i++) {
            const n = arguments[i];
            if (obj[n] !== undefined && obj[n] !== null) return obj[n];
            const snake = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
            if (obj[snake] !== undefined && obj[snake] !== null) return obj[snake];
        }
        return undefined;
    }

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    // Pure date formatter mirroring ops-console.js's shortTs() — duplicated
    // (not imported) for the same dependency-free reason as pick() above.
    function shortTs(iso) {
        if (!iso) return '—';
        const t = new Date(iso);
        if (isNaN(t.getTime())) return String(iso);
        return t.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    }

    // The parenthetical detail text for an episode — used by BOTH the
    // readiness line and the unresolved table's CHECKS cell, so the two
    // never drift out of sync with each other again.
    //
    // Order: failed checks first ("failed: a, b"), then incomplete required
    // ("incomplete: c"), joined with " · ". The word "execution" (with
    // "· exec: <error>" appended when there is one) is printed ONLY when the
    // backend actually says this episode is about an execution failure —
    // execution_error is non-null, or opened_by.kind === 'execution'. It is
    // NEVER inferred from an empty failed_checks array: that was the P2 bug
    // (owner repro: failed_checks=[], incomplete_required=
    // ["session_bars_accepted"] rendered as "(blocking, execution)", losing
    // the actual incomplete-check detail and mislabelling a result-opened
    // episode as an execution failure). When none of the three apply, the
    // detail is "no detail" — never a silently blank parenthetical.
    function episodeDetail(ep, esc) {
        const failed = asArray(pick(ep, 'failedChecks', 'failed_checks'));
        const incomplete = asArray(pick(ep, 'incompleteRequired', 'incomplete_required'));
        const execErr = pick(ep, 'executionError', 'execution_error');
        const openedBy = pick(ep, 'openedBy', 'opened_by');
        const openedKind = openedBy ? pick(openedBy, 'kind') : undefined;

        const parts = [];
        if (failed.length) parts.push('failed: ' + failed.map(c => esc(String(c))).join(', '));
        if (incomplete.length) parts.push('incomplete: ' + incomplete.map(c => esc(String(c))).join(', '));

        const isExecution =
            (execErr !== undefined && execErr !== null && execErr !== '') || openedKind === 'execution';
        if (isExecution) {
            parts.push('execution' + (execErr ? ' · exec: ' + esc(String(execErr)) : ''));
        }

        return parts.length ? parts.join(' · ') : 'no detail';
    }

    // The dim "execution: …" line's inner text — '' when there is nothing to
    // show (no execution object, or it already succeeded). The caller wraps
    // a non-empty result in whatever container markup it wants.
    //
    // `attempts` is the backend's raw attempt counter, including deferrals,
    // so it is rendered bare (no hardcoded "/3" ceiling — a deferred job can
    // legitimately read "attempt 4"). `retryable` is only meaningful when
    // state === 'failed'; it is never rendered for a running/succeeded job.
    function executionLine(execution, esc) {
        if (!execution || pick(execution, 'state') === 'succeeded') return '';
        const state = pick(execution, 'state');
        const attempts = pick(execution, 'attempts');
        const retryable = pick(execution, 'retryable');
        const err = pick(execution, 'error');

        const attemptsPart = isNum(attempts) ? ' attempt ' + esc(String(attempts)) : '';
        const retryPart =
            state === 'failed' && retryable === true
                ? ', retryable'
                : state === 'failed' && retryable === false
                ? ', exhausted'
                : '';
        const errPart = err ? ' — ' + esc(String(err)) : '';

        return 'execution: ' + esc(String(state || 'unknown')) + attemptsPart + retryPart + errPart;
    }

    // "<request_id or run N> (<trigger>) <shortTs>" — `trigger`/`request_id`
    // on legacy rows may literally be the string "unknown"; that renders as
    // "trigger unknown" rather than being echoed back as a real trigger name.
    function refLabel(x, esc) {
        if (!x) return '';
        const t = pick(x, 'trigger');
        const trigger = t && t !== 'unknown' ? esc(String(t)) : 'trigger unknown';
        const reqId = pick(x, 'requestId', 'request_id');
        const ranAt = pick(x, 'ranAt', 'ran_at');
        const runId = pick(x, 'resultId', 'result_id', 'id');
        const label = reqId ? esc(String(reqId)) : 'run ' + esc(String(runId != null ? runId : '—'));
        return label + ' (' + trigger + ')' + (ranAt ? ' ' + esc(shortTs(ranAt)) : '');
    }

    const DQReadinessFormat = { episodeDetail, executionLine, refLabel };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DQReadinessFormat;
    }
    if (typeof window !== 'undefined') {
        window.DQReadinessFormat = DQReadinessFormat;
    }
})();
