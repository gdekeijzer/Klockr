import { expect, test } from '@playwright/test';
import { ApiServer } from './server';

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('M5 share links: create, use, list, revoke (open display + new requests), new link', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill('10:00');
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}/boards`);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');

  // 1. Create a labelled share link.
  const shares = page.getByTestId('share-manager');
  await shares.getByLabel('Share label').fill('Lectern iPad');
  await shares.getByRole('button', { name: 'New share link' }).click();
  const url = await shares.getByTestId('new-share-link').inputValue();
  expect(url).toMatch(/\/b\/klb_/);
  const token = url.split('/b/')[1] ?? '';

  // 2-3. It works.
  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(url);
  await expect(display.getByTestId('board-timer')).toHaveText('10:00');

  // 4. Listed in management (with the Quick Timer's initial link).
  const row = shares.locator('[data-testid="share-row"][data-label="Lectern iPad"]');
  await expect(row).toContainText('Speaker Board');
  await expect(shares.getByTestId('share-row')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/m5-share-management.png' });

  // 5-6. Revoke: the open display is cut off, and new requests are unauthorized.
  await row.getByRole('button', { name: 'Revoke link Lectern iPad' }).click();
  await expect(row).toHaveAttribute('data-revoked', 'true');
  await expect(display.getByTestId('board-revoked')).toBeVisible();
  const status = await page.evaluate(
    async (t) =>
      (await fetch('/api/v1/board/state', { headers: { authorization: `Bearer ${t}` } })).status,
    token,
  );
  expect(status).toBe(401);
  await display.reload();
  await expect(display.getByText('This board link is not valid.')).toBeVisible();

  // 7-8. A new link works.
  await shares.getByLabel('Share label').fill('Replacement');
  await shares.getByRole('button', { name: 'New share link' }).click();
  await expect(shares.getByTestId('new-share-link')).not.toHaveValue(url);
  const fresh = await shares.getByTestId('new-share-link').inputValue();
  await display.goto(fresh);
  await expect(display.getByTestId('board-timer')).toHaveText('10:00');
  await displayContext.close();
});
