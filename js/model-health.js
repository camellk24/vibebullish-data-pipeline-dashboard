// Saved-report reader for the admin Heartbeats tab. No compute/refresh endpoint.
(function () {
    'use strict';
    let generation = 0;
    let timer = null;
    const statuses = ['PASS', 'WARN', 'FAIL'];
    const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const panel = () => document.getElementById('ops-model-health');
    function chip(status) {
        const known = statuses.includes(status);
        const color = status === 'PASS' ? 'ok' : status === 'WARN' ? 'warn' : status === 'FAIL' ? 'bad' : 'unknown';
        return `<span class="ops-chip ops-chip-${color}">${known ? status : 'unknown'}</span>`;
    }
    function clear() {
        generation++;
        if (timer !== null) clearInterval(timer);
        timer = null;
        const el = panel();
        if (el) el.innerHTML = '';
    }
    function valid(s) {
        return s && Number.isSafeInteger(s.snapshot_id) && s.snapshot_id > 0 &&
            typeof s.generated_at === 'string' && Number.isFinite(Date.parse(s.generated_at)) &&
            number(s.age_seconds) && number(s.threshold_hours) && s.threshold_hours > 0 &&
            ['fresh', 'stale'].includes(s.freshness) && s.report &&
            statuses.includes(s.report.status) && Array.isArray(s.report.cohorts);
    }
    function render(s, receivedAt) {
        const el = panel();
        if (!el) return;
        // Age from the server's clock, plus elapsed viewing time. A browser
        // left open past the cutoff must not keep labelling this report fresh.
        const age = s.age_seconds + Math.max(0, Date.now() - receivedAt) / 1000;
        const stale = s.freshness === 'stale' || age > s.threshold_hours * 3600;
        const rows = s.report.cohorts.filter(c => c && typeof c === 'object').map(c => `<tr>
            <td>${esc(c.cohort || 'Unknown cohort')}</td><td>${chip(c.status)}</td>
            <td>${chip(c.coverage && c.coverage.status)}</td><td>${chip(c.substrate && c.substrate.status)}</td>
            <td>${chip(c.liveness && c.liveness.severity)}</td><td>${chip(c.calibration && c.calibration.severity)}</td>
        </tr>`).join('');
        const reasons = Array.isArray(s.report.reasons) ? s.report.reasons.filter(r => typeof r === 'string') : [];
        el.innerHTML = `<div class="ops-model-summary">
            <span class="ops-chip ops-chip-${stale ? 'warn' : 'ok'}">${stale ? 'Stale' : 'Fresh'}</span>
            <span>Saved report: ${chip(s.report.status)}</span>
            <span class="ops-dim">${Math.floor(age / 3600)}h ${Math.floor(age % 3600 / 60)}m old · freshness limit ${esc(s.threshold_hours)}h</span>
        </div>
        ${stale ? '<p class="ops-model-stale">Historical result — this report is too old to describe current model health.</p>' : ''}
        <p class="ops-dim">Generated ${esc(new Date(s.generated_at).toISOString().replace('T', ' '))} · Sample ${number(s.sample_size) ? esc(s.sample_size) : 'unknown'} · ${esc(s.trigger || 'unknown trigger')} · Snapshot ${esc(s.snapshot_id)}</p>
        ${reasons.length ? `<ul>${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${rows ? `<div class="ao-scroll"><table class="data-table ops-table"><thead><tr><th>Cohort</th><th>Report</th><th>Coverage</th><th>Substrate</th><th>Liveness</th><th>Calibration</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="ops-dim">No cohort checks recorded.</p>'}`;
    }
    async function load() {
        clear();
        if (!window.VBAuth || !window.VBAuth.isAdmin) return;
        const el = panel();
        if (!el) return;
        const mine = generation;
        el.innerHTML = '<div class="ops-loading">Loading saved report…</div>';
        try {
            const res = await window.VBAuth.fetch('/api/ops/heartbeats?view=model-health');
            const body = await res.json();
            if (mine !== generation || !window.VBAuth.isAdmin) return;
            if (res.status === 404 && body && body.error === 'snapshot_missing') {
                el.innerHTML = '<div class="ops-unavailable">No saved report yet. A model-health snapshot has not been recorded.</div>';
                return;
            }
            if (res.status !== 200 || !valid(body)) throw new Error('unavailable');
            const receivedAt = Date.now();
            render(body, receivedAt);
            timer = setInterval(() => {
                if (!window.VBAuth || !window.VBAuth.isAdmin) { clear(); return; }
                render(body, receivedAt);
            }, 60000);
        } catch (_e) {
            if (mine === generation) el.innerHTML = '<div class="ops-unavailable">Saved report unavailable. Check admin access and backend availability, then reopen this tab to retry.</div>';
        }
    }
    window.addEventListener('vb-auth-change', e => {
        if (!e.detail || e.detail.state !== 'admin') clear();
    });
    window.ModelHealth = { load };
})();
