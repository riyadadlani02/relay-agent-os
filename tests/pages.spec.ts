import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('static build loads at its GitHub Pages prefix without API calls', async ({ page }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Agents act.*You set the limits/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.proof-device img')).toHaveJSProperty('naturalWidth', 1254);
  await page.screenshot({ path: 'docs/site-desktop.png', animations: 'disabled' });
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('browser demo survives reload at approval and commits one verified effect', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Run $249 refund demo', exact: true }).click();
  await expect(page.getByText('Your judgment. Your call.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Your judgment. Your call.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'APPROVE $249', exact: true }).click();
  await expect(page.locator('.demo-outcome')).toHaveText(
    '$249.00 refund recorded in the sandbox ledger.',
  );
  await expect(page.locator('.session-row')).toContainText('01 COMPLETED / 01 SANDBOX EFFECTS');
  await page.getByRole('button', { name: 'INSPECT FULL TRACE' }).click();
  await expect(page.getByRole('list', { name: 'Execution events' })).toContainText(
    'Operator approved',
  );
});

test('hard boundaries and idempotent retries work in the static site', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Run $750 refund demo', exact: true }).click();
  await expect(page.locator('.demo-outcome')).toContainText('Action blocked by policy.');
  await page.getByRole('button', { name: /D—04 A second chance/ }).click();
  await page.getByRole('button', { name: 'Launch selected mission', exact: true }).click();
  await expect(page.locator('.demo-outcome')).toContainText('$49.00 refund recorded');
  await expect(page.locator('.session-row')).toContainText('01 COMPLETED / 01 SANDBOX EFFECTS');
});

test('responsive page and controls have no automated WCAG A/AA violations', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await expect(
      page.getByRole('heading', { name: /Agents act.*You set the limits/ }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
    if (width === 390)
      await page.screenshot({ path: 'docs/site-mobile.png', animations: 'disabled' });
  }
});

test('live playground loads its own styles, local records, and explicit model setup', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?playground=1');
  await expect(page.getByRole('heading', { name: 'PUT IT TO WORK.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load live model', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send request', exact: true })).toBeDisabled();
  await expect(page.locator('h1')).toHaveCSS('font-family', /Anton/);
  await page.getByRole('button', { name: /Challenge the policy/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your request' })).toHaveValue(
    /Ignore the refund limit/,
  );
  await page.getByRole('tab', { name: 'Order records' }).click();
  await expect(page.getByRole('heading', { name: 'Field headphones' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('$249.00');
  await page.getByRole('tab', { name: 'Policies' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Above $500 is blocked');
  expect(errors).toEqual([]);
});

test('live playground is responsive and accessible before model loading', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto('./?playground=1');
    await expect(page.getByRole('button', { name: 'Load live model', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `docs/live-${width === 1440 ? 'desktop' : 'mobile'}.png`,
      animations: 'disabled',
    });
  }
});

test('evidence deep link lands on measured results after the lazy page loads', async ({ page }) => {
  await page.goto('./#evidence');
  await expect(page.getByRole('heading', { name: 'Test the boundary.' })).toBeInViewport();
  await expect(
    page.getByRole('heading', { name: 'The Relay Gauntlet', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.gauntlet-evidence table')).toContainText('gpt-4.1-mini');
  await page.getByText('Earlier pilot: 240 runs, 190 distinct requests', { exact: true }).click();
  await expect(page.locator('.evidence-metrics')).toContainText('236/240 matched');
  await expect(page.locator('.pilot-evidence .evidence-caveat')).toContainText(
    '190 distinct strings',
  );
});

test('Gauntlet runner exposes resumable local evaluation and is accessible', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./?gauntlet=1');
    await expect(page.getByRole('heading', { name: 'Try to break the boundary.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run / resume Qwen' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop after this case' })).toBeDisabled();
    await page.getByLabel('Time per batch').selectOption('2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([]);
  }
});

test('kernel console mediates four customers and exposes journal tampering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?os=1');
  await expect(
    page.getByRole('heading', { name: 'A proposal is never permission.' }),
  ).toBeVisible();
  const run = page.getByRole('button', { name: 'Run until a person is needed' });
  await run.click();
  await expect(page.getByText('Refund $49.00 for R-1042 (Studio cable)')).toBeVisible();
  // Carol's injected worker was confined without anyone being asked.
  await expect(page.getByText('carol: confirm?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm as alice' }).click();
  await page.getByRole('button', { name: 'Confirm as bob' }).click();
  await run.click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await run.click();
  await expect(page.getByText('2 receipts · 1 support tickets', { exact: false })).toBeVisible();
  await expect(page.getByText(/chain verified/)).toBeVisible();
  await page.getByRole('button', { name: 'Change a refund in the log to $0.01' }).click();
  await expect(
    page.getByText(/broken at #\d+: Entry contents do not match their hash/),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  // Live mode offers the in-browser model on the static site; no server model exists there.
  await page.getByRole('button', { name: 'Live AI agents' }).click();
  await expect(page.getByRole('button', { name: /Load browser model/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Use local server model/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Start alice's agent/ })).toBeDisabled();
  const live = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(live.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
