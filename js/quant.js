// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish Quant Quality Dashboard Tab
// ═══════════════════════════════════════════════════════════════════════════

var QUANT_API = API_BASE + '/api/quant/health';
var quantRefreshTimer = null;

async function refreshQuantHealth() {
    try {
        var r = await fetch(QUANT_API + '?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        renderQuantHero(data);
        renderProbabilityDist(data);
        renderVerdictDist(data);
        renderTopPredictions(data);
    } catch (err) {
        console.error('Quant health fetch failed:', err);
        renderQuantEmpty();
    }
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
