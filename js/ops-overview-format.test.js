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
    assert.match(out.html, /6 of 9 stages measured · 11 lines unmeasured/);
    assert.match(out.html, /<details class="ov-unmeasured"><summary>Unmeasured lines \(11\)<\/summary>/);
    assert.equal(out.stale, false);
});

test('the status appears once: the card header stays empty unless the view is stale', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.equal(out.badge, '');
    assert.equal(out.badgeBad, false);
});

test('times are Pacific, in both offsets; a session date stays a date', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    p.generated_at = '2026-11-07T08:51:00Z'; // PST
    const line = p.stages[0].lines[0];
    line.as_of = '2026-10-03T21:52:05Z'; // PDT
    const gen = Date.parse(p.generated_at);
    const out = render(p, esc, { receivedAt: gen, now: gen });
    assert.match(out.html, /generated 2026-11-07 00:51 PT/);
    assert.match(out.html, /2026-10-03 14:52 PT/);
    assert.doesNotMatch(out.html, /\d{2}:\d{2}Z/);
    assert.match(out.html, /<span class="ov-asof">2026-11-03<\/span>/);
});

test('a reading a day or more old says its age; a newer one and a session date do not', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    const line = p.stages[0].lines[0];
    const at = (ms) => {
        line.as_of = new Date(GEN - ms).toISOString();
        return render(p, esc, fresh).html;
    };
    const DAY = 24 * 60 * 60 * 1000;
    assert.match(at(34 * DAY), /PT · 34 d old<\/span>/);
    assert.doesNotMatch(at(DAY / 2), /d old/);
    line.as_of = '2026-01-01';
    assert.doesNotMatch(render(p, esc, fresh).html, /d old/);
    line.as_of = 'not a time';
    assert.match(render(p, esc, fresh).html, /<span class="ov-asof">not a time<\/span>/);
});

test('names read as words; an unlisted id or reason is still shown', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    const line = p.stages[0].lines[0];
    line.status = 'UNKNOWN';
    line.reason = 'snapshot_stale';
    assert.match(render(p, esc, fresh).html, /Substrate freshness<\/span>.*snapshot stale/s);
    line.id = 'brand_new_line';
    line.reason = 'brand_new_reason';
    const html = render(p, esc, fresh).html;
    assert.match(html, /brand new line/);
    assert.match(html, /brand new reason/);
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        line.id = key;
        line.reason = key;
        const h = render(p, esc, fresh).html;
        assert.match(h, new RegExp(`<span class="ov-line-id">${key.replace(/_/g, ' ')}</span>`), key);
        assert.match(h, new RegExp(`<span class="ov-reason">${key.replace(/_/g, ' ')}</span>`), key);
        assert.doesNotMatch(h, /native code|\[object Object\]/, key);
    }
});

test('no_result names the ET session, not the Pacific day, across Pacific midnight', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    p.generated_at = '2026-11-07T05:30:00Z'; // Nov 6, 21:30 PT; already the Nov 7 session in ET
    const line = p.stages[1].lines[0];
    line.status = 'UNKNOWN';
    line.reason = 'no_result';
    line.as_of = '2026-11-07';
    const gen = Date.parse(p.generated_at);
    const html = render(p, esc, { receivedAt: gen, now: gen }).html;
    assert.match(html, /generated 2026-11-06 21:30 PT/);
    assert.match(html, /<span class="ov-reason">no result for this session<\/span><span class="ov-asof">2026-11-07<\/span>/);
    assert.doesNotMatch(html, /today/);
});

test('the age note starts at exactly 24 hours and never shows for a future time', () => {
    const p = JSON.parse(JSON.stringify(FIXTURE));
    const line = p.stages[0].lines[0];
    const DAY = 24 * 60 * 60 * 1000;
    line.as_of = new Date(fresh.now - DAY).toISOString();
    assert.match(render(p, esc, fresh).html, /PT · 1 d old/);
    line.as_of = new Date(fresh.now - DAY + 1000).toISOString();
    assert.doesNotMatch(render(p, esc, fresh).html, /d old/);
    line.as_of = new Date(fresh.now + DAY).toISOString();
    assert.doesNotMatch(render(p, esc, fresh).html, /d old/);
});

test('no timestamp is plain text, not a pill that reads like a status', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /<span class="ov-asof">no timestamp<\/span>/);
    assert.doesNotMatch(out.html, /ops-unknown/);
});

test('lists FAIL lines as not paged', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /Substrate freshness · not paged/);
    assert.match(out.html, /<span class="ov-not-paged">not paged<\/span>/);
});

test('a timed-out line keeps its reason and says it has no timestamp', () => {
    const out = render(FIXTURE, esc, fresh);
    assert.match(out.html, /Inference health<\/span> <span class="ops-chip ops-chip-unknown">UNKNOWN<\/span> <span class="ov-reason">timed out<\/span>/);
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
    assert.equal(isStale(p, {}), true, 'missing clocks are never fresh');
});

test('handles a missing stages array', () => {
    for (const p of [null, {}, { stages: 'x' }]) {
        const out = render(p, esc, fresh);
        assert.match(out.html, /Malformed response/);
        assert.equal(out.badgeBad, true);
    }
});
