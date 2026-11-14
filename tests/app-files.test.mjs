import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appSourceFiles,compactJs,readAppSource} from './helpers/app-source.mjs';

// Tests that check the page's code read every file the app is split into; a file left off the list would be skipped.
test('the app-source helper covers every file of the page code',()=>{
  const onDisk=['app.js',...fs.readdirSync(new URL('../public/app/',import.meta.url)).filter(name=>name.endsWith('.js')).map(name=>`app/${name}`)].sort();
  assert.deepEqual([...appSourceFiles()].sort(),onDisk);
});

// Each page file imports what it uses from the others; a name used but never imported would fail only when clicked.
test('every name a page file imports is exported by the file it comes from',()=>{
  for(const file of appSourceFiles()){
    const text=compactJs(fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8'));
    for(const [,names,spec] of text.matchAll(/^import\{([^}]*)\}from '(\.\.?\/[^']+)';$/gm)){
      const target=new URL(spec.replace(/\?.*$/,''),new URL(`../public/${file}`,import.meta.url));
      if(!target.pathname.includes('/public/app'))continue;
      const exported=new Set(compactJs(fs.readFileSync(target,'utf8')).match(/^export\{([^}]*)\};$/m)?.[1].split(',').map(name=>name.trim())||[]);
      for(const name of names.split(','))assert.ok(exported.has(name.trim()),`${file} imports ${name.trim()} from ${spec}`);
    }
  }
});

// app.js connects buttons to the page files and starts the app; page logic lives in public/app/. It may define only
// these small helpers its own button wiring uses.
test('the startup file holds no page logic',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const functions=[...app.matchAll(/^(?:async\s+)?function\s+([\w$]+)/gm)].map(match=>match[1]).sort();
  assert.deepEqual(functions,['announceServerProblem','applyTheme','clearServerFormErrors']);
  assert.ok(readAppSource().includes(compactJs(app)));
});
