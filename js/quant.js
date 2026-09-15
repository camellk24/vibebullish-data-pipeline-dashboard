// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish Quant Quality Dashboard Tab
// ═══════════════════════════════════════════════════════════════════════════

var QUANT_API = API_BASE + '/api/quant/health';
var QUANTILE_REPORT_API = API_BASE + '/api/quantile-report';
var QUANT_RUNS_API = API_BASE + '/api/quant/training-runs?limit=10';
var QUANT_BACKTESTS_API = API_BASE + '/api/quant/backtests?limit=20';
// Live-stats migrated 2026-05-15: was /api/quant/live-stats (read
// lgbm_live_predictions which got retired) → now uses
// /api/action-engine/backtest/stats which reads action_decisions +
// action_resolutions, the canonical price-prediction substrate.
var QUANT_LIVE_STATS_API = API_BASE + '/api/action-engine/backtest/stats?days=30';
var QUANT_LIVE_PREDS_TOP_N = 10;
var quantRefreshTimer = null;

async function refreshQuantHealth() {
    try {
        var r = await fetch(QUANT_API + '?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        renderQuantHero(data);
        renderTrainingMetrics(data);
        renderProbabilityDist(data);
        renderVerdictDist(data);
        renderTopPredictions(data);
    } catch (err) {
        console.error('Quant health fetch failed:', err);
        renderQuantEmpty();
    }
    refreshQuantTrainingRuns();
    refreshQuantBacktests();
    refreshQuantLive();
}

async function refreshQuantLive() {
    try {
        // Stats: one call to /api/action-engine/backtest/stats which returns
        // top-line + by_horizon / by_trigger / by_v2_stance / by_confidence_band /
        // by_action_predicate rollups computed against action_decisions +
        // action_resolutions.
        var statsPromise = fetch(QUANT_LIVE_STATS_API + '&t=' + Date.now())
            .then(function(r) { return r.ok ? r.json() : null; })
            .catch(function() { return null; });
        // Predictions: read recent action_decisions (1d horizon, top-N).
        // The /api/quant/live-predictions endpoint was migrated 2026-05-15
        // to read action_decisions LEFT JOIN action_resolutions; same shape
        // as before with cohort_id always empty (action_decisions doesn't
        // tag cohort).
        var predsPromise = fetch(API_BASE + '/api/quant/live-predictions' +
            '?timeframe=1d&limit=' + QUANT_LIVE_PREDS_TOP_N + '&t=' + Date.now())
            .then(function(r) { return r.ok ? r.json() : { predictions: [] }; })
            .catch(function() { return { predictions: [] }; });

        var results = await Promise.all([statsPromise, predsPromise]);
        renderQuantLiveStats(results[0]);
        renderQuantLivePredictions(results[1].predictions || []);
    } catch (err) {
        console.error('Quant live fetch failed:', err);
        var badge = document.getElementById('quant-live-status');
        if (badge) badge.textContent = 'error';
    }
}

function renderQuantLiveStats(stats) {
    var c = document.getElementById('quant-live-stats');
    if (!c) return;
    var badge = document.getElementById('quant-live-status');

    if (!stats) {
        if (badge) badge.textContent = 'fetch failed';
        c.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem">Could not load action engine backtest stats.</p>';
        return;
    }
    if (badge) {
        badge.textContent = stats.resolved_decisions
            ? (stats.resolved_decisions + ' resolved decisions / ' + stats.total_decisions + ' total · ' + stats.window_days + 'd window')
            : 'no resolved decisions yet (' + stats.window_days + 'd window)';
    }

    function num(v, d) { return v == null ? '—' : Number(v).toFixed(d == null ? 2 : d); }
    function returnCell(v) {
        if (v == null) return '<td class="r">—</td>';
        var color = v > 0 ? '#00E5A0' : (v < 0 ? '#FF4560' : '#8a8a9e');
        return '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + color + '">' + num(v, 2) + '</td>';
    }
    function hitCell(v) {
        if (v == null) return '<td class="r">—</td>';
        var color = v >= 60 ? '#00E5A0' : (v >= 50 ? '#FBBF24' : '#FF4560');
        return '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + color + '">' + num(v, 1) + '</td>';
    }

    // Top-line summary
    var html = '<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;text-align:center">' +
        '<div style="font-size:0.65rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase">Hit %</div>' +
        '<div style="font-size:1.3rem;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:' +
        (stats.overall_hit_pct >= 60 ? '#00E5A0' : stats.overall_hit_pct >= 50 ? '#FBBF24' : '#FF4560') + '">' +
        num(stats.overall_hit_pct, 1) + '</div></div>' +
        '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;text-align:center">' +
        '<div style="font-size:0.65rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase">Avg Return %</div>' +
        '<div style="font-size:1.3rem;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:' +
        (stats.overall_avg_return_pct > 0 ? '#00E5A0' : stats.overall_avg_return_pct < 0 ? '#FF4560' : '#8a8a9e') + '">' +
        num(stats.overall_avg_return_pct, 2) + '</div></div>' +
        '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;text-align:center">' +
        '<div style="font-size:0.65rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase">Coverage %</div>' +
        '<div style="font-size:1.3rem;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' +
        num(stats.resolution_coverage_pct, 1) + '</div></div>' +
        '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;text-align:center">' +
        '<div style="font-size:0.65rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase">Avg PT Error</div>' +
        '<div style="font-size:1.3rem;font-weight:700;font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' +
        num(stats.overall_avg_abs_error_pt, 2) + '</div></div>' +
        '</div>';

    // By-horizon table — closest match to the prior per-timeframe layout.
    var horizons = stats.by_horizon || [];
    html += '<table class="data-table"><thead><tr>' +
        '<th>Horizon</th>' +
        '<th class="r">Decisions</th>' +
        '<th class="r">Resolved</th>' +
        '<th class="r">Hit %</th>' +
        '<th class="r">Avg Return %</th>' +
        '<th class="r">Avg PT Error</th>' +
        '</tr></thead><tbody>';
    if (!horizons.length) {
        html += '<tr><td colspan="6" style="color:#8a8a9e;font-size:0.8rem">no resolved decisions in window yet</td></tr>';
    } else {
        horizons.forEach(function(b) {
            html += '<tr>' +
                '<td style="font-family:\'JetBrains Mono\',monospace">' + qEsc(b.key) + '</td>' +
                '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + b.n_decisions + '</td>' +
                '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + b.n_resolved + '</td>' +
                hitCell(b.hit_pct) +
                returnCell(b.avg_return_pct) +
                '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + num(b.avg_abs_error_pt, 2) + '</td>' +
                '</tr>';
        });
    }
    html += '</tbody></table>';
    c.innerHTML = html;
}

function renderQuantLivePredictions(preds) {
    var c = document.getElementById('quant-live-predictions');
    if (!c) return;
    if (!preds.length) {
        c.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem">No live snapshots yet. POST /lightgbm/snapshot_live to capture today\'s top picks.</p>';
        return;
    }
    // Group by prediction_date, show most recent date's top picks
    var latestDate = preds[0].prediction_date;
    var todayPicks = preds.filter(function(p) { return p.prediction_date === latestDate; });
    var resolved = todayPicks.filter(function(p) { return p.y_true != null; }).length;

    var html = '<div style="font-size:0.85rem;color:#8a8a9e;margin-bottom:0.5rem">' +
        'Latest 1d snapshot: <strong style="color:#fff">' + qEsc(latestDate) + '</strong> · ' +
        todayPicks.length + ' picks · ' + resolved + ' resolved' +
        '</div>';
    html += '<table class="data-table"><thead><tr>' +
        '<th class="r">Rank</th><th>Ticker</th>' +
        '<th class="r">Pred %</th><th class="r">Entry $</th>' +
        '<th>Target Date</th><th class="r">Exit $</th>' +
        '<th class="r">Actual %</th><th>Status</th>' +
        '</tr></thead><tbody>';
    todayPicks.forEach(function(p) {
        var pred = Number(p.y_pred).toFixed(2);
        var entry = Number(p.entry_price).toFixed(2);
        var status = p.y_true == null ? '<span style="color:#FBBF24">pending</span>' : '<span style="color:#00E5A0">resolved</span>';
        var actual = p.y_true == null ? '—' :
            ('<span style="color:' + (p.y_true > 0 ? '#00E5A0' : '#FF4560') + '">' + Number(p.y_true).toFixed(2) + '</span>');
        var exit = p.exit_price == null ? '—' : Number(p.exit_price).toFixed(2);
        html += '<tr>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + p.pred_rank + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace">' + qEsc(p.ticker) + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + pred + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + entry + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.75rem;color:#8a8a9e">' + qEsc(p.target_date) + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + exit + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + actual + '</td>' +
            '<td style="font-size:0.8rem">' + status + '</td>' +
            '</tr>';
    });
    html += '</tbody></table>';
    c.innerHTML = html;
}

async function refreshQuantTrainingRuns() {
    try {
        var r = await fetch(QUANT_RUNS_API + '&t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        renderQuantRuns(data.runs || []);
    } catch (err) {
        console.error('Quant training runs fetch failed:', err);
    }
}

async function refreshQuantBacktests() {
    try {
        var r = await fetch(QUANT_BACKTESTS_API + '&t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        renderQuantBacktests(data.backtests || []);
    } catch (err) {
        console.error('Quant backtests fetch failed:', err);
    }
}

function renderQuantBacktests(rows) {
    var c = document.getElementById('quant-backtests-table');
    if (!c) return;
    var badge = document.getElementById('quant-backtests-count');
    if (badge) badge.textContent = rows.length ? (rows.length + ' runs') : 'none yet';
    c.innerHTML = '';
    if (!rows.length) {
        c.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem">No backtests recorded yet. Hit /lightgbm/backtest to log one.</p>';
        return;
    }

    var t = document.createElement('table');
    t.className = 'data-table';
    t.innerHTML = '<thead><tr>' +
        '<th>Time</th>' +
        '<th>Cohort</th>' +
        '<th>TF</th>' +
        '<th class="r">Top-N</th>' +
        '<th class="r">Cost (bps)</th>' +
        '<th class="r">Periods</th>' +
        '<th class="r">Cum %</th>' +
        '<th class="r">Ann %</th>' +
        '<th class="r">SPY Ann %</th>' +
        '<th class="r">Alpha %</th>' +
        '<th class="r">Sharpe</th>' +
        '<th class="r">Max DD %</th>' +
        '<th class="r">Hit %</th>' +
        '<th>Window</th>' +
        '</tr></thead><tbody></tbody>';
    var tbody = t.querySelector('tbody');

    function num(v, digits) {
        if (v == null) return '—';
        return Number(v).toFixed(digits == null ? 2 : digits);
    }

    function colorCell(v, posGood) {
        if (v == null) return '<td class="r">—</td>';
        var positive = posGood ? v > 0 : v < 0;
        var color = positive ? '#00E5A0' : (v == 0 ? '#8a8a9e' : '#FF4560');
        return '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + color + '">' + num(v, 2) + '</td>';
    }

    function sharpeCell(v) {
        if (v == null) return '<td class="r">—</td>';
        var color = v > 1 ? '#00E5A0' : v > 0 ? '#FBBF24' : '#FF4560';
        return '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + color + '">' + num(v, 2) + '</td>';
    }

    function ago(iso) {
        if (!iso) return '—';
        var sec = (Date.now() - new Date(iso).getTime()) / 1000;
        if (sec < 60) return Math.round(sec) + 's';
        if (sec < 3600) return Math.round(sec / 60) + 'm';
        if (sec < 86400) return Math.round(sec / 3600) + 'h';
        return Math.round(sec / 86400) + 'd';
    }

    rows.forEach(function(b) {
        var window = (b.date_range_start || '?') + ' → ' + (b.date_range_end || '?');
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td title="' + qEsc(b.created_at || '') + '">' + ago(b.created_at) + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.8rem">' + qEsc(b.cohort_id || '') + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.8rem">' + qEsc(b.timeframe || '') + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + (b.top_n != null ? b.top_n : '—') + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + num(b.cost_bps, 1) + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + (b.n_periods != null ? b.n_periods : '—') + '</td>' +
            colorCell(b.cumulative_return_pct, true) +
            colorCell(b.annualized_return_pct, true) +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + num(b.spy_annualized_return_pct, 2) + '</td>' +
            colorCell(b.alpha_annualized_pct, true) +
            sharpeCell(b.sharpe_annualized) +
            colorCell(b.max_drawdown_pct, false) +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + num(b.hit_rate_pct, 1) + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;color:#8a8a9e" title="' + qEsc(window) + '">' + qEsc(window) + '</td>';
        tbody.appendChild(tr);
    });
    c.appendChild(t);
}

function renderQuantRuns(runs) {
    var c = document.getElementById('quant-runs-table');
    if (!c) return;
    var badge = document.getElementById('quant-runs-count');
    if (badge) badge.textContent = runs.length ? (runs.length + ' runs') : 'no runs yet';
    c.innerHTML = '';
    if (!runs.length) {
        c.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem">No training runs recorded yet.</p>';
        return;
    }

    var mono = 'font-family:\'JetBrains Mono\',monospace;';
    var t = document.createElement('table');
    t.className = 'data-table';
    t.innerHTML = '<thead><tr>' +
        '<th>Time</th>' +
        '<th>Run</th>' +
        '<th class="r">Tickers · rows</th>' +
        '<th class="r" title="Mean per-date Spearman rank-IC of 20d predictions vs realized returns on the held-out window">20d IC</th>' +
        '<th class="r" title="60d top-decile mean return minus universe mean, pp — the promote gate">60d top10%</th>' +
        '<th class="r" title="R² on the training target (excess return when label=excess), pooled — magnitude fit, expected ≈0 or negative">R² 1d→60d</th>' +
        '<th class="r">Duration</th>' +
        '<th>Git</th>' +
        '</tr></thead><tbody></tbody>';
    t.querySelectorAll('th').forEach(function(th) { th.style.whiteSpace = 'nowrap'; });
    var tbody = t.querySelector('tbody');

    function hz(m, h) {
        // metrics are keyed "60d" (current) or "60d/long" (legacy)
        if (m[h]) return m[h];
        for (var k in m) {
            if (k.indexOf(h + '/') === 0 && m[k] && typeof m[k] === 'object') return m[k];
        }
        return {};
    }

    function num(v, digits, signed) {
        var s = v.toFixed(digits);
        return signed && v > 0 ? '+' + s : s;
    }

    function signCell(v, digits, goodAbove, suffix, hint) {
        if (v == null) return '<td class="r">—</td>';
        var color = v > goodAbove ? '#00E5A0' : v > 0 ? '#FBBF24' : '#FF4560';
        return '<td class="r" title="' + qEsc(hint || '') + '" style="' + mono + 'color:' + color + '">' +
            num(v, digits, true) + (suffix || '') + '</td>';
    }

    function r2Cell(m) {
        var parts = ['1d', '5d', '20d', '60d'].map(function(h) {
            var v = hz(m, h).r2;
            if (v == null) return '—';
            var f = v.toFixed(2);
            return f === '-0.00' ? '0.00' : f;
        });
        if (parts.every(function(p) { return p === '—'; })) return '<td class="r">—</td>';
        return '<td class="r" style="' + mono + 'font-size:0.75rem;color:#8a8a9e;white-space:nowrap">' +
            parts.join(' ') + '</td>';
    }

    // Classify the run so a dry run or a killed run isn't read as a model
    // regression. status/promoted/cohort come from the backend; notes carry
    // the research-harness tag ("v3-c0-dryrun … not a result").
    function runKind(run) {
        var status = (run.status || '').toLowerCase();
        var notes = (run.notes || '').toLowerCase();
        if (status === 'killed' || status === 'failed') return { label: status.toUpperCase(), color: '#FF4560', dead: true };
        if (status === 'running') return { label: 'RUNNING', color: '#FBBF24' };
        if (run.promoted) return { label: 'PROMOTED', color: '#00E5A0' };
        if (notes.indexOf('dryrun') !== -1 || notes.indexOf('dry-run') !== -1 || notes.indexOf('not a result') !== -1) {
            return { label: 'DRY RUN', color: '#8a8a9e' };
        }
        if (!run.n_rows) return { label: 'NO DATA', color: '#FF4560', dead: true };
        return { label: 'RESEARCH', color: '#8a8a9e' };
    }

    function compactRows(n) {
        if (!n) return '0';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return Math.round(n / 1e3) + 'k';
        return String(n);
    }

    function timeAgo(iso) {
        if (!iso) return '—';
        var t = new Date(iso);
        var sec = (Date.now() - t.getTime()) / 1000;
        if (sec < 60) return Math.round(sec) + 's ago';
        if (sec < 3600) return Math.round(sec / 60) + 'm ago';
        if (sec < 86400) return Math.round(sec / 3600) + 'h ago';
        return Math.round(sec / 86400) + 'd ago';
    }

    runs.forEach(function(run) {
        var m = run.metrics || {};
        var kind = runKind(run);
        var m20 = hz(m, '20d');
        var m60 = hz(m, '60d');
        var dur = !run.duration_s ? '—'
            : run.duration_s < 3600 ? Math.round(run.duration_s / 60) + 'm'
            : (run.duration_s / 3600).toFixed(1) + 'h';
        // Use the n_tickers column (truth — actual count trained on) rather
        // than tickers.length (the persisted JSONB array, which historically
        // stored the hardcoded universe constant rather than the dynamic
        // post-quality-filter list). Hover hint still shows ticker names.
        // A run that never produced rows only carries the requested universe
        // size, so show nothing rather than a misleading count.
        var tickerCount = run.n_tickers != null ? run.n_tickers : (run.tickers || []).length;
        if (kind.dead && !run.n_rows) tickerCount = '—';
        var tickerHint = (run.tickers || []).slice(0, 5).join(', ') +
            ((run.tickers || []).length > 5 ? (', +' + ((run.tickers || []).length - 5) + ' more') : '');
        var sha = (run.git_sha || '').substring(0, 7) || 'unknown';
        var labelMode = run.label_mode || m.label_mode || '';
        var contextParts = [run.cohort_id, run.feature_set || m.feature_set, labelMode]
            .filter(function(x) { return x && x !== 'default' && x !== 'unknown'; });
        // "tradeable_" prefixes every cohort; the full name is in the hover.
        var context = contextParts.map(function(x) { return x.replace(/^tradeable_/, ''); }).join(' · ');
        var runHint = [run.run_id, contextParts.join(' · '), run.error, run.notes].filter(Boolean).join('\n');

        var tr = document.createElement('tr');
        if (kind.dead) tr.style.opacity = '0.55';
        tr.innerHTML =
            '<td title="' + qEsc(run.started_at || '') + '">' + timeAgo(run.started_at) + '</td>' +
            '<td title="' + qEsc(runHint) + '" style="cursor:help;white-space:nowrap">' +
                '<span style="' + mono + 'font-size:0.65rem;letter-spacing:0.05em;padding:1px 6px;border-radius:4px;' +
                'border:1px solid ' + kind.color + ';color:' + kind.color + '">' + kind.label + '</span>' +
                (context ? '<div style="margin-top:3px;font-size:0.7rem;color:#8a8a9e">' + qEsc(context) + '</div>' : '') +
            '</td>' +
            '<td class="r" title="' + qEsc(tickerHint + (run.n_rows ? '\n' + run.n_rows.toLocaleString() + ' rows' : '')) + '" style="cursor:help;white-space:nowrap">' +
                tickerCount + ' <span style="color:#8a8a9e">· ' + compactRows(run.n_rows) + '</span></td>' +
            signCell(m20.rank_ic_mean, 3, 0.03, '', m20.n_test_dates ? (m20.n_test_dates + ' test dates') : '') +
            signCell(m60.top_decile_excess, 1, 1, 'pp', m60.n_test_dates ? (m60.n_test_dates + ' test dates — short windows are noisy') : '') +
            r2Cell(m) +
            '<td class="r" title="' + qEsc(run.duration_s ? run.duration_s.toFixed(0) + 's' : '') + '" style="' + mono + '">' + dur + '</td>' +
            '<td title="seed ' + (run.random_seed != null ? run.random_seed : '—') + '" style="' + mono + 'font-size:0.75rem;color:#8a8a9e">' + qEsc(sha) + '</td>';
        tbody.appendChild(tr);
    });
    // Nine columns at the default 16px side padding overflow the card.
    t.querySelectorAll('th, td').forEach(function(cell) { cell.style.padding = '10px 10px'; });
    var wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    wrap.appendChild(t);
    c.appendChild(wrap);
    var note = document.createElement('p');
    note.style.cssText = 'color:#5c6b7d;font-size:11px;margin-top:10px';
    note.textContent = 'Judge models by rank: 20d IC (>0 = ranking lines up with realized returns) and 60d top-decile excess (the promote gate). ' +
        'R² is scored on the excess-return target, where magnitude is mostly unforecastable — ≈0 or negative is normal, including for promoted models. ' +
        'Only PROMOTED runs serve live predictions.';
    c.appendChild(note);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function qEsc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function qFmt(n) { return Number(n).toLocaleString(); }

function qTimeAgo(ts) {
    if (!ts) return 'Never';
    var diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return Math.round(diff) + 's ago';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    return Math.round(diff / 86400) + 'd ago';
}

function qProbColor(prob) {
    if (prob >= 0.7) return '#00E5A0';
    if (prob >= 0.5) return '#FBBF24';
    return '#8a8a9e';
}

function qVerdictColor(verdict) {
    if (!verdict) return '#8a8a9e';
    var v = verdict.toLowerCase();
    if (v === 'strong_buy') return '#00E5A0';
    if (v === 'buy') return '#00E5A0';
    if (v === 'watch') return '#FBBF24';
    if (v === 'sell') return '#FF4560';
    if (v === 'urgent_sell') return '#FF4560';
    return '#8a8a9e';
}

// ── Empty state ──────────────────────────────────────────────────────────

function renderQuantEmpty() {
    var el = document.getElementById('q-total');
    if (el) el.textContent = '--';
    var wp = document.getElementById('q-with-prob');
    if (wp) wp.textContent = '--';
    var wop = document.getElementById('q-without-prob');
    if (wop) wop.textContent = '--';
    var lu = document.getElementById('q-last-updated');
    if (lu) lu.textContent = '--';
}

// ── Hero metrics ─────────────────────────────────────────────────────────

function renderQuantHero(data) {
    var el = function(id) { return document.getElementById(id); };
    el('q-total').textContent = qFmt(data.total_signals);
    el('q-with-prob').textContent = qFmt(data.with_probability);
    el('q-without-prob').textContent = qFmt(data.without_probability);

    var pct = data.total_signals > 0
        ? ((data.with_probability / data.total_signals) * 100).toFixed(1) + '% coverage'
        : '';
    el('q-with-prob-pct').textContent = pct;

    if (data.last_updated) {
        var d = new Date(data.last_updated);
        el('q-last-updated').textContent = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        el('q-freshness').textContent = qTimeAgo(data.last_updated) + ' | ' + data.updated_last_hour + ' last hr / ' + data.updated_last_24h + ' last 24h';
    } else {
        el('q-last-updated').textContent = 'Never';
        el('q-freshness').textContent = '';
    }
}

// ── Training Metrics ─────────────────────────────────────────────────────

function renderTrainingMetrics(data) {
    var container = document.getElementById('q-training-metrics');
    if (!container) return;
    var tm = data.training_metrics;
    if (!tm || !tm.metrics) {
        container.innerHTML = '<p style="color:#8a8a9e;font-size:0.85rem;">No training metrics yet — waiting for first LightGBM training cycle.</p>';
        return;
    }

    var metrics = tm.metrics;
    var html = '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">';

    // Summary cards
    html += '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">';
    html += '<div style="font-size:0.7rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase;">Tickers</div>';
    html += '<div style="font-size:1.3rem;font-weight:700;color:#e8e8ed;font-family:\'JetBrains Mono\',monospace;">' + qFmt(tm.tickers || 0) + '</div></div>';

    html += '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">';
    html += '<div style="font-size:0.7rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase;">Rows</div>';
    html += '<div style="font-size:1.3rem;font-weight:700;color:#e8e8ed;font-family:\'JetBrains Mono\',monospace;">' + qFmt(tm.rows || 0) + '</div></div>';

    html += '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">';
    html += '<div style="font-size:0.7rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase;">Duration</div>';
    html += '<div style="font-size:1.3rem;font-weight:700;color:#e8e8ed;font-family:\'JetBrains Mono\',monospace;">' + (tm.duration_s || 0).toFixed(0) + 's</div></div>';

    html += '<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;text-align:center;">';
    html += '<div style="font-size:0.7rem;color:#8a8a9e;letter-spacing:0.08em;text-transform:uppercase;">Trained</div>';
    html += '<div style="font-size:1.3rem;font-weight:700;color:#e8e8ed;font-family:\'JetBrains Mono\',monospace;">' + qTimeAgo(tm.trained_at) + '</div></div>';
    html += '</div>';

    // Per-timeframe metrics table
    html += '<table class="data-table"><thead><tr>';
    html += '<th>Timeframe</th><th class="r">R²</th><th class="r">RMSE</th><th class="r">MAE</th><th class="r">Samples</th>';
    html += '</tr></thead><tbody>';

    var timeframes = ['1d', '5d', '20d'];
    for (var i = 0; i < timeframes.length; i++) {
        var tf = timeframes[i];
        var m = metrics[tf];
        if (!m) continue;

        var r2Color = m.r2 > 0.1 ? '#00E5A0' : m.r2 > 0 ? '#FBBF24' : '#FF4560';
        html += '<tr>';
        html += '<td style="font-weight:600;color:#e8e8ed;">' + tf.toUpperCase() + '</td>';
        html += '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + r2Color + ';">' + m.r2.toFixed(4) + '</td>';
        html += '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e;">' + m.rmse.toFixed(2) + '</td>';
        html += '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e;">' + m.mae.toFixed(2) + '%</td>';
        html += '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e;">' + qFmt(m.train_samples) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';

    container.innerHTML = html;
}

// ── Probability Distribution ─────────────────────────────────────────────

function renderProbabilityDist(data) {
    var container = document.getElementById('q-prob-dist');
    var buckets = data.probability_distribution || [];
    if (!buckets.length) {
        container.textContent = 'No probability data';
        return;
    }

    var max = 0;
    for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].count > max) max = buckets[i].count;
    }

    // Build DOM nodes instead of innerHTML for safety
    while (container.firstChild) container.removeChild(container.firstChild);

    for (var i = 0; i < buckets.length; i++) {
        var b = buckets[i];
        var barPct = max > 0 ? (b.count / max) * 100 : 0;
        var color = '#8a8a9e';
        if (b.bucket === '0.7-0.9' || b.bucket === '0.9-1.0') color = '#00E5A0';
        else if (b.bucket === '0.5-0.7') color = '#FBBF24';
        else if (b.bucket === '0.3-0.5') color = '#A855F7';

        var row = document.createElement('div');
        row.className = 'model-row';

        var info = document.createElement('div');
        info.className = 'model-info';

        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = b.bucket;
        info.appendChild(name);

        var count = document.createElement('div');
        count.className = 'count';
        count.textContent = qFmt(b.count) + ' signals';
        info.appendChild(count);

        row.appendChild(info);

        var track = document.createElement('div');
        track.className = 'model-bar-track';
        var fill = document.createElement('div');
        fill.className = 'model-bar-fill';
        fill.style.width = barPct + '%';
        fill.style.background = color;
        track.appendChild(fill);
        row.appendChild(track);

        var pctLabel = document.createElement('div');
        pctLabel.className = 'model-pct';
        pctLabel.textContent = qFmt(b.count);
        row.appendChild(pctLabel);

        container.appendChild(row);
    }
}

// ── Verdict Distribution ─────────────────────────────────────────────────

function renderVerdictDist(data) {
    var container = document.getElementById('q-verdict-dist');
    var verdicts = data.verdict_distribution || [];
    if (!verdicts.length) {
        container.textContent = 'No verdict data';
        return;
    }

    var max = 0;
    for (var i = 0; i < verdicts.length; i++) {
        if (verdicts[i].count > max) max = verdicts[i].count;
    }

    var total = data.total_signals || 1;

    while (container.firstChild) container.removeChild(container.firstChild);

    for (var i = 0; i < verdicts.length; i++) {
        var v = verdicts[i];
        var barPct = max > 0 ? (v.count / max) * 100 : 0;
        var pct = ((v.count / total) * 100).toFixed(1);
        var color = qVerdictColor(v.verdict);

        var row = document.createElement('div');
        row.className = 'model-row';

        var info = document.createElement('div');
        info.className = 'model-info';

        var nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        var dot = document.createElement('span');
        dot.className = 'model-dot';
        dot.style.background = color;
        nameDiv.appendChild(dot);
        nameDiv.appendChild(document.createTextNode(v.verdict));
        info.appendChild(nameDiv);

        var countDiv = document.createElement('div');
        countDiv.className = 'count';
        countDiv.textContent = qFmt(v.count) + ' signals';
        info.appendChild(countDiv);

        row.appendChild(info);

        var track = document.createElement('div');
        track.className = 'model-bar-track';
        var fill = document.createElement('div');
        fill.className = 'model-bar-fill';
        fill.style.width = barPct + '%';
        fill.style.background = color;
        track.appendChild(fill);
        row.appendChild(track);

        var pctLabel = document.createElement('div');
        pctLabel.className = 'model-pct';
        pctLabel.textContent = pct + '%';
        row.appendChild(pctLabel);

        container.appendChild(row);
    }
}

// ── Top Predictions Table ────────────────────────────────────────────────

function renderTopPredictions(data) {
    var container = document.getElementById('q-top-predictions');
    var badge = document.getElementById('q-top-count');
    var preds = data.top_predictions || [];

    if (badge) badge.textContent = preds.length + ' signals';

    if (!preds.length) {
        container.textContent = 'No predictions with probability scores';
        return;
    }

    while (container.firstChild) container.removeChild(container.firstChild);

    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    var headers = ['Ticker', 'Probability', '1D', '1W', '1M', '3M', '1Y', 'Verdict', 'Price', 'Catalyst'];
    var rightAligned = { 'Probability': true, '1D': true, '1W': true, '1M': true, '3M': true, '1Y': true, 'Price': true };
    for (var h = 0; h < headers.length; h++) {
        var th = document.createElement('th');
        th.textContent = headers[h];
        if (rightAligned[headers[h]]) th.className = 'r';
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < preds.length; i++) {
        var p = preds[i];
        var tr = document.createElement('tr');

        // Ticker
        var tdTicker = document.createElement('td');
        tdTicker.style.fontWeight = '600';
        tdTicker.style.color = '#e8e8ed';
        tdTicker.textContent = p.ticker;
        tr.appendChild(tdTicker);

        // Probability
        var tdProb = document.createElement('td');
        tdProb.className = 'r';
        tdProb.style.fontFamily = "'JetBrains Mono', monospace";
        tdProb.style.color = qProbColor(p.probability);
        tdProb.textContent = p.probability != null ? (p.probability * 100).toFixed(1) + '%' : '--';
        tr.appendChild(tdProb);

        // Returns: 1D, 1W, 1M, 3M, 1Y
        tr.appendChild(makeReturnCell(p.expected_return_1d));
        tr.appendChild(makeReturnCell(p.expected_return_1w));
        tr.appendChild(makeReturnCell(p.expected_return_1m));
        tr.appendChild(makeReturnCell(p.expected_return_3m));
        tr.appendChild(makeReturnCell(p.expected_return_1y));

        // Verdict
        var tdVerdict = document.createElement('td');
        var verdictSpan = document.createElement('span');
        verdictSpan.style.color = qVerdictColor(p.verdict_1m);
        verdictSpan.style.fontWeight = '500';
        verdictSpan.textContent = p.verdict_1m || '--';
        tdVerdict.appendChild(verdictSpan);
        tr.appendChild(tdVerdict);

        // Price
        var tdPrice = document.createElement('td');
        tdPrice.className = 'r';
        tdPrice.style.fontFamily = "'JetBrains Mono', monospace";
        tdPrice.textContent = p.current_price != null ? '$' + p.current_price.toFixed(2) : '--';
        tr.appendChild(tdPrice);

        // Catalyst
        var tdCatalyst = document.createElement('td');
        tdCatalyst.textContent = p.catalyst_strength || '--';
        tr.appendChild(tdCatalyst);

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
}

// ── Auto-refresh ─────────────────────────────────────────────────────────

function makeReturnCell(val) {
    var td = document.createElement('td');
    td.className = 'r';
    td.style.fontFamily = "'JetBrains Mono', monospace";
    if (val != null) {
        td.style.color = val > 0 ? '#00E5A0' : val < 0 ? '#FF4560' : '#8a8a9e';
        td.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + '%';
    } else {
        td.style.color = '#8a8a9e';
        td.textContent = '--';
    }
    return td;
}

(function initQuantRefresh() {
    // Refresh every 60s when the quant tab is active
    setInterval(function() {
        var tab = document.querySelector('.tab[data-tab="quant-quality"]');
        if (tab && tab.classList.contains('active')) {
            refreshQuantHealth();
        }
    }, REFRESH_MS);
})();


// ── Model Quantiles (weekly rank-decile report) ─────────────────────────
async function refreshQuantileReport() {
    try {
        var r = await fetch(QUANTILE_REPORT_API + '?t=' + Date.now());
        if (!r.ok) return;
        var d = await r.json();
        var windowEl = document.getElementById('quantile-window');
        if (windowEl) windowEl.textContent = d.window_start + ' → ' + d.window_end;
        var headlineEl = document.getElementById('quantile-headline');
        if (headlineEl) {
            var pp = d.top_vs_middle_pp || 0;
            headlineEl.textContent = pp < -0.5
                ? 'Top decile trails the middle deciles by ' + Math.abs(pp).toFixed(1) + 'pp — crowded-top regime (extended-spike contamination).'
                : pp > 0.5
                    ? 'Top decile leads the middle by ' + pp.toFixed(1) + 'pp — ranking healthy.'
                    : 'Top and middle deciles roughly even.';
        }
        var host = document.getElementById('quantile-configs');
        if (!host) return;
        host.innerHTML = '';
        (d.configs || []).forEach(function (cfg) {
            var col = document.createElement('div');
            col.style.cssText = 'flex:1;min-width:260px';
            var title = document.createElement('div');
            title.style.cssText = 'font:600 10px monospace;letter-spacing:.1em;color:#a78bfa;margin-bottom:8px;text-transform:uppercase';
            title.textContent = cfg.label || cfg.key;
            col.appendChild(title);
            var rows = cfg.rows || [];
            var maxAbs = 0.01;
            rows.forEach(function (row) { maxAbs = Math.max(maxAbs, Math.abs(row.MeanFwd || 0)); });
            rows.forEach(function (row, i) {
                var v = row.MeanFwd || 0;
                var line = document.createElement('div');
                line.style.cssText = 'display:flex;align-items:center;gap:7px;padding:1.5px 0;font:11px monospace';
                var neg = v < 0;
                var color = i === 9 ? (neg ? '#ff4560' : '#ffb020') : (neg ? '#ff4560' : '#00e5a0');
                line.innerHTML =
                    '<span style="width:26px;color:' + (i === 9 ? '#f2f6fa' : '#5c6b7d') + '">D' + (i + 1) + '</span>' +
                    '<span style="flex:1;height:10px;background:#1a222d;border-radius:2px;position:relative;overflow:hidden">' +
                    '<span style="position:absolute;top:0;bottom:0;' + (neg ? 'right' : 'left') + ':0;width:' +
                    Math.max(2, Math.abs(v) / maxAbs * 100) + '%;background:' + color + ';opacity:' + (i === 9 ? 1 : 0.65) + ';border-radius:2px"></span></span>' +
                    '<span style="width:52px;text-align:right;color:' + (neg ? '#ff4560' : '#00e5a0') + '">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</span>';
                col.appendChild(line);
            });
            host.appendChild(col);
        });
    } catch (e) { /* section stays empty */ }
}
refreshQuantileReport();
document.addEventListener('click', function (e) {
    if (e.target && e.target.matches && e.target.matches('[data-tab="quant-quality"]')) {
        refreshQuantileReport();
    }
});
