const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const snapshot = () => ({ snapshot_id: 1, generated_at: '2026-10-03T21:52:05Z', age_seconds: 3600,
    freshness: 'fresh', threshold_hours: 20, sample_size: 60, trigger: 'manual',
    report: { status: 'PASS', reasons: [], cohorts: [{ cohort: 'tradeable_v2', status: 'PASS',
        coverage: {status:'PASS'}, substrate: {status:'WARN'}, liveness: {severity:'PASS'}, calibration: {severity:'PASS'} }] } });
function page(reply) {
    const el = { innerHTML:'' }; const events = {}; const timers = new Map(); let now = 0; const calls = [];
    const window = { VBAuth: { isAdmin: true, fetch: async url => { calls.push(url); return reply(); } },
        addEventListener: (k, f) => { events[k] = f; } };
    const context = { window, document: { getElementById: () => el },
        Date: class extends Date { static now() { return now; } },
        setInterval: f => { timers.set(1,f); return 1; }, clearInterval: id => timers.delete(id) };
    const file = path.join(__dirname,'model-health.js');
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
    assert.ok(window.ModelHealth, 'model-health panel is implemented');
    return { window, el, calls, events, advance(ms) { now+=ms; [...timers.values()].forEach(f=>f()); } };
}
const response = (body,status=200) => ({status,json:async()=>body});

test('saved status, cohort checks, timestamp and sample are displayed from the snapshot route', async () => {
    const p=page(()=>response(snapshot())); await p.window.ModelHealth.load();
    assert.deepEqual(p.calls,['/api/ops/heartbeats?view=model-health']);
    for(const value of ['Saved report','PASS','Fresh','tradeable_v2','Coverage','Substrate','WARN','2026-10-03','60']) assert.ok(p.el.innerHTML.includes(value),value);
});
test('freshness ages into stale without fetching or presenting the old PASS as current',async()=>{
    const p=page(()=>response(snapshot())); await p.window.ModelHealth.load(); p.advance(20*3600*1000);
    assert.match(p.el.innerHTML,/Stale/); assert.match(p.el.innerHTML,/Historical result/);
    assert.equal(p.calls.length,1);
});
test('backend stale is respected and report strings are escaped',async()=>{
    const s=snapshot();s.freshness='stale';s.report.reasons=['<img onerror=bad>'];s.report.cohorts[0].cohort='<cohort>';
    const p=page(()=>response(s));await p.window.ModelHealth.load();
    assert.match(p.el.innerHTML,/Stale/);assert.match(p.el.innerHTML,/&lt;img/);assert.doesNotMatch(p.el.innerHTML,/<img|<cohort>/);
});
test('missing, unavailable and malformed reports never leave old PASS content',async()=>{
    for(const next of [response({error:'snapshot_missing'},404), response({error:'upstream_error'},502),response({}),response({...snapshot(),age_seconds:null})]){
        let r=response(snapshot());const p=page(()=>r);await p.window.ModelHealth.load();r=next;await p.window.ModelHealth.load();
        assert.doesNotMatch(p.el.innerHTML,/>PASS</);assert.match(p.el.innerHTML,/No saved report|unavailable/i);
    }
});
test('non-admins cannot fetch and logout discards in-flight results',async()=>{
    let resolve;const p=page(()=>new Promise(r=>{resolve=r;}));const pending=p.window.ModelHealth.load();
    p.window.VBAuth.isAdmin=false;p.events['vb-auth-change']({detail:{state:'signed_out'}});
    resolve(response(snapshot()));await pending;assert.equal(p.el.innerHTML,'');
    await p.window.ModelHealth.load();assert.equal(p.calls.length,1);
});
test('an older slow request cannot overwrite a newer snapshot',async()=>{
    let resolve;let n=0;const newer=snapshot();newer.report.status='FAIL';
    const p=page(()=>++n===1?new Promise(r=>{resolve=r;}):response(newer));
    const pending=p.window.ModelHealth.load();await p.window.ModelHealth.load();resolve(response(snapshot()));await pending;
    assert.match(p.el.innerHTML,/>FAIL</);
});
