// Changelog tab — reads VBReads.get('changelog') (js/reads.js → /api/ops/reads,
// which answers from api/_changelog.md) and renders one card per release.
// Activation and request invalidation are owned by VBTabs (js/dashboard.js).
// The file only changes on a deploy, so the tab does not poll.

(function () {
    const REPOS = {
        web: 'vibebullish-web',
        ios: 'vibebullish-ios',
        backend: 'vibebullish-backend',
        pipeline: 'vibebullish-data-pipeline',
        dashboard: 'vibebullish-data-pipeline-dashboard',
    };

    // Escapes first, so the markup added afterwards is the only markup. The
    // changelog's own syntax is **bold**, `code` and a trailing (#123) PR link,
    // which resolves against the entry's surface.
    function itemHTML(item) {
        const esc = window.VBReads.esc;
        const surface = String((item && item.surface) || '');
        const repo = Object.prototype.hasOwnProperty.call(REPOS, surface) ? REPOS[surface] : null;
        const text = esc((item && item.text) || '')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\(#(\d+)\)/g, (match, n) => repo
                ? `(<a href="https://github.com/camellk24/${repo}/pull/${n}" target="_blank" rel="noopener noreferrer">#${n}</a>)`
                : match);
        return `<li class="cl-item"><span class="cl-surface">${esc(surface)}</span><span class="cl-text">${text}</span></li>`;
    }

    function releasesHTML(releases) {
        const esc = window.VBReads.esc;
        return releases.map((r, i) => `
            <section class="card cl-release">
                <div class="cl-meta">
                    <span class="cl-date">${esc(r.date)}</span>
                    ${i === 0 ? '<span class="card-badge">Latest</span>' : ''}
                </div>
                <h2 class="cl-title">${esc(r.title)}</h2>
                <ul class="cl-items">${(Array.isArray(r.items) ? r.items : []).map(itemHTML).join('')}</ul>
            </section>`).join('');
    }

    function panel() {
        return document.getElementById('changelog-panel');
    }

    async function load(ctx) {
        const el = panel();
        const r = await window.VBReads.get('changelog');
        if (!ctx.live()) return;
        if (!r.ok) {
            window.VBReads.unavailable(el, r.kind, r.message);
            return;
        }
        const releases = r.body && Array.isArray(r.body.releases) ? r.body.releases : [];
        if (releases.length === 0) {
            window.VBReads.unavailable(el, 'empty', 'No releases have been written up yet.');
            return;
        }
        el.innerHTML = releasesHTML(releases);
    }

    function clear() {
        const el = panel();
        if (el) el.innerHTML = '';
    }

    if (typeof window !== 'undefined') {
        window.VBChangelog = { itemHTML, releasesHTML };
        if (window.VBTabs) window.VBTabs.register('changelog', { load, clear });
    }
})();
