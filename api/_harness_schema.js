// Shared shape of the two Harness-board blobs (schema v1). Not a Vercel
// function: files prefixed with `_` are excluded from the functions build.
//
// Used by api/ops/harness.js (veto validation, state sanity check) and by
// scripts/harness-push.mjs (validate before upload), so the route and the
// uploader cannot disagree about what a valid file is.
//
//   harness/state.json   written by the harness on the owner's Mac
//   harness/vetoes.json  written by this dashboard (owner Do next / Skip)

const STATE_PATH = 'harness/state.json';
const VETOES_PATH = 'harness/vetoes.json';
const SCHEMA_VERSION = 1;

const TASK_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const VETO_ACTIONS = ['skip', 'top', 'undo'];
const MODES = ['not_started', 'running', 'paused'];
const TASK_STATES = [
    'queued', 'implementing', 'verifying', 'reviewing', 'merging',
    'deploying', 'checking', 'done', 'stopped', 'vetoed',
];
const RISKS = ['low', 'medium', 'high'];

function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

// validateState returns a list of problems (empty = valid). It checks the
// structure the board renders from; unknown extra fields are allowed.
function validateState(s) {
    const errs = [];
    if (!isObj(s)) return ['state must be a JSON object'];
    if (s.schema_version !== SCHEMA_VERSION) errs.push(`schema_version must be ${SCHEMA_VERSION}`);
    if (s.status !== null && s.status !== undefined) {
        if (!isObj(s.status)) errs.push('status must be an object or null');
        else {
            if (s.status.mode !== undefined && !MODES.includes(s.status.mode)) {
                errs.push('status.mode must be one of ' + MODES.join('|'));
            }
            if (s.status.lanes !== undefined && !Array.isArray(s.status.lanes)) errs.push('status.lanes must be an array');
        }
    }
    for (const k of ['tasks', 'needs', 'events']) {
        if (s[k] !== undefined && !Array.isArray(s[k])) errs.push(`${k} must be an array`);
    }
    (Array.isArray(s.tasks) ? s.tasks : []).forEach((t, i) => {
        if (!isObj(t)) { errs.push(`tasks[${i}] must be an object`); return; }
        if (typeof t.id !== 'string' || !TASK_ID_RE.test(t.id)) errs.push(`tasks[${i}].id must match ${TASK_ID_RE}`);
        if (!TASK_STATES.includes(t.state)) errs.push(`tasks[${i}].state must be one of ${TASK_STATES.join('|')}`);
        if (t.risk !== undefined && t.risk !== null && !RISKS.includes(t.risk)) errs.push(`tasks[${i}].risk must be low|medium|high|null`);
    });
    (Array.isArray(s.needs) ? s.needs : []).forEach((n, i) => {
        if (!isObj(n)) errs.push(`needs[${i}] must be an object`);
    });
    (Array.isArray(s.events) ? s.events : []).forEach((e, i) => {
        if (!isObj(e)) errs.push(`events[${i}] must be an object`);
    });
    return errs;
}

// emptyVetoes is what a missing vetoes.json means.
function emptyVetoes() {
    return { schema_version: SCHEMA_VERSION, vetoes: Object.create(null) };
}

// normalizeVetoes keeps only well-formed entries; null when the document is
// not a v1 vetoes file at all (the caller must not overwrite it blindly).
function normalizeVetoes(doc) {
    if (!isObj(doc) || doc.schema_version !== SCHEMA_VERSION || !isObj(doc.vetoes)) return null;
    const out = Object.create(null); // task ids like __proto__ stay own keys
    for (const [id, v] of Object.entries(doc.vetoes)) {
        if (!TASK_ID_RE.test(id) || !isObj(v)) continue;
        if (v.action !== 'skip' && v.action !== 'top') continue;
        out[id] = {
            action: v.action,
            at: typeof v.at === 'string' ? v.at : null,
            by_uid: typeof v.by_uid === 'string' ? v.by_uid : null,
        };
    }
    return { schema_version: SCHEMA_VERSION, vetoes: out };
}

module.exports = {
    STATE_PATH,
    VETOES_PATH,
    SCHEMA_VERSION,
    TASK_ID_RE,
    VETO_ACTIONS,
    MODES,
    TASK_STATES,
    RISKS,
    validateState,
    emptyVetoes,
    normalizeVetoes,
};
