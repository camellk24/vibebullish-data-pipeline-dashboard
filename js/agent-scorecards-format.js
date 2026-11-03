// Pure render helpers for the Agents tab's scorecard card: the three grades
// the backend already computes for agent roles (2.0 plan §4G tab map, Agents
// row: "risk-flagger-stats, curated-picks-scorecard, tripwire-scorecard
// (surface)"). Each reaches the browser through GET /api/agent-ops?view=…
// (api/agent-ops.js → the admin-verified proxy, internal token server-side).
//
// Payload shapes, from the backend handlers on main:
//   risk-flagger   internal/api/handlers/risk_flagger_stats_handler.go  riskFlaggerStatsResponse
//   curated-picks  {scorecard: [CuratedPickerScore] | null}             services/curated_picks_grader.go
//   tripwire       {grader_version, scorecard: [TripwireScorecardCell] | null} services/tripwire_grader.go
//
// Same honesty rule as the rest of the tab: a value we do not have renders as
// "unknown", a percentage with an empty denominator as "no data", and an empty
// scorecard says what it can and cannot mean. None of them is ever a 0 or a
// blank. Where the backend cannot tell "no rows" from "query failed" (the
// curated-picks scorecard returns an empty list for both; the risk-flagger's
// effective coverage reads 0 when its query fails), the card says so.
//
// No DOM dependency: every function takes `esc` and returns strings, so
// js/agent-ops.js renders with it in the browser and
// js/agent-scorecards-format.test.js runs it under node:test.

(function () {
    'use strict';

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    const UNKNOWN = '<span class="ao-unknown-val">unknown</span>';
    const NO_DATA = '<span class="ao-unknown-val" title="No rows in this cell’s denominator">no data</span>';

    function int(v) {
        return isNum(v) ? Math.round(v).toLocaleString('en-US') : null;
    }

    function pct(v, digits) {
        return isNum(v) ? v.toFixed(digits === undefined ? 1 : digits) + '%' : null;
    }

    function signedPct(v) {
        return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : null;
    }

    // A td for a number we may not have. `missing` is the markup used when absent.
    function cell(text, esc, missing, cls) {
        const c = cls ? ` ${cls}` : '';
        if (text === null) return `<td class="r ao-unknown-cell${c}">${missing || UNKNOWN}</td>`;
        return `<td class="r${c}">${esc(text)}</td>`;
    }

    function signCls(v) {
        return isNum(v) ? (v > 0 ? 'ao-val-good' : v < 0 ? 'ao-val-bad' : '') : '';
    }

    function range(first, last, esc) {
        if (!first && !last) return UNKNOWN;
        return esc(first || '?') + ' → ' + esc(last || '?');
    }

    function metric(label, valueHtml, sub, cls) {
        return `
            <div class="ao-sc-metric">
                <div class="metric-label">${label}</div>
                <div class="ao-sc-value ${cls || ''}">${valueHtml}</div>
                ${sub ? `<div class="metric-sub">${sub}</div>` : ''}
            </div>`;
    }

    // ── risk flagger ────────────────────────────────────────────────────────

    const RECO = { flip: 'ao-val-good', wait: 'ao-val-warn', investigate: 'ao-val-bad' };

    function riskFlagger(body, esc) {
        const b = body && typeof body === 'object' ? body : {};
        const eff = b.effective_coverage_pct;
        const evaluated = int(b.evaluated);
        const total = int(b.total_latest);
        const metrics = [
            metric(
                'Effective coverage',
                isNum(eff) ? esc(pct(eff)) : UNKNOWN,
                'swept top-N union with a flag in the last 24h — what the buy gate sees' +
                    (isNum(eff) && eff === 0 ? '. 0% can also mean the coverage query failed (the backend reports both as 0)' : ''),
                isNum(eff) ? (eff >= 80 ? 'ao-val-good' : eff >= 50 ? 'ao-val-warn' : 'ao-val-bad') : ''
            ),
            metric(
                'Raw is_latest coverage',
                isNum(b.pct_coverage) ? esc(pct(b.pct_coverage)) : UNKNOWN,
                (evaluated !== null && total !== null ? `${esc(evaluated)} of ${esc(total)} latest rows evaluated · ` : '') +
                    'low by design (the hourly roll orphans flags)'
            ),
            metric('Rows with flags', int(b.with_flags) !== null ? esc(int(b.with_flags)) : UNKNOWN),
            metric(
                'Severity high / med / low',
                [b.high_severity_count, b.medium_severity_count, b.low_severity_count]
                    .map((v) => (int(v) !== null ? esc(int(v)) : UNKNOWN))
                    .join(' / ')
            ),
        ].join('');

        const reco = typeof b.gate_recommendation === 'string' ? b.gate_recommendation : '';
        const recoHtml = reco
            ? `<div class="ao-sc-note"><span class="ao-sc-tag ${RECO[reco] || ''}">${esc(reco)}</span>
                 ${esc(b.gate_recommendation_reason || '')}
                 <span class="ao-dimnote">— the backend’s fixed coverage heuristic, not an authorization.</span></div>`
            : `<div class="ao-sc-note">${UNKNOWN} gate heuristic not reported.</div>`;

        const samples = asArray(b.high_severity_samples);
        const sampleHtml = samples.length
            ? `<div class="ao-sc-note">Latest high-severity bullish rows: ${samples
                  .map((s) => `<code>${esc(s && s.ticker)}</code>`)
                  .join(' ')}</div>`
            : `<div class="ao-sc-note ao-dimnote">No high-severity flag on a bullish latest row.</div>`;

        return {
            html: `<div class="ao-sc-metrics">${metrics}</div>${recoHtml}${sampleHtml}`,
            badge: isNum(eff) ? `effective ${pct(eff)}` : 'coverage unknown',
            badgeBad: !isNum(eff) || eff < 50,
        };
    }

    // ── curated picks ───────────────────────────────────────────────────────

    const SOURCE_LABEL = { quant: 'Quant', llm: 'LLM', llm_premium: 'LLM premium' };

    function curatedPicks(body, esc) {
        const rows = asArray(body && body.scorecard);
        if (!rows.length) {
            return {
                html: `<div class="ao-empty">No graded picks. Either nothing has matured and been graded yet, or the scorecard query failed — the backend returns the same empty list for both. Not a score of zero.</div>`,
                badge: 'no grades',
                badgeBad: true,
            };
        }
        const head = `
        <table class="data-table ao-table ao-sc-table">
            <thead><tr>
                <th>Picker</th>
                <th class="r">Horizon</th>
                <th class="r">Graded</th>
                <th class="r">Mean fwd</th>
                <th class="r">Mean vs SPY</th>
                <th class="r">Hit rate</th>
                <th class="r">Beat SPY</th>
                <th class="r">Median fwd</th>
                <th>Picks</th>
            </tr></thead><tbody>`;
        const body2 = rows
            .map((r) => {
                r = r || {};
                const src = r.source;
                return `<tr>
                    <td>${esc(SOURCE_LABEL[src] || src || 'unknown')}</td>
                    ${cell(isNum(r.horizon_sessions) ? r.horizon_sessions + ' sessions' : null, esc)}
                    ${cell(int(r.n), esc)}
                    ${cell(signedPct(r.mean_forward_pct), esc, null, signCls(r.mean_forward_pct))}
                    ${cell(signedPct(r.mean_excess_pct), esc, null, signCls(r.mean_excess_pct))}
                    ${cell(pct(r.hit_rate_pct), esc)}
                    ${cell(pct(r.beat_spy_rate_pct), esc)}
                    ${cell(signedPct(r.median_forward_pct), esc, null, signCls(r.median_forward_pct))}
                    <td class="ao-rel">${range(r.first_pick_date, r.last_pick_date, esc)}</td>
                </tr>`;
            })
            .join('');
        const graded = rows.reduce((a, r) => a + (isNum(r && r.n) ? r.n : 0), 0);
        return {
            html:
                head +
                body2 +
                '</tbody></table>' +
                '<div class="ao-sc-note ao-dimnote">Split-adjusted forward returns of each picker’s logged picks; “vs SPY” is the return minus SPY over the same window. Exploratory — no pre-registered threshold.</div>',
            badge: `${int(graded)} graded rows`,
            badgeBad: false,
        };
    }

    // ── tripwire push copy ──────────────────────────────────────────────────

    function tripwire(body, esc) {
        const b = body && typeof body === 'object' ? body : {};
        const version = typeof b.grader_version === 'string' && b.grader_version ? b.grader_version : null;
        const rows = asArray(b.scorecard);
        const vtxt = version ? `<code>${esc(version)}</code>` : UNKNOWN;
        if (!rows.length) {
            return {
                html: `<div class="ao-empty">No grades for grader version ${vtxt}. Nothing has been graded under this version yet. Not a score of zero.</div>`,
                badge: 'no grades',
                badgeBad: true,
            };
        }
        const head = `
        <table class="data-table ao-table ao-sc-table">
            <thead><tr>
                <th>Prompt</th>
                <th>Event</th>
                <th class="r">Fires</th>
                <th class="r">Pushed</th>
                <th class="r" title="Copy names the ticker, direction words match the event, every figure matches the event row">Grounded</th>
                <th class="r" title="Warranted share of pushes (target held / breach persisted at 5 sessions)">Precision</th>
                <th class="r" title="Pushed share of warranted, gate-passed fires">Recall</th>
                <th class="r" title="LLM said do not notify">Veto</th>
                <th class="r" title="Static copy used instead of the LLM">Fallback</th>
                <th class="r" title="Warranted share of fires nobody was shown (gate suppressed, pre-gate)">Unshown warranted</th>
                <th class="r">Mean fwd</th>
                <th>Fires</th>
            </tr></thead><tbody>`;
        const body2 = rows
            .map((r) => {
                r = r || {};
                const pv = r.prompt_version;
                const pre = pv === 'pre-gate';
                return `<tr${pre ? ' class="ao-row-dormant" title="Fired before decisions were persisted: counterfactual series, never mixed into precision"' : ''}>
                    <td><code>${esc(pv || 'unknown')}</code></td>
                    <td>${esc((r && r.event_type) || 'unknown')}</td>
                    ${cell(int(r.fires), esc)}
                    ${cell(int(r.pushed), esc)}
                    ${cell(pct(r.grounded_pct), esc, NO_DATA)}
                    ${cell(pct(r.precision_pct), esc, NO_DATA)}
                    ${cell(pct(r.recall_pct), esc, NO_DATA)}
                    ${cell(pct(r.veto_pct), esc, NO_DATA)}
                    ${cell(pct(r.fallback_pct), esc, NO_DATA)}
                    ${cell(pct(r.counterfactual_warranted_pct), esc, NO_DATA)}
                    ${cell(signedPct(r.mean_fwd_pct), esc, NO_DATA, signCls(r.mean_fwd_pct))}
                    <td class="ao-rel">${range(r.first_fire, r.last_fire, esc)}</td>
                </tr>`;
            })
            .join('');
        const fires = rows.reduce((a, r) => a + (isNum(r && r.fires) ? r.fires : 0), 0);
        return {
            html:
                head +
                body2 +
                '</tbody></table>' +
                `<div class="ao-sc-note ao-dimnote">Grader ${vtxt}. Grounding grades the LLM-written copy; precision and recall grade the decision at 5 complete sessions. Dimmed rows (<code>pre-gate</code>: fired before decisions were persisted) are the counterfactual series.</div>`,
            badge: `${int(fires)} fires graded`,
            badgeBad: false,
        };
    }

    const AgentScorecardsFormat = { riskFlagger, curatedPicks, tripwire };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AgentScorecardsFormat;
    }
    if (typeof window !== 'undefined') {
        window.AgentScorecardsFormat = AgentScorecardsFormat;
    }
})();
