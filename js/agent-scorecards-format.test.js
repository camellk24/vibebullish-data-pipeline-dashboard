'use strict';

// Render coverage for the Agents tab's scorecard cards. Payload shapes follow
// the backend structs named at the top of js/agent-scorecards-format.js; the
// numbers are illustrative.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { riskFlagger, curatedPicks, tripwire } = require('./agent-scorecards-format.js');

// The escaper js/agent-ops.js passes in: the shared one from js/reads.js.
const { esc } = require('./reads.js');

const EVIL = '<img src=x onerror=alert(1)>';

// ── risk flagger ─────────────────────────────────────────────────────────────

test('risk-flagger: coverage, counts and the heuristic labelled as not an authorization', () => {
    const out = riskFlagger({
        total_latest: 1840, evaluated: 31, pct_coverage: 1.7, effective_coverage_pct: 86.4,
        with_flags: 22, high_severity_count: 4, medium_severity_count: 11, low_severity_count: 0,
        high_severity_samples: [{ ticker: 'AAA' }],
        gate_recommendation: 'flip', gate_recommendation_reason: 'effective coverage at 86.4%',
    }, esc);
    assert.match(out.html, /86\.4%/);
    assert.match(out.html, /31 of 1,840 latest rows evaluated/);
    assert.match(out.html, /4 \/ 11 \/ 0/, 'a real zero renders as 0');
    assert.match(out.html, /not an authorization/);
    assert.match(out.html, /<code>AAA<\/code>/);
    assert.equal(out.badge, 'effective 86.4%');
    assert.equal(out.badgeBad, false);
});

test('risk-flagger: missing fields render unknown, never 0', () => {
    const out = riskFlagger({}, esc);
    assert.ok(!/>0%?</.test(out.html), 'no fabricated zero');
    assert.ok((out.html.match(/unknown/g) || []).length >= 6);
    assert.equal(out.badge, 'coverage unknown');
    assert.equal(out.badgeBad, true);
});

test('risk-flagger: 0% effective coverage says it may be a failed query', () => {
    const out = riskFlagger({ effective_coverage_pct: 0, gate_recommendation: 'investigate' }, esc);
    assert.match(out.html, /0\.0%/);
    assert.match(out.html, /coverage query failed/);
    assert.equal(out.badgeBad, true);
});

test('risk-flagger: empty samples with a positive high count do not claim there are none', () => {
    const out = riskFlagger({ effective_coverage_pct: 60, high_severity_count: 4, high_severity_samples: [] }, esc);
    assert.match(out.html, /No high-severity samples returned; this can mean no matching rows or a failed sample query/);
    assert.ok(!/No high-severity flag/.test(out.html));
});

test('risk-flagger: empty eligible universe renders raw coverage as no data, not 0.0%', () => {
    const out = riskFlagger({ total_latest: 0, evaluated: 0, pct_coverage: 0, effective_coverage_pct: 55 }, esc);
    const raw = out.html.split('Raw is_latest coverage')[1].split('</div>')[1];
    assert.match(raw, /no data/);
    assert.ok(!/0\.0%/.test(raw));
});

test('risk-flagger: ticker, reason and recommendation are escaped', () => {
    const out = riskFlagger({
        effective_coverage_pct: 10, gate_recommendation: EVIL, gate_recommendation_reason: EVIL,
        high_severity_samples: [{ ticker: EVIL }],
    }, esc);
    assert.ok(!out.html.includes('<img'), out.html);
});

// ── curated picks ────────────────────────────────────────────────────────────

const PICK = {
    source: 'llm_premium', horizon_sessions: 20, n: 96, mean_forward_pct: 0.88, mean_excess_pct: -0.31,
    hit_rate_pct: 55.2, beat_spy_rate_pct: 0, median_forward_pct: 0, first_pick_date: '2026-09-02',
    last_pick_date: '2026-10-27',
};

test('curated-picks: one row per (source, horizon) in the order received', () => {
    const out = curatedPicks({ scorecard: [PICK, Object.assign({}, PICK, { source: 'quant', n: 4 })] }, esc);
    assert.ok(out.html.indexOf('LLM premium') < out.html.indexOf('Quant'));
    assert.match(out.html, /20 sessions/);
    assert.match(out.html, /\+0\.88%/);
    assert.match(out.html, /-0\.31%/);
    assert.match(out.html, /0\.0%/, 'a real 0% beat-SPY rate is shown, not hidden');
    assert.match(out.html, /2026-09-02 → 2026-10-27/);
    assert.equal(out.badge, '100 graded rows');
    assert.equal(out.badgeBad, false);
});

for (const body of [{ scorecard: null }, { scorecard: [] }, {}, null]) {
    test(`curated-picks: empty (${JSON.stringify(body)}) says it cannot tell no-grades from a failed query`, () => {
        const out = curatedPicks(body, esc);
        assert.match(out.html, /query failed/);
        assert.match(out.html, /Not a score of zero/);
        assert.ok(!/<table/.test(out.html));
        assert.equal(out.badgeBad, true);
    });
}

test('curated-picks: a row with no count makes the badge total unknown, never an understated sum', () => {
    const out = curatedPicks({ scorecard: [PICK, { source: 'quant' }] }, esc);
    assert.equal(out.badge, 'graded count unknown');
    assert.equal(out.badgeBad, true);
});

test('curated-picks: missing numbers are unknown, and source is escaped', () => {
    const out = curatedPicks({ scorecard: [{ source: EVIL }] }, esc);
    assert.equal(out.badge, 'graded count unknown');
    assert.ok(!out.html.includes('<img'));
    assert.ok((out.html.match(/unknown/g) || []).length >= 7);
});

// ── tripwire ─────────────────────────────────────────────────────────────────

const CELL = {
    prompt_version: 'tripwire_copy_v2', event_type: 'stop_breach', fires: 38, decided: 38, gate_passed: 30,
    pushed: 21, grounding_n: 21, grounded_pct: 95.2, precision_pct: 66.7, recall_pct: null, veto_pct: 0,
    fallback_pct: null, counterfactual_warranted_pct: null, mean_fwd_pct: -1.9,
    first_fire: '2026-09-12', last_fire: '2026-11-02',
};

test('tripwire: null rates are "no data", a real 0 stays 0', () => {
    const out = tripwire({ grader_version: 'tripwire_grader_v1', scorecard: [CELL] }, esc);
    assert.match(out.html, /95\.2%/);
    assert.match(out.html, /66\.7%/);
    assert.match(out.html, />0\.0%</, 'veto 0 rendered');
    assert.equal((out.html.match(/no data/g) || []).length, 3, 'recall, fallback, unshown');
    assert.match(out.html, /-1\.90%/);
    assert.match(out.html, /tripwire_grader_v1/);
    assert.equal(out.badge, '38 fires graded');
});

test('tripwire: pre-gate rows are dimmed as the counterfactual series; unversioned ones are not', () => {
    const out = tripwire({
        grader_version: 'v',
        scorecard: [Object.assign({}, CELL, { prompt_version: 'pre-gate' }), Object.assign({}, CELL, { prompt_version: 'unversioned' })],
    }, esc);
    assert.equal((out.html.match(/ao-row-dormant/g) || []).length, 1);
});

test('tripwire: empty scorecard names the grader version and is not a zero', () => {
    const out = tripwire({ grader_version: 'tripwire_grader_v1', scorecard: [] }, esc);
    assert.match(out.html, /No grades for grader version <code>tripwire_grader_v1<\/code>/);
    assert.match(out.html, /Not a score of zero/);
    assert.equal(out.badgeBad, true);
    assert.match(tripwire({}, esc).html, /grader version <span class="ao-unknown-val">unknown/);
});

test('tripwire: a cell with no fire count makes the badge total unknown', () => {
    const out = tripwire({ grader_version: 'v', scorecard: [CELL, Object.assign({}, CELL, { fires: undefined })] }, esc);
    assert.equal(out.badge, 'fire count unknown');
    assert.equal(out.badgeBad, true);
});

test('tripwire: version, prompt and event type are escaped', () => {
    const out = tripwire({ grader_version: EVIL, scorecard: [Object.assign({}, CELL, { prompt_version: EVIL, event_type: EVIL })] }, esc);
    assert.ok(!out.html.includes('<img'));
});
