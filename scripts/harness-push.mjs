#!/usr/bin/env node
// harness-push — the harness's one call into the dashboard's Blob store.
//
//   node scripts/harness-push.mjs <state.json>            validate, then upload to harness/state.json
//   node scripts/harness-push.mjs --dry-run <state.json>  validate only, no network
//   node scripts/harness-push.mjs --pull-vetoes           print harness/vetoes.json (empty v1 doc if absent)
//
// Auth: BLOB_READ_WRITE_TOKEN from the environment (the private store's
// read-write token). The token is never printed: every message that leaves
// this script is passed through redact() first.
//
// Exit codes: 0 ok · 1 blob/network failure · 2 usage or missing token ·
// 3 the file is not a valid schema v1 state document.
//
// Needs `npm install` in this repo (for @vercel/blob); nothing else.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schema = require('../api/_harness_schema.js');

const MAX_BYTES = 2 * 1024 * 1024;
const TOKEN = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();

function redact(s) {
    let out = String(s);
    if (TOKEN) out = out.split(TOKEN).join('[redacted]');
    return out.replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, '[redacted]');
}

function fail(code, msg) {
    process.stderr.write('harness-push: ' + redact(msg) + '\n');
    process.exit(code);
}

function usage() {
    fail(2, 'usage: node scripts/harness-push.mjs [--dry-run] <state.json> | --pull-vetoes');
}

async function loadBlob() {
    if (!TOKEN) fail(2, 'BLOB_READ_WRITE_TOKEN is not set (the private Blob store read-write token).');
    try {
        return await import('@vercel/blob');
    } catch (_e) {
        fail(2, '@vercel/blob is not installed; run `npm install` in the dashboard repo first.');
    }
}

async function pullVetoes() {
    const { get } = await loadBlob();
    let r;
    try {
        r = await get(schema.VETOES_PATH, { access: 'private', useCache: false, token: TOKEN });
    } catch (err) {
        fail(1, 'could not read ' + schema.VETOES_PATH + ': ' + ((err && err.message) || err));
    }
    if (!r) {
        process.stdout.write(JSON.stringify(schema.emptyVetoes(), null, 2) + '\n');
        return;
    }
    const text = await new Response(r.stream).text();
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (_e) {
        fail(1, schema.VETOES_PATH + ' is not valid JSON.');
    }
    const norm = schema.normalizeVetoes(doc);
    if (!norm) fail(1, schema.VETOES_PATH + ' is not a schema v1 vetoes document.');
    process.stdout.write(JSON.stringify(norm, null, 2) + '\n');
}

async function push(file, dryRun) {
    let text;
    try {
        text = await readFile(file, 'utf8');
    } catch (err) {
        fail(2, 'cannot read ' + file + ': ' + ((err && err.code) || err));
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail(3, file + ' is larger than 2 MB.');
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (err) {
        fail(3, file + ' is not valid JSON: ' + ((err && err.message) || err));
    }
    const problems = schema.validateState(doc);
    if (problems.length) fail(3, 'not a valid schema v1 state document:\n  - ' + problems.join('\n  - '));
    if (dryRun) {
        process.stdout.write(`ok (dry run): ${(doc.tasks || []).length} tasks, ${(doc.events || []).length} events\n`);
        return;
    }
    const { put } = await loadBlob();
    try {
        await put(schema.STATE_PATH, JSON.stringify(doc), {
            access: 'private',
            allowOverwrite: true,
            addRandomSuffix: false,
            contentType: 'application/json',
            token: TOKEN,
        });
    } catch (err) {
        fail(1, 'upload failed: ' + ((err && err.message) || err));
    }
    process.stdout.write(`ok: uploaded ${schema.STATE_PATH} (${(doc.tasks || []).length} tasks)\n`);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--pull-vetoes') {
    await pullVetoes();
} else if (args.length === 2 && args[0] === '--dry-run' && !args[1].startsWith('--')) {
    await push(args[1], true);
} else if (args.length === 1 && !args[0].startsWith('--')) {
    await push(args[0], false);
} else {
    usage();
}
