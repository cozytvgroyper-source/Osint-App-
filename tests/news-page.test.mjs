import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The News page: a labeled search, loading and errors announced in plain words, and focus that follows Load more.
const read=file=>fs.readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const html=read('index.html'),app=read('app.js');
const news=html.match(/<section id="news"[\s\S]*?<\/section>/)[0];

test('the news search has a visible label and loading is announced',()=>{
  assert.match(news,/<label class="filter">[\s\S]*?Search news[\s\S]*?id="intelNewsFilter"/);
  assert.match(news,/id="intelNewsStatus"[^>]*role="status"/);
  assert.match(app,/Loading news…/);
  assert.match(app,/Couldn't reach IntelMap\. Check your internet connection and try again\./);
  assert.match(app,/news event[^`]{0,40}loaded/);
});

test('Load more moves focus to the first new card',()=>{
  assert.match(app,/data-load-more-news[\s\S]{0,300}querySelectorAll\('#intelNewsList \.news-card'\)\[[^\]]+\]\?\.focus\(\)/);
  assert.match(app,/Load more news/);
});

test('news uses the shared view module',()=>{
  assert.match(app,/from '\.\/news-view\.js\?v=\d+'/);
  assert.doesNotMatch(app,/function relativeTime\(/);
});

test('the news status line only speaks when it changes, and the filter count is shown quietly',()=>{
  assert.match(app,/if\(status\.textContent!==loadedText\)status\.textContent=loadedText;/);
  assert.match(app,/Showing \$\{events\.length\} of \$\{matching\.length\}/);
});
test('after Try again, focus does not fall off the page',()=>{
  assert.match(app,/retryIntelNews[\s\S]{0,200}\$\('#refreshIntelNews'\)\.focus\(\)/);
});
