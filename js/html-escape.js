// Attribute-safe HTML escaper shared by every classic script on the page
// (dashboard.js's global esc() delegates here). The old DOM-based esc
// (textContent → innerHTML) did not escape quotes, so a value placed inside
// a quoted attribute (title="…") could break out of it. UMD-lite:
// window.HtmlEscape in the browser, module.exports under node:test.
(function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const HtmlEscape = { esc };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HtmlEscape;
    }
    if (typeof window !== 'undefined') {
        window.HtmlEscape = HtmlEscape;
    }
})();
