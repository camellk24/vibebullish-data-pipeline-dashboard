'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { coverageEntries, tiersTableHTML, peBreakdownLine, scoredDecisionAgesLine } = require('./fundamentals-coverage-format.js');

// The production escaper: the page's global esc() is defined in js/reads.js.
const { esc } = require('./reads.js');

const ORDER = ['market_cap', 'pe_ratio', 'ps_ratio', 'pb_ratio', 'ev_ebitda', 'roe', 'roa', 'revenue', 'free_float_pct'];

test('coverageEntries: all nine fields in the backend order, none truncated', () => {
    // Go marshals maps alphabetically — the old slice(0, 6) dropped roe/roa/revenue.
    const nc = { ev_ebitda: 68, free_float_pct: 50, market_cap: 74, pb_ratio: 85, pe_ratio: 45, ps_ratio: 77, revenue: 40, roa: 88, roe: 86 };
    const got = coverageEntries(nc, ORDER);
    assert.deepEqual(got.map(e => e[0]), ORDER);
    assert.equal(got.length, 9);
});

test('coverageEntries: without an order, every key is kept; unknown keys follow the ordered ones', () => {
    assert.equal(coverageEntries({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }).length, 7);
    assert.deepEqual(coverageEntries({ x: 1, pe_ratio: 2 }, ['pe_ratio']).map(e => e[0]), ['pe_ratio', 'x']);
    assert.deepEqual(coverageEntries(null, ORDER), []);
});

const COV = {
    scored_tickers: 12177,
    min_market_cap_usd: 1e9,
    tiers: [
        { key: 'admitted', label: 'Rank universe (≥ $1B)', tickers: 2580,
          coverage: { market_cap: 100, pe_ratio: 77, ps_ratio: 95, pb_ratio: 98.9, ev_ebitda: 93.2, roe: 98.1, roa: 98.1, revenue: 78.5, free_float_pct: 79.4 },
          rows_older_7d: 59, stalest_ticker: 'ABC', stalest_age_hours: 400,
          decisions_older_7d: 33, decisions_older_30d: 27, no_coverage_ledger: 0, no_coverage_ledger_30d: 0 },
        { key: 'scored_no_row', label: 'Scored, no row', tickers: 5894,
          rows_older_7d: 0, decisions_older_7d: 4230, decisions_older_30d: 208, no_coverage_ledger: 5894, no_coverage_ledger_30d: 5894 },
        { key: 'stored_unscored', label: 'Stored, unscored', tickers: 1813,
          coverage: { market_cap: 21.3, pe_ratio: 24.3 }, rows_older_7d: 1527, stalest_ticker: '<W>', stalest_age_hours: 3701,
          no_coverage_ledger: 0, no_coverage_ledger_30d: 0 },
    ],
};

test('tiersTableHTML: rank-universe market cap renders as "req.", not a green 100%', () => {
    const h = tiersTableHTML(COV, ORDER, esc);
    const admittedRow = h.split('<tr').find(r => r.includes('Rank universe'));
    assert.match(admittedRow, />req\.<\/td>/);
    assert.doesNotMatch(admittedRow, />100%</);
    assert.match(admittedRow, />77%</);
    assert.match(admittedRow, /33\/27/);
});

test('tiersTableHTML: the no-row tier shows dashes, its ledger counts, and decision ages', () => {
    const h = tiersTableHTML(COV, ORDER, esc);
    const row = h.split('<tr').find(r => r.includes('Scored, no row'));
    assert.equal((row.match(/>—</g) || []).length, 9 + 1); // nine fields + rows>7d
    assert.match(row, /5,894 <span[^>]*>\(5,894\)/);
    assert.match(row, /4,230\/208/);
});

test('tiersTableHTML: unscored tier has no decision ages; ticker names are escaped; missing fields read 0%', () => {
    const h = tiersTableHTML(COV, ORDER, esc);
    const row = h.split('<tr').find(r => r.includes('Stored, unscored'));
    assert.match(row, /title="Stalest: &lt;W&gt; \(154d\)"/);
    assert.doesNotMatch(row, /<W>/);
    assert.match(row, />0%</); // ps_ratio absent from the map
    assert.match(h, /<th[^>]*>EV\/EBITDA<\/th>/);
});

test('tiersTableHTML / peBreakdownLine: empty input renders nothing', () => {
    assert.equal(tiersTableHTML(null, ORDER, esc), '');
    assert.equal(tiersTableHTML({ tiers: [] }, ORDER, esc), '');
    assert.equal(peBreakdownLine([], esc), '');
});

test('peBreakdownLine: descriptive counts, no causal wording', () => {
    const h = peBreakdownLine([
        { pe: 'null', eps: 'negative', source: 'polygon', n: 465 },
        { pe: 'null', eps: 'null', source: 'finnhub-adr', n: 128 },
    ], esc);
    assert.match(h, /P\/E null · EPS negative · polygon: <b>465<\/b>/);
    assert.match(h, /finnhub-adr: <b>128<\/b>/);
    assert.doesNotMatch(h, /loss|because|expected/i);
});

test('tiersTableHTML: a quote in a ticker cannot break out of the title attribute (production esc)', () => {
    const cov = { tiers: [{ key: 'stored_unscored', label: 'Stored, unscored', tickers: 1, coverage: { market_cap: 0 },
        rows_older_7d: 1, stalest_ticker: 'A" onmouseover="x', stalest_age_hours: 100, no_coverage_ledger: 0, no_coverage_ledger_30d: 0 }] };
    const h = tiersTableHTML(cov, ORDER, esc);
    assert.match(h, /title="Stalest: A&quot; onmouseover=&quot;x \(4d\)"/);
    assert.doesNotMatch(h, /onmouseover="/);
});

test('production esc (reads.js): quotes, ampersands and null', () => {
    assert.equal(esc(`<a href='x'>"&"</a>`), '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
});

test('scoredDecisionAgesLine: full scored-set totals, absent when the backend omits them', () => {
    assert.equal(
        scoredDecisionAgesLine({ scored_decisions_older_7d: 4956, scored_decisions_older_30d: 398 }).replace(/<[^>]+>/g, ''),
        'All scored tickers: decisions &gt;7d: 4,956; decisions &gt;30d: 398');
    assert.equal(scoredDecisionAgesLine({ scored_tickers: 5 }), '');
    assert.equal(scoredDecisionAgesLine(null), '');
});

test('numeric fields are coerced: string numbers format, markup-bearing values never render', () => {
    const cov = { tiers: [{ key: 'scored_below', label: 'Scored, < $1B', tickers: '2996',
        coverage: { market_cap: '100', pe_ratio: '<img src=x onerror=alert(1)>', ps_ratio: 79 },
        rows_older_7d: '1199', stalest_ticker: 'ABCD', stalest_age_hours: '10',
        decisions_older_7d: '<b>x</b>', decisions_older_30d: 102, no_coverage_ledger: null, no_coverage_ledger_30d: 0 }] };
    const h = tiersTableHTML(cov, ORDER, esc);
    assert.match(h, />2,996</);
    assert.match(h, />100%</);
    assert.match(h, /title="Stalest: ABCD \(10\.0h\)"/);
    assert.match(h, />1,199</);
    assert.doesNotMatch(h, /<img|onerror|<b>x/);
    assert.equal(scoredDecisionAgesLine({ scored_decisions_older_7d: '<i>', scored_decisions_older_30d: '398' }).replace(/<[^>]+>/g, ''),
        'All scored tickers: decisions &gt;7d: —; decisions &gt;30d: 398');
});
