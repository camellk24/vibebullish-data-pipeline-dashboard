// Agent Ops fixture data — DEV ONLY.
//
// This file is never loaded in normal use. js/agent-ops.js injects it lazily
// and only when the page URL carries an explicit ?fixture=... flag:
//
//   ?fixture=1               full roster, every status exercised
//   ?fixture=unreachable     backend down       (502 unreachable)
//   ?fixture=notconfigured   missing env var    (503 not_configured)
//   ?fixture=upstream        backend 401/500    (502 upstream_error)
//   ?fixture=scempty         full roster, every scorecard empty / unknown
//   ?fixture=scerror         full roster, scorecards 502 / 404
//
// The second argument is the scorecard view (risk-flagger | curated-picks |
// tripwire), absent for the roster. Scorecard bodies mirror the backend
// structs named in js/agent-scorecards-format.js; the numbers are illustrative.
//
// Timestamps are computed from Date.now() so the relative-time column stays
// meaningful whenever this is opened.

(function () {
    function ago(seconds) {
        return new Date(Date.now() - seconds * 1000).toISOString();
    }

    // Mirrors the REAL payload of GET /api/internal/agent-ops (backend
    // internal/api/handlers/agent_ops_handler.go agentOpsRole). The first
    // fixture invented its own field names and the tab shipped rendering
    // every live role as "not declared" — change this file only alongside
    // the backend struct.
    function prov(model, prompt, ts, note) {
        return { model_persisted: model, prompt_version_persisted: prompt, timestamp_persisted: ts, note: note };
    }

    function roster() {
        const roles = [
            {
                id: 'risk_flagger_sweep',
                display_name: 'Risk-flagger sweep',
                owner: 'backend',
                kind: 'gate',
                purpose: 'Extracts observable risk events for the top candidates of every risk-flagged strategy; a high-severity flag blocks the autopilot buy.',
                trigger: 'Post-batch, after each scheduled action-engine refresh',
                expected_cadence_seconds: 21600,
                cadence_note: '4×/day on the refresh slots (09:00, 15:30, 18:30, 20:30 UTC).',
                event_driven: false,
                output_tables: ['action_decisions.risk_flags'],
                staleness_threshold_seconds: 86400,
                market_days_only: true,
                graded: false,
                grading_note: 'NOT GRADED. Coverage is measured, precision never has been.',
                verifier: 'None.',
                failure_mode: 'fail-closed',
                failure_note: 'An LLM error leaves risk_flags NULL and the gate admits nothing without a fresh flag.',
                provenance: prov(false, false, false, 'NONE. Only the jsonb array is written.'),
                gates_trades: true,
                lifecycle: 'live',
                lifecycle_note: 'Live since 2026-05-26.',
                observable: true,
                observability_note: 'decided_at is a proxy for the flag write time.',
                status: 'stale',
                last_output_at: ago(26 * 3600),
                outputs_today: 0,
                llm_calls_today: 0,
                failures_today: null,
                quality: {
                    state: 'not_graded',
                    kind: 'coverage',
                    source: 'computed live from action_decisions',
                    reason: 'No precision or recall has ever been computed for risk flags.',
                    metric_name: 'effective_coverage_pct',
                    metric_value: 87.5,
                    as_of: ago(40),
                },
            },
            {
                id: 'catalyst_extractor_news',
                display_name: 'Catalyst extractor — news',
                owner: 'backend',
                kind: 'extractor',
                purpose: 'Turns a clustered news article into a structured catalyst emission.',
                trigger: 'Event-driven: scanner news-cluster discovery',
                expected_cadence_seconds: null,
                cadence_note: 'Event-driven, one call per (headline, ticker) after dedup.',
                event_driven: true,
                output_tables: ['llm_catalyst_emissions'],
                staleness_threshold_seconds: 86400,
                market_days_only: false,
                graded: true,
                grading_note: 'GRADED by the ResolveDue cron against realized closes.',
                verifier: 'Deterministic resolver against daily_bars.',
                failure_mode: 'silent',
                failure_note: 'Errors go to stdout only.',
                provenance: prov(true, false, true, 'Partial: model + extractor_name + emitted_at. No prompt version.'),
                gates_trades: true,
                lifecycle: 'live',
                lifecycle_note: 'Live.',
                observable: true,
                status: 'healthy',
                last_output_at: ago(1900),
                outputs_today: 212,
                llm_calls_today: null,
                failures_today: null,
                quality: {
                    state: 'graded',
                    kind: 'resolution',
                    source: 'llm_catalyst_emissions.directional_hit, resolved by the ResolveDue cron',
                    metric_name: 'directional_hit_rate_pct_90d',
                    metric_value: 48.5,
                    as_of: ago(5 * 86400),
                },
            },
            {
                id: 'catalyst_extractor_8k',
                display_name: 'Catalyst extractor — 8-K',
                owner: 'backend',
                kind: 'extractor',
                purpose: 'Turns a newly matched 8-K filing into a structured catalyst emission.',
                trigger: 'Event-driven: SEC 8-K catalyst source discovery',
                expected_cadence_seconds: null,
                cadence_note: 'Event-driven, tracks the filing tape.',
                event_driven: true,
                output_tables: ['llm_catalyst_emissions'],
                staleness_threshold_seconds: 259200,
                market_days_only: false,
                graded: true,
                grading_note: 'GRADED by the same ResolveDue cron.',
                verifier: 'Deterministic resolver against daily_bars.',
                failure_mode: 'silent',
                failure_note: 'Errors go to stdout only.',
                provenance: prov(true, false, true, 'Partial.'),
                gates_trades: true,
                lifecycle: 'dormant',
                lifecycle_note: 'DORMANT since 2026-05-18 — the poll can never match a same-day filing.',
                observable: true,
                status: 'dormant',
                last_output_at: ago(118 * 86400),
                outputs_today: 0,
                llm_calls_today: 0,
                failures_today: null,
                quality: {
                    state: 'graded',
                    kind: 'resolution',
                    source: 'llm_catalyst_emissions.directional_hit',
                    metric_name: 'directional_hit_rate_pct_90d',
                    metric_value: 71.1,
                    as_of: ago(31 * 86400),
                },
            },
            {
                id: 'tripwire_push_copy',
                display_name: 'Tripwire push copy',
                owner: 'backend',
                kind: 'narrator',
                purpose: 'Writes the push title/body for a fired tripwire.',
                trigger: 'Event-driven: a tripwire fires on a held or watched name',
                expected_cadence_seconds: null,
                cadence_note: 'Event-driven.',
                event_driven: true,
                output_tables: ['tripwire_events.payload'],
                staleness_threshold_seconds: 604800,
                market_days_only: false,
                graded: false,
                grading_note: 'NOT GRADED yet.',
                verifier: 'None yet.',
                failure_mode: 'fail-open',
                failure_note: 'Falls back to static copy.',
                provenance: prov(true, true, true, 'payload.copy carries model, prompt_version and generated_at.'),
                gates_trades: false,
                lifecycle: 'live',
                lifecycle_note: 'Live.',
                observable: true,
                status: 'idle',
                last_output_at: null,
                outputs_today: 0,
                llm_calls_today: 0,
                failures_today: 0,
                quality: { state: 'not_graded', reason: 'Grader not yet written.', metric_value: null, as_of: null },
            },
            {
                id: 'trending_chips_clusterer',
                display_name: 'Trending-chips theme clusterer',
                owner: 'backend',
                kind: 'classifier',
                purpose: 'Clusters recent per-ticker headlines into named search-chip themes.',
                trigger: 'Background cron, market-aware interval',
                expected_cadence_seconds: 1800,
                cadence_note: 'Every 30 min in market hours, every 2h otherwise.',
                event_driven: false,
                output_tables: [],
                staleness_threshold_seconds: 21600,
                market_days_only: false,
                graded: false,
                grading_note: 'NOT GRADED.',
                verifier: 'Parse guard only.',
                failure_mode: 'fail-open',
                failure_note: 'Keeps serving the previous themes.',
                provenance: prov(false, false, true, 'In-memory generatedAt only.'),
                gates_trades: false,
                lifecycle: 'live',
                lifecycle_note: 'Live.',
                observable: false,
                observability_note: 'Output is process memory; status judged on the latest tagged LLM call.',
                status: 'healthy',
                status_basis: 'llm_calls',
                last_llm_call_at: ago(1500),
                last_output_at: null,
                outputs_today: null,
                llm_calls_today: 9,
                failures_today: null,
                quality: { state: 'not_graded', reason: 'Themes are never persisted.', metric_value: null, as_of: null },
            },
            {
                id: 'market_regime_narrator',
                display_name: 'Market-regime narrator',
                owner: 'backend',
                kind: 'narrator',
                purpose: 'Empty-state copy for the regime strip.',
                trigger: 'On demand, memory-cached',
                expected_cadence_seconds: null,
                cadence_note: 'Memory-only cache.',
                event_driven: true,
                output_tables: [],
                staleness_threshold_seconds: null,
                market_days_only: false,
                graded: false,
                grading_note: 'NOT GRADED by design.',
                verifier: 'None.',
                failure_mode: 'fail-open',
                failure_note: 'Static fallback.',
                provenance: prov(false, false, false, 'NONE — nothing is persisted.'),
                gates_trades: false,
                lifecycle: 'live',
                lifecycle_note: 'Live.',
                observable: false,
                observability_note: 'UNOBSERVABLE: memory-only cache, nothing written to the DB.',
                status: 'unknown',
                last_output_at: null,
                outputs_today: null,
                llm_calls_today: null,
                failures_today: null,
                quality: { state: 'not_graded', reason: 'Cosmetic copy; nothing to score against.', metric_value: null, as_of: null },
            },
        ];

        const count = (f) => roles.filter(f).length;
        return {
            generated_at: ago(0),
            cache_ttl_seconds: 60,
            summary: {
                roles_total: roles.length,
                live: count((r) => r.lifecycle === 'live'),
                dormant: count((r) => r.lifecycle !== 'live'),
                healthy: count((r) => r.status === 'healthy'),
                stale: count((r) => r.status === 'stale'),
                idle: count((r) => r.status === 'idle'),
                unknown: count((r) => r.status === 'unknown'),
                graded: count((r) => r.graded),
                ungraded: count((r) => !r.graded),
                ungraded_gaps: 2,
                gating_trades: count((r) => r.gates_trades),
                gating_trades_but_ungraded: count((r) => r.gates_trades && !r.graded),
            },
            roles: roles,
        };
    }

    function scorecard(view) {
        if (view === 'risk-flagger') {
            return {
                total_latest: 1840,
                evaluated: 31,
                pct_coverage: 1.7,
                effective_coverage_pct: 86.4,
                with_flags: 22,
                high_severity_count: 4,
                medium_severity_count: 11,
                low_severity_count: 7,
                high_severity_samples: [
                    { ticker: 'AAA', y_pred_60d: 6.1, flags: [{ severity: 'high', kind: 'dilution' }] },
                    { ticker: 'BBB', y_pred_60d: 3.4, flags: [{ severity: 'high', kind: 'going_concern' }] },
                ],
                gate_recommendation: 'flip',
                gate_recommendation_reason:
                    'effective coverage at 86.4% across the autopilot-eligible universe — safe to enable ENABLE_AUTOPILOT_RISK_GATE',
            };
        }
        if (view === 'curated-picks') {
            const row = (source, h, n, fwd, exc, hit, beat, med) => ({
                source, horizon_sessions: h, n, mean_forward_pct: fwd, mean_excess_pct: exc,
                hit_rate_pct: hit, beat_spy_rate_pct: beat, median_forward_pct: med,
                first_pick_date: '2026-09-02', last_pick_date: '2026-10-27',
            });
            return {
                scorecard: [
                    row('llm', 5, 212, 0.41, -0.12, 52.4, 47.6, 0.22),
                    row('llm_premium', 5, 96, 0.88, 0.31, 55.2, 51.0, 0.47),
                    row('quant', 5, 240, 0.63, 0.05, 53.8, 49.2, 0.3),
                    row('llm', 20, 150, 1.2, -0.6, 54.0, 44.7, 0.9),
                    row('quant', 20, 171, 2.05, 0.4, 58.5, 52.6, 1.6),
                ],
            };
        }
        if (view === 'tripwire') {
            const cell = (pv, ev, o) => Object.assign({
                prompt_version: pv, event_type: ev, fires: 0, decided: 0, gate_passed: 0, pushed: 0,
                grounding_n: 0, grounded_pct: null, precision_pct: null, recall_pct: null, veto_pct: null,
                fallback_pct: null, counterfactual_warranted_pct: null, mean_fwd_pct: null,
                first_fire: '2026-09-12', last_fire: '2026-11-02',
            }, o);
            return {
                grader_version: 'tripwire_grader_v1',
                scorecard: [
                    cell('pre-gate', 'target_hit', { fires: 140, counterfactual_warranted_pct: 61.4, mean_fwd_pct: 0.8, first_fire: '2026-08-01', last_fire: '2026-09-11' }),
                    cell('tripwire_copy_v2', 'stop_breach', { fires: 38, decided: 38, gate_passed: 30, pushed: 21, grounding_n: 21, grounded_pct: 95.2, precision_pct: 66.7, recall_pct: 82.4, veto_pct: 18.4, fallback_pct: 3.3, counterfactual_warranted_pct: 37.5, mean_fwd_pct: -1.9 }),
                    cell('tripwire_copy_v2', 'target_hit', { fires: 54, decided: 54, gate_passed: 49, pushed: 40, grounding_n: 40, grounded_pct: 100, precision_pct: 57.5, recall_pct: 88.5, veto_pct: 11.1, fallback_pct: 0, mean_fwd_pct: 1.2 }),
                ],
            };
        }
        return null;
    }

    window.__AGENT_OPS_FIXTURE__ = function (kind, view) {
        if (view && (kind === '1' || kind === 'scempty' || kind === 'scerror')) {
            if (kind === 'scerror') {
                return view === 'tripwire'
                    ? { __status: 404, body: { error: 'not_found', upstream_status: 404, message: 'Backend returned HTTP 404 for /api/internal/tripwire-scorecard.' } }
                    : { __status: 502, body: { error: 'upstream_error', upstream_status: 503, message: 'Backend returned HTTP 503.' } };
            }
            if (kind === 'scempty') {
                if (view === 'risk-flagger') return { __status: 200, body: { high_severity_samples: [] } };
                if (view === 'curated-picks') return { __status: 200, body: { scorecard: null } };
                return { __status: 200, body: { grader_version: 'tripwire_grader_v1', scorecard: [] } };
            }
            return { __status: 200, body: scorecard(view) };
        }
        if (kind === 'unreachable') {
            return { __status: 502, body: { error: 'unreachable', message: 'Backend is unreachable.' } };
        }
        if (kind === 'notconfigured') {
            return {
                __status: 503,
                body: {
                    error: 'not_configured',
                    message:
                        'INTERNAL_API_TOKEN is not set on this Vercel project. Set it under ' +
                        'Project Settings → Environment Variables (Production only) and redeploy.',
                },
            };
        }
        if (kind === 'upstream') {
            return {
                __status: 502,
                body: {
                    error: 'upstream_error',
                    upstream_status: 401,
                    message: 'Backend returned HTTP 401 for /api/internal/agent-ops.',
                },
            };
        }
        return { __status: 200, body: roster() };
    };
})();
