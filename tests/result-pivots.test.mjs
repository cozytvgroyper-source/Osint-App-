import test from 'node:test';
import assert from 'node:assert/strict';
import {resultPivot} from '../public/result-pivots.js';

test('creates normalized pivots for exact domains, emails and IP addresses', () => {
  assert.deepEqual(resultPivot('*.API.Example.com.'), {type:'domain',target:'api.example.com',label:'Investigate domain'});
  assert.deepEqual(resultPivot('Person@Example.COM'), {type:'email',target:'person@example.com',label:'Investigate email'});
  assert.deepEqual(resultPivot('192.0.2.4'), {type:'IP address',target:'192.0.2.4',label:'Investigate IP address'});
  assert.deepEqual(resultPivot('2001:db8::1'), {type:'IP address',target:'2001:db8::1',label:'Investigate IP address'});
});

test('does not turn prose, invalid addresses, URLs or non-strings into pivots', () => {
  assert.equal(resultPivot('Found api.example.com in a certificate'), null);
  assert.equal(resultPivot('999.2.3.4'), null);
  assert.equal(resultPivot('https://example.com/path'), null);
  assert.equal(resultPivot('12:00:00'), null);
  assert.equal(resultPivot(123), null);
});
