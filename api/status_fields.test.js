// node --test api/*.test.js
//
// The Shadow-book status strip reads two backend fields whose names have already
// moved once (release.strategy → release.name; last_run.ran_at → formed_at). The
// helpers live inside js/ops-console.js's IIFE, so — as in escaping.test.js —
// this suite EXTRACTS them from the real source and evaluates them, together
// with the `pick()` they depend on. The assertions therefore run against the
// shipped code, and the file fails the moment either helper is renamed away.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'ops-console.js'), 'utf8');

// Matches from `function <sig> {` to the `}` at the SAME indentation — a
// backreference, so a body containing nested blocks (pick()'s for-loop) is not
// truncated at the first inner brace.
function extract(signature) {
    const lit = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^([ \\t]*)function ' + lit + ' \\{[\\s\\S]*?\\n\\1\\}', 'm');
    const m = re.exec(SRC);
    assert.ok(m, `no \`function ${signature}\` found in js/ops-console.js`);
    return m[0];
}

const { pick, releaseLabelOf, lastRunTsOf } = (function () {
    const src = [
        extract('pick(obj /* , ...names */)'),
        extract('releaseLabelOf(release)'),
        extract('lastRunTsOf(lastRun)'),
    ].join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${src}; return { pick, releaseLabelOf, lastRunTsOf };`)();
})();

// ── pick(): snake_case is the backend's vocabulary ───────────────────────────

test('pick() resolves the snake_case form of a camelCase name', () => {
    assert.strictEqual(pick({ formed_at: 'x' }, 'formedAt'), 'x');
    assert.strictEqual(pick({ formedAt: 'y' }, 'formedAt'), 'y');
    assert.strictEqual(pick({}, 'formedAt'), undefined);
    assert.strictEqual(pick(null, 'formedAt'), undefined);
});

// ── release badge ────────────────────────────────────────────────────────────

test('releaseLabelOf(): reads `name` and renders name@version', () => {
    assert.strictEqual(
        releaseLabelOf({ name: 'baseline_v2', version: '1', state: 'shadow' }),
        'baseline_v2@1'
    );
});

test('releaseLabelOf(): `name` WINS over the legacy `strategy` spelling', () => {
    assert.strictEqual(
        releaseLabelOf({ name: 'baseline_v2', strategy: 'pure_quant', version: '1' }),
        'baseline_v2@1'
    );
});

test('releaseLabelOf(): falls back to `strategy` on an older backend', () => {
    assert.strictEqual(releaseLabelOf({ strategy: 'baseline_v2', version: '1' }), 'baseline_v2@1');
});

test('releaseLabelOf(): degrades without inventing a label', () => {
    assert.strictEqual(releaseLabelOf({ name: 'baseline_v2' }), 'baseline_v2'); // no version
    assert.strictEqual(releaseLabelOf({ id: 'rel_7' }), 'rel_7'); // neither name nor strategy
    assert.strictEqual(releaseLabelOf({}), null); // caller renders "unknown"
    assert.strictEqual(releaseLabelOf(null), null);
    assert.strictEqual(releaseLabelOf('baseline_v2@1'), 'baseline_v2@1'); // plain string
});

// ── last run timestamp ───────────────────────────────────────────────────────

const FORMED = '2026-09-17T21:45:00Z';
const RAN = '2026-09-17T22:00:00Z';
const CREATED = '2026-09-17T22:05:00Z';

test('lastRunTsOf(): prefers formed_at over every other field', () => {
    assert.strictEqual(
        lastRunTsOf({ formed_at: FORMED, ran_at: RAN, created_at: CREATED, session_date: '2026-09-17' }),
        FORMED
    );
});

test('lastRunTsOf(): falls back ran_at → created_at → session_date, in that order', () => {
    assert.strictEqual(lastRunTsOf({ ran_at: RAN, created_at: CREATED, session_date: '2026-09-17' }), RAN);
    assert.strictEqual(lastRunTsOf({ created_at: CREATED, session_date: '2026-09-17' }), CREATED);
    // A date, not a timestamp — deliberately last.
    assert.strictEqual(lastRunTsOf({ session_date: '2026-09-17' }), '2026-09-17');
});

test('lastRunTsOf(): accepts the camelCase spellings too', () => {
    assert.strictEqual(lastRunTsOf({ formedAt: FORMED, ranAt: RAN }), FORMED);
});

test('lastRunTsOf(): absent → null (the strip renders "unknown", not a fake time)', () => {
    assert.strictEqual(lastRunTsOf({}), null);
    assert.strictEqual(lastRunTsOf(null), null);
    assert.strictEqual(lastRunTsOf(undefined), null);
    // A bare timestamp instead of an object still works.
    assert.strictEqual(lastRunTsOf(FORMED), FORMED);
});
