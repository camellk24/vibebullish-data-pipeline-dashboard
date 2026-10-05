// Pure formatting helpers for the Data Collector tab's ticker_fundamentals
// coverage (whole-table bars + the by-population breakdown).
//
// Why the breakdown exists: the card's bars divide by every stored row
// (warrants, dead tickers, sub-$1B names), so they read far lower than
// coverage over the names the rank universe actually uses — and they cannot
// see scored tickers that have no fundamentals row at all. The backend's
// coverage_tiers splits both out (2026-09-29 analysis, Astra-approved).
//
// No DOM dependency: every function takes an `esc` function and returns
// strings, so js/fundamentals-coverage-format.test.js runs it under node:test.
// UMD-lite like dq-readiness-format.js: window.FundCoverageFormat in the
// browser, module.exports under node.

(function () {
    'use strict';

    const SHORT = {
        market_cap: 'mcap', pe_ratio: 'P/E', ps_ratio: 'P/S', pb_ratio: 'P/B',
        ev_ebitda: 'EV/EBITDA', roe: 'ROE', roa: 'ROA', revenue: 'Rev', free_float_pct: 'Float',
    };

    function covColor(pct) {
        return pct > 80 ? '#00E5A0' : pct > 50 ? '#FBBF24' : '#FF4560';
    }

    // Every coverage entry, in the backend's fixed order when it sends one
    // (a JSON map has no order), then any keys the order does not name.
    // Never truncates: the old slice(0, 6) silently hid roe/roa/revenue.
    function coverageEntries(nullCoverage, order) {
        if (!nullCoverage) return [];
        const out = [];
        const seen = {};
        (order || []).forEach(k => {
            if (Object.prototype.hasOwnProperty.call(nullCoverage, k)) {
                out.push([k, nullCoverage[k]]);
                seen[k] = true;
            }
        });
        Object.keys(nullCoverage).forEach(k => {
            if (!seen[k]) out.push([k, nullCoverage[k]]);
        });
        return out;
    }

    // Numeric fields are coerced before any formatting (same rule as
    // VBReads.num on the rest of the page): a non-finite or non-numeric value
    // renders as a dash / nothing, never as markup or a thrown TypeError.
    function fin(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
        return Number.isFinite(n) ? n : null;
    }

    function fmtInt(v) {
        const n = fin(v);
        return n === null ? '—' : n.toLocaleString('en-US');
    }

    function fmtAge(v) {
        const h = fin(v);
        if (h === null || !(h > 0)) return '';
        return h >= 48 ? Math.round(h / 24) + 'd' : h.toFixed(1) + 'h';
    }

    const TD = 'padding:0.3rem 0.35rem;text-align:right;font-family:\'JetBrains Mono\',monospace';

    // One row per population. Market cap in the rank universe is 100% by
    // construction (it is the admission test), so it renders as "req." rather
    // than a misleading green 100%.
    function tiersTableHTML(cov, order, esc) {
        if (!cov || !cov.tiers || !cov.tiers.length) return '';
        const cols = (order && order.length) ? order : Object.keys(SHORT);
        let h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;white-space:nowrap;font-size:0.78rem">' +
            '<thead><tr style="color:#8a8a9e;border-bottom:1px solid rgba(255,255,255,0.08)">' +
            '<th style="text-align:left;padding:0.3rem 0.45rem">Population</th>' +
            '<th style="text-align:right;padding:0.3rem 0.45rem">Tickers</th>';
        cols.forEach(c => {
            h += '<th style="text-align:right;padding:0.3rem 0.45rem">' + esc(SHORT[c] || c) + '</th>';
        });
        h += '<th style="text-align:right;padding:0.3rem 0.45rem" title="Fundamentals rows whose updated_at is older than 7 days (row-write age, not source freshness). Hover a cell for the stalest row.">Rows &gt;7d</th>' +
            '<th style="text-align:right;padding:0.3rem 0.45rem" title="Latest 60d decision older than 7 / 30 days">Dec &gt;7d/30d</th>' +
            '<th style="text-align:right;padding:0.3rem 0.45rem" title="In the no-coverage ledger (an attempt ended without a fundamentals write — includes fallback errors, so not proof that every source had no data); attempted in the last 30 days in brackets">Ledger</th>' +
            '</tr></thead><tbody>';
        cov.tiers.forEach(t => {
            const admitted = t.key === 'admitted';
            h += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)' + (admitted ? ';background:rgba(0,229,160,0.04)' : '') + '">' +
                '<td style="padding:0.3rem 0.45rem;' + (admitted ? 'font-weight:600' : 'color:#c8c8d4') + '" title="' + esc(t.key) + '">' + esc(t.label || t.key) + '</td>' +
                '<td style="' + TD + '">' + fmtInt(t.tickers) + '</td>';
            cols.forEach(c => {
                if (!t.coverage) {
                    h += '<td style="' + TD + ';color:#555">—</td>';
                } else if (admitted && c === 'market_cap') {
                    h += '<td style="' + TD + ';color:#8a8a9e" title="Required for inclusion: the rank universe is defined by market_cap ≥ $1B">req.</td>';
                } else {
                    const raw = t.coverage[c];
                    const p = raw === undefined ? 0 : fin(raw);
                    const show = fin(t.tickers) > 0 && p !== null;
                    h += '<td style="' + TD + ';color:' + (show ? covColor(p) : '#555') + '">' + (show ? p.toFixed(0) + '%' : '—') + '</td>';
                }
            });
            const stalest = t.stalest_ticker ? ' title="Stalest: ' + esc(t.stalest_ticker) + ' (' + fmtAge(t.stalest_age_hours) + ')"' : '';
            h += '<td style="' + TD + ';color:#8a8a9e"' + stalest + '>' + (t.coverage ? fmtInt(t.rows_older_7d) : '—') + '</td>';
            h += '<td style="' + TD + ';color:#8a8a9e">' + (t.decisions_older_7d == null ? '—' : fmtInt(t.decisions_older_7d) + '/' + fmtInt(t.decisions_older_30d)) + '</td>';
            h += '<td style="' + TD + ';color:#8a8a9e">' + fmtInt(t.no_coverage_ledger) + ' <span style="color:#666">(' + fmtInt(t.no_coverage_ledger_30d) + ')</span></td>';
            h += '</tr>';
        });
        return h + '</tbody></table></div>';
    }

    // Descriptive only — which rank-universe rows lack P/E, by EPS sign and
    // source. No causal label: NULL P/E alone does not say why.
    function peBreakdownLine(rows, esc) {
        if (!rows || !rows.length) return '';
        const parts = rows.map(r =>
            'P/E ' + esc(r.pe) + ' · EPS ' + esc(r.eps) + ' · ' + esc(r.source) + ': <b>' + fmtInt(r.n) + '</b>');
        return '<div style="color:#8a8a9e;font-size:0.75rem;margin-top:8px;line-height:1.6">' +
            '<span style="color:#c8c8d4">Rank universe P/E × EPS × source</span> — ' + parts.join(' &nbsp;|&nbsp; ') + '</div>';
    }

    // Full scored-set decision ages (the per-tier rows sum to these).
    function scoredDecisionAgesLine(cov) {
        if (!cov || cov.scored_decisions_older_7d == null) return '';
        return '<div style="color:#8a8a9e;font-size:0.75rem;margin-top:6px">All scored tickers: decisions &gt;7d: ' +
            fmtInt(cov.scored_decisions_older_7d) + '; decisions &gt;30d: ' + fmtInt(cov.scored_decisions_older_30d) + '</div>';
    }

    const FundCoverageFormat = { coverageEntries, tiersTableHTML, peBreakdownLine, scoredDecisionAgesLine, covColor };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FundCoverageFormat;
    }
    if (typeof window !== 'undefined') {
        window.FundCoverageFormat = FundCoverageFormat;
    }
})();
