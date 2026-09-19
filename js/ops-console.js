// Ops console — Shadow book + Heartbeats tabs (Phase D, task 6).
//
// ACCESS: both tabs are hidden until /api/ops/whoami says the signed-in Google
// account is an admin (js/auth.js owns sign-in and fires `vb-auth-change`). The
// public tabs are untouched and stay unauthenticated — this is ONE deployment.
//
// DATA: same-origin /api/ops/* Vercel functions, which verify the Firebase ID
// token and then forward to the token-gated backend. The browser never holds
// INTERNAL_API_TOKEN.
//
// DESIGN RULE — degrade per panel, never break the page. The Phase D backend
// endpoints may not be deployed yet; a 404 / not_configured / unreachable
// response renders that ONE panel as an explicit "unavailable" state with the
// reason. It never blanks the tab, and it never leaves stale numbers on screen
// pretending to be current.

(function () {
    'use strict';

    const OPS_TABS = ['ops-shadow', 'ops-heartbeats'];
    const LOADING = '<div class="ops-loading">Loading…</div>';

    let bookId = null; // null = let the backend default to the shadow book

    // Sleeve 2 (2026-09-18): the shadow book is no longer singular. `sleeves`
    // is the normalized list from /api/ops/shadow?view=sleeves; `sleeveModeUnavailable`
    // is true when that view 404s (older backend) or otherwise fails, in which
    // case the console falls back to single-sleeve mode exactly as before —
    // no selector, no counterpart param, `bookId` stays whatever the backend
    // defaults to. `counterpartBookId` is the diffs panel's comparison choice.
    let sleeves = [];
    let sleeveModeUnavailable = false;
    let counterpartBookId = null;

    // ── helpers ──────────────────────────────────────────────────────────────

    // Attribute-safe: these strings land inside quoted HTML attributes (title=,
    // data-target=), so quotes MUST be escaped too — a textContent/innerHTML
    // round-trip does not escape them and would let `" onmouseover=` break out.
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    // Backend structs in this phase are a mix of json-tagged and Go-default
    // (PascalCase) names — read both rather than guess one.
    function pick(obj /* , ...names */) {
        if (!obj || typeof obj !== 'object') return undefined;
        for (let i = 1; i < arguments.length; i++) {
            const n = arguments[i];
            if (obj[n] !== undefined && obj[n] !== null) return obj[n];
            const snake = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
            if (obj[snake] !== undefined && obj[snake] !== null) return obj[snake];
        }
        return undefined;
    }

    // Some handlers wrap their list in an object; accept either.
    function asArray(payload /* , ...keys */) {
        if (Array.isArray(payload)) return payload;
        for (let i = 1; i < arguments.length; i++) {
            const v = payload && payload[arguments[i]];
            if (Array.isArray(v)) return v;
        }
        if (payload && typeof payload === 'object') {
            for (const k of Object.keys(payload)) {
                if (Array.isArray(payload[k])) return payload[k];
            }
        }
        return [];
    }

    function relTime(iso) {
        if (!iso) return null;
        const t = Date.parse(iso);
        if (isNaN(t)) return null;
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.round(s / 60) + 'm ago';
        if (s < 172800) return Math.round(s / 3600) + 'h ago';
        return Math.round(s / 86400) + 'd ago';
    }

    function ageLabel(seconds) {
        if (!isNum(seconds)) return null;
        if (seconds < 90) return Math.round(seconds) + 's';
        if (seconds < 5400) return Math.round(seconds / 60) + 'm';
        if (seconds < 172800) return Math.round(seconds / 3600) + 'h';
        return Math.round(seconds / 86400) + 'd';
    }

    function shortTs(iso) {
        if (!iso) return '—';
        const t = new Date(iso);
        if (isNaN(t.getTime())) return esc(iso);
        return t.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    }

    function unknownSpan(title) {
        return `<span class="ops-unknown" title="${esc(title || 'Not reported by the backend')}">unknown</span>`;
    }

    // The one shared "this panel has no data to show, and here is why" state.
    function unavailable(el, kind, message) {
        if (!el) return;
        const title =
            kind === 'not_found'
                ? 'Not available on this backend yet'
                : kind === 'not_configured'
                ? 'Ops proxy is not configured'
                : kind === 'forbidden' || kind === 'unauthenticated'
                ? 'Admin sign-in required'
                : kind === 'empty'
                ? 'Nothing recorded yet'
                : 'Backend unavailable';
        const hint =
            kind === 'not_found'
                ? 'The Phase D endpoint is not deployed on this backend. Nothing is shown rather than something stale.'
                : kind === 'not_configured'
                ? 'Set <code>INTERNAL_API_TOKEN</code> on the Vercel project (Production + Preview) and redeploy.'
                : kind === 'empty'
                ? ''
                : 'Nothing is shown, because showing the last-known numbers here would read as current state.';
        el.innerHTML = `
            <div class="ops-unavailable">
                <div class="ops-unavailable-title">${esc(title)}</div>
                ${message ? `<div class="ops-unavailable-msg">${esc(message)}</div>` : ''}
                ${hint ? `<div class="ops-unavailable-hint">${hint}</div>` : ''}
            </div>`;
    }

    // GET a same-origin ops endpoint. Resolves to {ok, body} or {ok:false, kind, message}.
    async function opsGet(path) {
        if (!window.VBAuth || !window.VBAuth.isAdmin) {
            return { ok: false, kind: 'forbidden', message: 'Sign in with an admin account.' };
        }
        let res;
        try {
            res = await window.VBAuth.fetch(path);
        } catch (err) {
            return { ok: false, kind: 'unreachable', message: String((err && err.message) || err) };
        }
        let body = null;
        try {
            body = await res.json();
        } catch (_e) {
            body = null;
        }
        if (res.status === 200 && body && !body.error) return { ok: true, body };
        return {
            ok: false,
            kind: (body && body.error) || (res.status === 404 ? 'not_found' : 'unreachable'),
            message: (body && body.message) || `HTTP ${res.status}`,
        };
    }

    // ── Shadow book tab ──────────────────────────────────────────────────────

    function q(extra) {
        const parts = [];
        if (bookId != null) parts.push('book_id=' + encodeURIComponent(bookId));
        if (extra) parts.push(extra);
        return parts.length ? '&' + parts.join('&') : '';
    }

    // ── Sleeve + comparison selectors ────────────────────────────────────────

    function currentSleeve() {
        if (bookId == null) return sleeves[0] || null;
        return sleeves.find(s => String(s.bookId) === String(bookId)) || null;
    }

    function sleeveLabel(s) {
        const name = s.name || 'sleeve';
        const version = s.version !== undefined && s.version !== null && s.version !== '' ? '@' + s.version : '';
        return `${name}${version} (book ${s.bookId})`;
    }

    // "vs legacy book 56" / "vs sleeve baseline_v2 (book 61)" — a sleeve-kind
    // counterpart is named by looking up the OTHER declared sleeve sharing
    // that book id; if the sleeve list doesn't know it (shouldn't happen, but
    // never assert a name we don't have), fall back to the book id alone.
    function comparisonLabel(comp) {
        const cbid = comp.counterpartBookId;
        if (comp.kind === 'sleeve') {
            const other = sleeves.find(s => String(s.bookId) === String(cbid));
            return other ? `vs sleeve ${esc(other.name || 'sleeve')} (book ${esc(String(cbid))})` : `vs sleeve (book ${esc(String(cbid))})`;
        }
        return `vs legacy book ${esc(String(cbid))}`;
    }

    // Default comparison = the sleeve's declared legacy counterpart, falling
    // back to its first declared comparison when none is tagged "legacy".
    function setCounterpartDefault() {
        const s = currentSleeve();
        if (!s || !s.comparisons.length) {
            counterpartBookId = null;
            return;
        }
        const legacy = s.comparisons.find(c => c.kind === 'legacy');
        counterpartBookId = (legacy || s.comparisons[0]).counterpartBookId;
    }

    function renderSleeveSelect() {
        const wrap = document.getElementById('ops-sleeve-select-wrap');
        if (!wrap) return;
        // Nothing to pick between: 404/error (old backend) or a single
        // declared sleeve both render as "no selector", same as today.
        if (sleeveModeUnavailable || sleeves.length < 2) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        const opts = sleeves
            .map(
                s =>
                    `<option value="${esc(String(s.bookId))}"${
                        String(s.bookId) === String(bookId) ? ' selected' : ''
                    }>${esc(sleeveLabel(s))}</option>`
            )
            .join('');
        wrap.innerHTML = `<label class="ops-select-label">Sleeve <select id="ops-sleeve-select">${opts}</select></label>`;
        const sel = document.getElementById('ops-sleeve-select');
        if (sel) {
            sel.addEventListener('change', e => {
                bookId = e.target.value;
                setCounterpartDefault();
                renderComparisonSelect();
                loadShadowStatus();
                loadShadowEvidence();
                loadShadowAttribution();
                loadShadowDiffs();
            });
        }
    }

    function renderComparisonSelect() {
        const wrap = document.getElementById('ops-diffs-comparison-wrap');
        if (!wrap) return;
        const s = currentSleeve();
        if (!s || !s.comparisons.length) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        wrap.style.display = '';
        const opts = s.comparisons
            .map(
                c =>
                    `<option value="${esc(String(c.counterpartBookId))}"${
                        String(c.counterpartBookId) === String(counterpartBookId) ? ' selected' : ''
                    }>${esc(comparisonLabel(c).replace(/^vs\s+/, ''))}</option>`
            )
            .join('');
        wrap.innerHTML = `<label class="ops-select-label">Compare <select id="ops-diffs-comparison-select">${opts}</select></label>`;
        const sel = document.getElementById('ops-diffs-comparison-select');
        if (sel) {
            sel.addEventListener('change', e => {
                counterpartBookId = e.target.value;
                loadShadowDiffs();
            });
        }
    }

    async function loadSleeves() {
        const r = await opsGet('/api/ops/shadow?view=sleeves');
        if (!r.ok) {
            // Graceful degrade: old backend (404) or any other failure →
            // single-sleeve mode exactly as today. Leave bookId/counterpartBookId
            // untouched so the existing panels behave unchanged.
            sleeves = [];
            sleeveModeUnavailable = true;
            renderSleeveSelect();
            renderComparisonSelect();
            return;
        }

        const rawList = asArray(r.body, 'sleeves');
        sleeves = rawList.map(s => ({
            name: pick(s, 'name'),
            version: pick(s, 'version'),
            bookId: pick(s, 'bookId', 'book_id'),
            releaseId: pick(s, 'releaseId', 'release_id'),
            legacyBookId: pick(s, 'legacyBookId', 'legacy_book_id'),
            routines: pick(s, 'routines') || {},
            comparisons: asArray(pick(s, 'comparisons') || [], 'comparisons').map(c => ({
                counterpartBookId: pick(c, 'counterpartBookId', 'counterpart_book_id'),
                kind: pick(c, 'kind'),
            })),
        }));
        sleeveModeUnavailable = false;

        // Default = the first declared sleeve (the baseline, by backend
        // ordering convention) unless the current bookId already names a
        // known sleeve (e.g. set externally via OpsConsole.setBookId).
        if (sleeves.length && (bookId == null || !sleeves.some(s => String(s.bookId) === String(bookId)))) {
            bookId = sleeves[0].bookId;
        }
        setCounterpartDefault();
        renderSleeveSelect();
        renderComparisonSelect();
    }

    // The release badge. The backend's field is `name` (e.g. "baseline_v2");
    // `strategy` is the older spelling and stays as a fallback so an older
    // backend still renders something real instead of "unknown".
    function releaseLabelOf(release) {
        if (release === null || release === undefined) return null;
        if (typeof release !== 'object') return String(release);
        const name = pick(release, 'name', 'strategy');
        const version = pick(release, 'version');
        const joined = [name, version].filter(v => v !== undefined && v !== null && v !== '').join('@');
        return joined || pick(release, 'id') || null;
    }

    // When the shadow run "last ran" is the moment the allocation was FORMED —
    // `formed_at` is the run's own clock. `ran_at` / `created_at` are the
    // wrapper's, and `session_date` is a date, not a timestamp, so it is the
    // last resort rather than the first match.
    function lastRunTsOf(lastRun) {
        if (lastRun === null || lastRun === undefined) return null;
        if (typeof lastRun !== 'object') return lastRun;
        const v = pick(lastRun, 'formedAt', 'ranAt', 'createdAt', 'sessionDate');
        return v === undefined ? null : v;
    }

    async function loadShadowStatus() {
        const el = document.getElementById('ops-shadow-status');
        if (!el) return;
        el.innerHTML = LOADING;
        const r = await opsGet('/api/ops/shadow?view=status' + q());
        if (!r.ok) return unavailable(el, r.kind, r.message);

        const d = r.body || {};
        const book = pick(d, 'book') || {};
        const release = pick(d, 'release') || {};
        const mode = pick(d, 'mode');
        const frozen = pick(d, 'frozen');
        const lastRun = pick(d, 'lastRun', 'last_run');
        const openRecs = pick(d, 'openReconciliations', 'open_reconciliations');

        const bookLabel =
            (typeof book === 'object' ? pick(book, 'id', 'bookId') : book) != null
                ? '#' + esc(typeof book === 'object' ? pick(book, 'id', 'bookId') : book)
                : unknownSpan();
        const releaseLabel = releaseLabelOf(release) || 'unknown';
        const releaseState = typeof release === 'object' ? pick(release, 'state') : null;

        const lastRunTs = lastRunTsOf(lastRun);
        const lastRunRel = relTime(lastRunTs);

        const frozenKnown = typeof frozen === 'boolean';
        const recsKnown = isNum(openRecs);

        el.innerHTML = `
            <div class="ops-strip">
                <div class="metric-card">
                    <div class="metric-label">Mode</div>
                    <div class="metric-value ops-strip-val">${mode ? esc(String(mode)) : unknownSpan()}</div>
                    <div class="metric-sub">dispatcher derivation</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Frozen</div>
                    <div class="metric-value ops-strip-val ${frozenKnown && frozen ? 'ops-bad' : frozenKnown ? 'ops-good' : ''}">
                        ${frozenKnown ? (frozen ? 'FROZEN' : 'no') : unknownSpan()}
                    </div>
                    <div class="metric-sub">book pause state</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Last run</div>
                    <div class="metric-value ops-strip-val">${lastRunRel ? esc(lastRunRel) : unknownSpan()}</div>
                    <div class="metric-sub">${lastRunTs ? esc(shortTs(lastRunTs)) : ''}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Open reconciliations</div>
                    <div class="metric-value ops-strip-val ${recsKnown && openRecs > 0 ? 'ops-bad' : ''}">
                        ${recsKnown ? esc(String(openRecs)) : unknownSpan()}
                    </div>
                    <div class="metric-sub">unresolved discrepancies</div>
                </div>
            </div>
            <div class="ops-strip-meta">
                <span>book ${bookLabel}</span>
                <span>release <code>${esc(releaseLabel)}</code>${releaseState ? ' · ' + esc(releaseState) : ''}</span>
            </div>`;
    }

    // Evidence rows come straight out of ShadowEvidenceSQL, whose column set is
    // the backend's to choose. Render whatever columns arrive, session first.
    const EVIDENCE_FIRST = ['session_date', 'sessionDate', 'execution_date', 'ticker', 'side'];

    async function loadShadowEvidence() {
        const el = document.getElementById('ops-shadow-evidence');
        if (!el) return;
        el.innerHTML = LOADING;
        const r = await opsGet('/api/ops/shadow?view=evidence' + q('sessions=30'));
        if (!r.ok) return unavailable(el, r.kind, r.message);

        const rows = asArray(r.body, 'rows', 'evidence');
        if (!rows.length) return unavailable(el, 'empty', 'No shadow sessions recorded yet.');

        const keys = [];
        for (const k of EVIDENCE_FIRST) if (rows[0][k] !== undefined && !keys.includes(k)) keys.push(k);
        for (const row of rows) {
            for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
        }

        const head = keys.map(k => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('');
        const body = rows
            .map(row => {
                const tds = keys
                    .map(k => {
                        const v = row[k];
                        if (v === undefined || v === null) return `<td class="r">${unknownSpan()}</td>`;
                        if (typeof v === 'object') return `<td class="r"><code>${esc(JSON.stringify(v))}</code></td>`;
                        return `<td class="r">${esc(String(v))}</td>`;
                    })
                    .join('');
                return `<tr>${tds}</tr>`;
            })
            .join('');

        el.innerHTML = `<table class="data-table ops-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function money(v) {
        if (v === undefined || v === null || v === '') return null;
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (!isFinite(n)) return String(v);
        return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    }

    // An unpriced lot is a lot whose valuation could not be struck — its
    // unrealized P&L is MISSING from the number beside it, so the number reads
    // low without saying so. Surface the count rather than let the total look
    // complete. Zero is rendered as nothing; unknown stays unknown.
    function unpricedChip(v, opts) {
        if (!isNum(v)) {
            return (opts && opts.silentUnknown)
                ? ''
                : unknownSpan('The backend did not report unpriced_lots.');
        }
        if (v === 0) return '';
        return `<span class="ops-chip ops-chip-warn" title="${esc(
            v + ' lot' + (v === 1 ? '' : 's') + ' could not be priced at the valuation date — their unrealized P&L is not included above.'
        )}">${esc(v + ' unpriced')}</span>`;
    }

    // How stale the priciest input is. Present only when the backend reports it.
    function barAgeNote(v) {
        if (v === null || v === undefined) return '';
        if (!isNum(v)) return '';
        const cls = v > 5 ? 'ops-chip-warn' : 'ops-chip-quiet';
        return `<span class="ops-chip ${cls}" title="${esc(
            'Oldest daily bar used for this valuation is ' + v + ' day(s) old.'
        )}">bar age ${esc(String(v))}d</span>`;
    }

    function signedClass(v) {
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (!isFinite(n) || n === 0) return '';
        return n > 0 ? 'ops-good' : 'ops-bad';
    }

    async function loadShadowAttribution() {
        const el = document.getElementById('ops-shadow-attribution');
        if (!el) return;
        el.innerHTML = LOADING;
        const r = await opsGet('/api/ops/shadow?view=attribution' + q());
        if (!r.ok) return unavailable(el, r.kind, r.message);

        const d = r.body || {};
        const totals = pick(d, 'totals') || {};
        const byRun = asArray(pick(d, 'byRun', 'by_run') || [], 'rows');

        const realized = pick(totals, 'realizedPnL', 'realized_pnl', 'RealizedPnL');
        const unrealized = pick(totals, 'unrealizedPnL', 'unrealized_pnl', 'UnrealizedPnL');
        const costs = pick(totals, 'costsUSD', 'costs_usd', 'CostsUSD');
        const valuation = pick(totals, 'valuationDate', 'valuation_date');
        const totalUnpriced = pick(totals, 'unpricedLots', 'unpriced_lots');
        const totalBarAgeDays = pick(totals, 'oldestBarAgeDays', 'oldest_bar_age_days');
        const totalUnpricedChip = unpricedChip(totalUnpriced, { silentUnknown: true });
        const totalBarAge = barAgeNote(totalBarAgeDays);

        const totalsHtml = `
            <div class="ops-strip ops-strip-3">
                <div class="metric-card">
                    <div class="metric-label">Realized P&amp;L</div>
                    <div class="metric-value ops-strip-val ${signedClass(realized)}">${money(realized) != null ? esc(money(realized)) : unknownSpan()}</div>
                    <div class="metric-sub">closed lineage lots, net of costs</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Unrealized P&amp;L</div>
                    <div class="metric-value ops-strip-val ${signedClass(unrealized)}">${money(unrealized) != null ? esc(money(unrealized)) : unknownSpan()}</div>
                    <div class="metric-sub">${
                        isNum(totalUnpriced) && totalUnpriced > 0
                            ? `<span class="ops-warn">incomplete — ${esc(String(totalUnpriced))} lot${totalUnpriced === 1 ? '' : 's'} unpriced</span>`
                            : 'open lots at the valuation close'
                    }</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Execution costs</div>
                    <div class="metric-value ops-strip-val">${money(costs) != null ? esc(money(costs)) : unknownSpan()}</div>
                    <div class="metric-sub">informational — already inside P&amp;L</div>
                </div>
            </div>
            <div class="ops-strip-meta">
                <span>valuation date ${valuation ? esc(String(valuation)) : unknownSpan()}</span>
                ${totalUnpricedChip ? `<span>${totalUnpricedChip}</span>` : ''}
                ${totalBarAge ? `<span>${totalBarAge}</span>` : ''}
            </div>`;

        let table;
        if (!byRun.length) {
            table = '<div class="ops-unavailable"><div class="ops-unavailable-title">No allocation runs attributed yet</div></div>';
        } else {
            const rows = byRun
                .map(row => {
                    const runId = String(pick(row, 'allocationRunID', 'allocation_run_id', 'AllocationRunID') || '');
                    const rz = pick(row, 'realizedPnL', 'realized_pnl', 'RealizedPnL');
                    const uz = pick(row, 'unrealizedPnL', 'unrealized_pnl', 'UnrealizedPnL');
                    const rowUnpriced = pick(row, 'unpricedLots', 'unpriced_lots');
                    const rowBarAge = pick(row, 'oldestBarAgeDays', 'oldest_bar_age_days');
                    return `<tr class="${isNum(rowUnpriced) && rowUnpriced > 0 ? 'ops-row-warn' : ''}">
                        <td class="r" title="${esc(runId)}"><code>${esc(runId.slice(0, 12) || '—')}</code></td>
                        <td class="r">${esc(String(pick(row, 'sessionDate', 'session_date', 'SessionDate') || '—'))}</td>
                        <td class="r">${esc(String(pick(row, 'targetPortfolioID', 'target_portfolio_id', 'TargetPortfolioID') || '—'))}</td>
                        <td class="r">${esc(String(pick(row, 'kind', 'Kind') || '—'))}</td>
                        <td class="r ${signedClass(rz)}">${money(rz) != null ? esc(money(rz)) : unknownSpan()}</td>
                        <td class="r ${signedClass(uz)}">${money(uz) != null ? esc(money(uz)) : unknownSpan()}</td>
                        <td class="r">${esc(String(money(pick(row, 'costsUSD', 'costs_usd', 'CostsUSD')) || '—'))}</td>
                        <td class="r">${esc(String(pick(row, 'fills', 'Fills') ?? '—'))}</td>
                        <td class="r">${esc(String(pick(row, 'openLots', 'open_lots', 'OpenLots') ?? '—'))}/${esc(String(pick(row, 'closedLots', 'closed_lots', 'ClosedLots') ?? '—'))}</td>
                        <td class="r">${unpricedChip(rowUnpriced) || '<span class="ops-dim">none</span>'}</td>
                        <td class="r">${barAgeNote(rowBarAge) || '<span class="ops-dim">—</span>'}</td>
                    </tr>`;
                })
                .join('');
            table = `<table class="data-table ops-table">
                <thead><tr>
                    <th>run</th><th>session</th><th>portfolio</th><th>kind</th>
                    <th>realized</th><th>unrealized</th><th>costs</th><th>fills</th><th>open/closed</th>
                    <th>unpriced</th><th>bar age</th>
                </tr></thead>
                <tbody>${rows}</tbody></table>`;
        }

        el.innerHTML = totalsHtml + table;
    }

    const DIFF_CLASSES = ['rule_mismatch', 'data_version', 'timing', 'quarantine', 'cost', 'unclassified'];

    // Backend contract (2026-09-18): the single `size` kind was split into
    // `entry_size` / `exit_size`, so a size disagreement names which leg it is.
    // Anything outside this list still renders — as itself, marked unknown —
    // rather than being silently folded into a kind it is not.
    const DIFF_KINDS = ['entry', 'exit', 'entry_size', 'exit_size'];

    let diffKindFilter = 'all'; // 'all' | one of DIFF_KINDS

    function classChip(c) {
        const key = DIFF_CLASSES.includes(c) ? c : 'unclassified';
        return `<span class="ops-chip ops-chip-${esc(key)}">${esc(key.replace(/_/g, ' '))}</span>`;
    }

    function kindChip(k) {
        const raw = String(k == null ? '' : k);
        if (!raw) return `<span class="ops-chip ops-chip-unknown-kind">unknown</span>`;
        const known = DIFF_KINDS.includes(raw);
        return `<span class="ops-chip ops-chip-kind ops-chip-kind-${esc(known ? raw : 'other')}"${
            known ? '' : ` title="${esc('Kind not in the declared set: ' + raw)}"`
        }>${esc(raw.replace(/_/g, ' '))}</span>`;
    }

    // The unclassified share is the differ's own coverage gauge: a session where
    // most rows have no explanation is a warning about the CLASSIFIER, not a
    // clean bill of health for the book. The backend decides when that is true
    // (warn_unclassified); we only render its verdict, never re-derive it.
    function unclassifiedNote(run) {
        const summary = pick(run, 'summary', 'Summary') || {};
        const share = pick(summary, 'unclassified_share', 'unclassifiedShare');
        const n = pick(summary, 'n_unclassified', 'nUnclassified');
        const warn =
            pick(summary, 'warn_unclassified', 'warnUnclassified') === true ||
            pick(run, 'warn_unclassified', 'warnUnclassified') === true;

        // Fall back to the run level in case the handler hoists these out.
        const shareVal = share !== undefined ? share : pick(run, 'unclassified_share', 'unclassifiedShare');
        const nVal = n !== undefined ? n : pick(run, 'n_unclassified', 'nUnclassified');

        if (shareVal === undefined && nVal === undefined) {
            return `<span class="ops-dim">unclassified ${unknownSpan('The backend did not report an unclassified share for this run.')}</span>`;
        }

        // 6dp string from the backend; show it as a percentage without lying
        // about precision we do not have.
        let pctText = null;
        if (shareVal !== undefined && shareVal !== null && String(shareVal) !== '') {
            const f = typeof shareVal === 'number' ? shareVal : parseFloat(String(shareVal));
            pctText = isFinite(f) ? (f * 100).toFixed(1) + '%' : String(shareVal);
        }

        const label =
            (pctText ? pctText : '—') + (isNum(nVal) ? ` (${nVal})` : '') + ' unclassified';
        return `<span class="ops-chip ${warn ? 'ops-chip-warn' : 'ops-chip-quiet'}"${
            warn
                ? ' title="The backend flagged this session: too large a share of its differences have no explanation."'
                : ''
        }>${esc(label)}</span>`;
    }

    function renderDiffFilter() {
        const opts = ['all'].concat(DIFF_KINDS);
        return `<div class="ops-filter" id="ops-diff-filter">
            <span class="ops-dim">kind:</span>
            ${opts
                .map(
                    k =>
                        `<button class="ops-filter-btn${k === diffKindFilter ? ' ops-filter-on' : ''}" data-kind="${esc(k)}">${esc(
                            k === 'all' ? 'all' : k.replace(/_/g, ' ')
                        )}</button>`
                )
                .join('')}
        </div>`;
    }

    async function loadShadowDiffs() {
        const el = document.getElementById('ops-shadow-diffs');
        if (!el) return;
        el.innerHTML = LOADING;
        const diffExtra =
            'sessions=20' +
            (counterpartBookId != null ? '&counterpart_book_id=' + encodeURIComponent(counterpartBookId) : '');
        const r = await opsGet('/api/ops/shadow?view=diffs' + q(diffExtra));
        if (!r.ok) return unavailable(el, r.kind, r.message);

        // Response header line: the pair this run actually compared, echoed
        // by the backend rather than re-derived from the selector state.
        const respBookId = pick(r.body, 'bookId', 'book_id');
        const respCounterpart = pick(r.body, 'counterpartBookId', 'counterpart_book_id');
        const respKind = pick(r.body, 'kind');
        const pairLine =
            respBookId != null && respCounterpart != null
                ? `<div class="ops-dim ops-diff-pair">book ${esc(String(respBookId))} ${esc(
                      respKind === 'sleeve' ? 'vs sleeve' : 'vs legacy'
                  )} book ${esc(String(respCounterpart))}</div>`
                : '';

        const runs = asArray(r.body, 'runs', 'diff_runs', 'diffRuns');
        if (!runs.length) {
            return unavailable(el, 'empty', 'No shadow-vs-legacy diff runs in the last 20 sessions.');
        }

        const sections = runs
            .map((run, ri) => {
                const session = String(pick(run, 'sessionDate', 'session_date', 'SessionDate') || '—');
                const stage = String(pick(run, 'stage', 'Stage') || '—');
                const n = pick(run, 'nDiffs', 'n_diffs', 'NDiffs');
                const diffs = asArray(pick(run, 'diffs', 'Diffs') || [], 'diffs');

                const rows = diffs
                    .map((d, di) => {
                        const id = `ops-diff-${ri}-${di}`;
                        const cls = String(pick(d, 'classification', 'Classification') || 'unclassified');
                        const kind = String(pick(d, 'kind', 'Kind') || '');
                        const detail = String(pick(d, 'detail', 'Detail') || '');
                        const shadow = pick(d, 'shadow', 'Shadow');
                        const legacy = pick(d, 'legacy', 'Legacy');
                        const detailJson = JSON.stringify({ shadow: shadow ?? null, legacy: legacy ?? null }, null, 2);
                        return `
                        <tr class="ops-diff-row" data-target="${id}" data-kind="${esc(kind)}" tabindex="0">
                            <td><span class="ops-caret">&rsaquo;</span> <strong>${esc(String(pick(d, 'ticker', 'Ticker') || '—'))}</strong></td>
                            <td>${kindChip(kind)}</td>
                            <td>${classChip(cls)}</td>
                            <td class="ops-diff-detail">${esc(detail)}</td>
                        </tr>
                        <tr class="ops-diff-expand" id="${id}" data-kind="${esc(kind)}" style="display:none">
                            <td colspan="4"><pre class="ops-pre">${esc(detailJson)}</pre></td>
                        </tr>`;
                    })
                    .join('');

                return `
                <div class="ops-diff-session">
                    <div class="ops-diff-head">
                        <strong>${esc(session)}</strong>
                        <span class="card-badge">${esc(stage)}</span>
                        <span class="ops-dim">${isNum(n) ? esc(n + ' diff' + (n === 1 ? '' : 's')) : diffs.length + ' diffs'}</span>
                        ${unclassifiedNote(run)}
                    </div>
                    ${
                        diffs.length
                            ? `<table class="data-table ops-table"><tbody>${rows}</tbody></table>`
                            : '<div class="ops-dim ops-empty-line">no differences</div>'
                    }
                </div>`;
            })
            .join('');

        el.innerHTML = pairLine + renderDiffFilter() + sections;

        function applyKindFilter() {
            // `tr[data-kind]` only: the filter BUTTONS also carry data-kind, and a
            // bare [data-kind] selector hid the filter bar along with the rows.
            el.querySelectorAll('tr[data-kind]').forEach(node => {
                const match = diffKindFilter === 'all' || node.getAttribute('data-kind') === diffKindFilter;
                if (node.classList.contains('ops-diff-expand')) {
                    // Never re-open a detail row the filter just revealed.
                    node.style.display = 'none';
                    const owner = el.querySelector(`.ops-diff-row[data-target="${node.id}"]`);
                    if (owner) owner.classList.remove('ops-row-open');
                    return;
                }
                node.style.display = match ? '' : 'none';
            });
        }

        const filterBar = el.querySelector('#ops-diff-filter');
        if (filterBar) {
            filterBar.addEventListener('click', e => {
                const btn = e.target.closest('.ops-filter-btn');
                if (!btn) return;
                diffKindFilter = btn.getAttribute('data-kind') || 'all';
                filterBar.querySelectorAll('.ops-filter-btn').forEach(b => {
                    b.classList.toggle('ops-filter-on', b.getAttribute('data-kind') === diffKindFilter);
                });
                applyKindFilter();
            });
        }
        if (diffKindFilter !== 'all') applyKindFilter();

        el.querySelectorAll('.ops-diff-row').forEach(row => {
            const toggle = () => {
                const target = document.getElementById(row.getAttribute('data-target'));
                if (!target) return;
                const open = target.style.display !== 'none';
                target.style.display = open ? 'none' : '';
                row.classList.toggle('ops-row-open', !open);
            };
            row.addEventListener('click', toggle);
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        });
    }

    async function loadShadowAlerts() {
        const el = document.getElementById('ops-shadow-alerts');
        if (!el) return;
        el.innerHTML = LOADING;
        const r = await opsGet('/api/ops/shadow?view=alerts&limit=50');
        if (!r.ok) return unavailable(el, r.kind, r.message);

        const events = asArray(r.body, 'events', 'alerts');
        if (!events.length) return unavailable(el, 'empty', 'No pages emitted.');

        el.innerHTML = events
            .map(ev => {
                const key = String(pick(ev, 'eventKey', 'event_key') || '—');
                const created = pick(ev, 'createdAt', 'created_at');
                const deliveries = asArray(pick(ev, 'deliveries') || [], 'deliveries');
                const okDelivery = deliveries.find(d => pick(d, 'ok') === true);
                const attemptedAt = okDelivery ? pick(okDelivery, 'attemptedAt', 'attempted_at') : null;
                let latency = null;
                if (created && attemptedAt) {
                    const ms = Date.parse(attemptedAt) - Date.parse(created);
                    if (isFinite(ms)) latency = Math.max(0, Math.round(ms / 1000)) + 's to deliver';
                }
                const state = okDelivery
                    ? `<span class="ops-chip ops-chip-ok">delivered</span>`
                    : deliveries.length
                    ? `<span class="ops-chip ops-chip-bad">undelivered · ${deliveries.length} attempt${deliveries.length === 1 ? '' : 's'}</span>`
                    : `<span class="ops-chip ops-chip-warn">no attempt recorded</span>`;
                return `
                <div class="ops-alert">
                    <div class="ops-alert-top">
                        <code>${esc(key)}</code>
                        ${state}
                        <span class="ops-dim">${esc(String(pick(ev, 'channel') || ''))}</span>
                    </div>
                    <div class="ops-alert-msg">${esc(String(pick(ev, 'message') || ''))}</div>
                    <div class="ops-dim">${esc(shortTs(created))}${latency ? ' · ' + esc(latency) : ''}</div>
                </div>`;
            })
            .join('');
    }

    async function loadShadow() {
        if (!window.VBAuth || !window.VBAuth.isAdmin) return;
        // Resolve the sleeve list (and default book_id/counterpart_book_id)
        // BEFORE the panels fetch, so every panel's first load already
        // carries the right book_id — never a load-then-reload flash.
        await loadSleeves();
        await Promise.all([
            loadShadowStatus(),
            loadShadowEvidence(),
            loadShadowAttribution(),
            loadShadowDiffs(),
            loadShadowAlerts(),
        ]);
    }

    // ── Heartbeats tab ───────────────────────────────────────────────────────

    function hbStatusChip(status) {
        const s = String(status || '').toUpperCase();
        const key = s === 'PASS' ? 'ok' : s === 'WARN' ? 'warn' : s === 'FAIL' ? 'bad' : 'unknown';
        return `<span class="ops-chip ops-chip-${key}">${esc(s || 'never')}</span>`;
    }

    async function loadHeartbeats() {
        if (!window.VBAuth || !window.VBAuth.isAdmin) return;
        const el = document.getElementById('ops-hb-table');
        const sum = document.getElementById('ops-hb-summary');
        if (!el) return;
        el.innerHTML = LOADING;
        if (sum) sum.textContent = '';

        const r = await opsGet('/api/ops/heartbeats');
        if (!r.ok) return unavailable(el, r.kind, r.message);

        const routines = asArray(r.body, 'routines', 'RoutineStatuses');
        if (!routines.length) return unavailable(el, 'empty', 'No routines registered.');

        let late = 0;
        let enabled = 0;
        const rows = routines
            .map(rt => {
                const isLate = pick(rt, 'late', 'Late') === true;
                const isEnabled = pick(rt, 'enabled', 'Enabled') === true;
                if (isLate) late++;
                if (isEnabled) enabled++;

                const schedule = String(pick(rt, 'schedule', 'Schedule') || '—');
                const cadence = pick(rt, 'expectedCadenceS', 'expected_cadence_s', 'ExpectedCadenceS');
                const dueBy = pick(rt, 'dueByET', 'due_by_et', 'DueByET');
                const lastRan = pick(rt, 'lastRanAt', 'last_ran_at', 'LastRanAt');
                const ageS = pick(rt, 'ageS', 'age_s', 'AgeS');
                const inWindow = pick(rt, 'inWindow', 'in_window', 'InWindow');

                const cadenceCell = dueBy
                    ? `due ${esc(String(dueBy))} ET`
                    : isNum(cadence)
                    ? `every ${esc(ageLabel(cadence))}`
                    : unknownSpan();

                const ageCell = lastRan
                    ? `${esc(relTime(lastRan) || '—')}`
                    : isNum(ageS)
                    ? esc(ageLabel(ageS) + ' ago')
                    : `<span class="ops-never">never</span>`;

                return `<tr class="${isLate ? 'ops-row-late' : ''}${isEnabled ? '' : ' ops-row-disabled'}">
                    <td><strong>${esc(String(pick(rt, 'routine', 'Routine') || '—'))}</strong></td>
                    <td class="r">${esc(schedule)}</td>
                    <td class="r">${cadenceCell}</td>
                    <td class="r" title="${esc(lastRan ? shortTs(lastRan) : '')}">${ageCell}</td>
                    <td>${hbStatusChip(pick(rt, 'lastStatus', 'last_status', 'LastStatus'))}</td>
                    <td class="r">${isLate ? '<span class="ops-bad">LATE</span>' : inWindow === false ? '<span class="ops-dim">out of window</span>' : '<span class="ops-good">on time</span>'}</td>
                    <td class="r">${isEnabled ? 'yes' : '<span class="ops-dim">no</span>'}</td>
                    <td class="r">${esc(String(pick(rt, 'channel', 'Channel') || '—'))}</td>
                </tr>`;
            })
            .join('');

        el.innerHTML = `<table class="data-table ops-table">
            <thead><tr>
                <th>routine</th><th>schedule</th><th>cadence / due by</th><th>last run</th>
                <th>status</th><th>lateness</th><th>enabled</th><th>channel</th>
            </tr></thead>
            <tbody>${rows}</tbody></table>`;

        if (sum) {
            sum.textContent = `${routines.length} registered · ${enabled} enabled · ${late} late`;
            sum.className = 'card-badge' + (late > 0 ? ' ops-badge-bad' : '');
        }
    }

    // ── tab visibility, driven by the auth state ─────────────────────────────

    function setOpsVisible(visible) {
        document.querySelectorAll('.tab[data-ops-tab]').forEach(btn => {
            btn.style.display = visible ? '' : 'none';
        });
        const note = document.getElementById('ops-access-note');
        if (note) note.style.display = visible ? 'none' : '';

        if (!visible) {
            // If an ops tab was open when access went away, fall back to the
            // first public tab rather than leaving a stale panel on screen.
            const active = document.querySelector('.tab.active');
            if (active && active.hasAttribute('data-ops-tab')) {
                const first = document.querySelector('.tab:not([data-ops-tab])');
                if (first) first.click();
            }
            OPS_TABS.forEach(id => {
                ['ops-shadow-status', 'ops-shadow-evidence', 'ops-shadow-attribution',
                 'ops-shadow-diffs', 'ops-shadow-alerts', 'ops-hb-table',
                 'ops-sleeve-select-wrap', 'ops-diffs-comparison-wrap'].forEach(pid => {
                    const el = document.getElementById(pid);
                    if (el) el.innerHTML = '';
                });
            });
        }
    }

    function onAuthChange(detail) {
        const admin = detail && detail.state === 'admin';
        setOpsVisible(admin);

        const note = document.getElementById('ops-access-note');
        if (note && !admin) {
            note.textContent =
                detail && detail.state === 'not_admin'
                    ? 'Signed in, but this account is not an admin — ops tabs stay hidden.'
                    : detail && detail.state === 'unconfigured'
                    ? 'Ops sign-in is not configured on this deployment.'
                    : '';
        }
    }

    window.addEventListener('vb-auth-change', e => onAuthChange(e.detail));

    // Public surface used by js/dashboard.js's tab router.
    window.OpsConsole = {
        loadShadow,
        loadHeartbeats,
        setBookId(id) {
            bookId = id;
        },
    };

    // Hidden until proven admin.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setOpsVisible(false));
    } else {
        setOpsVisible(false);
    }
})();
