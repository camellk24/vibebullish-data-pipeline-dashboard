'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missingUsageSources } = require('./llm-usage-completeness.js');

test('complete summaries report nothing missing', () => {
    assert.deepEqual(missingUsageSources({ total_calls: 3 }, [{ total_calls: 1 }, { missing_sources: [] }]), []);
});

test('a source missing today is reported', () => {
    assert.deepEqual(missingUsageSources({ missing_sources: ['llm_calls:catalyst_news_jev_shadow'] }, []),
        ['llm_calls:catalyst_news_jev_shadow']);
});

test('a source missing on one week day is reported, once', () => {
    const week = [{}, { missing_sources: ['llm_calls:x'] }, { missing_sources: ['llm_calls:x'] }];
    assert.deepEqual(missingUsageSources({}, week), ['llm_calls:x']);
});

test('malformed bodies are tolerated', () => {
    assert.deepEqual(missingUsageSources(null, null), []);
    assert.deepEqual(missingUsageSources({ missing_sources: 'llm_calls:x' }, [null, { missing_sources: [7] }]), []);
});
