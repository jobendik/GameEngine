// Headless WebGL2 smoke test for the Aether demo.
// Usage: node .aether-build/smoke.mjs <url> [frames]
// Launches Chromium with SwiftShader so WebGL2 works headless, clicks the start
// overlay, simulates a little movement, screenshots each second, and reports any
// console errors / pageerrors / WebGL issues plus per-frame canvas non-blackness.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const PW = 'C:/Users/joben/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright';
const { chromium } = require(PW);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(__dirname, 'shots');
mkdirSync(SHOTS, { recursive: true });

const url = process.argv[2] || 'http://localhost:5173/';
const frames = parseInt(process.argv[3] || '6', 10);

const CHROME_CANDIDATES = [
  'C:/Users/joben/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  'C:/Users/joben/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
import { existsSync } from 'fs';
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));

const consoleErrors = [];
const pageErrors = [];
const allLogs = [];

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-gpu-sandbox',
    '--window-size=1280,720',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('console', (msg) => {
  const t = msg.type();
  const text = `[${t}] ${msg.text()}`;
  allLogs.push(text);
  if (t === 'error') consoleErrors.push(text);
});
page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));

let webglInfo = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait a beat for module load + engine init.
  await page.waitForTimeout(1500);

  // Probe WebGL2 availability + renderer string.
  webglInfo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: true,
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
    };
  });

  // Click the start overlay to enter the demo (hides overlay, resumes audio, requests pointer lock).
  try { await page.mouse.click(640, 360); } catch {}
  await page.waitForTimeout(600);

  const nonBlack = [];
  const keys = ['KeyW', 'KeyD', 'KeyA', 'KeyS', 'Space'];
  for (let i = 0; i < frames; i++) {
    // Drive a little input so physics/camera move.
    const k = keys[i % keys.length];
    await page.keyboard.down(k);
    await page.mouse.move(640 + (i % 2 ? 60 : -60), 360);
    await page.waitForTimeout(900);
    await page.keyboard.up(k);

    const shot = join(SHOTS, `frame_${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: shot });

    // Measure non-blackness of the gl canvas via a downscaled readback.
    const lum = await page.evaluate(() => {
      const c = document.getElementById('gl');
      if (!c) return -1;
      const tmp = document.createElement('canvas');
      tmp.width = 64; tmp.height = 36;
      const ctx = tmp.getContext('2d');
      try { ctx.drawImage(c, 0, 0, 64, 36); } catch { return -2; }
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0, max = 0;
      for (let p = 0; p < d.length; p += 4) {
        const v = (d[p] + d[p + 1] + d[p + 2]) / 3;
        sum += v; if (v > max) max = v;
      }
      return { avg: +(sum / (d.length / 4)).toFixed(1), max };
    });
    nonBlack.push(lum);
  }

  console.log('\n================ SMOKE TEST REPORT ================');
  console.log('URL:', url);
  console.log('Chrome:', executablePath);
  console.log('WebGL:', JSON.stringify(webglInfo));
  console.log('Per-frame canvas luminance (avg/max):');
  nonBlack.forEach((l, i) => console.log(`  frame ${i}:`, JSON.stringify(l)));
  console.log('Console errors:', consoleErrors.length);
  consoleErrors.slice(0, 40).forEach((e) => console.log('  ', e));
  console.log('Page errors:', pageErrors.length);
  pageErrors.slice(0, 40).forEach((e) => console.log('  ', e));
  const rendered = nonBlack.some((l) => l && typeof l === 'object' && l.avg > 3);
  console.log('RENDERED NON-BLACK FRAMES:', rendered);
  const pass = pageErrors.length === 0 && consoleErrors.length === 0 && rendered && webglInfo?.webgl2;
  console.log('RESULT:', pass ? 'PASS ✅' : 'FAIL ❌');
  console.log('Screenshots in:', SHOTS);
  console.log('===================================================\n');
  // Dump recent logs for debugging if something failed.
  if (!pass) {
    console.log('--- recent console logs ---');
    allLogs.slice(-50).forEach((l) => console.log(l));
  }
  writeFileSync(join(__dirname, 'smoke-report.json'),
    JSON.stringify({ webglInfo, nonBlack, consoleErrors, pageErrors, pass }, null, 2));
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  console.error('SMOKE HARNESS ERROR:', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
