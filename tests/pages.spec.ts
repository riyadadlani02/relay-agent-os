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
  await expect(page.getByRole('heading', { name: 'AGENTS, UNLEASHED.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.hero-art img')).toHaveJSProperty('naturalWidth', 1254);
  await page.screenshot({ path: 'docs/site-desktop.png', animations: 'disabled' });
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('browser demo survives reload at approval and commits one verified effect', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: /B—02 Human in the loop/ }).click();
  await page.getByRole('button', { name: 'Launch selected mission', exact: true }).click();
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
  await page.getByRole('button', { name: /C—03 The hard boundary/ }).click();
  await page.getByRole('button', { name: 'Launch selected mission', exact: true }).click();
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
    await expect(page.getByRole('heading', { name: 'AGENTS, UNLEASHED.' })).toBeVisible();
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
