// node --test api/*.test.js
//
// The browser escapers are duplicated in js/auth.js (an ES module) and
// js/ops-console.js (an IIFE), so neither can simply be require()d here. This
// suite EXTRACTS the real `esc` source from each file and evaluates it, so the
// assertions run against the shipped code rather than a copy.
//
// Why it matters: both escapers feed values into QUOTED HTML attributes
// (title="…", data-target="…"). An escaper built on textContent/innerHTML — the
// previous implementation — leaves `"` and `'` untouched, so a backend string
// like `" onmouseover="x` would close the attribute and inject a handler.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'js');

function extractEsc(file) {
    const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    const m = /function esc\(s\) \{[\s\S]*?\n\s*\}/.exec(src);
    assert.ok(m, `no \`function esc(s)\` found in js/${file}`);
    // eslint-disable-next-line no-new-func
    return new Function(`${m[0]}; return esc;`)();
}

const FILES = ['auth.js', 'ops-console.js'];

for (const file of FILES) {
    test(`js/${file}: esc() escapes quotes so it is safe inside an attribute`, () => {
        const esc = extractEsc(file);

        const attack = '" onmouseover="x';
        const out = esc(attack);
        assert.ok(!out.includes('"'), `raw double quote survived: ${out}`);
        assert.strictEqual(out, '&quot; onmouseover=&quot;x');

        // The single-quoted attribute variant.
        const single = esc("' onfocus='y");
        assert.ok(!single.includes("'"), `raw single quote survived: ${single}`);

        // Building a real attribute must not let the value break out.
        const html = `<span title="${esc(attack)}">t</span>`;
        assert.strictEqual(html.match(/"/g).length, 2, 'exactly the two attribute quotes');
        assert.ok(!/onmouseover=/.test(html.replace(/&quot;/g, '')) || !html.includes('" onmouseover'));
    });

    test(`js/${file}: esc() escapes the angle brackets and ampersand, ampersand first`, () => {
        const esc = extractEsc(file);
        assert.strictEqual(esc('<script>'), '&lt;script&gt;');
        // & must be replaced BEFORE the entities it introduces, or `&lt;` from
        // the input would come back as `&amp;lt;`-mangled output ordering.
        assert.strictEqual(esc('&'), '&amp;');
        assert.strictEqual(esc('a & <b>'), 'a &amp; &lt;b&gt;');
    });

    test(`js/${file}: esc() renders null/undefined as empty, not "null"`, () => {
        const esc = extractEsc(file);
        assert.strictEqual(esc(null), '');
        assert.strictEqual(esc(undefined), '');
        assert.strictEqual(esc(0), '0');
        assert.strictEqual(esc(false), 'false');
    });
}

test('both escapers behave identically', () => {
    const [a, b] = FILES.map(extractEsc);
    for (const s of ['" onmouseover="x', "'", '<&>', 'plain', null, 7]) {
        assert.strictEqual(a(s), b(s), `divergent output for ${JSON.stringify(s)}`);
    }
});
