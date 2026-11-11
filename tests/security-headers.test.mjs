import test from 'node:test';
import assert from 'node:assert/strict';
import {SECURITY_HEADERS} from '../server.mjs';

test('forbids framing by other sites (clickjacking)',()=>{
  assert.equal(SECURITY_HEADERS['x-frame-options'],'DENY');
  assert.match(SECURITY_HEADERS['content-security-policy'],/frame-ancestors 'none'/);
});

test('only runs scripts and styles from Public Desk itself',()=>{
  const csp=SECURITY_HEADERS['content-security-policy'];
  assert.match(csp,/default-src 'self'/);
  assert.match(csp,/script-src 'self'(;|$)/);
  assert.match(csp,/style-src 'self'(;|$)/);
  assert.match(csp,/object-src 'none'/);
  assert.match(csp,/base-uri 'none'/);
  assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);
});

test('allows the IntelMap news feed and nothing else to be fetched from outside',()=>{
  assert.match(SECURITY_HEADERS['content-security-policy'],/connect-src 'self' https:\/\/intelmap\.watch(;|$)/);
});

test('sets the other standard protections',()=>{
  assert.equal(SECURITY_HEADERS['x-content-type-options'],'nosniff');
  assert.equal(SECURITY_HEADERS['referrer-policy'],'no-referrer');
  assert.equal(SECURITY_HEADERS['cross-origin-resource-policy'],'same-origin');
  assert.equal(SECURITY_HEADERS['cross-origin-opener-policy'],'same-origin');
});
