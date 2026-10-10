// Harness tab fixture data — DEV ONLY.
//
// Never loaded in normal use. js/harness.js injects it lazily, and only when
// the page URL carries an explicit ?fixture=harness… flag:
//
//   ?fixture=harness                 populated board (2 lanes, queue of 3, 1 need, finished, events)
//   ?fixture=harness-empty           the harness has not reported yet (state: null)
//   ?fixture=harness-notconfigured   no Blob store connected (503 not_configured)
//   ?fixture=harness-forbidden       signed in, not an admin (403 forbidden)
//   ?fixture=harness-signedout       signed out (401 unauthenticated)
//   ?fixture=harness-unreachable     Blob store down (502 unreachable)
//
// Bodies mirror GET /api/ops/harness exactly ({state, vetoes, read_at}; the
// state is a schema v1 harness/state.json). Times are relative to Date.now()
// so the "ago" labels stay meaningful whenever this is opened. In fixture
// mode Do next / Skip / Undo edit an in-memory vetoes map — nothing is sent.

(function () {
    const MIN = 60 * 1000;
    const iso = (minsAgo) => new Date(Date.now() - minsAgo * MIN).toISOString();
    const PR = 'https://github.com/camellk24/vibebullish-';

    function populated() {
        const tasks = [
            {
                id: 'backend-517', title: 'Retire the dead v2_reason readers in the feed builder', source: 'backend issue #517',
                repo: 'backend', state: 'reviewing', rank: null, why: null, lane: 'lane-1', risk: 'low', rounds: 2, verdict: 'changes requested',
                pr: PR + 'backend/pull/512', pr_label: null, head: '8f3c2a91d0e4b7c6', started_at: iso(95), engineering_ready_at: null,
                live_at: null, done_at: null, updated_at: iso(4), stop_reason: null, outcome: null,
                summary: 'Astra round 2: asked for a PG-backed test of the empty-reason path. Adding it now.',
            },
            {
                id: 'web-88', title: 'Mobile Lab: keep the rank band legend on one line at 375 px', source: 'web roadmap §4',
                repo: 'web', state: 'deploying', rank: null, why: null, lane: 'lane-2', risk: 'medium', rounds: 1, verdict: 'approved',
                pr: PR + 'web/pull/91', pr_label: 'web #91', head: '27aa04be5531c9d2', started_at: iso(210), engineering_ready_at: iso(48),
                live_at: null, done_at: null, updated_at: iso(2), stop_reason: null, outcome: null,
                summary: 'Merged; waiting for the Vercel production deployment of 27aa04be to be Ready.',
            },
            {
                id: 'pipeline-203', title: 'Pin sqlalchemy and lock the pipeline requirements', source: 'pipeline roadmap P2',
                repo: 'pipeline', state: 'queued', rank: 1, why: 'unbounded range broke a rebuild', lane: null, risk: null, rounds: 0,
                updated_at: iso(300),
            },
            {
                id: 'dashboard-31', title: 'Heartbeats: show the routine owner next to each row', source: 'dashboard issue #31',
                repo: 'dashboard', state: 'queued', rank: 2, why: 'owner asked 10-07', lane: null, risk: null, rounds: 0,
                updated_at: iso(300),
            },
            {
                id: 'backend-529', title: 'Backtester: report fill-price slippage per book', source: 'backend issue #529',
                repo: 'backend', state: 'queued', rank: 3, why: null, lane: null, risk: null, rounds: 0, updated_at: iso(300),
            },
            {
                id: 'docs-410', title: 'Runbook: add the PG-trial log line to backend-start-windows', source: 'docs issue #410',
                repo: 'docs', state: 'done', lane: null, risk: 'low', rounds: 1, verdict: 'approved', pr: PR + 'docs/pull/412',
                started_at: iso(60 * 26), engineering_ready_at: iso(60 * 25.4), live_at: iso(60 * 25), done_at: iso(60 * 25),
                updated_at: iso(60 * 25), outcome: 'merged + published',
            },
            {
                id: 'ios-140', title: 'iOS: compact Action Feed tile — truncate long catalyst names', source: 'ios roadmap',
                repo: 'ios', state: 'done', lane: null, risk: 'medium', rounds: 3, verdict: 'approved', pr: PR + 'ios/pull/140',
                started_at: iso(60 * 50), engineering_ready_at: iso(60 * 46), live_at: iso(60 * 44), done_at: iso(60 * 44),
                updated_at: iso(60 * 44), outcome: null,
            },
            {
                id: 'backend-498', title: 'Drop the unused ticker_analysis migration guard', source: 'backend issue #498',
                repo: 'backend', state: 'done', lane: null, risk: 'low', rounds: 1, verdict: 'approved', pr: PR + 'backend/pull/501',
                started_at: iso(60 * 80), engineering_ready_at: iso(60 * 79.2), live_at: iso(60 * 68), done_at: iso(60 * 68),
                updated_at: iso(60 * 68), outcome: 'merged + verified',
            },
            {
                id: 'pipeline-190', title: 'Move labelling DB calls off the event loop', source: 'pipeline R8',
                repo: 'pipeline', state: 'stopped', lane: null, risk: 'high', rounds: 4, verdict: 'blocked', pr: PR + 'data-pipeline/pull/188',
                started_at: iso(60 * 30), engineering_ready_at: null, done_at: null, updated_at: iso(60 * 27),
                stop_reason: 'Astra blocked 4 rounds running: needs an owner call on the retry budget.',
            },
            {
                id: 'web-77', title: 'Search: fuzzy-match ADR tickers', source: 'web roadmap §6',
                repo: 'web', state: 'vetoed', lane: null, risk: null, rounds: 0, updated_at: iso(60 * 20),
            },
        ];
        const needs = [
            {
                id: 'need-1', question: 'Approve a backend start for #512 after 17:00 PT?', detail: 'Astra approved round 3. The deploy window opens at 17:00 PT; it needs your go per backend-start-windows.',
                kind: 'deploy go', task_id: 'backend-517', since: iso(35), link: PR + 'backend/pull/512', resolved: false,
            },
            { id: 'need-0', question: 'Old resolved question', kind: 'question', since: iso(600), resolved: true },
        ];
        const events = [
            ['deploy', 'web-88', 'Merged web #91; production deployment started.', 2],
            ['review', 'backend-517', 'Astra round 2: changes requested (missing PG-backed test).', 4],
            ['need', 'backend-517', 'Asked the owner for a backend start window.', 35],
            ['ready', 'web-88', 'Engineering ready: tests green, Astra approved round 1.', 48],
            ['build', 'backend-517', 'Started build in lane 1.', 95],
            ['build', 'web-88', 'Started build in lane 2.', 210],
            ['queue', null, 'Filled the queue from the roadmaps: 3 tasks.', 300],
            ['done', 'docs-410', 'Merged + published docs #412.', 60 * 25],
            ['stop', 'pipeline-190', 'Stopped after 4 Astra rounds; moved to Needs you.', 60 * 27],
            ['veto', 'web-77', 'Skipped by the owner.', 60 * 20],
        ].map(([kind, task_id, text, m]) => ({ ts: iso(m), kind, task_id, text }));

        return {
            schema_version: 1,
            status: {
                mode: 'running', heartbeat_at: iso(3), next_tick_at: new Date(Date.now() + 7 * MIN).toISOString(),
                lanes: [{ id: 'lane-1', task_id: 'backend-517' }, { id: 'lane-2', task_id: 'web-88' }],
                deploy_window: { open: false, note: 'Market hours: no backend starts 06:00–17:00 PT.' },
                synced_at: iso(2),
            },
            tasks, needs, events,
        };
    }

    let vetoes = { 'backend-529': { action: 'skip', at: iso(20), by_uid: 'fixture-owner' } };

    window.__HARNESS_FIXTURE__ = function (kind) {
        const readAt = new Date().toISOString();
        switch (kind) {
            case 'harness-empty':
                return { status: 200, body: { state: null, vetoes: {}, read_at: readAt } };
            case 'harness-notconfigured':
                return {
                    status: 503,
                    body: {
                        error: 'not_configured',
                        message:
                            'No Vercel Blob store is connected to this project. Create a PRIVATE Blob store, connect it to ' +
                            'the vibebullish-dashboard project for Production + Preview (this sets BLOB_READ_WRITE_TOKEN, or ' +
                            'BLOB_STORE_ID for OIDC auth), and redeploy.',
                    },
                };
            case 'harness-forbidden':
                return { status: 403, body: { error: 'forbidden', message: 'This Google account is not an admin of VibeBullish.' } };
            case 'harness-signedout':
                return { status: 401, body: { error: 'unauthenticated', message: 'Sign in with an admin Google account to view this panel.' } };
            case 'harness-unreachable':
                return { status: 502, body: { error: 'unreachable', message: 'The Blob store did not answer. Nothing was changed.' } };
            default:
                return { status: 200, body: { state: populated(), vetoes: Object.assign({}, vetoes), read_at: readAt } };
        }
    };

    window.__HARNESS_FIXTURE_VETO__ = function (taskId, action) {
        if (action === 'undo') delete vetoes[taskId];
        else vetoes[taskId] = { action, at: new Date().toISOString(), by_uid: 'fixture-owner' };
        vetoes = Object.assign({}, vetoes);
        return { status: 200, body: { vetoes: Object.assign({}, vetoes), read_at: new Date().toISOString() } };
    };
})();
