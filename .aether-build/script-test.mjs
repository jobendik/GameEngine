import { createRequire } from 'module'; import { existsSync } from 'fs';
import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/joben/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const CHROME = ['C:/Users/joben/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'].find(existsSync);
const b = await chromium.launch({ headless:true, executablePath:CHROME, args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1400,820'] });
const p = await b.newPage({ viewport:{width:1400,height:820} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded' }); await p.waitForTimeout(1500);

// Add a CUSTOM-code object before play.
await p.evaluate(() => {
  const ctx = window.aether.ctx;
  const cube = ctx.add({ kind:'mesh', primitive:'box', position:[6,1,-4] });
  cube.name = 'Scripted Cube';
  cube.scripts = [{ type:'custom', code:'transform.position.y = 3 + Math.sin(time.elapsed*4)*1.5;' }];
});

const read = () => p.evaluate(() => {
  const objs = window.aether.ctx.scene.objects;
  const ring = objs.find(o=>o.name==='Energy Ring');
  const cube = objs.find(o=>o.name==='Scripted Cube');
  return {
    ringRotX: +ring.transform.rotation.x.toFixed(4),
    ringEmissive: +ring.material.emissiveIntensity.toFixed(3),
    cubeY: +cube.transform.position.y.toFixed(3),
  };
});

const before = await read();
console.log('BEFORE play:', JSON.stringify(before));

await p.locator('#toolbar button', { hasText:'Play' }).first().click();
await p.waitForTimeout(1200);
const during = await read();
console.log('DURING play:', JSON.stringify(during));
await p.screenshot({ path: join(SHOTS,'script_playing.png') });

await p.locator('#toolbar button', { hasText:'Stop' }).first().click();
await p.waitForTimeout(400);
const after = await read();
console.log('AFTER stop :', JSON.stringify(after));

const spinWorks = Math.abs(during.ringRotX - before.ringRotX) > 0.02;
const pulseWorks = Math.abs(during.ringEmissive - before.ringEmissive) > 0.05;
const customWorks = during.cubeY > 1.4; // driven to ~3±1.5
const restored = Math.abs(after.ringRotX - before.ringRotX) < 0.001 && Math.abs(after.cubeY - 1) < 0.001;
console.log('SPIN behavior moved ring  :', spinWorks);
console.log('PULSE behavior changed emis:', pulseWorks);
console.log('CUSTOM script drove cube.y :', customWorks, '(y=',during.cubeY,')');
console.log('STOP restored edit state   :', restored);
console.log('errors:', errs.length);
console.log('RESULT:', (spinWorks&&pulseWorks&&customWorks&&restored&&errs.length===0)?'PASS ✅':'FAIL ❌');
await b.close();
