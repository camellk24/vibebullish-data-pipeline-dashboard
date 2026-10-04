// Catalyst Accuracy tab — reads VBReads.get('catalyst-accuracy', {dimension, days})
// (js/reads.js → /api/ops/reads → /api/llm-catalyst-accuracy) for four
// dimensions (extractor, model, event_type, horizon) and renders hit-rate bars
// per group. Hit rate = directional_hit / N.
//
// Activation, the 60 s poll and request invalidation are owned by VBTabs
// (js/dashboard.js). The Refresh button and the window selector route through
// VBTabs.reload(); the window is snapshotted once per load and used for all
// four dimensions and the meta line, so a change mid-load cannot mix windows.

(function () {
    const REFRESH_MS = 60_000;
    const DIMS = [
        { d: 'extractor', el: 'ca-by-extractor', count: 'ca-extractor-count', label: 'Extractor' },
        { d: 'model', el: 'ca-by-model', count: 'ca-model-count', label: 'Model' },
        { d: 'event_type', el: 'ca-by-event-type', count: 'ca-event-count', label: 'Event Type' },
        { d: 'horizon', el: 'ca-by-horizon', count: 'ca-horizon-count', label: 'Horizon' },
    ];
    const WINDOWS = new Set(['7', '30', '60', '90']);

    function colorForRate(pct) {
        if (pct == null || isNaN(pct)) return '#666';
        if (pct >= 60) return '#00C896';
        if (pct >= 50) return '#A855F7';
        if (pct >= 40) return '#F59E0B';
        return '#FF4560';
    }

    // Every backend string is escaped (text AND attribute contexts); every
    // numeric field is coerced first, so an HTML-bearing value in a numeric
    // field renders as the invalid-value dash, never as markup.
    function renderBars(rows, container, label) {
        if (!rows || rows.length === 0) {
            container.innerHTML = '<div class="dim" style="padding:14px;text-align:center;font-size:12px;">No resolved emissions yet for this window. Catalysts need their horizon to elapse before they can be scored.</div>';
            return;
        }
        const html = `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="border-bottom:1px solid #333;text-align:left;">
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">${esc(label)}</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">N</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Directional Hit %</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Magnitude Hit %</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Avg |Realized|</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => {
                    const n = VBReads.num(r.n);
                    const hits = VBReads.num(r.directionalHits);
                    // Invalid or missing measurements show the dash, never a measured 0.
                    const dirPct = VBReads.num(r.directionalPct);
                    const magPct = VBReads.num(r.magnitudePct);
                    const avg = VBReads.num(r.avgRealized);
                    const dirColor = colorForRate(dirPct);
                    const magColor = colorForRate(magPct);
                    const group = r.groupValue == null || r.groupValue === '' ? '(unknown)' : String(r.groupValue);
                    return `
                    <tr style="border-bottom:1px solid #1a1a1a;">
                        <td style="padding:8px;font-family:monospace;font-weight:600;" title="${esc(group)}">${esc(group)}</td>
                        <td style="padding:8px;font-family:monospace;color:#888;">${n == null ? '—' : n}</td>
                        <td style="padding:8px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="color:${dirColor};font-weight:700;font-family:monospace;width:54px;">${dirPct === null ? '—' : dirPct.toFixed(1) + '%'}</span>
                                <div style="flex:1;height:6px;background:#1a1a1a;border-radius:3px;overflow:hidden;max-width:200px;">
                                    <div style="height:100%;width:${dirPct === null ? 0 : Math.max(0, Math.min(100, dirPct))}%;background:${dirColor};"></div>
                                </div>
                                <span style="color:#666;font-size:10px;">${hits == null ? '—' : hits}/${n == null ? '—' : n}</span>
                            </div>
                        </td>
                        <td style="padding:8px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="color:${magColor};font-weight:600;font-family:monospace;width:54px;">${magPct === null ? '—' : magPct.toFixed(1) + '%'}</span>
                                <div style="flex:1;height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;max-width:200px;">
                                    <div style="height:100%;width:${magPct === null ? 0 : Math.max(0, Math.min(100, magPct))}%;background:${magColor};opacity:0.6;"></div>
                                </div>
                            </div>
                        </td>
                        <td style="padding:8px;font-family:monospace;color:#aaa;">${avg === null ? '—' : avg.toFixed(2) + '%'}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;
        container.innerHTML = html;
    }

    function selectedDays() {
        const sel = document.getElementById('ca-filter-days');
        const v = sel && sel.value != null ? String(sel.value) : '30';
        return WINDOWS.has(v) ? v : '30';
    }

    async function load(ctx) {
        const days = selectedDays(); // one snapshot for all four dimensions + meta
        const results = await Promise.all(DIMS.map(dim => VBReads.get('catalyst-accuracy', { dimension: dim.d, days })));
        if (!ctx.live()) return;
        let metaShown = false;
        DIMS.forEach((dim, i) => {
            const r = results[i];
            const container = document.getElementById(dim.el);
            const countEl = document.getElementById(dim.count);
            if (!r.ok) {
                VBReads.unavailable(container, r.kind, r.message);
                if (countEl) countEl.textContent = '';
                return;
            }
            try {
                const rows = Array.isArray(r.body.rows) ? r.body.rows : [];
                renderBars(rows, container, dim.label);
                if (countEl) countEl.textContent = `${rows.length} groups`;
                if (!metaShown) {
                    const totalResolved = rows.reduce((a, row) => a + (VBReads.num(row.n) || 0), 0);
                    const meta = document.getElementById('ca-meta');
                    if (meta) meta.textContent = `${totalResolved} resolved emissions in the last ${days} days`;
                    metaShown = true;
                }
            } catch (err) {
                console.error('Catalyst accuracy render failed:', err);
                VBReads.unavailable(container, 'upstream_error', 'The backend payload could not be rendered.');
                if (countEl) countEl.textContent = '';
            }
        });
        if (!metaShown) {
            const meta = document.getElementById('ca-meta');
            if (meta) meta.textContent = '';
        }
    }

    function clear() {
        DIMS.forEach(dim => {
            const c = document.getElementById(dim.el);
            if (c) c.textContent = '';
            const n = document.getElementById(dim.count);
            if (n) n.textContent = '';
        });
        const meta = document.getElementById('ca-meta');
        if (meta) meta.textContent = '';
    }

    const refreshBtn = document.getElementById('ca-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => VBTabs.reload('catalyst-accuracy'));
    const daysSel = document.getElementById('ca-filter-days');
    if (daysSel) daysSel.addEventListener('change', () => VBTabs.reload('catalyst-accuracy'));

    VBTabs.register('catalyst-accuracy', { load, clear, intervalMs: REFRESH_MS });
})();
