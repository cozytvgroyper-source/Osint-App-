import fs from 'node:fs';

// The page's own code: app.js (startup and button wiring) plus each page's file in public/app/. Tests that check the
// code's text read all of it, so moving a function between these files never hides it from a test.
const APP_FILES=['app/core.js','app/news.js','app/servers.js','app/tools.js','app/evidence.js','app/results.js','app/search.js','app/deep.js','app.js'];

export function readAppSource(){
  return APP_FILES.map(file=>fs.readFileSync(new URL(`../../public/${file}`,import.meta.url),'utf8')).join('\n');
}

export function appSourceFiles(){return [...APP_FILES];}
