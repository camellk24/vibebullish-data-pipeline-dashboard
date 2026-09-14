// Agent Ops fixture data — DEV ONLY.
//
// This file is never loaded in normal use. js/agent-ops.js injects it lazily
// and only when the page URL carries an explicit ?fixture=... flag:
//
//   ?fixture=1               full roster, every status exercised
//   ?fixture=unreachable     backend down       (502 unreachable)
//   ?fixture=notconfigured   missing env var    (503 not_configured)
//   ?fixture=upstream        backend 401/500    (502 upstream_error)
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

    window.__AGENT_OPS_FIXTURE__ = function (kind) {
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
                        'Project Settings → Environment Variables (Production + Preview) and redeploy.',
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
