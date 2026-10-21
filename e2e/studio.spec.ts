import { expect, test } from '@playwright/test';

/**
 * The regression this file exists for.
 *
 * `render()` posted `this.config` to the worker, but that object is a Svelte
 * `$state` proxy, and structured clone throws DataCloneError on a proxy.  The
 * throw happened *after* `phase` had been set to 'rendering', and it escaped an
 * event handler where nothing caught it, so the UI sat on "Rendering in Python…"
 * forever with no error to show.
 *
 * Nothing in the Node harness could have caught it: the Python was correct all
 * along and ran in ~130 ms there.  The bug lived entirely in the handoff between
 * the two threads, which only a browser can exercise.  So this asserts the thing
 * the user actually sees -- that a map appears.
 *
 * It is one test rather than several on purpose: Playwright gives every test a
 * fresh browser context, so each one would re-download ~30 MB of WebAssembly.
 */
test('boots, renders, re-renders and keeps its console clean', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${String(error)}`));

  await page.goto('/');

  // --- boot ---------------------------------------------------------------
  await expect(page.getByText('Booting Python in your browser')).toBeVisible();

  const map = page.getByAltText('Generated choropleth map');
  await expect(map).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('Booting Python in your browser')).toHaveCount(0);

  // A real PNG, not an empty placeholder.
  const first = (await map.getAttribute('src')) ?? '';
  expect(first).toMatch(/^data:image\/png;base64,/);
  expect(first.length).toBeGreaterThan(10_000);

  // The probe reported real versions and found no missing glyphs.
  await expect(page.getByText('1.1.3')).toBeVisible();

  // --- the highlight row lays out correctly -------------------------------
  // A colour swatch and a county textarea share one flex row.  Because component
  // CSS used to be unlayered it beat Tailwind's utilities, so `.swatch{width:100%}`
  // overrode `w-11` and stretched the swatch across the row, collapsing the
  // textarea to a sliver.  Asserting the actual boxes is the only way to catch a
  // cascade bug like that.
  const swatchBox = await page.locator('input[type=color]').first().boundingBox();
  const textareaBox = await page.locator('textarea').first().boundingBox();
  expect(swatchBox?.width ?? 0).toBeLessThan(60);
  expect(swatchBox?.height ?? 0).toBeLessThan(60);
  expect(textareaBox?.width ?? 0).toBeGreaterThan(150);
  expect(textareaBox?.height ?? 0).toBeGreaterThan(50);

  // --- the drawer regenerates from the form -------------------------------
  await page.getByRole('button', { name: /View the Python code/ }).click();
  const code = page.locator('.code-surface');
  await expect(code).toBeVisible();

  const shown = (await code.textContent()) ?? '';
  console.log(
    `drawer script: ${shown.length} chars, starts with:\n---\n${shown.slice(0, 300)}\n---`,
  );

  expect(shown).toContain('import geopandas as gpd');
  // The cached-frame fast path and its desktop fallback: this is what makes
  // re-rendering fast, so it must be visible in the shown script.
  expect(shown).toContain('BOUNDARIES.copy()');
  expect(shown).toContain('gpd.read_file');
  expect(shown).toContain('assign_color');
  expect(shown).toContain('EPSG:5070');

  // Labels are off by default, so this is absent -- and ticking the box has to
  // make it appear without any render happening.
  expect(shown).not.toContain('representative_point');
  await page.getByText('Show county names').click();
  await expect(code).toContainText('representative_point');

  // Refreshed on every run, so docs/studio.png always shows the current UI.  Taken
  // in the dark palette, which is the default, and flipping to it also proves the
  // theme toggle works.
  await page.getByRole('button', { name: /Toggle colour theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/studio.png', fullPage: true });

  // --- re-render on the slowest path --------------------------------------
  await page.getByRole('button', { name: 'Contiguous U.S.' }).click();
  await page.getByRole('button', { name: /Generate map/ }).click();

  await expect
    .poll(async () => map.getAttribute('src'), { timeout: 120_000 })
    .not.toBe(first);
  await expect(page.getByRole('button', { name: /Rendering in Python/ })).toHaveCount(0);

  // --- nothing blew up ----------------------------------------------------
  await expect(page.getByText('Python raised an exception')).toHaveCount(0);
  expect(problems, `\n${problems.join('\n')}`).toEqual([]);
});
