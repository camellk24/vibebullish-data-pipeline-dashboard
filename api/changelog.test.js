// The Changelog tab's data path: the parser, the real file's shape, and the
// admin gate in front of it on /api/ops/reads?view=changelog.

const test = require('node:test');
const assert = require('node:assert');

const { parseChangelog, readChangelog, SURFACES } = require('./_changelog.js');
const handler = require('./ops/reads.js');
const { fakeRes, fakeReq, upstreamResponse, installFetch, withEnv } = require('./_test_helpers.js');

const H = { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.firebase-id-token-3f9a7c2e1d' };

test('parser: sections and tagged items; preamble, untagged and unknown-surface lines are ignored', () => {
    const md = [
        '# Title', 'Preamble.', '- [web] **Before any section**: dropped.',
        '## 2026-11-06 · Two things',
        '- [ios] **A**: one. (#1)', '- untagged', '- [nope] unknown surface', '',
        '## not-a-date · Ignored heading',
        '- [web] **B**: still the section above.',
        '## 2026-11-05 · Older', '- [backend] **C**: two.',
    ].join('\n');
    assert.deepStrictEqual(parseChangelog(md), [
        { date: '2026-11-06', title: 'Two things', items: [
            { surface: 'ios', text: '**A**: one. (#1)' },
            { surface: 'web', text: '**B**: still the section above.' },
        ] },
        { date: '2026-11-05', title: 'Older', items: [{ surface: 'backend', text: '**C**: two.' }] },
    ]);
});

test('the real file: newest first, no empty release, and no bullet the parser would silently drop', () => {
    const releases = readChangelog();
    assert.ok(releases.length > 0);
    const dates = releases.map(r => r.date);
    assert.deepStrictEqual(dates, [...dates].sort().reverse());
    for (const r of releases) {
        assert.ok(r.items.length > 0, r.date);
        for (const i of r.items) assert.ok(SURFACES.has(i.surface), i.text);
    }
    const raw = require('node:fs').readFileSync(require('node:path').join(__dirname, '_changelog.md'), 'utf8');
    const body = raw.slice(raw.indexOf('\n## '));
    const bullets = body.split('\n').filter(l => l.startsWith('- ')).length;
    const headings = body.split('\n').filter(l => l.startsWith('## ')).length;
    assert.strictEqual(releases.reduce((n, r) => n + r.items.length, 0), bullets);
    assert.strictEqual(releases.length, headings);
});

test('changelog view: no bearer → 401, no network, no data', async () => {
    await withEnv(async () => {
        const calls = installFetch({});
        const res = fakeRes();
        await handler(fakeReq({ query: { view: 'changelog' } }), res);
        assert.strictEqual(res.statusCode, 401);
        assert.strictEqual(JSON.parse(res.body).releases, undefined);
        assert.strictEqual(calls.length, 0);
    });
});

test('changelog view: non-admin → 403 and no data', async () => {
    await withEnv(async () => {
        installFetch({ '/api/admin/whoami': () => upstreamResponse(403, { error: 'forbidden' }) });
        const res = fakeRes();
        await handler(fakeReq({ query: { view: 'changelog' }, headers: H }), res);
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(JSON.parse(res.body).releases, undefined);
    });
});

test('changelog view: admin → 200 from the file, only whoami goes upstream', async () => {
    await withEnv(async () => {
        const calls = installFetch({ '/api/admin/whoami': () => upstreamResponse(200, { uid: 'admin-uid' }) });
        const res = fakeRes();
        await handler(fakeReq({ query: { view: 'changelog' }, headers: H }), res);
        assert.strictEqual(res.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(res.body).releases, readChangelog());
        assert.strictEqual(calls.length, 1);
    });
});

test('vercel.json redirects direct requests for the source file, before the filesystem can serve it', () => {
    const config = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'vercel.json'), 'utf8'));
    assert.deepStrictEqual(config.redirects, [
        { source: '/(.*)_changelog\\.md(/.*)?', destination: '/', permanent: false },
        // Routing matches the raw path but the filesystem decodes it, so
        // /api/%5Fchangelog.md would otherwise slip past the rule above.
        { source: '/(.*)%(.*)', destination: '/', permanent: false },
    ]);
});
