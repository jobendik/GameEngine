import { createRequire } from 'module'; import { existsSync } from 'fs';
import { fileURLToPath } from 'url'; import { dirname, join } from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/joben/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const CHROME = ['C:/Users/joben/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'].find(existsSync);
const b = await chromium.launch({ headless:true, executablePath:CHROME, args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1400,860'] });
const p = await b.newPage({ viewport:{width:1400,height:860} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:4173/', { waitUntil:'domcontentloaded' }); await p.waitForTimeout(1600);
await p.screenshot({ path: join(SHOTS,'assets_00.png') });

// 1. Sample assets present + links
const info = await p.evaluate(() => {
  const a = window.aether.ctx.scene.assets;
  const objs = window.aether.ctx.scene.objects;
  const crate1 = objs.find(o=>o.name==='Crate 1');
  const coin = objs.find(o=>o.name==='Coin');
  const wood = a.materials.find(m=>m.name==='Wood');
  return {
    materials: a.materials.map(m=>m.name), scripts: a.scripts.map(s=>s.name), prefabs: a.prefabs.length,
    crateLinkedToWood: crate1?.materialAssetId === wood?.id,
    crateSharesWoodInstance: crate1?.material === wood?.material,
    coinHasScriptRef: !!coin?.scripts?.some(s=>s.assetId !== undefined),
  };
});
console.log('assets:', JSON.stringify(info));

// 2. Live shared material: edit Wood albedo -> a crate's material reflects it
const live = await p.evaluate(() => {
  const a = window.aether.ctx.scene.assets;
  const objs = window.aether.ctx.scene.objects;
  const wood = a.materials.find(m=>m.name==='Wood');
  const crate = objs.find(o=>o.name==='Crate 2');
  wood.material.albedo.set(0.1, 0.9, 0.2, 1); // turn green
  return { crateR:+crate.material.albedo.r.toFixed(2), crateG:+crate.material.albedo.g.toFixed(2) };
});
console.log('after editing Wood, crate 2 albedo:', JSON.stringify(live), '(should be ~0.1,0.9)');

// 3. Save/load round-trip preserves assets + links
const roundtrip = await p.evaluate(() => {
  const ctx = window.aether.ctx;
  const json = ctx.scene.serialize();
  const hadAssets = !!json.assets && json.assets.materials.length;
  ctx.importSceneJSON(JSON.parse(JSON.stringify(json)));
  const a = ctx.scene.assets;
  const crate = ctx.scene.objects.find(o=>o.name==='Crate 1');
  const wood = a.materials.find(m=>m.name==='Wood');
  return {
    serializedAssets: hadAssets ? json.assets.materials.length + json.assets.scripts.length : 0,
    reloadedMaterials: a.materials.length, reloadedScripts: a.scripts.length,
    crateStillLinked: crate?.materialAssetId === wood?.id && crate?.material === wood?.material,
  };
});
console.log('roundtrip:', JSON.stringify(roundtrip));

// 4. Switch to Materials tab + screenshot
await p.locator('#assets .tab', { hasText:'Materials' }).click();
await p.waitForTimeout(300);
await p.screenshot({ path: join(SHOTS,'assets_materials.png') });
const cards = await p.evaluate(()=>document.querySelectorAll('#assets .asset-card').length);
console.log('material cards shown:', cards);

const ok = info.materials.includes('Wood') && info.materials.includes('Gold')
  && info.scripts.includes('Fast Spinner') && info.crateLinkedToWood && info.crateSharesWoodInstance
  && info.coinHasScriptRef && live.crateG > 0.8
  && roundtrip.reloadedMaterials===2 && roundtrip.reloadedScripts===1 && roundtrip.crateStillLinked
  && cards===2 && errs.length===0;
console.log('errors:', errs.length);
console.log('RESULT:', ok ? 'PASS ✅' : 'FAIL ❌');
await b.close();
