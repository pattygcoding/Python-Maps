/**
 * Verifies the deployed site actually works, in a real browser.
 *
 * The bundle greps in the deploy notes prove the right bytes shipped, but not that
 * the thing runs: the render hang and the missing imports both looked perfectly
 * healthy from the outside.  This loads production, waits for a map to appear and
 * fails loudly if it does not.
 *
 *   npm run verify:live
 */

import { chromium } from '@playwright/test';

const URL = process.env.LIVE_URL ?? 'https://pythonmaps.pattygcoding.com/';

const browser = await chromium.launch();
const page = await browser.newPage();

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${String(error)}`));

console.log(`Loading ${URL}`);
const started = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

let ok = true;
try {
  // Generous: a cold visit pulls ~30 MB of WebAssembly before anything renders.
  await page.getByAltText('Generated choropleth map').waitFor({ timeout: 240_000 });
  const src = (await page.getByAltText('Generated choropleth map').getAttribute('src')) ?? '';
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`  map rendered in ${seconds}s, ${Math.round(src.length / 1024)} KB payload`);
  ok = src.startsWith('data:image/png;base64,') && src.length > 10_000;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  a real PNG reached the canvas`);

  // A failure panel would mean the worker reported an exception.
  const failures = await page.getByText('Python raised an exception').count();
  console.log(`  ${failures === 0 ? 'PASS' : 'FAIL'}  no Python exception shown`);
  ok &&= failures === 0;

  // The drawer must show a runnable script, imports included.
  await page.getByRole('button', { name: /View the Python code/ }).click();
  const shown = (await page.locator('.code-surface').textContent()) ?? '';
  const runnable =
    shown.includes('import geopandas as gpd') && shown.includes('BOUNDARIES.copy()');
  console.log(`  ${runnable ? 'PASS' : 'FAIL'}  drawer script is self-contained`);
  ok &&= runnable;

  // Layout: component CSS must not beat Tailwind's utilities, or the colour swatch
  // stretches across the row and collapses the county textarea.
  const swatch = await page.locator('input[type=color]').first().boundingBox();
  const textarea = await page.locator('textarea').first().boundingBox();
  const laidOut = (swatch?.width ?? 0) < 60 && (textarea?.width ?? 0) > 150;
  console.log(
    `  ${laidOut ? 'PASS' : 'FAIL'}  highlight row lays out (swatch ${Math.round(
      swatch?.width ?? 0,
    )}px, textarea ${Math.round(textarea?.width ?? 0)}px)`,
  );
  ok &&= laidOut;
} catch (error) {
  console.log(`  FAIL  ${String(error).split('\n')[0]}`);
  ok = false;
}

if (problems.length) {
  console.log('  console problems:');
  for (const problem of problems) console.log(`    ${problem}`);
}

await browser.close();
console.log(ok && problems.length === 0 ? '\nLive site OK.' : '\nLive site FAILED.');
process.exit(ok && problems.length === 0 ? 0 : 1);
