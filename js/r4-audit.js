// Label audit tab (registry R4 rev 3.1) — the owner's blind rating form.
//
// ACCESS: admin only, same mechanism as the other ops tabs (hidden until
// /api/ops/whoami says admin; js/ops-console.js owns the show/hide).
//
// BLINDING: this page renders exactly what /api/ops/r4?view=next returns —
// ticker, date, publisher, title, summary. It never fetches a price, a served
// label, or another article. If a field is missing it is shown as missing.
//
// FLOW: pick a round → progress → one item → answer H1/H2/H3 (+ note) →
// submit → next item. A submit that the backend refuses (closed round,
// duplicate, vocabulary) is shown verbatim as its typed kind and the item
// stays on screen; nothing is retried silently.

(function () {
    'use strict';

    const ROUNDS = [
        { id: 'spot', label: 'Spot-check (rev 4, initial 20)' },
        { id: 'spot_topup', label: 'Spot-check top-up (20)' },
        { id: 'dev1', label: 'Practice (dev, pass 1)' },
        { id: 'dev2', label: 'Practice re-rate (dev, pass 2)' },
        { id: 'conf', label: 'Confirmatory' },
        { id: 'relook', label: 'Re-look (flagged)' },
    ];
    const H1 = [['yes', 'Yes, materially about this ticker'], ['passing_mention', 'Passing mention'], ['no', 'No']];
    const H2 = [['bullish', 'Bullish'], ['bearish', 'Bearish'], ['neutral', 'Neutral'], ['unclear', 'Unclear']];
    const H3 = [['filler', 'Filler / rehash'], ['notable', 'Notable'], ['material', 'Material'], ['major', 'Major']];

    let round = 'spot';
    let current = null; // the item on screen, with the round it was served for
    let busy = false;
    // Bumped on every round change and every load; a response whose
    // generation is no longer current is dropped, so a slow reply for the
    // PREVIOUS round can never replace the item on screen. Submission uses
    // current.round (the round the item was served for), never the selector.
    let generation = 0;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function api(path, opts) {
        if (!window.VBAuth || !window.VBAuth.isAdmin) {
            return { ok: false, kind: 'forbidden', message: 'Sign in with an admin account.' };
        }
        let res;
        try {
            res = await window.VBAuth.fetch(path, opts);
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

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(text, bad) {
        const s = el('r4-status');
        if (!s) return;
        s.textContent = text || '';
        s.className = 'r4-status' + (bad ? ' ops-bad' : '');
    }

    function renderRoundSelect() {
        const wrap = el('r4-round-wrap');
        if (!wrap) return;
        wrap.innerHTML =
            '<label class="ops-select-label">Round <select id="r4-round">' +
            ROUNDS.map(r => `<option value="${r.id}"${r.id === round ? ' selected' : ''}>${esc(r.label)}</option>`).join('') +
            '</select></label>';
        el('r4-round').addEventListener('change', e => {
            round = e.target.value;
            current = null;
            generation++;
            load();
        });
    }

    function renderProgress(p, open) {
        const b = el('r4-progress');
        if (!b) return;
        if (!p) {
            b.textContent = '';
            return;
        }
        b.textContent = `${p.done} / ${p.total} answered` + (p.open ? '' : ' · round closed');
        const o = el('r4-open-rounds');
        if (o) o.textContent = open && open.length ? 'open rounds: ' + open.join(', ') : 'no round is open';
    }

    function radios(name, options) {
        return options
            .map(
                ([v, label]) =>
                    `<label class="r4-opt"><input type="radio" name="${name}" value="${esc(v)}"> ${esc(label)}</label>`
            )
            .join('');
    }

    function renderItem(item) {
        const box = el('r4-item');
        if (!box) return;
        if (!item) {
            box.innerHTML = '<div class="ops-empty-line ops-dim">Nothing to rate in this round.</div>';
            return;
        }
        const when = item.published_at ? new Date(item.published_at) : null;
        const whenText = when && !isNaN(when) ? when.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '(no date)';
        box.innerHTML = `
            <div class="r4-meta">
                <span class="r4-ticker">${esc(item.ticker || '(no ticker)')}</span>
                <span class="ops-dim">${esc(whenText)}</span>
                <span class="ops-dim">${esc(item.publisher || '(no publisher)')}</span>
            </div>
            <h3 class="r4-title">${esc(item.title || '(no title)')}</h3>
            <p class="r4-summary">${esc(item.summary || '(no summary available)')}</p>
            <form id="r4-form" class="r4-form">
                <fieldset><legend>H1 — Is this article materially about ${esc(item.ticker || 'the ticker')}?</legend>${radios('h1', H1)}</fieldset>
                <fieldset><legend>H2 — From this article alone, the stock's expected reaction is</legend>${radios('h2', H2)}</fieldset>
                <fieldset><legend>H3 — How material is it?</legend>${radios('h3', H3)}</fieldset>
                <label class="r4-note">Note (optional)<br><textarea name="note" rows="2" maxlength="2000"></textarea></label>
                <div class="r4-actions">
                    <button type="submit" class="date-nav-btn" id="r4-submit">Submit &amp; next</button>
                    <span class="ops-dim">Do not look the ticker up. Answer from the text only.</span>
                </div>
            </form>`;
        el('r4-form').addEventListener('submit', onSubmit);
    }

    async function load(keepStatus) {
        const gen = ++generation;
        const forRound = round;
        renderProgress(null);
        if (!keepStatus) setStatus('');
        const box = el('r4-item');
        if (box) box.innerHTML = '<div class="ops-loading">Loading…</div>';
        const [p, n] = await Promise.all([
            api('/api/ops/r4?view=progress&round=' + encodeURIComponent(forRound)),
            api('/api/ops/r4?view=next&round=' + encodeURIComponent(forRound)),
        ]);
        if (gen !== generation) return; // stale: the round changed meanwhile
        if (p.ok) renderProgress(p.body.progress, p.body.open_rounds);
        if (!n.ok) {
            current = null;
            if (box) box.innerHTML = '';
            setStatus(
                n.kind === 'locked' || /not open/.test(n.message)
                    ? 'This round is closed. Nothing is shown until it is opened on the backend.'
                    : `${n.kind}: ${n.message}`,
                true
            );
            return;
        }
        if (n.body.done) {
            current = null;
            renderItem(null);
            setStatus('Round complete for you. Nothing left to rate.');
            return;
        }
        current = Object.assign({}, n.body.item, { round: forRound });
        renderItem(current);
    }

    async function onSubmit(e) {
        e.preventDefault();
        if (busy || !current) return;
        const f = e.target;
        const get = name => (f.querySelector(`input[name="${name}"]:checked`) || {}).value;
        const h1 = get('h1'), h2 = get('h2'), h3 = get('h3');
        if (!h1 || !h2 || !h3) {
            setStatus('Answer all three questions.', true);
            return;
        }
        busy = true;
        el('r4-submit').disabled = true;
        const item = current;
        const r = await api('/api/ops/r4?view=label', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                round: item.round,
                cluster_id: item.cluster_id,
                h1, h2, h3,
                note: (f.querySelector('textarea[name="note"]') || {}).value || '',
            }),
        });
        busy = false;
        if (current !== item) return; // the round changed mid-submit; the answer is stored under its own round
        if (!r.ok) {
            const btn = el('r4-submit');
            if (btn) btn.disabled = false;
            const why =
                r.kind === 'conflict' ? 'Already answered in this round (not overwritten).' :
                r.kind === 'locked' ? 'This round is closed.' :
                r.kind === 'rejected' ? 'The backend rejected the answer.' :
                r.kind === 'not_found' ? 'This item is not part of this round.' :
                `${r.kind}: ${r.message}`;
            setStatus(why, true);
            return;
        }
        setStatus('Saved.');
        await load(true);
    }

    window.R4Audit = { load };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderRoundSelect);
    } else {
        renderRoundSelect();
    }
})();
