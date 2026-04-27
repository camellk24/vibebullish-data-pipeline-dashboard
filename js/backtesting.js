// ═══════════════════════════════════════════════════════════════════════════
// VibeBullish Backtesting Dashboard Tab
// ═══════════════════════════════════════════════════════════════════════════

var BT_API = API_BASE + '/api/backtesting/stats';

async function fetchBacktestingStats() {
    try {
        var r = await fetch(BT_API + '?days=30&t=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var data = await r.json();
        renderBTHero(data);
        renderBTAlert(data);
        renderBTByVerdict(data);
        renderBTByModel(data);
        renderBTDetector(data);
        renderBTHorizonMAE(data);
        renderBTCalibration(data);
    } catch (err) {
        console.error('Backtesting fetch failed:', err);
        renderBTEmpty();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function btFmtPct(v) {
    if (v == null || isNaN(v)) return '--';
    return v.toFixed(1) + '%';
}

function btClear(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
}

function btMetricCard(label, value, opts) {
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

function btAccColor(pct) {
    if (pct == null) return 'var(--text-secondary)';
    if (pct >= 55) return 'var(--positive)';
    if (pct < 50) return 'var(--negative)';
    return 'var(--neutral)';
}

// ── Empty state ──────────────────────────────────────────────────────────

function renderBTEmpty() {
    var el = document.getElementById('bt-hero-metrics');
    btClear(el);
    var msg = document.createElement('div');
    msg.className = 'empty-state';
    msg.textContent = 'Collecting data... Backtesting stats will appear once predictions are resolved.';
    el.appendChild(msg);
}

// ── Hero metrics ─────────────────────────────────────────────────────────

function renderBTHero(data) {
    var c = document.getElementById('bt-hero-metrics');
    btClear(c);

    var da = data.directional_accuracy || {};
    var a1d = da['1d'];
    var a1w = da['1w'];

    // 1D accuracy — pct is already 0-100 (e.g., 49.98)
    var v1d = a1d ? btFmtPct(a1d.pct) : '--';
    var c1d = a1d ? btAccColor(a1d.pct) : 'var(--text-secondary)';
    var s1d = a1d ? (a1d.correct + ' / ' + a1d.total + ' correct') : '';

    // 1W accuracy
    var v1w = a1w ? btFmtPct(a1w.pct) : '--';
    var c1w = a1w ? btAccColor(a1w.pct) : 'var(--text-secondary)';
    var s1w = a1w ? (a1w.correct + ' / ' + a1w.total + ' correct') : '';

    // Resolved count
    var resolved = (data.resolved_1d || 0);

    // Price MAE
    var pta = data.price_target_accuracy || {};
    var mae = pta['1d'];
    var maeVal = mae && mae.mae_pct ? mae.mae_pct.toFixed(1) + '%' : '--';

    c.appendChild(btMetricCard('1D Accuracy', v1d, { hero: true, color: c1d, sub: s1d }));
    c.appendChild(btMetricCard('1W Accuracy', v1w, { color: c1w, sub: s1w }));
    c.appendChild(btMetricCard('Resolved', resolved.toLocaleString(), { sub: 'of ' + (data.total_predictions || 0).toLocaleString() + ' total' }));
    c.appendChild(btMetricCard('Price MAE', maeVal, { sub: '1D mean absolute error' }));
}

// ── Threshold alert ──────────────────────────────────────────────────────

function renderBTAlert(data) {
    var s = document.getElementById('bt-alert-section');
    btClear(s);

    var rec = data.threshold_recommendation;
    if (!rec || !rec.reason || rec.min_confidence === 0) {
        s.style.display = 'none';
        return;
    }

    s.style.display = '';
    var banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);border-radius:var(--r-lg);padding:var(--s-lg);margin-bottom:var(--s-lg);display:flex;align-items:center;gap:var(--s-md);';

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:1.2rem;flex-shrink:0;color:var(--warning);';
    icon.textContent = '\u26A0';
    banner.appendChild(icon);

    var body = document.createElement('div');
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;color:var(--warning);font-size:0.85rem;margin-bottom:2px;';
    title.textContent = 'Threshold Recommendation';
    body.appendChild(title);

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);';
    desc.textContent = rec.reason;
    body.appendChild(desc);

    banner.appendChild(body);
    s.appendChild(banner);
}

// ── By Verdict ───────────────────────────────────────────────────────────

var VERDICT_COLORS = {
    strong_buy: 'var(--positive)', buy: '#86EFAC',
    trim: '#FDE68A', sell: '#FCA5A5', urgent_sell: 'var(--negative)'
};

function btAccCell(acc) {
    var cell = document.createElement('div');
    cell.style.cssText = 'flex:1;text-align:center;font-family:var(--font-mono);font-size:0.8rem;font-weight:600;';
    if (acc && acc.pct != null) {
        cell.style.color = btAccColor(acc.pct);
        cell.textContent = btFmtPct(acc.pct);
    } else {
        cell.style.color = 'var(--text-quaternary)';
        cell.textContent = '--';
    }
    return cell;
}

function renderBTByVerdict(data) {
    var c = document.getElementById('bt-by-verdict');
    btClear(c);

    var bv = data.by_verdict;
    if (!bv || Object.keys(bv).length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No verdict data yet.';
        c.appendChild(msg);
        return;
    }

    // Header row
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px;';
    var spacer = document.createElement('div');
    spacer.style.cssText = 'flex:0 0 140px;';
    header.appendChild(spacer);
    ['1D', '1W', '1M'].forEach(function(h) {
        var lbl = document.createElement('div');
        lbl.style.cssText = 'flex:1;text-align:center;font-family:var(--font-mono);font-size:0.7rem;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px;';
        lbl.textContent = h;
        header.appendChild(lbl);
    });
    c.appendChild(header);

    var entries = Object.entries(bv).sort(function(a, b) { return (b[1].total || 0) - (a[1].total || 0); });

    entries.forEach(function(pair) {
        var verdict = pair[0];
        var info = pair[1];

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--divider);';

        // Name + count
        var infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'flex:0 0 140px;';
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-family:var(--font-mono);font-size:0.85rem;font-weight:600;';
        nameDiv.style.color = VERDICT_COLORS[verdict] || 'var(--text-primary)';
        nameDiv.textContent = verdict.replace(/_/g, ' ');
        infoDiv.appendChild(nameDiv);
        var countDiv = document.createElement('div');
        countDiv.style.cssText = 'font-size:0.7rem;color:var(--text-quaternary);';
        countDiv.textContent = (info.total || 0).toLocaleString();
        infoDiv.appendChild(countDiv);
        row.appendChild(infoDiv);

        // 1D / 1W / 1M accuracy cells
        row.appendChild(btAccCell(info.accuracy_1d));
        row.appendChild(btAccCell(info.accuracy_1w));
        row.appendChild(btAccCell(info.accuracy_1m));

        c.appendChild(row);
    });
}

// ── By Model ─────────────────────────────────────────────────────────────

function renderBTByModel(data) {
    var c = document.getElementById('bt-by-model');
    btClear(c);

    var bm = data.by_model;
    if (!bm || Object.keys(bm).length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No model data yet.';
        c.appendChild(msg);
        return;
    }

    // Header row
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px;';
    var spacer = document.createElement('div');
    spacer.style.cssText = 'flex:0 0 180px;';
    header.appendChild(spacer);
    ['1D', '1W', '1M'].forEach(function(h) {
        var lbl = document.createElement('div');
        lbl.style.cssText = 'flex:1;text-align:center;font-family:var(--font-mono);font-size:0.7rem;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px;';
        lbl.textContent = h;
        header.appendChild(lbl);
    });
    c.appendChild(header);

    var entries = Object.entries(bm).sort(function(a, b) { return (b[1].total || 0) - (a[1].total || 0); });

    entries.forEach(function(pair) {
        var model = pair[0];
        var info = pair[1];

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--divider);';

        // Name + count
        var infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'flex:0 0 180px;';
        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-family:var(--font-mono);font-size:0.8rem;display:flex;align-items:center;gap:6px;';
        var dot = document.createElement('span');
        dot.className = 'model-dot ' + modelFamily(model);
        nameDiv.appendChild(dot);
        nameDiv.appendChild(document.createTextNode(model));
        infoDiv.appendChild(nameDiv);
        var countDiv = document.createElement('div');
        countDiv.style.cssText = 'font-size:0.7rem;color:var(--text-quaternary);';
        countDiv.textContent = (info.total || 0).toLocaleString();
        infoDiv.appendChild(countDiv);
        row.appendChild(infoDiv);

        // 1D / 1W / 1M accuracy cells
        row.appendChild(btAccCell(info.accuracy_1d));
        row.appendChild(btAccCell(info.accuracy_1w));
        row.appendChild(btAccCell(info.accuracy_1m));

        c.appendChild(row);
    });
}

// ── Confidence Calibration ───────────────────────────────────────────────

function renderBTCalibration(data) {
    var c = document.getElementById('bt-calibration');
    btClear(c);

    var buckets = data.confidence_calibration;
    if (!buckets || buckets.length === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'No calibration data yet.';
        c.appendChild(msg);
        return;
    }

    var chart = document.createElement('div');
    chart.style.cssText = 'display:flex;align-items:flex-end;gap:var(--s-sm);height:160px;padding-top:var(--s-sm);';

    var maxPred = buckets.reduce(function(m, b) { return Math.max(m, b.predictions || 0); }, 1);

    buckets.forEach(function(b) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;cursor:default;';

        // Accuracy label — accuracy_1d is already a percentage (e.g., 57.14)
        var accPct = b.accuracy_1d != null ? b.accuracy_1d : null;
        var accLabel = document.createElement('div');
        accLabel.style.cssText = 'font-family:var(--font-mono);font-size:0.7rem;font-weight:600;margin-bottom:4px;';
        accLabel.style.color = accPct != null ? btAccColor(accPct) : 'var(--text-quaternary)';
        accLabel.textContent = accPct != null ? accPct.toFixed(1) + '%' : '--';
        wrap.appendChild(accLabel);

        // Count
        var countLabel = document.createElement('div');
        countLabel.style.cssText = 'font-family:var(--font-mono);font-size:0.6rem;color:var(--text-quaternary);margin-bottom:2px;';
        countLabel.textContent = (b.predictions || 0).toLocaleString();
        wrap.appendChild(countLabel);

        // Bar
        var bar = document.createElement('div');
        var pct = ((b.predictions || 0) / maxPred) * 100;
        bar.style.cssText = 'width:100%;border-radius:var(--r-sm) var(--r-sm) 0 0;min-height:2px;transition:opacity 0.2s;opacity:0.7;';
        bar.style.height = Math.max(pct, 2) + '%';
        bar.style.background = 'var(--grad-bar)';
        wrap.appendChild(bar);

        // Bucket label
        var label = document.createElement('div');
        label.style.cssText = 'font-family:var(--font-mono);font-size:0.65rem;color:var(--text-tertiary);margin-top:var(--s-sm);';
        label.textContent = (b.bucket_min || 0) + '-' + (b.bucket_max || 0);
        wrap.appendChild(label);

        wrap.addEventListener('mouseenter', function() { bar.style.opacity = '1'; });
        wrap.addEventListener('mouseleave', function() { bar.style.opacity = '0.7'; });

        chart.appendChild(wrap);
    });

    c.appendChild(chart);
}

// ── Change Detector Metrics ──────────────────────────────────────────────

function renderBTDetector(data) {
    var c = document.getElementById('bt-detector');
    btClear(c);

    var det = data.detector_metrics;
    if (!det || det.total_decisions === 0) {
        var msg = document.createElement('span');
        msg.className = 'dim';
        msg.textContent = 'Collecting data... Change detector metrics will appear once decisions are logged.';
        c.appendChild(msg);
        return;
    }

    var table = document.createElement('div');
    table.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0;';

    function addRow(label, value, opts) {
        var lbl = document.createElement('div');
        lbl.style.cssText = 'font-family:var(--font-mono);font-size:0.75rem;color:var(--text-secondary);padding:6px 0;border-bottom:1px solid var(--divider);';
        lbl.textContent = label;
        table.appendChild(lbl);

        var val = document.createElement('div');
        val.style.cssText = 'font-family:var(--font-mono);font-size:0.8rem;font-weight:600;padding:6px 0;text-align:right;border-bottom:1px solid var(--divider);';
        if (opts && opts.color) val.style.color = opts.color;
        val.textContent = value;
        table.appendChild(val);
    }

    addRow('Total Decisions', det.total_decisions.toLocaleString());
    addRow('Escalated', det.escalated.toLocaleString());
    addRow('Skipped', det.skipped.toLocaleString());

    // Precision / wasted rate with color coding
    var precColor = det.precision >= 60 ? 'var(--positive)' : det.precision < 40 ? 'var(--negative)' : 'var(--neutral)';
    addRow('Precision', btFmtPct(det.precision), { color: precColor });
    var wastedColor = det.wasted_call_rate <= 20 ? 'var(--positive)' : det.wasted_call_rate > 40 ? 'var(--negative)' : 'var(--neutral)';
    addRow('Wasted Call Rate', btFmtPct(det.wasted_call_rate), { color: wastedColor });

    addRow('Verdict Changes', det.verdict_changes.toLocaleString(), { color: 'var(--positive)' });
    addRow('Conviction Changes', det.conviction_changes.toLocaleString(), { color: 'var(--positive)' });
    addRow('Target Revisions', det.target_revisions.toLocaleString(), { color: 'var(--positive)' });
    addRow('Wasted Calls', det.wasted_calls.toLocaleString(), { color: 'var(--negative)' });
    addRow('Correct Skips', det.correct_skips.toLocaleString(), { color: 'var(--positive)' });
    addRow('Missed Signals', det.missed_signals.toLocaleString(), { color: 'var(--negative)' });

    c.appendChild(table);
}

// ── Per-Horizon Target MAE ───────────────────────────────────────────────

function renderBTHorizonMAE(data) {
    var c = document.getElementById('bt-horizon-mae');
    btClear(c);

    var horizons = data.horizon_target_accuracy;
    if (!horizons || horizons.length === 0) {
        // Fall back to existing price_target_accuracy if horizon data not available
        var pta = data.price_target_accuracy || {};
        var keys = Object.keys(pta);
        if (keys.length === 0) {
            var msg = document.createElement('span');
            msg.className = 'dim';
            msg.textContent = 'No target accuracy data yet.';
            c.appendChild(msg);
            return;
        }
        // Render existing MAE data as a table
        horizons = [];
        var order = ['1d', '1w', '1m'];
        order.forEach(function(h) {
            if (pta[h]) {
                horizons.push({ horizon: h, count: pta[h].count, mae_pct: pta[h].mae_pct });
            }
        });
        if (horizons.length === 0) {
            var msg2 = document.createElement('span');
            msg2.className = 'dim';
            msg2.textContent = 'No target accuracy data yet.';
            c.appendChild(msg2);
            return;
        }
    }

    var HORIZON_LABELS = { '1d': '1 Day', '1w': '1 Week', '1m': '1 Month' };

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px;';
    ['Horizon', 'Samples', 'MAE %'].forEach(function(h, i) {
        var lbl = document.createElement('div');
        lbl.style.cssText = 'font-family:var(--font-mono);font-size:0.7rem;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1px;' +
            (i === 0 ? 'flex:0 0 100px;' : 'flex:1;text-align:center;');
        lbl.textContent = h;
        header.appendChild(lbl);
    });
    c.appendChild(header);

    horizons.forEach(function(h) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--divider);';

        var nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'flex:0 0 100px;font-family:var(--font-mono);font-size:0.85rem;font-weight:600;';
        nameDiv.textContent = HORIZON_LABELS[h.horizon] || h.horizon;
        row.appendChild(nameDiv);

        var countDiv = document.createElement('div');
        countDiv.style.cssText = 'flex:1;text-align:center;font-family:var(--font-mono);font-size:0.8rem;color:var(--text-secondary);';
        countDiv.textContent = (h.count || 0).toLocaleString();
        row.appendChild(countDiv);

        var maeDiv = document.createElement('div');
        maeDiv.style.cssText = 'flex:1;text-align:center;font-family:var(--font-mono);font-size:0.8rem;font-weight:600;';
        var maeVal = h.mae_pct;
        // Lower MAE is better: green <= 5%, red > 15%, neutral otherwise
        var maeColor = maeVal <= 5 ? 'var(--positive)' : maeVal > 15 ? 'var(--negative)' : 'var(--neutral)';
        maeDiv.style.color = maeColor;
        maeDiv.textContent = maeVal != null ? maeVal.toFixed(1) + '%' : '--';
        row.appendChild(maeDiv);

        c.appendChild(row);
    });
}
