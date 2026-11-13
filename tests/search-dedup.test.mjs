import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateIndicatorLists, extractIndicatorLists} from '../public/search-dedup.js';

test('extracts simple indicator lists without flattening rich source records', () => {
  const extracted = extractIndicatorLists({
    total: 2,
    hostnames: ['api.example.com', '*.www.example.com'],
    hosts: ['mail.example.com:1.2.3.4'],
    ip_addresses: ['2001:db8::1'],
    certificates: [{ common_name: 'api.example.com', issuer: 'Example CA' }]
  });
  assert.equal(extracted.changed, true);
  assert.deepEqual(extracted.data, {total: 2, certificates: [{ common_name: 'api.example.com', issuer: 'Example CA' }]});
  assert.deepEqual(extracted.findings.map(item => [item.type, item.normalized]), [
    ['domains', 'api.example.com'], ['domains', 'www.example.com'], ['domains', 'mail.example.com'], ['ipAddresses', '1.2.3.4'], ['ipAddresses', '2001:db8::1']
  ]);
});

test('merges repeated indicators and retains every contributing source', () => {
  const first = extractIndicatorLists({hostnames: ['api.example.com', 'one.example.com']});
  const second = extractIndicatorLists({hosts: ['API.EXAMPLE.COM:1.2.3.4'], emails: ['user@example.com']});
  const merged = consolidateIndicatorLists([
    {...first, source: 'crt.sh'},
    {...second, source: 'theHarvester'}
  ]);
  assert.equal(merged.hasDuplicates, true);
  assert.deepEqual(merged.groups.domains.find(item => item.title.toLowerCase() === 'api.example.com'), {
    title: 'api.example.com', foundBy: 'crt.sh; theHarvester', sourceCount: 2
  });
  assert.equal(merged.groups.ipAddresses[0].title, '1.2.3.4');
  assert.equal(merged.groups.emailAddresses[0].title, 'user@example.com');
});

test('does not replace source lists when nothing overlaps', () => {
  const first = extractIndicatorLists({hostnames: ['one.example.com']});
  const second = extractIndicatorLists({hostnames: ['two.example.com']});
  assert.equal(consolidateIndicatorLists([{...first, source: 'one'}, {...second, source: 'two'}]).hasDuplicates, false);
});

test('values that are not recognised stay in the source answer instead of disappearing', () => {
  const extracted = extractIndicatorLists({
    hosts: ['a.example.com', '2001:db8::1', 'localhost'],
    addresses: ['1.2.3.4', '10 Downing Street, London'],
    urls: ['https://x.example/page', 'ftp://files.example/pub']
  });
  assert.deepEqual(extracted.data, {hosts: ['localhost'], addresses: ['10 Downing Street, London'], urls: ['ftp://files.example/pub']});
  assert.deepEqual(extracted.findings.map(item => [item.type, item.normalized]), [
    ['domains', 'a.example.com'], ['ipAddresses', '2001:db8::1'], ['ipAddresses', '1.2.3.4'], ['urls', 'https://x.example/page']
  ]);
});

test('a list where nothing is recognised is left exactly as the tool sent it', () => {
  const extracted = extractIndicatorLists({addresses: ['10 Downing Street, London']});
  assert.equal(extracted.changed, false);
  assert.deepEqual(extracted.data, {addresses: ['10 Downing Street, London']});
});
