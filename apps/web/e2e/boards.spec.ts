import { expect, test, type Browser, type Page } from '@playwright/test';
import { ApiServer } from './server';

test.use({ timezoneId: 'Europe/Amsterdam' });

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

const MIN = 60_000;

async function api(page: Page, showId: string, type: string, payload: object): Promise<string> {
  return page.evaluate(
    async ({ showId, type, payload }) => {
      const res = await fetch(`/api/v1/shows/${showId}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: crypto.randomUUID(), type, payload }),
      });
      const body = (await res.json()) as { createdId?: string; error?: { message: string } };
      if (!res.ok) throw new Error(`${type}: ${body.error?.message ?? res.status}`);
      return body.createdId ?? '';
    },
    { showId, type, payload },
  );
}

async function shareFor(page: Page, showId: string, boardId: string): Promise<string> {
  return page.evaluate(
    async ({ showId, boardId }) => {
      const res = await fetch(`/api/v1/shows/${showId}/board-shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });
      const body = (await res.json()) as { boardShareToken: string };
      return `${window.location.origin}/b/${body.boardShareToken}`;
    },
    { showId, boardId },
  );
}

/** The raw scoped projection a Board token receives (what reaches the display's browser). */
async function rawBoardState(page: Page, url: string): Promise<string> {
  const token = url.split('/b/')[1] ?? '';
  return page.evaluate(async (token) => {
    const res = await fetch('/api/v1/board/state', {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.text();
  }, token);
}

async function openBoard(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

function seconds(text: string | null): number {
  const [m, s] = (text ?? '').replace('-', '').split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

test('M4 Boards: presets, scoped sources/audiences, Messages, disconnect + resync', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill('10:00');
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const operatorUrl = page.url();
  const showId = operatorUrl.split('/').at(-1) ?? '';

  // Setup: Program (Primary) + Audio + Lighting with items.
  const state0 = await page.evaluate(
    async (id) =>
      (await fetch(`/api/v1/shows/${id}/state`)).json() as Promise<{
        queues: { items: { id: string }[] }[];
      }>,
    showId,
  );
  const opening = state0.queues[0]?.items[0]?.id ?? '';
  await api(page, showId, 'item.update', { queueItemId: opening, patch: { title: 'Opening' } });
  const keynote = await api(page, showId, 'item.add', { title: 'Keynote', durationMs: 20 * MIN });
  await api(page, showId, 'item.add', { title: 'Q&A', durationMs: 10 * MIN });
  const audio = await api(page, showId, 'queue.create', { name: 'Audio', discipline: 'Audio' });
  const light = await api(page, showId, 'queue.create', {
    name: 'Lighting',
    discipline: 'Lighting',
  });
  const walkin = await api(page, showId, 'item.add', {
    title: 'Walk-in',
    durationMs: 10 * MIN,
    queueId: audio,
  });
  await api(page, showId, 'item.add', {
    title: 'Keynote mic',
    durationMs: 20 * MIN,
    queueId: audio,
  });
  const olook = await api(page, showId, 'item.add', {
    title: 'Opening look',
    durationMs: 10 * MIN,
    queueId: light,
  });
  await api(page, showId, 'queue.setCurrent', { queueItemId: walkin });
  await api(page, showId, 'queue.setCurrent', { queueItemId: olook });

  // 1. Speaker Confidence Board (default, Primary, Stage) — in the Boards page.
  await page.goto(`${operatorUrl}/boards`);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const speakerItem = page.locator('[data-testid="board-list-item"][data-name="Speaker Board"]');
  await expect(speakerItem).toContainText('Speaker Confidence · stage');
  await speakerItem.click();
  // Constrained configuration: enable the (preset-off) Next item component.
  await page.getByTestId('board-config').getByLabel('Show Next item').check();
  await page.getByTestId('board-config').getByRole('button', { name: 'Save Board' }).click();
  await expect(page.getByTestId('board-preview').getByTestId('board-next')).toBeVisible();
  await page.getByRole('button', { name: 'Create link' }).click();
  const speakerUrl = await page.getByTestId('board-share-link').inputValue();
  expect(speakerUrl).toMatch(/\/b\/klb_/);

  // 2. Production Board with sources Program + Audio + Lighting, via the UI.
  await page.getByLabel('Board preset').selectOption('production');
  await page.getByRole('button', { name: '+ Create Board' }).click();
  const config = page.getByTestId('board-config');
  await expect(config.getByLabel('Board name')).not.toHaveValue('Speaker Board');
  await config.getByLabel('Board name').fill('FOH');
  await config.getByLabel('Follow Primary Queue').uncheck();
  for (const q of ['Program', 'Audio', 'Lighting']) await config.getByLabel(`Source ${q}`).check();
  await config.getByRole('button', { name: 'Save Board' }).click();
  await expect(page.locator('[data-testid="board-list-item"][data-name="FOH"]')).toContainText(
    'FOH / Production · production',
  );
  await config.getByRole('button', { name: 'Create link' }).click();
  const productionUrl = await page.getByTestId('board-share-link').inputValue();
  expect(productionUrl).not.toBe(speakerUrl);
  await expect(page.getByTestId('board-preview')).toBeVisible();
  await page.screenshot({ path: 'test-results/m4-boards-page.png' });

  // A Public Agenda Board (API setup).
  const publicId = await api(page, showId, 'board.create', {
    preset: 'public_agenda',
    name: 'Lobby',
  });
  const publicUrl = await shareFor(page, showId, publicId);

  // 3. Restrict Keynote to Production only.
  await api(page, showId, 'item.setVisibility', {
    queueItemId: keynote,
    visibility: ['production'],
  });

  const speaker = await openBoard(browser, speakerUrl);
  const production = await openBoard(browser, productionUrl);
  const lobby = await openBoard(browser, publicUrl);

  // 4. Production shows multiple Queue states; the restricted item is there.
  const columns = production.page.getByTestId('board-queue');
  await expect(columns).toHaveCount(3);
  await expect(
    production.page.locator('[data-testid="board-queue"][data-queue="Program"]'),
  ).toContainText('Keynote');
  await expect(
    production.page.locator(
      '[data-testid="board-queue"][data-queue="Audio"] [data-testid="board-queue-current"]',
    ),
  ).toHaveText('Walk-in');

  // 5. Speaker and Public Boards do not show it — and the server never sent it.
  await expect(speaker.page.getByTestId('board-title')).toHaveText('Opening');
  await expect(speaker.page.getByTestId('board-next')).toContainText('Q&A');
  await expect(lobby.page.getByTestId('board-agenda')).toContainText('Q&A');
  await expect(lobby.page.getByTestId('board-agenda')).not.toContainText('Keynote');
  for (const url of [speakerUrl, publicUrl]) {
    const raw = await rawBoardState(page, url);
    expect(raw).not.toContain('Keynote');
    expect(raw).not.toContain('Audio');
    expect(raw).not.toContain('audit');
  }
  expect(await rawBoardState(page, productionUrl)).toContain('Keynote');

  // Start timers in Program and Audio (Operator UI).
  await page.goto(operatorUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await page.locator('[data-testid="queue-tab"][data-queue="Audio"]').click();
  await expect(page.getByTestId('current-title')).toHaveText('Walk-in');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await expect(speaker.page.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');
  await expect(
    production.page.locator('[data-testid="board-queue-timer"][data-status="running"]'),
  ).toHaveCount(2);
  await expect(production.page.getByTestId('board-running')).toContainText('Walk-in');

  // 6-7. A Stage Message reaches the Speaker Board only.
  const messages = page.getByTestId('message-panel');
  await expect(messages.getByLabel('Audience stage')).toBeChecked();
  await messages.getByRole('button', { name: 'WRAP UP', exact: true }).click();
  await expect(speaker.page.getByTestId('board-message')).toHaveText('WRAP UP');
  await expect(speaker.page.getByTestId('board-timer')).toBeVisible(); // timer stays, compact
  await expect(production.page.getByTestId('board-message')).toHaveCount(0);
  await expect(lobby.page.getByTestId('board-message')).toHaveCount(0);
  await speaker.page.screenshot({ path: 'test-results/m4-speaker-message.png' });

  // 8-9. Clear: the normal timer view returns.
  await messages.getByRole('button', { name: 'Clear message WRAP UP' }).click();
  await expect(speaker.page.getByTestId('board-message')).toHaveCount(0);
  await expect(speaker.page.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');
  await production.page.screenshot({ path: 'test-results/m4-production-board.png' });

  // 10-11. Server outage: both Boards keep rendering their running timers.
  const speakerRev = await speaker.page.getByTestId('board-timer').getAttribute('data-revision');
  await server.stop();
  for (const b of [speaker, production]) {
    await expect(b.page.getByTestId('board-connection')).toHaveText('RECONNECTING');
  }
  const atOutage = seconds(await speaker.page.getByTestId('board-timer').textContent());
  const prodAtOutage = seconds(
    await production.page.getByTestId('board-queue-timer').first().textContent(),
  );
  await expect
    .poll(async () => seconds(await speaker.page.getByTestId('board-timer').textContent()), {
      timeout: 10_000,
    })
    .toBeLessThan(atOutage);
  await expect
    .poll(
      async () =>
        seconds(await production.page.getByTestId('board-queue-timer').first().textContent()),
      { timeout: 10_000 },
    )
    .toBeLessThan(prodAtOutage);
  await expect(production.page.getByTestId('board-queue')).toHaveCount(3);

  // 12-13. Restart: both Boards resynchronize to the authoritative state.
  await server.start();
  for (const b of [speaker, production]) {
    await expect(b.page.getByTestId('board-connection')).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(speaker.page.getByTestId('board-timer')).toHaveAttribute(
    'data-revision',
    speakerRev ?? '',
  );
  await expect(speaker.page.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');
  await expect(
    production.page.locator('[data-testid="board-queue-timer"][data-status="running"]'),
  ).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(speaker.page.getByTestId('board-timer')).toHaveAttribute('data-status', 'paused');

  // The Board's browser holds no management credential.
  const attempt = await speaker.page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/shows/${id}/state`);
    return res.status;
  }, showId);
  expect(attempt).toBe(401);

  for (const b of [speaker, production, lobby]) await b.context.close();
});
