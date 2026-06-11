// Catalyst Accuracy tab — fetches /api/llm-catalyst-accuracy?dimension=...
// for four dimensions (extractor, model, event_type, horizon) and renders
// hit-rate bars per group. Hit rate = directional_hit / N.

(function () {
    const API = 'https://api.vibebullish.com/api/llm-catalyst-accuracy';
    const REFRESH_MS = 60_000;
    let timer = null;

    function colorForRate(pct) {
        if (pct == null || isNaN(pct)) return '#666';
        if (pct >= 60) return '#00C896';
        if (pct >= 50) return '#A855F7';
        if (pct >= 40) return '#F59E0B';
        return '#FF4560';
    }

    function renderBars(rows, container, label) {
        if (!rows || rows.length === 0) {
            container.innerHTML = '<div class="dim" style="padding:14px;text-align:center;font-size:12px;">No resolved emissions yet for this window. Catalysts need their horizon to elapse before they can be scored.</div>';
            return;
        }
        const html = `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="border-bottom:1px solid #333;text-align:left;">
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">${label}</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">N</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Directional Hit %</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Magnitude Hit %</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Avg |Realized|</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => {
                    const dirPct = r.directionalPct != null ? r.directionalPct : 0;
                    const magPct = r.magnitudePct != null ? r.magnitudePct : 0;
                    const dirColor = colorForRate(dirPct);
                    const magColor = colorForRate(magPct);
                    return `
                    <tr style="border-bottom:1px solid #1a1a1a;">
                        <td style="padding:8px;font-family:monospace;font-weight:600;">${r.groupValue || '(unknown)'}</td>
                        <td style="padding:8px;font-family:monospace;color:#888;">${r.n}</td>
                        <td style="padding:8px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="color:${dirColor};font-weight:700;font-family:monospace;width:54px;">${dirPct.toFixed(1)}%</span>
                                <div style="flex:1;height:6px;background:#1a1a1a;border-radius:3px;overflow:hidden;max-width:200px;">
                                    <div style="height:100%;width:${Math.min(100, dirPct)}%;background:${dirColor};"></div>
                                </div>
                                <span style="color:#666;font-size:10px;">${r.directionalHits}/${r.n}</span>
                            </div>
                        </td>
                        <td style="padding:8px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="color:${magColor};font-weight:600;font-family:monospace;width:54px;">${magPct.toFixed(1)}%</span>
                                <div style="flex:1;height:4px;background:#1a1a1a;border-radius:2px;overflow:hidden;max-width:200px;">
                                    <div style="height:100%;width:${Math.min(100, magPct)}%;background:${magColor};opacity:0.6;"></div>
                                </div>
                            </div>
                        </td>
                        <td style="padding:8px;font-family:monospace;color:#aaa;">${(r.avgRealized != null ? r.avgRealized : 0).toFixed(2)}%</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;
        container.innerHTML = html;
    }

    async function fetchAndRender() {
        const days = document.getElementById('ca-filter-days').value || '30';
        const dims = [
            { d: 'extractor', el: 'ca-by-extractor', count: 'ca-extractor-count', label: 'Extractor' },
            { d: 'model', el: 'ca-by-model', count: 'ca-model-count', label: 'Model' },
            { d: 'event_type', el: 'ca-by-event-type', count: 'ca-event-count', label: 'Event Type' },
            { d: 'horizon', el: 'ca-by-horizon', count: 'ca-horizon-count', label: 'Horizon' },
        ];
        let totalResolved = 0;
        let metaShown = false;
        for (const dim of dims) {
            const container = document.getElementById(dim.el);
            const countEl = document.getElementById(dim.count);
            try {
                const res = await fetch(`${API}?dimension=${dim.d}&days=${days}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const rows = data.rows || [];
                renderBars(rows, container, dim.label);
                countEl.textContent = `${rows.length} groups`;
                if (!metaShown) {
                    totalResolved = rows.reduce((a, r) => a + (r.n || 0), 0);
                    document.getElementById('ca-meta').textContent = `${totalResolved} resolved emissions in the last ${days} days`;
                    metaShown = true;
                }
            } catch (err) {
                // textContent, not innerHTML — err.message can carry upstream response text.
                container.textContent = '';
                const msg = document.createElement('div');
                msg.style.cssText = 'color:#FF4560;padding:14px;';
                msg.textContent = String(err.message || err);
                container.appendChild(msg);
                countEl.textContent = '';
            }
        }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        timer = setInterval(fetchAndRender, REFRESH_MS);
    }
    function stopAutoRefresh() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function onTabClick(e) {
        const t = e.target.closest('.tab');
        if (!t) return;
        if (t.dataset.tab === 'catalyst-accuracy') {
            fetchAndRender();
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('.dashboard-tabs').addEventListener('click', onTabClick);
        document.getElementById('ca-refresh').addEventListener('click', fetchAndRender);
        document.getElementById('ca-filter-days').addEventListener('change', fetchAndRender);
        if (document.querySelector('.tab.active[data-tab="catalyst-accuracy"]')) {
            fetchAndRender();
            startAutoRefresh();
        }
    });
})();
