// Shared doubles for the api/*.test.js suites. Not a Vercel function: files
// prefixed with `_` are excluded from the functions build, and this name does
// not match the `*.test.js` glob the test script runs.

const TOKEN = 'super-secret-internal-token-9f3a';

function fakeRes() {
    return {
        statusCode: 0,
        headers: {},
        body: null,
        setHeader(k, v) {
            this.headers[k] = v;
        },
        status(c) {
            this.statusCode = c;
            return this;
        },
        send(b) {
            this.body = b;
            return this;
        },
    };
}

function fakeReq(opts) {
    return Object.assign({ method: 'GET', url: '/api/ops/x', headers: {} }, opts || {});
}

function upstreamResponse(status, bodyObj, headers) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Map(Object.entries(headers || {})),
        async text() {
            return typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        },
    };
}

// installFetch records every call and answers from `routes` (URL substring → fn).
function installFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
        calls.push({ url: String(url), opts: opts || {} });
        for (const [needle, fn] of Object.entries(routes)) {
            if (String(url).includes(needle)) return fn(opts || {});
        }
        throw new Error('unexpected fetch: ' + url);
    };
    return calls;
}

function withEnv(fn) {
    const prevToken = process.env.INTERNAL_API_TOKEN;
    const prevBase = process.env.BACKEND_API_BASE;
    const prevFetch = globalThis.fetch;
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.BACKEND_API_BASE = 'https://backend.test';
    return Promise.resolve(fn()).finally(() => {
        if (prevToken === undefined) delete process.env.INTERNAL_API_TOKEN;
        else process.env.INTERNAL_API_TOKEN = prevToken;
        if (prevBase === undefined) delete process.env.BACKEND_API_BASE;
        else process.env.BACKEND_API_BASE = prevBase;
        globalThis.fetch = prevFetch;
    });
}

// Every surface a browser can read, as one string.
function responseSurface(res) {
    return JSON.stringify({ headers: res.headers, body: res.body, status: res.statusCode });
}

module.exports = { TOKEN, fakeRes, fakeReq, upstreamResponse, installFetch, withEnv, responseSurface };
