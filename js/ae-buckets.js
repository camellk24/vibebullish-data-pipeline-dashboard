// Action Engine bucket helpers (pure; node:test-able — js/ae-buckets.test.js).
//
// Some buckets hold ONLY 60d decisions: the 60d horizon row, and the
// buy_now / sell_now predicates (backend V2ActionPredicateLabelSQL assigns
// them to horizon='60d' rows only). A 60d decision resolves ~60 trading days
// (~84 calendar days) after it is made, so inside the tab's 30-day window
// such a bucket has nothing resolved BY CONSTRUCTION. Its empty grade
// columns mean "not matured yet", not "broken" — say so instead of dashes
// and a misleading +0.00% average return.
(function () {
    'use strict';

    const SIXTY_D_ONLY = {
        horizon: ['60d'],
        predicate: ['buy_now', 'sell_now'],
    };

    const MATURITY_NOTE = 'matures ~84d after decision';
    const MATURITY_TITLE = 'Only 60d decisions land in this bucket. A 60d decision resolves ~60 trading ' +
        '(~84 calendar) days after it is made, so none inside this 30-day window has matured yet.';

    function isUnmatured60dBucket(dim, key, nResolved) {
        const keys = SIXTY_D_ONLY[dim];
        return !!keys && keys.indexOf(key) !== -1 && !(nResolved > 0);
    }

    const AEBuckets = { isUnmatured60dBucket, MATURITY_NOTE, MATURITY_TITLE };
    if (typeof module !== 'undefined' && module.exports) module.exports = AEBuckets;
    if (typeof window !== 'undefined') window.AEBuckets = AEBuckets;
})();
