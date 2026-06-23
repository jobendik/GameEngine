// Interaction test for the Aether Editor: load, select an object (gizmo+inspector),
// run Play (physics should fall), Stop (restore). Screenshots each step.
import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const PW = 'C:/Users/joben/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright';
const { chromium } = require(PW);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, 'shots');
mkdirSync(SHOTS, { recursive: true });

const CHROME = [
  'C:/Users/joben/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);

const url = process.argv[2] || 'http://localhost:4173/';
const errors = [];

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=1400,820'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|\.map/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shot = (n) => page.screenshot({ path: join(SHOTS, `editor_${n}.png`) });

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1800);
  await shot('00_loaded');

  // Select an object by clicking in the viewport where the stack sits.
  const vp = await page.$('#viewport');
  const box = await vp.boundingBox();
  await page.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.6);
  await page.waitForTimeout(500);
  await shot('01_selected');

  // Read the inspector's first heading + hierarchy count for a sanity log.
  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll('#hierarchy .tree .row').length,
    groups: Array.from(document.querySelectorAll('#inspector .group-head')).map((g) => g.textContent.trim()),
    selected: document.querySelector('#hierarchy .row.selected')?.textContent?.trim() || null,
  }));
  console.log('HIERARCHY rows:', info.rows);
  console.log('INSPECTOR groups:', JSON.stringify(info.groups));
  console.log('SELECTED:', info.selected);

  // Click Play.
  await page.locator('#toolbar button', { hasText: 'Play' }).first().click();
  await page.waitForTimeout(1800); // let physics fall/settle
  await shot('02_playing');
  const playing = await page.evaluate(() => document.querySelector('#viewport')?.classList.contains('play-mode'));
  console.log('PLAY MODE active:', playing);

  // Stop.
  await page.locator('#toolbar button', { hasText: 'Stop' }).first().click();
  await page.waitForTimeout(600);
  await shot('03_stopped');

  // Add a torus via toolbar to confirm add works.
  await page.locator('#toolbar button', { hasText: 'Torus' }).first().click();
  await page.waitForTimeout(400);
  await shot('04_added');
  const rows2 = await page.evaluate(() => document.querySelectorAll('#hierarchy .tree .row').length);
  console.log('ROWS after add:', rows2);

  console.log('CONSOLE/PAGE ERRORS:', errors.length);
  errors.slice(0, 20).forEach((e) => console.log('  ', e));
  console.log('RESULT:', errors.length === 0 ? 'PASS ✅' : 'FAIL ❌');
} catch (e) {
  console.error('TEST ERROR:', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
