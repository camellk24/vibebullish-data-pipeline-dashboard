// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish Backtesting Dashboard Tab
// ═══════════════════════════════════════════════════════════════════════════

const BT_API = API_BASE + '/api/backtesting/stats';

async function fetchBacktestingStats() {
    try {
        const r = await fetch(BT_API + '?t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        renderBTHero(data);
        renderBTAlert(data);
        renderBTByVerdict(data);
        renderBTByModel(data);
        renderBTCalibration(data);
        renderBTTrend(data);
    } catch (err) {
        console.error('Backtesting fetch failed:', err);
        renderBTEmpty();
    }
}

// ── Helper ────────────────────────────────────────────────────────────────

function btPct(v) {
    if (v == null || isNaN(v)) return '--';
    return (v * 100).toFixed(1) + '%';
}

function btClearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function btCreateMetricCard(label, value, opts) {
    var card = document.createElement('div');
    card.className = 'metric-card' + (opts && opts.hero ? ' hero' : '');

    var lbl = document.createElement('div');
    lbl.className = 'metric-label';
    lbl.textContent = label;
    card.appendChild(lbl);

    var val = document.createElement('div');
    val.className = 'metric-value';
    if (opts && opts.color) val.style.color = opts.color;
    val.textContent = value;
    card.appendChild(val);

    if (opts && opts.sub) {
        var sub = document.createElement('div');
        sub.className = 'metric-sub';
        sub.textContent = opts.sub;
        card.appendChild(sub);
    }

    return card;
}

// ── Empty state ───────────────────────────────────────────────────────────

function renderBTEmpty() {
    var hero = document.getElementById('bt-hero-metrics');
    btClearChildren(hero);
    var msg = document.createElement('div');
    msg.className = 'empty-state';
    msg.textContent = 'Collecting data... Backtesting stats will appear once predictions are resolved.';
    hero.appendChild(msg);
}

// ── Hero metrics ──────────────────────────────────────────────────────────

function renderBTHero(data) {
    var container = document.getElementById('bt-hero-metrics');
    btClearChildren(container);

    var da = data.directional_accuracy || {};
    var acc1d = da['1d'];
    var acc1w = da['1w'];
    var pta = data.price_target_accuracy || {};
    var mae1d = pta['1d'];

    var acc1dVal = acc1d ? btPct(acc1d.accuracy) : '--';
    var acc1dColor = acc1d && acc1d.accuracy >= 0.55 ? 'var(--positive)' : acc1d && acc1d.accuracy < 0.50 ? 'var(--negative)' : 'var(--neutral)';

    var acc1wVal = acc1w ? btPct(acc1w.accuracy) : '--';
    var acc1wColor = acc1w && acc1w.accuracy >= 0.55 ? 'var(--positive)' : acc1w && acc1w.accuracy < 0.50 ? 'var(--negative)' : 'var(--neutral)';

    var resolvedCount = (data.resolved_1d || 0) + (data.resolved_1w || 0) + (data.resolved_1m || 0);
    var maeVal = mae1d ? mae1d.mae_pct.toFixed(1) + '%' : '--';

    container.appendChild(btCreateMetricCard('1D Accuracy', acc1dVal, {
        hero: true,
        color: acc1dColor,
        sub: acc1d ? acc1d.correct + ' / ' + acc1d.total + ' correct' : ''
    }));

    container.appendChild(btCreateMetricCard('1W Accuracy', acc1wVal, {
        color: acc1wColor,
        sub: acc1w ? acc1w.correct + ' / ' + acc1w.total + ' correct' : ''
    }));

    container.appendChild(btCreateMetricCard('Resolved', resolvedCount.toLocaleString(), {
        sub: data.total_predictions ? 'of ' + data.total_predictions.toLocaleString() + ' total' : ''
    }));

    container.appendChild(btCreateMetricCard('Price MAE', maeVal, {
        sub: '1-day mean absolute error'
    }));
}

// ── Threshold alert ───────────────────────────────────────────────────────

function renderBTAlert(data) {
    var section = document.getElementById('bt-alert-section');
    btClearChildren(section);

    var rec = data.threshold_recommendation;
    if (!rec || rec.suggested_min_confidence == null) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:var(--r-lg);padding:var(--s-lg);margin-bottom:var(--s-md);display:flex;align-items:center;gap:var(--s-md);position:relative;z-index:1;';

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:1.4rem;flex-shrink:0;';
    icon.textContent = '\u26A0';
    banner.appendChild(icon);

    var body = document.createElement('div');

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;color:var(--warning);margin-bottom:4px;font-size:0.9rem;';
    title.textContent = 'Threshold Recommendation';
    body.appendChild(title);

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);line-height:1.5;';
    desc.textContent = rec.reason + ' (current: ' + rec.current_min_confidence + '%, suggested: ' + rec.suggested_min_confidence + '%)';
    body.appendChild(desc);

    banner.appendChild(body);
    section.appendChild(banner);
}

// ── By Verdict ────────────────────────────────────────────────────────────

var VERDICT_COLORS = {
    strong_buy:  'var(--positive)',
    buy:         '#86EFAC',
    hold:        'var(--neutral)',
    sell:        '#FCA5A5',
    urgent_sell: 'var(--negative)'
};

function renderBTByVerdict(data) {
    var container = document.getElementById('bt-by-verdict');
    btClearChildren(container);

    var bv = data.by_verdict;
    if (!bv || Object.keys(bv).length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No verdict data yet.';
        container.appendChild(msg);
        return;
    }

    var entries = Object.entries(bv).sort(function(a, b) { return b[1].count - a[1].count; });
    var maxCount = entries.reduce(function(m, e) { return Math.max(m, e[1].count); }, 1);

    entries.forEach(function(pair) {
        var verdict = pair[0];
        var info = pair[1];

        var row = document.createElement('div');
        row.className = 'model-row';

        // Info column
        var infoDiv = document.createElement('div');
        infoDiv.className = 'model-info';

        var nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.style.color = VERDICT_COLORS[verdict] || 'var(--text-primary)';
        nameDiv.textContent = verdict.replace(/_/g, ' ');
        infoDiv.appendChild(nameDiv);

        var countDiv = document.createElement('div');
        countDiv.className = 'count';
        countDiv.textContent = info.count + ' predictions';
        infoDiv.appendChild(countDiv);

        row.appendChild(infoDiv);

        // Bar
        var track = document.createElement('div');
        track.className = 'model-bar-track';

        var fill = document.createElement('div');
        fill.className = 'model-bar-fill';
        fill.style.width = ((info.count / maxCount) * 100) + '%';
        fill.style.background = 'var(--grad-bar)';
        track.appendChild(fill);
        row.appendChild(track);

        // Accuracy + return
        var pctDiv = document.createElement('div');
        pctDiv.className = 'model-pct';
        pctDiv.style.flex = '0 0 100px';
        var accColor = info.accuracy_1d >= 0.55 ? 'var(--positive)' : info.accuracy_1d < 0.50 ? 'var(--negative)' : 'var(--text-secondary)';
        pctDiv.style.color = accColor;
        pctDiv.textContent = btPct(info.accuracy_1d);
        if (info.avg_return_1d != null) {
            var retSpan = document.createElement('span');
            retSpan.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-tertiary);';
            retSpan.textContent = (info.avg_return_1d >= 0 ? '+' : '') + info.avg_return_1d.toFixed(1) + '% avg';
            pctDiv.appendChild(retSpan);
        }
        row.appendChild(pctDiv);

        container.appendChild(row);
    });
}

// ── By Model ──────────────────────────────────────────────────────────────

function renderBTByModel(data) {
    var container = document.getElementById('bt-by-model');
    btClearChildren(container);

    var bm = data.by_model;
    if (!bm || Object.keys(bm).length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No model data yet.';
        container.appendChild(msg);
        return;
    }

    var entries = Object.entries(bm).sort(function(a, b) { return b[1].count - a[1].count; });
    var maxCount = entries.reduce(function(m, e) { return Math.max(m, e[1].count); }, 1);

    entries.forEach(function(pair) {
        var model = pair[0];
        var info = pair[1];

        var row = document.createElement('div');
        row.className = 'model-row';

        var infoDiv = document.createElement('div');
        infoDiv.className = 'model-info';

        var nameDiv = document.createElement('div');
        nameDiv.className = 'name';

        var dot = document.createElement('span');
        dot.className = 'model-dot ' + modelFamily(model);
        nameDiv.appendChild(dot);

        var nameText = document.createTextNode(model);
        nameDiv.appendChild(nameText);
        infoDiv.appendChild(nameDiv);

        var countDiv = document.createElement('div');
        countDiv.className = 'count';
        countDiv.textContent = info.count.toLocaleString() + ' predictions';
        infoDiv.appendChild(countDiv);

        row.appendChild(infoDiv);

        // Bar
        var track = document.createElement('div');
        track.className = 'model-bar-track';

        var fill = document.createElement('div');
        fill.className = 'model-bar-fill ' + modelFamily(model);
        fill.style.width = ((info.count / maxCount) * 100) + '%';
        track.appendChild(fill);
        row.appendChild(track);

        // Accuracy
        var pctDiv = document.createElement('div');
        pctDiv.className = 'model-pct';
        var accColor = info.accuracy_1d >= 0.55 ? 'var(--positive)' : info.accuracy_1d < 0.50 ? 'var(--negative)' : 'var(--text-secondary)';
        pctDiv.style.color = accColor;
        pctDiv.textContent = btPct(info.accuracy_1d);
        row.appendChild(pctDiv);

        container.appendChild(row);
    });
}

// ── Confidence Calibration ────────────────────────────────────────────────

function renderBTCalibration(data) {
    var container = document.getElementById('bt-calibration');
    btClearChildren(container);

    var buckets = data.confidence_calibration;
    if (!buckets || buckets.length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No calibration data yet.';
        container.appendChild(msg);
        return;
    }

    var chart = document.createElement('div');
    chart.style.cssText = 'display:flex;align-items:flex-end;gap:var(--s-sm);height:160px;padding-top:var(--s-sm);';

    var maxPred = buckets.reduce(function(m, b) { return Math.max(m, b.predictions || 0); }, 1);

    buckets.forEach(function(b) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;cursor:default;position:relative;';

        // Accuracy label on top
        var accLabel = document.createElement('div');
        accLabel.style.cssText = 'font-family:var(--font-mono);font-size:0.7rem;font-weight:600;margin-bottom:4px;';
        accLabel.style.color = b.accuracy >= 0.55 ? 'var(--positive)' : b.accuracy < 0.50 ? 'var(--negative)' : 'var(--neutral)';
        accLabel.textContent = btPct(b.accuracy);
        wrap.appendChild(accLabel);

        // Count
        var countLabel = document.createElement('div');
        countLabel.style.cssText = 'font-family:var(--font-mono);font-size:0.6rem;color:var(--text-quaternary);margin-bottom:2px;';
        countLabel.textContent = (b.predictions || 0).toLocaleString();
        wrap.appendChild(countLabel);

        // Bar
        var bar = document.createElement('div');
        var pct = ((b.predictions || 0) / maxPred) * 100;
        bar.style.cssText = 'width:100%;border-radius:var(--r-sm) var(--r-sm) 0 0;min-height:2px;transition:height 0.6s ease,opacity 0.2s;opacity:0.7;';
        bar.style.height = Math.max(pct, 2) + '%';
        bar.style.background = 'var(--grad-bar)';
        wrap.appendChild(bar);

        // Bucket label
        var label = document.createElement('div');
        label.style.cssText = 'font-family:var(--font-mono);font-size:0.7rem;color:var(--text-tertiary);margin-top:var(--s-sm);';
        label.textContent = b.bucket;
        wrap.appendChild(label);

        wrap.addEventListener('mouseenter', function() { bar.style.opacity = '1'; });
        wrap.addEventListener('mouseleave', function() { bar.style.opacity = '0.7'; });

        chart.appendChild(wrap);
    });

    container.appendChild(chart);

    // Legend
    var legend = document.createElement('div');
    legend.style.cssText = 'margin-top:var(--s-md);padding-top:var(--s-sm);border-top:1px solid var(--border);display:flex;gap:var(--s-lg);font-size:0.7rem;color:var(--text-quaternary);font-family:var(--font-mono);';

    var items = [
        { color: 'var(--positive)', text: '>= 55% accurate' },
        { color: 'var(--negative)', text: '< 50% accurate' },
        { color: 'var(--neutral)', text: '50-55% accurate' }
    ];

    items.forEach(function(item) {
        var span = document.createElement('span');
        span.style.cssText = 'display:flex;align-items:center;gap:4px;';

        var dot = document.createElement('span');
        dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;';
        dot.style.background = item.color;
        span.appendChild(dot);

        var text = document.createTextNode(item.text);
        span.appendChild(text);
        legend.appendChild(span);
    });

    container.appendChild(legend);
}

// ── 7-Day Accuracy Trend ──────────────────────────────────────────────────

function renderBTTrend(data) {
    var container = document.getElementById('bt-trend');
    btClearChildren(container);

    var trend = data.accuracy_trend;
    if (!trend || trend.length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'Trend data will appear after multiple days of resolved predictions.';
        container.appendChild(msg);
        return;
    }

    var chart = document.createElement('div');
    chart.style.cssText = 'display:flex;align-items:flex-end;gap:var(--s-md);height:160px;';

    trend.forEach(function(day) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;cursor:default;';

        // Accuracy value
        var accLabel = document.createElement('span');
        accLabel.style.cssText = 'font-size:0.75rem;font-weight:600;font-family:var(--font-mono);margin-bottom:4px;font-variant-numeric:tabular-nums;';
        var acc = day.accuracy != null ? day.accuracy : 0;
        accLabel.style.color = acc >= 0.55 ? 'var(--positive)' : acc < 0.50 ? 'var(--negative)' : 'var(--neutral)';
        accLabel.textContent = btPct(acc);
        wrap.appendChild(accLabel);

        // Bar (height = accuracy * 100, capped to chart height)
        var bar = document.createElement('div');
        var barH = Math.max(acc * 100, 2);
        bar.style.cssText = 'width:100%;border-radius:var(--r-sm) var(--r-sm) 0 0;min-height:2px;transition:height 0.8s ease,opacity 0.2s;opacity:0.6;';
        bar.style.height = barH + '%';
        bar.style.background = acc >= 0.55 ? 'var(--grad-accent)' : 'var(--grad-bar)';
        wrap.appendChild(bar);

        wrap.addEventListener('mouseenter', function() { bar.style.opacity = '1'; });
        wrap.addEventListener('mouseleave', function() { bar.style.opacity = '0.6'; });

        // Date label
        var dateLabel = document.createElement('span');
        dateLabel.style.cssText = 'font-size:0.75rem;color:var(--text-tertiary);margin-top:var(--s-sm);font-family:var(--font-mono);';
        dateLabel.textContent = day.date ? day.date.slice(5) : '';
        wrap.appendChild(dateLabel);

        // Day name
        var dayLabel = document.createElement('span');
        dayLabel.style.cssText = 'font-size:0.65rem;color:var(--text-quaternary);';
        dayLabel.textContent = day.date ? dayName(day.date) : '';
        wrap.appendChild(dayLabel);

        chart.appendChild(wrap);
    });

    container.appendChild(chart);
}
