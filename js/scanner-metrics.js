// Scanner activity metrics — reads VBReads.get('scanner-metrics', {hours: 24})
// (js/reads.js → /api/ops/reads → /api/scanner/metrics) and renders a hero
// strip + per-source breakdown in the System Health tab. Loaded by that tab's
// VBTabs definition in js/dashboard.js (window.ScannerMetrics.load / clear).
(function () {
    function num(n) {
        const v = VBReads.num(n);
        return v === null ? '—' : v.toLocaleString('en-US');
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
            { label: 'Sources active', value: num((Array.isArray(m.by_source) ? m.by_source : []).length) },
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
        const rows = Array.isArray(m.by_source) ? m.by_source : [];
        if (rows.length === 0) {
            el.innerHTML = '<span class="dim">No scanner activity in this window.</span>';
            return;
        }
        const dispatches = rows.map(r => VBReads.num(r.dispatches) || 0);
        const max = Math.max(...dispatches, 1);
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
        rows.forEach((r, i) => {
            const sourceName = r.source == null || r.source === '' ? '(unknown)' : String(r.source);
            const pct = (dispatches[i] / max) * 100;
            const avgRaw = VBReads.num(r.avg_duration_ms);
            const avgMs = avgRaw ? Math.round(avgRaw) : 0;
            const errClass = (VBReads.num(r.errors) || 0) > 0 ? 'cell-warn' : '';
            html.push(
                '<tr>',
                '<td><code>', esc(sourceName), '</code></td>',
                '<td class="num">', num(r.dispatches), '</td>',
                '<td class="num">', num(r.unique_tickers), '</td>',
                '<td class="num">', num(r.llm_calls), '</td>',
                '<td class="num ', errClass, '">', num(r.errors), '</td>',
                '<td class="num">', num(avgMs), ' ms</td>',
                '<td><div class="bar-row"><div class="bar-fill" style="width:', pct.toFixed(1), '%"></div></div></td>',
                '</tr>',
            );
        });
        html.push('</tbody></table>');
        el.innerHTML = html.join('');
    }

    async function load(ctx) {
        const r = await VBReads.get('scanner-metrics', { hours: 24 });
        if (!ctx.live()) return;
        const content = document.getElementById('scanner-by-source-content');
        if (!r.ok) {
            const hero = document.getElementById('scanner-hero-metrics');
            if (hero) hero.innerHTML = '';
            VBReads.unavailable(content, r.kind, r.message);
            return;
        }
        try {
            renderHero(r.body);
            renderBySource(r.body);
        } catch (err) {
            console.error('Scanner metrics render failed:', err);
            const hero = document.getElementById('scanner-hero-metrics');
            if (hero) hero.innerHTML = '';
            VBReads.unavailable(content, 'upstream_error', 'The backend payload could not be rendered.');
        }
    }

    function clear() {
        ['scanner-hero-metrics', 'scanner-by-source-content'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });
    }

    window.ScannerMetrics = { load, clear };
})();
