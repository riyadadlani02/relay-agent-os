import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('overview has no automated WCAG A/AA violations on desktop or mobile', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?workspace=1');
    await expect(page.getByRole('heading', { name: 'Your agents. In sync.' })).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});

test('launches, pauses for approval, resumes, and verifies a sandbox refund', async ({ page }) => {
  await page.goto('/?workspace=1');
  await page.getByRole('button', { name: 'New mission', exact: true }).click();
  await page.getByRole('button', { name: 'Approval gate', exact: true }).click();
  await page.getByLabel('Customer name').fill('Browser Test Customer');
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mission trace' });
  await expect(dialog.getByText('Your approval is needed', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve action', exact: true }).click();
  await expect(dialog.locator('.outcome')).toHaveText(
    '$249.00 refund recorded in the sandbox ledger.',
  );
  await expect(dialog.locator('.status')).toHaveText('Completed');
});

test('a hard policy limit stops execution and exposes the reason', async ({ page }) => {
  await page.goto('/?workspace=1');
  await page.getByRole('button', { name: 'New mission', exact: true }).click();
  await page.getByRole('button', { name: 'Policy boundary', exact: true }).click();
  await page.getByRole('button', { name: 'Launch mission', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mission trace' });
  await expect(dialog.locator('.outcome')).toHaveText(
    'Action blocked by policy. No sandbox effect was created.',
  );
  await expect(dialog.getByRole('button', { name: 'Approve action' })).toHaveCount(0);
});

test('searches knowledge and persists a policy edit', async ({ page }) => {
  await page.goto('/?workspace=1');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Knowledge', exact: true })
    .click();
  await page.getByLabel('Search knowledge').fill('damaged');
  await expect(page.getByRole('heading', { name: 'Damaged deliveries' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Returns & refunds' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Policies', exact: true }).click();
  await page.getByLabel('Automatic refund limit').fill('75');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByRole('status')).toContainText('Workspace policy saved.');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Policies', exact: true }).click();
  await expect(page.getByLabel('Automatic refund limit')).toHaveValue('75');
});

test('mobile layout stays within the viewport and keyboard search works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?workspace=1');
  await expect(page.getByRole('heading', { name: 'Your agents. In sync.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Find your way' });
  await expect(search).toBeVisible();
  await search.getByLabel('Search pages or missions').fill('Agents');
  await search.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
