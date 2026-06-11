// LLM Analysis Logs tab — fetches /api/llm-analysis-log/recent and renders
// a filterable table of recent v2 catalyst-only calls. Hero metrics surface
// success rate, average latency, and buyable/bearish ratio at a glance.

(function () {
    const API_BASE = 'https://api.vibebullish.com/api/llm-analysis-log';
    const REFRESH_MS = 60_000;

    let timer = null;

    function formatLatency(ms) {
        if (ms == null) return '—';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    function formatTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }

    function statusBadge(status) {
        const colors = {
            success: '#00C896',
            error: '#FF4560',
            timeout: '#F59E0B',
            panic: '#A855F7',
        };
        const c = colors[status] || '#888';
        return `<span style="background:${c}22;color:${c};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;">${status}</span>`;
    }

    function modelBadge(model) {
        const isDeepseek = model && model.includes('deepseek');
        const c = isDeepseek ? '#3B82F6' : '#A855F7';
        return `<span style="background:${c}22;color:${c};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;font-family:monospace;">${model}</span>`;
    }

    function eventTypesPills(events) {
        if (!events || Object.keys(events).length === 0) return '<span class="dim">—</span>';
        return Object.entries(events)
            .map(([k, v]) => `<span style="background:#161616;border:1px solid #333;color:#aaa;padding:1px 5px;border-radius:3px;font-size:10px;font-family:monospace;margin-right:3px;">${k}${v > 1 ? '×' + v : ''}</span>`)
            .join('');
    }

    function directionBadge(bullish, bearish) {
        if (bullish == null && bearish == null) return '<span class="dim">—</span>';
        const parts = [];
        if (bullish > 0) parts.push(`<span style="color:#00C896;">↑${bullish}</span>`);
        if (bearish > 0) parts.push(`<span style="color:#FF4560;">↓${bearish}</span>`);
        if (parts.length === 0) parts.push('<span class="dim">neutral</span>');
        return parts.join(' ');
    }

    function labelsList(labels) {
        if (!labels || labels.length === 0) return '<span class="dim">—</span>';
        return `<details style="cursor:pointer;"><summary style="font-size:11px;color:#aaa;">${labels.length} catalyst${labels.length === 1 ? '' : 's'}</summary><div style="margin-top:4px;font-size:11px;line-height:1.4;color:#ccc;">${labels.map(l => `<div style="padding:2px 0;">• ${l.replace(/</g, '&lt;')}</div>`).join('')}</div></details>`;
    }

    function renderTable(rows) {
        const el = document.getElementById('lal-table');
        if (!rows || rows.length === 0) {
            el.innerHTML = '<div class="dim" style="padding:20px;text-align:center;">No log entries yet. Trigger an analysis on a tracked ticker to populate.</div>';
            return;
        }
        const html = `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="border-bottom:1px solid #333;text-align:left;">
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">When</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Ticker</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Model</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Status</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Direction</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Events</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Catalysts</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Headline</th>
                    <th style="padding:8px;color:#888;font-weight:600;text-transform:uppercase;font-size:10px;">Latency</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                    <tr style="border-bottom:1px solid #1a1a1a;vertical-align:top;">
                        <td style="padding:8px;color:#888;font-family:monospace;font-size:10px;white-space:nowrap;">${formatTime(r.calledAt)}</td>
                        <td style="padding:8px;font-weight:600;font-family:monospace;">${r.ticker}</td>
                        <td style="padding:8px;">${modelBadge(r.model)}</td>
                        <td style="padding:8px;">${statusBadge(r.status)}${r.errorMessage ? `<div class="dim" style="font-size:10px;margin-top:2px;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${(r.errorMessage || '').replace(/"/g, '&quot;')}">${(r.errorMessage || '').substring(0, 60)}…</div>` : ''}</td>
                        <td style="padding:8px;">${directionBadge(r.bullishCount, r.bearishCount)}</td>
                        <td style="padding:8px;">${eventTypesPills(r.eventTypes)}</td>
                        <td style="padding:8px;max-width:300px;">${labelsList(r.catalystLabels)}</td>
                        <td style="padding:8px;color:#aaa;font-style:italic;max-width:240px;">${r.verdictHeadline ? r.verdictHeadline.replace(/</g, '&lt;') : '<span class="dim">—</span>'}</td>
                        <td style="padding:8px;color:#888;font-family:monospace;">${formatLatency(r.latencyMs)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
        el.innerHTML = html;
    }

    function renderHeroMetrics(rows) {
        const total = rows.length;
        document.getElementById('lal-total').textContent = total;
        const success = rows.filter(r => r.status === 'success').length;
        const successPct = total > 0 ? Math.round((success / total) * 100) : 0;
        document.getElementById('lal-success-rate').textContent = total > 0 ? `${successPct}%` : '—';

        const successRows = rows.filter(r => r.status === 'success' && r.latencyMs);
        const avgLatency = successRows.length > 0
            ? Math.round(successRows.reduce((a, r) => a + r.latencyMs, 0) / successRows.length)
            : null;
        document.getElementById('lal-latency').textContent = avgLatency ? formatLatency(avgLatency) : '—';

        const bullish = successRows.filter(r => (r.bullishCount || 0) > (r.bearishCount || 0)).length;
        const bearish = successRows.filter(r => (r.bearishCount || 0) > (r.bullishCount || 0)).length;
        document.getElementById('lal-buy-ratio').textContent = successRows.length > 0
            ? `${bullish} / ${bearish}`
            : '—';

        document.getElementById('lal-row-count').textContent = `${total} row${total === 1 ? '' : 's'}`;
    }

    async function fetchAndRender() {
        const ticker = document.getElementById('lal-filter-ticker').value.trim().toUpperCase();
        const model = document.getElementById('lal-filter-model').value;
        const limit = document.getElementById('lal-filter-limit').value;

        const params = new URLSearchParams();
        if (ticker) params.set('ticker', ticker);
        if (model) params.set('model', model);
        params.set('promptVersion', 'v2');
        params.set('limit', limit);

        try {
            const res = await fetch(`${API_BASE}/recent?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const rows = data.rows || [];
            renderHeroMetrics(rows);
            renderTable(rows);
        } catch (err) {
            // textContent, not innerHTML — err.message can carry upstream response text.
            const el = document.getElementById('lal-table');
            el.textContent = '';
            const msg = document.createElement('div');
            msg.style.cssText = 'color:#FF4560;padding:20px;text-align:center;';
            msg.textContent = `Fetch failed: ${err.message || err}`;
            el.appendChild(msg);
        }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        timer = setInterval(fetchAndRender, REFRESH_MS);
    }
    function stopAutoRefresh() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    // Wire up tab activation — only fetch when this tab becomes visible to avoid
    // wasted requests for users who never open it.
    function onTabClick(e) {
        const t = e.target.closest('.tab');
        if (!t) return;
        if (t.dataset.tab === 'llm-analysis-logs') {
            fetchAndRender();
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('.dashboard-tabs').addEventListener('click', onTabClick);
        document.getElementById('lal-refresh').addEventListener('click', fetchAndRender);
        ['lal-filter-ticker', 'lal-filter-model', 'lal-filter-limit'].forEach(id => {
            document.getElementById(id).addEventListener('change', fetchAndRender);
        });
        // If the page loads with the tab already active (e.g. deep link), fetch immediately.
        if (document.querySelector('.tab.active[data-tab="llm-analysis-logs"]')) {
            fetchAndRender();
            startAutoRefresh();
        }
    });
})();
