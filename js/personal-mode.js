// js/personal-mode.js — personal research mode: direct data reads switched off.
//
// The LLM Usage, System Health, Action Engine, Quant Quality, Data Collector
// and Catalyst Accuracy tabs used to read the backend with anonymous fetch()
// calls. Those reads are disabled: each former call site now calls
// vbPersonalModeRead(), which makes NO network request and always rejects.
// The tabs show a static notice instead (index.html, class
// "personal-mode-disabled"; styles/dashboard.css hides everything else in them).
//
// Not affected: the Agents tab and the admin-only ops tabs, which already read
// through same-origin /api/* proxies with the signed-in user's token
// (VBAuth.fetch in js/auth.js, verified server-side by api/_verified_proxy.js).
//
// Re-enabling a disabled tab means moving its reads to VBAuth.fetch behind a
// verified proxy — not restoring the anonymous fetch().
//
// Loaded as a classic <script> BEFORE every other dashboard script, and
// requireable from node for js/personal-mode.test.js. If this file failed to
// load, the call sites would throw a ReferenceError inside their own
// try/catch: still no request.
(function () {
    var NOTICE = 'Disabled in personal research mode.';

    function vbPersonalModeRead() {
        var err = new Error(NOTICE);
        err.personalMode = true;
        return Promise.reject(err);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { vbPersonalModeRead: vbPersonalModeRead, NOTICE: NOTICE };
    }
    if (typeof window !== 'undefined') {
        window.vbPersonalModeRead = vbPersonalModeRead;
        window.VB_PERSONAL_MODE_NOTICE = NOTICE;
    }
})();
