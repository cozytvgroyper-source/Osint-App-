import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appSourceFiles,readAppSource} from './helpers/app-source.mjs';

// Tests that check the page's code read every file the app is split into; a file left off the list would be skipped.
test('the app-source helper covers every file of the page code',()=>{
  const onDisk=['app.js',...fs.readdirSync(new URL('../public/app/',import.meta.url)).filter(name=>name.endsWith('.js')).map(name=>`app/${name}`)].sort();
  assert.deepEqual([...appSourceFiles()].sort(),onDisk);
});

// Each page file imports what it uses from the others; a name used but never imported would fail only when clicked.
test('every name a page file imports is exported by the file it comes from',()=>{
  for(const file of appSourceFiles()){
    const text=fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
    for(const [,names,spec] of text.matchAll(/^import \{([^}]*)\} from '(\.\.?\/[^']+)';$/gm)){
      const target=new URL(spec.replace(/\?.*$/,''),new URL(`../public/${file}`,import.meta.url));
      if(!target.pathname.includes('/public/app'))continue;
      const exported=new Set(fs.readFileSync(target,'utf8').match(/^export \{([^}]*)\};$/m)?.[1].split(',')||[]);
      for(const name of names.split(','))assert.ok(exported.has(name.trim()),`${file} imports ${name.trim()} from ${spec}`);
    }
  }
});

test('the startup file stays short and holds no page logic',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(app.split('\n').length<200,'app.js is the startup and wiring file');
  assert.ok(readAppSource().includes(app));
});
