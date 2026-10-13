// Pure render helpers for the Strategies tab's book diagnostics card
// (GET /api/ops/strategy-diagnostics → backend
// /api/internal/ops/strategy-diagnostics). Spec: vibebullish-docs
// docs/superpowers/specs/2026-10-11-strategies-tab-diagnostics-spec.md,
// "Tab presentation contract":
//   - books and pairs in the order received, never sorted by a number;
//   - n and the 95% interval beside every correlation; an insufficient one greyed;
//   - null renders as "unknown" (with the book's error), never 0;
//   - the A21 note on diagnostic books;
//   - turnover labelled with its basis ("paper"), annualised only when present;
//   - the capacity assumption (1% of 30-day ADV, one session) beside the figure.
//
// No DOM dependency: every function takes `esc` and returns strings, so
// js/ops-console.js renders with it in the browser and
// js/strategy-diagnostics-format.test.js runs it under node:test.
// UMD-lite, like js/dq-readiness-format.js.

(function () {
    'use strict';

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    function asArray(v) {
        return Array.isArray(v) ? v : [];
    }

    function str(v) {
        return typeof v === 'string' && v ? v : null;
    }

    function fixed(v, digits) {
        return isNum(v) ? v.toFixed(digits) : null;
    }

    // '2026-10-13 19:45Z'; an unparseable value is returned as given.
    // Mirrors dq-readiness-format.js's shortTs (duplicated to stay dependency-free).
    function shortTs(iso) {
        const t = new Date(iso);
        if (isNaN(t.getTime())) return String(iso);
        return t.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    }

    function unknown(title, esc) {
        return `<span class="ops-unknown" title="${esc(title || 'Not reported by the backend')}">unknown</span>`;
    }

    function count(v, esc, title) {
        return Number.isSafeInteger(v) ? esc(String(v)) : unknown(title, esc);
    }

    // '$2.43M' / '$15.3k' / '$950'; null for anything that is not a finite number.
    function money(v) {
        if (!isNum(v)) return null;
        const a = Math.abs(v);
        if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
        if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
        return '$' + v.toFixed(0);
    }

    // A correlation with its 95% interval. Null is "unknown", never 0.
    function corrCell(r, ci, esc) {
        const point = fixed(r, 2);
        if (point === null) return unknown('No estimate', esc);
        const lo = Array.isArray(ci) ? fixed(ci[0], 2) : null;
        const hi = Array.isArray(ci) ? fixed(ci[1], 2) : null;
        const interval = lo !== null && hi !== null
            ? `[${esc(lo)}, ${esc(hi)}]`
            : '[interval unknown]';
        return `${esc(point)} <span class="sd-ci">${interval}</span>`;
    }

    function statusChip(status, esc) {
        const s = str(status) || 'unknown';
        const key = s === 'PASS' ? 'ok' : s === 'WARN' ? 'warn' : s === 'FAIL' ? 'bad' : 'unknown';
        return `<span class="ops-chip ops-chip-${key}">${esc(s)}</span>`;
    }

    function errorsOf(b) {
        return asArray(b && b.errors).filter(e => typeof e === 'string' && e);
    }

    function turnoverCell(t, errText, esc) {
        if (!t || typeof t !== 'object') return unknown(errText, esc);
        const oneWay = fixed(t.turnover_one_way, 2);
        const entries = fixed(t.entries_to_equity, 2);
        const head = oneWay !== null ? `${esc(oneWay)}× one-way` : unknown(null, esc);
        const annual = isNum(t.annualized_one_way)
            ? ` · ${esc(t.annualized_one_way.toFixed(1))}×/yr`
            : '';
        const basis = str(t.basis) || 'basis unknown';
        const win = Number.isSafeInteger(t.window_sessions) ? `${t.window_sessions} sessions` : 'window unknown';
        const state = str(t.state) || 'unknown';
        return `${head}${annual}
            <div class="sd-sub">entries ${entries !== null ? esc(entries) + '×' : 'unknown'}</div>
            <div class="sd-sub">${esc(basis)} · ${esc(win)} · ${esc(state)}</div>`;
    }

    function capacityCell(c, errText, esc) {
        if (!c || typeof c !== 'object') return unknown(errText, esc);
        const figure = money(c.capacity_usd);
        const missing = asArray(c.missing_adv).filter(x => typeof x === 'string' && x);
        let head;
        if (figure !== null) {
            head = esc(figure);
        } else if (c.state === 'partial_adv') {
            head = `<span class="ops-dim">no figure: ADV missing for ${
                missing.length ? esc(missing.join(', ')) : 'some positions'}</span>`;
        } else {
            head = unknown(null, esc);
        }
        const pct = isNum(c.participation) ? String(+(c.participation * 100).toFixed(2)) : 'unknown';
        const top = fixed(c.top_position_pct, 1);
        const binding = str(c.binding_ticker);
        return `${head}
            <div class="sd-sub">at ${esc(pct)}% of 30-day ADV, one session</div>
            <div class="sd-sub">${count(c.positions_with_adv, esc)} of ${count(c.positions, esc)} positions with ADV · top ${
                top !== null ? esc(top) + '%' : 'unknown'} (cost basis) · binding ${binding ? esc(binding) : 'unknown'}</div>`;
    }

    function bookRow(b, esc) {
        const errs = errorsOf(b);
        const errText = errs.join('; ') || null;
        const label = str(b.label) || 'unlabelled';
        const id = Number.isSafeInteger(b.book_id) ? String(b.book_id) : '?';
        const diag = b.presentation === 'diagnostic'
            ? ` <span class="ops-chip ops-chip-unknown">diagnostic · ${esc(str(b.registry) || 'A21')}</span>`
            : '';
        const paused = b.paused === true ? ' <span class="ops-chip ops-chip-warn">paused</span>' : '';
        const note = b.presentation === 'diagnostic' && str(b.note)
            ? `<div class="sd-note">${esc(b.note)}</div>`
            : '';
        const errLine = errs.length ? `<div class="sd-sub ops-bad">${esc(errText)}</div>` : '';
        return `<tr>
            <td><strong>${esc(label)}</strong> <span class="ops-dim">#${esc(id)}</span>${diag}${paused}${note}${errLine}</td>
            <td class="r">${count(b.sessions_observed, esc, errText)}</td>
            <td>${turnoverCell(b.turnover, errText, esc)}</td>
            <td>${capacityCell(b.capacity, errText, esc)}</td>
        </tr>`;
    }

    const NO_ESTIMATE = { too_few: 'too few sessions', zero_variance: 'constant returns' };

    function pairRow(p, labelOf, esc) {
        const state = str(p.state) || 'unknown';
        const why = Object.prototype.hasOwnProperty.call(NO_ESTIMATE, state) ? NO_ESTIMATE[state] : null;
        const noEst = why ? `<span class="ops-dim">no estimate (${why})</span>` : null;
        return `<tr class="${state === 'observed' ? '' : 'sd-grey'}">
            <td>${esc(labelOf(p.a))} × ${esc(labelOf(p.b))}</td>
            <td class="r">${count(p.n, esc)}</td>
            <td class="r">${noEst || corrCell(p.raw, p.raw_ci95, esc)}</td>
            <td class="r">${noEst || corrCell(p.residual, p.residual_ci95, esc)}</td>
            <td class="r">${count(p.dropped_misaligned, esc)}</td>
            <td>${esc(state)}</td>
        </tr>`;
    }

    // render(payload, esc) → { html, badge, badgeBad }
    function render(payload, esc) {
        const p = payload && typeof payload === 'object' ? payload : {};
        const books = asArray(p.books).filter(b => b && typeof b === 'object');
        const corr = p.correlation && typeof p.correlation === 'object' ? p.correlation : {};
        const pairs = asArray(corr.pairs).filter(x => x && typeof x === 'object');
        const cap = corr.cap && typeof corr.cap === 'object' ? corr.cap : {};
        const params = p.params && typeof p.params === 'object' ? p.params : {};

        const labels = new Map();
        books.forEach(b => {
            if (Number.isSafeInteger(b.book_id)) labels.set(b.book_id, str(b.label));
        });
        const labelOf = id => (labels.get(id) ? `${labels.get(id)} (#${id})` : `book ${id}`);

        const status = str(p.status) || 'unknown';
        const degraded = p.degraded === true;
        const observed = pairs.filter(x => x.state === 'observed').length;

        const win = Number.isSafeInteger(params.corr_window_sessions) ? params.corr_window_sessions : '?';
        const floor = Number.isSafeInteger(params.corr_floor_sessions) ? params.corr_floor_sessions : '?';
        const min = Number.isSafeInteger(params.corr_min_sessions) ? params.corr_min_sessions : '?';
        const bench = str(params.benchmark) || 'benchmark';

        const booksBody = books.length
            ? `<table class="data-table ops-table sd-books">
                <thead><tr><th>book</th><th>sessions</th><th>turnover (20 sessions)</th><th>capacity</th></tr></thead>
                <tbody>${books.map(b => bookRow(b, esc)).join('')}</tbody></table>`
            : '<div class="ops-dim">No active paper books.</div>';

        const pairsBody = pairs.length
            ? `<table class="data-table ops-table sd-pairs">
                <thead><tr><th>pair</th><th>n</th><th>raw [95%]</th><th>residual given ${esc(bench)} [95%]</th>
                <th>dropped</th><th>state</th></tr></thead>
                <tbody>${pairs.map(x => pairRow(x, labelOf, esc)).join('')}</tbody></table>`
            : '<div class="ops-dim">No book pairs.</div>';

        const html = `
            <div class="sd-head">
                ${statusChip(status, esc)}${degraded ? ' <span class="ops-chip ops-chip-bad">degraded</span>' : ''}
                <span class="ops-dim">correlation cap: ${esc(str(cap.state) || 'unknown')}${
                    str(cap.detail) ? ' — ' + esc(cap.detail) : ''}</span>
                <span class="ops-dim">generated ${esc(str(p.generated_at) ? shortTs(p.generated_at) : 'unknown')}</span>
            </div>
            ${str(p.note) ? `<details class="sd-notes"><summary>How to read this</summary><p>${esc(p.note)}</p></details>` : ''}
            <h3 class="sd-h">Books</h3>
            <div class="ao-scroll">${booksBody}</div>
            <h3 class="sd-h">Correlation of daily returns · last ${esc(String(win))} common sessions · estimate from ${
                esc(String(floor))}, observed from ${esc(String(min))}</h3>
            <div class="ao-scroll">${pairsBody}</div>`;

        return {
            html,
            badge: `${books.length} books · ${pairs.length} pairs · ${observed} observed`,
            badgeBad: degraded || status === 'FAIL' || status === 'UNKNOWN',
        };
    }

    const StrategyDiagnosticsFormat = { render, corrCell, money };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StrategyDiagnosticsFormat;
    }
    if (typeof window !== 'undefined') {
        window.StrategyDiagnosticsFormat = StrategyDiagnosticsFormat;
    }
})();
