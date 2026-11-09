import { expect, test, type Page } from '@playwright/test';
import { ApiServer } from './server';

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** Parse the displayed timer (`mm:ss`, `h:mm:ss`, `+mm:ss`) to signed seconds remaining. */
async function boardSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('board-timer').textContent()) ?? '';
  const overtime = text.startsWith('+');
  const parts = text.replace('+', '').split(':').map(Number);
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return overtime ? -seconds : seconds;
}

async function createTimer(page: Page, duration: string) {
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill(duration);
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const boardUrl = await page.getByTestId('board-link').inputValue();
  expect(boardUrl).toMatch(/\/b\/klb_/);
  return { showUrl: page.url(), showId: page.url().split('/').at(-1) ?? '', boardUrl };
}

test('anonymous Quick Timer: operator and speaker board stay in sync', async ({
  page,
  browser,
}) => {
  const { boardUrl, showId } = await createTimer(page, '10:00');
  const operatorTimer = page.getByTestId('operator-timer');
  await expect(operatorTimer).toHaveText('10:00');

  // Speaker Board on another "device": separate context, no owner cookie.
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto(boardUrl);
  const boardTimer = board.getByTestId('board-timer');
  await expect(boardTimer).toHaveText('10:00');
  await expect(boardTimer).toHaveAttribute('data-status', 'idle');

  // Start: the board follows and counts down locally.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await expect(boardTimer).toHaveAttribute('data-status', 'running');
  await expect.poll(() => boardSeconds(board)).toBeLessThan(600);
  // Normal running timer (more than 20 % remaining) is white/light gray, not green.
  await expect(boardTimer).toHaveCSS('color', 'rgb(245, 247, 250)');

  // Pause / resume.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(boardTimer).toHaveAttribute('data-status', 'paused');
  await expect(board.getByTestId('board-state-label')).toHaveText('PAUSED');
  const paused = await boardSeconds(board);
  await expect(operatorTimer).toHaveText((await boardTimer.textContent()) ?? '');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(boardTimer).toHaveAttribute('data-status', 'running');
  await expect.poll(() => boardSeconds(board)).toBeLessThan(paused);

  // Adjust +30s and -10s.
  const beforeAdjust = await boardSeconds(board);
  await page.getByRole('button', { name: 'Add 30 seconds' }).click();
  await expect(page.getByTestId('adjustment')).toHaveText('+00:30');
  await expect.poll(() => boardSeconds(board)).toBeGreaterThan(beforeAdjust + 25);
  await page.getByRole('button', { name: 'Remove 10 seconds' }).click();
  await expect(page.getByTestId('adjustment')).toHaveText('+00:20');

  // Stop, then Restart from the full duration.
  await page.getByRole('button', { name: /Stop timer/ }).click();
  await expect(boardTimer).toHaveAttribute('data-status', 'stopped');
  await expect(board.getByTestId('board-state-label')).toHaveText('STOPPED');
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(boardTimer).toHaveAttribute('data-status', 'running');
  await expect(page.getByTestId('adjustment')).toHaveText('±00:00');
  await expect.poll(() => boardSeconds(board)).toBeLessThanOrEqual(600);
  expect(await boardSeconds(board)).toBeGreaterThan(590);

  // The board's browser holds no control credential.
  const attempt = await board.evaluate(async (id) => {
    const res = await fetch(`/api/v1/shows/${id}/state`);
    return res.status;
  }, showId);
  expect(attempt).toBe(401);
  await boardContext.close();
});

test('board survives a short server outage and resynchronizes; the show survives a restart', async ({
  page,
  browser,
}) => {
  const { boardUrl } = await createTimer(page, '10:00');
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto(boardUrl);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');
  const revision = await board.getByTestId('board-timer').getAttribute('data-revision');

  // Outage: the server process is gone.
  await server.stop();
  await expect(board.getByTestId('board-connection')).toHaveText('RECONNECTING');
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeDisabled();
  // No loading page: the timer keeps counting locally for ~5 seconds.
  const atOutage = await boardSeconds(board);
  await expect
    .poll(() => boardSeconds(board), { timeout: 10_000 })
    .toBeLessThanOrEqual(atOutage - 5);
  await expect(board.getByTestId('board-timer')).toBeVisible();

  // Recovery: same database, new process.
  await server.start();
  await expect(board.getByTestId('board-connection')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE', { timeout: 15_000 });
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-revision', revision ?? '');
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');

  // Board and operator agree within a second after resync.
  const operatorText = (await page.getByTestId('operator-timer').textContent()) ?? '';
  const [m, s] = operatorText.split(':').map(Number);
  expect(Math.abs((m ?? 0) * 60 + (s ?? 0) - (await boardSeconds(board)))).toBeLessThanOrEqual(1);

  // Control works again after the restart (state was persisted).
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'paused');

  await board.screenshot({ path: 'test-results/speaker-board.png' });
  await page.screenshot({ path: 'test-results/operator-view.png' });
  await boardContext.close();
});

test('an invalid board link shows a calm message, not a crash', async ({ page }) => {
  await page.goto('/b/klb_this-is-not-a-valid-board-token-123456');
  await expect(page.getByText('This board link is not valid.')).toBeVisible();
});

test('another browser cannot control a show it did not create', async ({ page, browser }) => {
  const { showUrl } = await createTimer(page, '01:00');
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(showUrl);
  await expect(stranger.getByText('No control access in this browser')).toBeVisible();
  await other.close();
});
