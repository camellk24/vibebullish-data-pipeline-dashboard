'use strict';

// Render coverage for the ops console Overview tab. The payload is the
// committed fixture js/fixtures/ops-overview.sample.json, in the shape the
// backend's GET /api/internal/ops/overview returns (build plan Task 4).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render, isStale, chip } = require('./ops-overview-format.js');

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ops-overview.sample.json'), 'utf8'));
const GEN = Date.parse(FIXTURE.generated_at);
const fresh = { receivedAt: GEN + 1000, now: GEN + 2000 };

test('renders every status with the right class; nothing but PASS is green', () => {
    assert.match(chip('PASS', esc), /ops-chip-ok/);
    assert.match(chip('WARN', esc), /ops-chip-warn/);
    assert.match(chip('FAIL', esc), /ops-chip-bad/);
    for (const s of ['UNKNOWN', 'DIAGNOSTIC', 'NOT_BUILT', 'BOGUS', null]) {
        const c = chip(s, esc);
        assert.match(c, /ops-chip-unknown/, String(s));
        assert.doesNotMatch(c, /ops-chip-ok/, String(s));
    }
    assert.match(chip('NOT_BUILT', esc), />NOT BUILT</);
    assert.match(chip('DIAGNOSTIC', esc), />DIAGNOSTIC</);
});

test('shows the unmeasured count beside the overall chip', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /6 of 9 measured · 11 unmeasured/);
    assert.match(out.html, /<details class="ov-unmeasured"><summary>Unmeasured \(11\)<\/summary>/);
    assert.equal(out.stale, false);
    assert.equal(out.badgeBad, true);
});

test('lists FAIL lines as not paged', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /substrate_freshness · not paged/);
    assert.match(out.html, /<span class="ov-not-paged">not paged<\/span>/);
});

test('a timed-out line keeps its reason and says it has no timestamp', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /inference_health<\/span> <span class="ops-chip ops-chip-unknown">UNKNOWN<\/span> <span class="ov-reason">timeout<\/span>/);
    assert.match(out.html, /no timestamp/);
});

test('escapes payload strings', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    p.stages[0].lines[0].reason = '<img src=x onerror=alert(1)>';
    p.stages[0].tab = '"><script>alert(1)</script>';
    const out = render(p, esc, fresh);
    assert.ok(!out.html.includes('<img'), 'tag rendered');
    assert.ok(!out.html.includes('<script>'), 'script rendered');
    assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('formats a stale view', () => {
    const later = { receivedAt: GEN + 1000, now: GEN + 6 * 60 * 1000 };
    assert.equal(isStale(FIXTURE, later), true);
    const out = render(FIXTURE, esc, later);
    assert.equal(out.stale, true);
    assert.match(out.html, /stale/);
    assert.match(out.html, /<div class="ov-overall"><span class="ops-chip ops-chip-unknown">UNKNOWN<\/span>/);
    assert.equal(out.badge, 'stale');
    // exactly five minutes is not yet stale
    assert.equal(isStale(FIXTURE, { receivedAt: GEN, now: GEN + 5 * 60 * 1000 }), false);
});

test('a PASS view is green only when fresh', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    p.status = 'PASS';
    assert.match(render(p, esc, fresh).html, /<div class="ov-overall"><span class="ops-chip ops-chip-ok">PASS/);
    assert.equal(render(p, esc, fresh).badgeBad, false);
    assert.equal(isStale(p, {}), true, 'missing clocks are never fresh');
});

test('handles a missing stages array', () => {
    for (const p of [null, {}, { stages: 'x' }]) {
        const out = render(p, esc, fresh);
        assert.match(out.html, /Malformed response/);
        assert.equal(out.badgeBad, true);
    }
});
