'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { episodeDetail, executionLine, refLabel } = require('./dq-readiness-format.js');

// Same attribute-safe escaper as ops-console.js's esc() — duplicated here so
// this test exercises the module exactly the way the browser calls it,
// without requiring a DOM.
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── episodeDetail ────────────────────────────────────────────────────────

test('episodeDetail: owner P2 repro — empty failed_checks + incomplete_required must show "incomplete", never "execution"', () => {
    const ep = {
        failed_checks: [],
        incomplete_required: ['session_bars_accepted'],
        execution_error: null,
        opened_by: { kind: 'result', ref: '12' },
    };
    const out = episodeDetail(ep, esc);
    assert.match(out, /incomplete: session_bars_accepted/);
    assert.doesNotMatch(out, /execution/);
});

test('episodeDetail: failed + incomplete both present renders both, joined', () => {
    const ep = {
        failed_checks: ['session_bars_complete'],
        incomplete_required: ['quote_coverage'],
        execution_error: null,
        opened_by: { kind: 'scheduled_batch', ref: 'x' },
    };
    const out = episodeDetail(ep, esc);
    assert.match(out, /failed: session_bars_complete/);
    assert.match(out, /incomplete: quote_coverage/);
    assert.doesNotMatch(out, /execution/);
});

test('episodeDetail: execution-opened episode renders "execution" with the error', () => {
    const ep = {
        failed_checks: [],
        incomplete_required: [],
        execution_error: 'x',
        opened_by: { kind: 'execution', ref: 'req-1' },
    };
    const out = episodeDetail(ep, esc);
    assert.match(out, /execution/);
    assert.match(out, /exec: x/);
});

test('episodeDetail: execution_error alone (opened_by.kind not "execution") still renders "execution"', () => {
    const ep = {
        failed_checks: ['session_bars_complete'],
        incomplete_required: [],
        execution_error: 'boom',
        opened_by: { kind: 'scheduled_batch', ref: 'x' },
    };
    const out = episodeDetail(ep, esc);
    assert.match(out, /failed: session_bars_complete/);
    assert.match(out, /execution · exec: boom/);
});

test('episodeDetail: nothing set at all renders "no detail"', () => {
    const ep = { failed_checks: [], incomplete_required: [], execution_error: null, opened_by: { kind: 'result' } };
    assert.equal(episodeDetail(ep, esc), 'no detail');
});

test('episodeDetail: escapes check names', () => {
    const ep = { failed_checks: ['<b>bad</b>'], incomplete_required: [], execution_error: null };
    const out = episodeDetail(ep, esc);
    assert.match(out, /&lt;b&gt;bad&lt;\/b&gt;/);
    assert.doesNotMatch(out, /<b>/);
});

// ── executionLine ────────────────────────────────────────────────────────

test('executionLine: running never shows "exhausted" or "retryable"', () => {
    const out = executionLine({ state: 'running', attempts: 1, retryable: null, error: null }, esc);
    assert.match(out, /^execution: running attempt 1$/);
    assert.doesNotMatch(out, /exhausted/);
    assert.doesNotMatch(out, /retryable/);
});

test('executionLine: failed + retryable true shows ", retryable"', () => {
    const out = executionLine({ state: 'failed', attempts: 1, retryable: true, error: 'connection refused' }, esc);
    assert.match(out, /^execution: failed attempt 1, retryable — connection refused$/);
});

test('executionLine: failed + retryable false shows ", exhausted"', () => {
    const out = executionLine({ state: 'failed', attempts: 3, retryable: false, error: 'timeout' }, esc);
    assert.match(out, /^execution: failed attempt 3, exhausted — timeout$/);
});

test('executionLine: succeeded renders nothing', () => {
    assert.equal(executionLine({ state: 'succeeded', attempts: 1, retryable: null, error: null }, esc), '');
});

test('executionLine: null execution renders nothing', () => {
    assert.equal(executionLine(null, esc), '');
});

// ── refLabel ─────────────────────────────────────────────────────────────

test('refLabel: trigger "unknown" renders "trigger unknown", not the literal string as a real trigger', () => {
    const out = refLabel({ request_id: 'unknown', trigger: 'unknown', result_id: 11, ran_at: '2026-09-21T14:10:00Z' }, esc);
    assert.match(out, /trigger unknown/);
});

test('refLabel: real trigger + request_id renders both plus the timestamp', () => {
    const out = refLabel(
        { request_id: 'dq_daily:2026-09-23:c1', trigger: 'manual_revalidate', ran_at: '2026-09-23T13:05:00Z' },
        esc
    );
    assert.match(out, /dq_daily:2026-09-23:c1/);
    assert.match(out, /manual_revalidate/);
    assert.match(out, /2026-09-23 13:05Z/);
});

test('refLabel: null/undefined ref renders empty string', () => {
    assert.equal(refLabel(null, esc), '');
    assert.equal(refLabel(undefined, esc), '');
});
