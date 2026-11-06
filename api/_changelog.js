// The Changelog tab's data: api/_changelog.md, parsed for /api/ops/reads?view=changelog.
//
// Lives under api/ with a "_" prefix so Vercel does not build it as a function
// (the Hobby plan allows 12) and so the file reaches the reads function through
// the file trace. The readFileSync(path.join(__dirname, …)) form below is what
// the trace recognises: keep it literal.

const fs = require('node:fs');
const path = require('node:path');

const SURFACES = new Set(['web', 'ios', 'backend', 'pipeline', 'dashboard']);
const HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.+)$/;
const ITEM_RE = /^-\s+\[([a-z]+)\]\s+(.+)$/;

// parseChangelog(markdown) → [{date, title, items: [{surface, text}]}], in file
// order. Anything that is not a release heading or a tagged item is ignored, so
// the file's preamble never renders; the test on the real file catches typos.
function parseChangelog(markdown) {
    const releases = [];
    let current = null;
    for (const line of String(markdown).split('\n')) {
        const heading = line.match(HEADING_RE);
        if (heading) {
            current = { date: heading[1], title: heading[2].trim(), items: [] };
            releases.push(current);
            continue;
        }
        const item = current && line.match(ITEM_RE);
        if (item && SURFACES.has(item[1])) current.items.push({ surface: item[1], text: item[2].trim() });
    }
    return releases;
}

function readChangelog() {
    return parseChangelog(fs.readFileSync(path.join(__dirname, '_changelog.md'), 'utf8'));
}

module.exports = { parseChangelog, readChangelog, SURFACES };
