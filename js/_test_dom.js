'use strict';
// Persistent fake DOM + sandbox for the js/*.test.js lifecycle suites.
//
// Not a browser: elements are kept by id for the life of the sandbox, real
// listeners fire (with bubbling), timers are recorded and ticked by the test,
// and every innerHTML assignment is kept as a string so the injection scan can
// read it. The tree is DERIVED FROM index.html (tab buttons, tab panels and
// every id inside each panel), so a renamed element fails the suite.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function parseSelector(sel) {
    // Compound selector only: tag, #id, .class, [attr], [attr="v"], :not(<simple>)
    const out = { tag: null, id: null, classes: [], attrs: [], nots: [] };
    let rest = sel.trim();
    const m = /^[a-zA-Z][\w-]*/.exec(rest);
    if (m) { out.tag = m[0].toUpperCase(); rest = rest.slice(m[0].length); }
    const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(([^)]*)\)/g;
    let a;
    while ((a = re.exec(rest))) {
        if (a[1]) out.id = a[1];
        else if (a[2]) out.classes.push(a[2]);
        else if (a[3]) out.attrs.push([a[3], a[4] === undefined ? null : a[4]]);
        else if (a[5]) out.nots.push(parseSelector(a[5]));
    }
    return out;
}

function matchOne(el, p) {
    if (p.tag && el.tagName !== p.tag) return false;
    if (p.id && el.id !== p.id) return false;
    for (const c of p.classes) if (!el._cls.has(c)) return false;
    for (const [k, v] of p.attrs) {
        if (!(k in el.attrs)) return false;
        if (v !== null && el.attrs[k] !== v) return false;
    }
    for (const n of p.nots) if (matchOne(el, n)) return false;
    return true;
}

function createSandbox(opts) {
    opts = opts || {};
    const registry = [];
    const byId = new Map();
    const timers = { intervals: [], timeouts: [], nextId: 1 };
    const fetchCalls = [];
    const winListeners = Object.create(null);
    const docListeners = Object.create(null);
    const pending = []; // deferred read responders when deferReads is on
    const state = { deferReads: false, responses: Object.create(null), fail: Object.create(null) };

    let doc;
    class El {
        constructor(tag, attrs) {
            attrs = attrs || {};
            this.tagName = String(tag).toUpperCase();
            this.attrs = Object.assign({}, attrs);
            this.id = attrs.id || '';
            this.children = [];
            this.parent = null;
            this._listeners = Object.create(null);
            this.style = {};
            this.dataset = {};
            this._cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
            this._text = '';
            this._html = '';
            this.hidden = false;
            this.value = attrs.value || '';
            for (const k of Object.keys(attrs)) if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = attrs[k];
            const self = this;
            this.classList = {
                add(c) { self._cls.add(c); },
                remove(c) { self._cls.delete(c); },
                contains(c) { return self._cls.has(c); },
                toggle(c, force) { const on = force === undefined ? !self._cls.has(c) : !!force; if (on) self._cls.add(c); else self._cls.delete(c); return on; },
            };
            registry.push(this);
            if (this.id) byId.set(this.id, this);
        }
        get className() { return [...this._cls].join(' '); }
        set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
        get innerHTML() { return this._html; }
        set innerHTML(v) {
            this._html = String(v); this._text = ''; this.children = [];
            // Elements declared in the string become reachable by id (and by
            // class/data-* selectors) as lightweight children, the way a
            // browser would create them.
            const re = /<(\w+)([^>]*)\bid="([^"]+)"([^>]*)>/g;
            let m;
            while ((m = re.exec(this._html))) {
                const attrs = { id: m[3] };
                const rest = m[2] + ' ' + m[4];
                const cm = /class="([^"]*)"/.exec(rest); if (cm) attrs.class = cm[1];
                const dm = rest.matchAll(/(data-[\w-]+)="([^"]*)"/g); for (const d of dm) attrs[d[1]] = d[2];
                const child = new El(m[1], attrs);
                child.parent = this; this.children.push(child);
            }
        }
        get textContent() { return this._text; }
        set textContent(v) { this._text = String(v); this._html = ''; this.children = []; }
        get firstChild() { return this.children[0] || null; }
        appendChild(c) { c.parent = this; this.children.push(c); return c; }
        removeChild(c) { this.children = this.children.filter(x => x !== c); c.parent = null; return c; }
        remove() { if (this.parent) this.parent.removeChild(this); }
        insertAdjacentHTML(_pos, html) { this._html += String(html); }
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
        setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = String(v); byId.set(this.id, this); } if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
        hasAttribute(k) { return k in this.attrs; }
        removeAttribute(k) { delete this.attrs[k]; }
        addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
        removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(f => f !== fn); }
        matches(sel) { return sel.split(',').some(s => matchOne(this, parseSelector(s))); }
        closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n.parent; } return null; }
        _all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
        querySelectorAll(sel) {
            const found = this._all().filter(e => e.matches(sel));
            return found;
        }
        querySelector(sel) {
            const found = this.querySelectorAll(sel);
            if (found.length) return found[0];
            // A tag present in this element's innerHTML string (e.g. a <tbody>
            // set via innerHTML, then queried to append rows) materializes
            // lazily as a child so the renderer can keep going.
            const p = parseSelector(sel.split(',')[0]);
            if (p.tag && !p.id && !p.classes.length && new RegExp('<' + p.tag + '\\b', 'i').test(this._html)) {
                return this.appendChild(new El(p.tag));
            }
            return null;
        }
        dispatchEvent(ev) { this.dispatch(ev.type, ev); return true; }
        dispatch(type, extra) {
            const ev = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, extra || {});
            let node = this;
            while (node) {
                for (const fn of (node._listeners[type] || []).slice()) fn(ev);
                node = node.parent;
            }
            for (const fn of (docListeners[type] || []).slice()) fn(ev);
        }
        click() { this.dispatch('click'); }
        focus() {}
    }

    // ── tree from index.html ──────────────────────────────────────────────
    const html = read('index.html');
    const root = new El('body');
    const nav = new El('nav', { class: 'dashboard-tabs' });
    root.appendChild(nav);
    const btnRe = /<button class="(tab[^"]*)" data-tab="([a-z0-9-]+)"( data-ops-tab)?[^>]*>([^<]*)<\/button>/g;
    let bm;
    const tabButtons = [];
    while ((bm = btnRe.exec(html))) {
        const attrs = { class: bm[1], 'data-tab': bm[2] };
        if (bm[3]) attrs['data-ops-tab'] = '';
        const b = new El('button', attrs);
        b._text = bm[4];
        if (bm[3]) b.style.display = 'none';
        nav.appendChild(b);
        tabButtons.push(b);
    }
    for (const id of ['ops-access-note', 'auth-slot', 'last-updated', 'live-dot']) root.appendChild(new El(id === 'auth-slot' || id === 'last-updated' || id === 'live-dot' ? 'span' : 'div', { id }));
    const panelRe = /<div id="tab-([a-z0-9-]+)"([^>]*)>([\s\S]*?)<\/div><!-- \/tab-\1 -->/g;
    let pm;
    const panels = {};
    while ((pm = panelRe.exec(html))) {
        const attrs = { id: 'tab-' + pm[1] };
        const panel = new El('div', attrs);
        if (/display:none/.test(pm[2])) panel.style.display = 'none';
        root.appendChild(panel);
        panels[pm[1]] = panel;
        if (/class="vb-gate"/.test(pm[3])) panel.appendChild(new El('div', { class: 'vb-gate', role: 'status' })).hidden = true;
        const idRe = /<(\w+)[^>]*\bid="([a-z0-9-]+)"[^>]*>/g;
        let im;
        while ((im = idRe.exec(pm[3]))) {
            if (byId.has(im[2])) continue;
            const el = new El(im[1], { id: im[2] });
            if (im[2] === 'ca-filter-days') el.value = '30';
            panel.appendChild(el);
        }
    }

    // Minimal well-formed payloads for views whose renderers require a shape
    // (a response that lacks it is, by design, a render failure).
    const DEFAULT_RESPONSES = {
        'data-collector-health': { queue: { Pending: 0, InProgress: 0, CompletedLastHr: 0, FailedLastHr: 0, AvgCompletionMs: 0, BySource: {}, ByDataType: {} }, tables: {}, api_usage: {}, recent_errors: [] },
        'llm-week': [],
    };

    // ── sandbox globals ───────────────────────────────────────────────────
    function respondFor(url) {
        const u = new URL(url, 'https://dashboard.example.test');
        const p = u.pathname;
        const ok = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
        if (p === '/api/config') return ok(503, { error: 'not_configured', message: 'no firebase config in tests' });
        if (p === '/api/ops/whoami') return state.whoami ? state.whoami() : ok(200, { admin: true, uid: 'admin-uid', email: 'admin@example.test' });
        if (p === '/api/ops/reads') {
            const view = u.searchParams.get('view');
            if (state.fail[view]) return ok(state.fail[view].status, state.fail[view].body);
            return ok(200, state.responses[view] || DEFAULT_RESPONSES[view] || { ok: true, view });
        }
        if (p === '/api/agent-ops') return ok(200, { generated_at: new Date().toISOString(), summary: {}, roles: [] });
        if (p.startsWith('/api/ops/')) return ok(200, { rows: [], routines: [], items: [] });
        return ok(404, { error: 'not_found' });
    }

    const ctx = {
        console: opts.console || { log() {}, warn() {}, error() {} },
        URL, URLSearchParams, Promise, Date, Math, JSON, Error, Number, String, Object, Array, Map, Set, Boolean, RegExp, Symbol,
        isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl, setImmediate,
        location: { search: opts.search || '', hash: '', href: 'https://dashboard.example.test/', origin: 'https://dashboard.example.test', pathname: '/' },
        navigator: { userAgent: 'node-test' },
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        Event: class Event { constructor(type) { this.type = type; } },
        setInterval(fn, ms) { const id = timers.nextId++; timers.intervals.push({ id, fn, ms }); return id; },
        clearInterval(id) { timers.intervals = timers.intervals.filter(t => t.id !== id); },
        setTimeout(fn, ms) { const id = timers.nextId++; timers.timeouts.push({ id, fn, ms }); return id; },
        clearTimeout(id) { timers.timeouts = timers.timeouts.filter(t => t.id !== id); },
        addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
        removeEventListener(t, fn) { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); },
        dispatchEvent(ev) { for (const fn of (winListeners[ev.type] || []).slice()) fn(ev); return true; },
        fetch(url, o) {
            const call = { url: String(url), opts: o || {}, headers: (o && o.headers) || {} };
            fetchCalls.push(call);
            const resp = respondFor(call.url);
            if (state.deferReads && /\/api\/ops\/reads/.test(call.url)) {
                return new Promise((resolve) => pending.push({ call, resolve: () => resolve(resp) }));
            }
            return Promise.resolve(resp);
        },
    };
    doc = {
        readyState: 'complete',
        body: root,
        head: new El('head'),
        getElementById: (id) => byId.get(id) || null,
        querySelector: (sel) => root.querySelector(sel),
        querySelectorAll: (sel) => root.querySelectorAll(sel),
        createElement: (tag) => new El(tag),
        addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
        removeEventListener(t, fn) { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); },
    };
    ctx.document = doc;
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);

    function load(file) {
        vm.runInContext(read(file), ctx, { filename: file });
    }
    async function flush(rounds) {
        for (let i = 0; i < (rounds || 25); i++) await new Promise(r => setImmediate(r));
    }
    function tickIntervals() { for (const t of timers.intervals.slice()) t.fn(); }
    function tickTimeouts() { const ts = timers.timeouts.slice(); timers.timeouts = []; for (const t of ts) t.fn(); }
    function readCalls() {
        return fetchCalls.filter(c => /\/api\/ops\/reads/.test(c.url)).map(c => {
            const u = new URL(c.url, 'https://dashboard.example.test');
            const params = {}; for (const [k, v] of u.searchParams) if (k !== 'view') params[k] = v;
            return { view: u.searchParams.get('view'), params, auth: c.headers.Authorization || null, url: c.url };
        });
    }
    function tabButton(tab) { return tabButtons.find(b => b.dataset.tab === tab); }
    function clickTab(tab) { tabButton(tab).click(); }
    function activeTab() { const b = tabButtons.find(b => b._cls.has('active')); return b ? b.dataset.tab : null; }
    function releasePending() { const ps = pending.splice(0); for (const p of ps) p.resolve(); return ps.length; }
    function resetCalls() { fetchCalls.length = 0; }
    function allHtml() { return registry.map(e => e._html).filter(Boolean); }

    return {
        ctx, doc, root, El, byId, registry, panels, tabButtons, timers, fetchCalls, state, pending,
        load, flush, tickIntervals, tickTimeouts, readCalls, clickTab, tabButton, activeTab, releasePending, resetCalls, allHtml,
    };
}

// offendingMarkup(html): tag names and attribute NAMES are parsed, so an
// escaped `&quot; onmouseover=&quot;` inside a quoted title is NOT flagged,
// while a real breakout (`title="" onmouseover="…"`) and injected elements are.
function offendingMarkup(html) {
    const bad = [];
    const tagRe = /<\s*([a-zA-Z][\w-]*)([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(html))) {
        const tag = m[1].toLowerCase();
        if (['img', 'script', 'svg', 'iframe', 'object', 'embed', 'link', 'style'].includes(tag)) bad.push(m[0]);
        const attrRe = /([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
        let a;
        while ((a = attrRe.exec(m[2]))) if (/^on\w+$/i.test(a[1])) bad.push(m[0]);
    }
    return bad;
}

module.exports = { createSandbox, offendingMarkup, read, ROOT };
