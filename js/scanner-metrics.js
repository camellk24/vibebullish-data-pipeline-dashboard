// Scanner activity metrics — fetches /api/scanner/metrics?hours=24 and
// renders a hero strip + per-source breakdown in the System Health tab.
(function () {
    const API = 'https://api.vibebullish.com/api/scanner/metrics';

    function num(n) {
        if (n == null) return '—';
        return n.toLocaleString('en-US');
    }

    function renderHero(m) {
        const el = document.getElementById('scanner-hero-metrics');
        if (!el) return;
        el.innerHTML = '';
        const cells = [
            { label: 'Unique tickers', value: num(m.unique_tickers) },
            { label: 'Total dispatches', value: num(m.total_dispatches) },
            { label: 'LLM calls', value: num(m.total_llm_calls) },
            { label: 'Errors', value: num(m.total_errors) },
            { label: 'Sources active', value: num((m.by_source || []).length) },
        ];
        for (const c of cells) {
            const card = document.createElement('div');
            card.className = 'metric-card';
            const v = document.createElement('div');
            v.className = 'metric-value';
            v.textContent = c.value;
            const lbl = document.createElement('div');
            lbl.className = 'metric-label';
            lbl.textContent = c.label;
            card.appendChild(v);
            card.appendChild(lbl);
            el.appendChild(card);
        }
    }

    function renderBySource(m) {
        const el = document.getElementById('scanner-by-source-content');
        if (!el) return;
        const rows = m.by_source || [];
        if (rows.length === 0) {
            el.innerHTML = '<span class="dim">No scanner activity in this window.</span>';
            return;
        }
        const max = Math.max(...rows.map((r) => r.dispatches), 1);
        const html = [
            '<table class="data-table">',
            '<thead><tr>',
            '<th>Source</th>',
            '<th class="num">Dispatches</th>',
            '<th class="num">Unique tickers</th>',
            '<th class="num">LLM calls</th>',
            '<th class="num">Errors</th>',
            '<th class="num">Avg duration</th>',
            '<th>Share</th>',
            '</tr></thead>',
            '<tbody>',
        ];
        for (const r of rows) {
            const sourceName = r.source || '(unknown)';
            const pct = (r.dispatches / max) * 100;
            const avgMs = r.avg_duration_ms ? Math.round(r.avg_duration_ms) : 0;
            const errClass = r.errors > 0 ? 'cell-warn' : '';
            html.push(
                '<tr>',
                '<td><code>', escapeHtml(sourceName), '</code></td>',
                '<td class="num">', num(r.dispatches), '</td>',
                '<td class="num">', num(r.unique_tickers), '</td>',
                '<td class="num">', num(r.llm_calls), '</td>',
                '<td class="num ', errClass, '">', num(r.errors), '</td>',
                '<td class="num">', num(avgMs), ' ms</td>',
                '<td><div class="bar-row"><div class="bar-fill" style="width:', pct.toFixed(1), '%"></div></div></td>',
                '</tr>',
            );
        }
        html.push('</tbody></table>');
        el.innerHTML = html.join('');
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function load() {
        try {
            const res = await fetch(`${API}?hours=24`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const m = await res.json();
            renderHero(m);
            renderBySource(m);
        } catch (err) {
            const el = document.getElementById('scanner-by-source-content');
            if (el) el.innerHTML = `<span class="dim">Error: ${escapeHtml(String(err))}</span>`;
        }
    }

    // Lazy-load when the System Health tab becomes visible. Re-runs on every
    // tab click — cheap (one query) and keeps the data fresh.
    function attachTabHook() {
        const btn = document.querySelector('.tab[data-tab="system-health"]');
        if (!btn) return;
        btn.addEventListener('click', () => setTimeout(load, 50));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            attachTabHook();
            // If the user lands on system-health via URL, fire immediately.
            const tab = document.getElementById('tab-system-health');
            if (tab && tab.style.display !== 'none') load();
        });
    } else {
        attachTabHook();
        const tab = document.getElementById('tab-system-health');
        if (tab && tab.style.display !== 'none') load();
    }
})();
