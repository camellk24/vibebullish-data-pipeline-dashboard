// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish Quant Quality Dashboard Tab
// ═══════════════════════════════════════════════════════════════════════════

var QUANT_API = API_BASE + '/api/quant/health';
var QUANT_RUNS_API = API_BASE + '/api/quant/training-runs?limit=10';
var QUANT_BACKTESTS_API = API_BASE + '/api/quant/backtests?limit=20';
var QUANT_LIVE_COHORT = 'uni_1308';
var QUANT_LIVE_TOP_N = 20;
var QUANT_LIVE_COST_BPS = 5;
var QUANT_LIVE_TIMEFRAMES = ['1d', '5d', '20d'];
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
    var cohort = QUANT_LIVE_COHORT;
    var topN = QUANT_LIVE_TOP_N;
    var costBps = QUANT_LIVE_COST_BPS;
    try {
        // Fetch stats for each timeframe in parallel
        var statsPromises = QUANT_LIVE_TIMEFRAMES.map(function(tf) {
            var url = API_BASE + '/api/quant/live-stats?cohort=' + cohort +
                '&timeframe=' + tf + '&top_n=' + topN + '&cost_bps=' + costBps +
                '&t=' + Date.now();
            return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
        });
        var preds1dPromise = fetch(API_BASE + '/api/quant/live-predictions?cohort=' + cohort +
            '&timeframe=1d&limit=' + topN + '&t=' + Date.now())
            .then(function(r) { return r.ok ? r.json() : { predictions: [] }; })
            .catch(function() { return { predictions: [] }; });

        var results = await Promise.all(statsPromises.concat([preds1dPromise]));
        var statsArr = results.slice(0, QUANT_LIVE_TIMEFRAMES.length);
        var predsResp = results[results.length - 1];
        renderQuantLiveStats(statsArr);
        renderQuantLivePredictions(predsResp.predictions || []);
    } catch (err) {
        console.error('Quant live fetch failed:', err);
        var badge = document.getElementById('quant-live-status');
        if (badge) badge.textContent = 'error';
    }
}

function renderQuantLiveStats(statsArr) {
    var c = document.getElementById('quant-live-stats');
    if (!c) return;
    var badge = document.getElementById('quant-live-status');

    var anyResolved = false;
    var totalPeriods = 0;
    statsArr.forEach(function(s) {
        if (s && s.n_resolved_periods > 0) {
            anyResolved = true;
            totalPeriods += s.n_resolved_periods;
        }
    });
    if (badge) {
        badge.textContent = anyResolved ? (totalPeriods + ' resolved bets') : 'no resolved data yet';
    }

    var html = '<table class="data-table"><thead><tr>' +
        '<th>TF</th>' +
        '<th class="r">Periods</th>' +
        '<th class="r">Cum %</th>' +
        '<th class="r">Ann %</th>' +
        '<th class="r">SPY Ann %</th>' +
        '<th class="r">Alpha %</th>' +
        '<th class="r">Sharpe</th>' +
        '<th class="r">Max DD %</th>' +
        '<th class="r">Hit %</th>' +
        '<th>Window</th>' +
        '</tr></thead><tbody>';

    function num(v, d) { return v == null ? '—' : Number(v).toFixed(d == null ? 2 : d); }
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

    QUANT_LIVE_TIMEFRAMES.forEach(function(tf, i) {
        var s = statsArr[i];
        if (!s) {
            html += '<tr><td>' + tf + '</td><td class="r" colspan="9" style="color:#8a8a9e">fetch failed</td></tr>';
            return;
        }
        if (!s.summary) {
            html += '<tr><td style="font-family:\'JetBrains Mono\',monospace">' + tf + '</td>' +
                '<td class="r">0</td>' +
                '<td colspan="8" style="color:#8a8a9e;font-size:0.8rem">' + qEsc(s.note || 'no resolved data yet') + '</td></tr>';
            return;
        }
        var sm = s.summary;
        var win = (s.date_range && s.date_range[0]) ? (s.date_range[0] + ' → ' + s.date_range[1]) : '—';
        html += '<tr>' +
            '<td style="font-family:\'JetBrains Mono\',monospace">' + tf + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + s.n_resolved_periods + '</td>' +
            colorCell(sm.cumulative_return_pct, true) +
            colorCell(sm.annualized_return_pct, true) +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:#8a8a9e">' + num(sm.spy_annualized_return_pct, 2) + '</td>' +
            colorCell(sm.alpha_annualized_pct, true) +
            sharpeCell(sm.sharpe_annualized) +
            colorCell(sm.max_drawdown_pct, false) +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + num(sm.hit_rate_pct, 1) + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;color:#8a8a9e">' + qEsc(win) + '</td>' +
            '</tr>';
    });
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

    var t = document.createElement('table');
    t.className = 'data-table';
    t.innerHTML = '<thead><tr>' +
        '<th>Time</th>' +
        '<th class="r">Tickers</th>' +
        '<th class="r">Rows</th>' +
        '<th class="r">1d R²</th>' +
        '<th class="r">5d R²</th>' +
        '<th class="r">20d R²</th>' +
        '<th class="r">60d R²</th>' +
        '<th class="r">Duration</th>' +
        '<th>Git</th>' +
        '<th>Seed</th>' +
        '</tr></thead><tbody></tbody>';
    var tbody = t.querySelector('tbody');

    function r2Cell(v) {
        if (v == null) return '<td class="r">—</td>';
        var color = v > 0.1 ? '#00E5A0' : v > 0 ? '#FBBF24' : '#FF4560';
        return '<td class="r" style="font-family:\'JetBrains Mono\',monospace;color:' + color + '">' + v.toFixed(4) + '</td>';
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
        var r1d = m['1d'] && m['1d'].r2;
        var r5d = m['5d'] && m['5d'].r2;
        var r20d = m['20d'] && m['20d'].r2;
        var r60d = m['60d'] && m['60d'].r2;
        var dur = run.duration_s ? run.duration_s.toFixed(0) + 's' : '—';
        // Use the n_tickers column (truth — actual count trained on) rather
        // than tickers.length (the persisted JSONB array, which historically
        // stored the hardcoded universe constant rather than the dynamic
        // post-quality-filter list). Hover hint still shows ticker names.
        var tickerCount = run.n_tickers != null ? run.n_tickers : (run.tickers || []).length;
        var tickerHint = (run.tickers || []).slice(0, 5).join(', ') +
            ((run.tickers || []).length > 5 ? (', +' + ((run.tickers || []).length - 5) + ' more') : '');
        var sha = (run.git_sha || '').substring(0, 7) || 'unknown';

        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td title="' + qEsc(run.started_at || '') + '">' + timeAgo(run.started_at) + '</td>' +
            '<td class="r" title="' + qEsc(tickerHint) + '" style="cursor:help">' + tickerCount + '</td>' +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + (run.n_rows || 0).toLocaleString() + '</td>' +
            r2Cell(r1d) +
            r2Cell(r5d) +
            r2Cell(r20d) +
            r2Cell(r60d) +
            '<td class="r" style="font-family:\'JetBrains Mono\',monospace">' + dur + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.75rem;color:#8a8a9e">' + qEsc(sha) + '</td>' +
            '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.75rem;color:#8a8a9e">' + (run.random_seed != null ? run.random_seed : '—') + '</td>';
        tbody.appendChild(tr);
    });
    c.appendChild(t);
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
