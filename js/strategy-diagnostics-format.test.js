'use strict';

// Render coverage for the Strategies tab's book diagnostics card.
// The payload shape (field names, nesting, which fields are omitted vs null)
// was taken from the first production read of
// GET /api/internal/ops/strategy-diagnostics on 2026-10-13 (backend df15cb43).
// The NUMBERS below are illustrative, not that read's values.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, corrCell, money } = require('./strategy-diagnostics-format.js');

// Same attribute-safe escaper as ops-console.js's esc().
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function book(id, label, over) {
    return Object.assign({
        book_id: id, label, engine: 'legacy', strategy_release_id: null,
        presentation: 'diagnostic', registry: 'A21',
        note: 'legacy paper diagnostics — no demonstrated edge (registry A21); not a performance comparison',
        paused: false, first_entry_date: '2026-09-17', latest_session: '2026-10-12',
        sessions_observed: 17, excluded_non_paper_rows: 0,
        turnover: {
            window_sessions: 18, window_start: '2026-09-17', window_end: '2026-10-12',
            buys_usd: 20000, sells_usd: 12000, avg_equity_usd: 10000,
            entries_to_equity: 2.0, turnover_one_way: 1.2, annualized_one_way: null,
            basis: 'paper', state: 'partial_window',
        },
        capacity: {
            positions: 18, positions_with_adv: 18, top_position_pct: 5.25,
            max_participation: 0.00004, median_participation: 0.000003,
            binding_ticker: 'AAA', capacity_usd: 2500000, participation: 0.01, state: 'observed',
        },
    }, over || {});
}

function pair(a, b, over) {
    return Object.assign({
        a, b, n: 17, window_start: '2026-09-18', window_end: '2026-10-12',
        raw: 0.9, raw_ci95: [0.7, 0.96], residual: 0.8, residual_ci95: [0.5, 0.93],
        dropped_misaligned: 0, state: 'insufficient',
    }, over || {});
}

function payload(over) {
    return Object.assign({
        generated_at: '2026-10-13T19:45:30Z', cache_ttl_seconds: 60,
        status: 'DIAGNOSTIC', degraded: false,
        note: 'Diagnostics, not verdicts.',
        params: { corr_window_sessions: 60, corr_min_sessions: 30, corr_floor_sessions: 10,
            turnover_window_sessions: 20, capacity_participation: 0.01, adv_max_age_days: 10, benchmark: 'SPY' },
        books: [book(57, 'pure_quant'), book(60, 'pure_quant@trailing')],
        correlation: {
            pairs: [pair(57, 60)],
            cap: { state: 'policy_pending', detail: 'no correlation cap is registered' },
        },
    }, over || {});
}

// ── order: as received, never sorted by a number ───────────────────────────

test('books and pairs render in the order received, not sorted by id or value', () => {
    const p = payload({
        books: [book(62, 'trailing_v2@1'), book(57, 'pure_quant'), book(60, 'pure_quant@trailing')],
        correlation: {
            pairs: [pair(60, 62, { raw: 0.1 }), pair(57, 62, { raw: 0.99 }), pair(57, 60, { raw: 0.5 })],
            cap: { state: 'policy_pending' },
        },
    });
    const html = render(p, esc).html;
    const bookIdx = ['trailing_v2@1', 'pure_quant</strong>', 'pure_quant@trailing'].map(s => html.indexOf(s));
    assert.ok(bookIdx.every(i => i >= 0), 'every book rendered');
    assert.deepEqual([...bookIdx].sort((x, y) => x - y), bookIdx, 'books keep received order');
    const pairIdx = ['0.10', '0.99', '0.50'].map(s => html.indexOf(`>${s} `));
    assert.ok(pairIdx.every(i => i >= 0), 'every pair rendered');
    assert.deepEqual([...pairIdx].sort((x, y) => x - y), pairIdx, 'pairs keep received order');
});

// ── correlation: n and interval beside every estimate; insufficient greyed ─

test('every correlation shows n and its interval; an insufficient pair is greyed', () => {
    const html = render(payload(), esc).html;
    assert.match(html, /<tr class="sd-grey">/);
    assert.match(html, />17</, 'n is shown');
    assert.match(html, /0\.90 <span class="sd-ci">\[0\.70, 0\.96\]<\/span>/);
    assert.match(html, /0\.80 <span class="sd-ci">\[0\.50, 0\.93\]<\/span>/);
});

test('an observed pair is not greyed', () => {
    const html = render(payload({
        correlation: { pairs: [pair(57, 60, { n: 45, state: 'observed' })], cap: { state: 'policy_pending' } },
    }), esc).html;
    assert.doesNotMatch(html, /sd-grey/);
});

test('too_few and zero_variance pairs say why there is no estimate, never a number', () => {
    const html = render(payload({
        correlation: {
            pairs: [
                pair(57, 60, { n: 7, raw: null, raw_ci95: null, residual: null, residual_ci95: null, state: 'too_few' }),
                pair(57, 61, { raw: null, raw_ci95: null, residual: null, residual_ci95: null, state: 'zero_variance' }),
            ],
            cap: { state: 'policy_pending' },
        },
    }), esc).html;
    assert.match(html, /no estimate \(too few sessions\)/);
    assert.match(html, /no estimate \(constant returns\)/);
    assert.doesNotMatch(html, /0\.00/);
});

test('residual null beside a raw estimate renders "unknown", never 0', () => {
    const html = render(payload({
        correlation: { pairs: [pair(57, 60, { residual: null, residual_ci95: null })], cap: { state: 'policy_pending' } },
    }), esc).html;
    assert.match(html, /0\.90 <span class="sd-ci">/);
    assert.match(html, /class="ops-unknown"[^>]*>unknown</);
    assert.doesNotMatch(html, /0\.00/);
});

test('an UNKNOWN pair (unreadable book) shows unknown n and unknown dropped count, never 0', () => {
    const html = render(payload({
        correlation: {
            pairs: [pair(57, 60, { n: null, raw: null, raw_ci95: null, residual: null, residual_ci95: null,
                dropped_misaligned: null, state: 'UNKNOWN' })],
            cap: { state: 'policy_pending' },
        },
    }), esc).html;
    const row = html.slice(html.indexOf('<tbody>', html.indexOf('sd-pairs')));
    assert.equal((row.match(/>unknown</g) || []).length >= 4, true, 'n, raw, residual, dropped all unknown');
    assert.doesNotMatch(row, />0</);
});

test('a real zero dropped_misaligned renders 0 (zero is a value, not a null)', () => {
    const html = render(payload(), esc).html;
    assert.match(html, /<td class="r">0<\/td>/);
});

test('corrCell at r = 1 renders the point interval', () => {
    assert.equal(corrCell(1, [1, 1], esc), '1.00 <span class="sd-ci">[1.00, 1.00]</span>');
});

// ── books: null is unknown with the book's error; A21 note; turnover; capacity

test('a book whose reads failed renders unknown with its error, never 0 or $0', () => {
    const html = render(payload({
        degraded: true,
        books: [book(57, 'pure_quant', {
            sessions_observed: null, excluded_non_paper_rows: null, turnover: null, capacity: null,
            errors: ['equity read: connection reset'],
        })],
        correlation: { pairs: [], cap: { state: 'policy_pending' } },
    }), esc);
    assert.match(html.html, /equity read: connection reset/);
    assert.match(html.html, /title="equity read: connection reset">unknown</);
    assert.doesNotMatch(html.html, /\$0|>0</);
    assert.equal(html.badgeBad, true, 'degraded marks the badge');
    assert.match(html.html, /degraded/);
});

test('a diagnostic book shows its A21 note and a diagnostic chip', () => {
    const html = render(payload(), esc).html;
    assert.match(html, /no demonstrated edge \(registry A21\)/);
    assert.match(html, /diagnostic · A21/);
});

test('turnover is labelled with its basis and shows no annualised figure on a partial window', () => {
    const html = render(payload(), esc).html;
    assert.match(html, /1\.20× one-way/);
    assert.match(html, /paper · 18 sessions · partial_window/);
    assert.doesNotMatch(html, /×\/yr/);
});

test('turnover shows the annualised figure when present', () => {
    const b = book(57, 'pure_quant');
    b.turnover = Object.assign({}, b.turnover, { window_sessions: 20, annualized_one_way: 15.12, state: 'observed' });
    const html = render(payload({ books: [b] }), esc).html;
    assert.match(html, /15\.1×\/yr/);
});

test('capacity shows the figure with its assumption beside it', () => {
    const html = render(payload(), esc).html;
    assert.match(html, /\$2\.50M/);
    assert.match(html, /at 1% of 30-day ADV, one session/);
    assert.match(html, /top 5\.3% \(cost basis\)/);
    assert.match(html, /binding AAA/);
});

test('partial_adv capacity names the missing tickers and gives no figure', () => {
    const b = book(57, 'pure_quant');
    b.capacity = Object.assign({}, b.capacity, {
        positions_with_adv: 16, missing_adv: ['APGE', 'CRNX'], capacity_usd: null, state: 'partial_adv',
    });
    const html = render(payload({ books: [b] }), esc).html;
    assert.match(html, /no figure: ADV missing for APGE, CRNX/);
    assert.match(html, /16 of 18 positions with ADV/);
    assert.doesNotMatch(html, /\$/);
});

test('money(): scales and never invents a value for null', () => {
    assert.equal(money(2429620.27), '$2.43M');
    assert.equal(money(15300), '$15.3k');
    assert.equal(money(950), '$950');
    assert.equal(money(null), null);
    assert.equal(money(NaN), null);
});

// ── header: status, cap state, badge ───────────────────────────────────────

test('header shows status, cap state and detail; badge counts books, pairs and observed pairs', () => {
    const out = render(payload(), esc);
    assert.match(out.html, /ops-chip-unknown">DIAGNOSTIC</);
    assert.match(out.html, /correlation cap: policy_pending — no correlation cap is registered/);
    assert.equal(out.badge, '2 books · 1 pairs · 0 observed');
    assert.equal(out.badgeBad, false);
});

test('generated_at renders as a short UTC minute; an unparseable value is shown as given', () => {
    assert.match(render(payload({ generated_at: '2026-10-13T19:45:30.694355021Z' }), esc).html, /generated 2026-10-13 19:45Z/);
    assert.match(render(payload({ generated_at: 'not-a-date' }), esc).html, /generated not-a-date/);
});

test('a FAIL or UNKNOWN status marks the badge', () => {
    assert.equal(render(payload({ status: 'FAIL' }), esc).badgeBad, true);
    assert.equal(render(payload({ status: 'UNKNOWN' }), esc).badgeBad, true);
});

test('no active books renders an explicit empty line, not an empty table', () => {
    const html = render(payload({ books: [], correlation: { pairs: [], cap: { state: 'policy_pending' } } }), esc).html;
    assert.match(html, /No active paper books\./);
    assert.match(html, /No book pairs\./);
});

// ── escaping ───────────────────────────────────────────────────────────────

test('every backend string is escaped (label, note, errors, tickers, cap detail, state)', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const b = book(57, attack, { note: attack, errors: [attack] });
    b.capacity = Object.assign({}, b.capacity, { binding_ticker: attack, missing_adv: [attack], capacity_usd: null, state: 'partial_adv' });
    b.turnover = Object.assign({}, b.turnover, { basis: attack, state: attack });
    const html = render(payload({
        status: attack, note: attack, generated_at: attack,
        books: [b],
        correlation: { pairs: [pair(57, 57, { state: attack })], cap: { state: attack, detail: attack } },
    }), esc).html;
    assert.doesNotMatch(html, /<img/);
});
