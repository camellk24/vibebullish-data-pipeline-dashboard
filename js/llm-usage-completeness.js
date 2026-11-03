// The backend's daily usage summary names any call source it could not read
// in `missing_sources` (backend #577). Its totals are then a floor, so the
// LLM Usage tab must not render them as complete. Returns the distinct
// missing sources across today's summary and every day of the week.
(function () {
    'use strict';

    function missingUsageSources(todayBody, weekBody) {
        const days = [todayBody, ...(Array.isArray(weekBody) ? weekBody : [])];
        const out = [];
        for (const d of days) {
            const list = d && Array.isArray(d.missing_sources) ? d.missing_sources : [];
            for (const s of list) if (typeof s === 'string' && !out.includes(s)) out.push(s);
        }
        return out;
    }

    const LLMUsageCompleteness = { missingUsageSources };
    if (typeof module !== 'undefined' && module.exports) module.exports = LLMUsageCompleteness;
    if (typeof window !== 'undefined') window.LLMUsageCompleteness = LLMUsageCompleteness;
})();
