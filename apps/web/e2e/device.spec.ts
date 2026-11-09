import { expect, test, type Page } from '@playwright/test';
import { ApiServer } from './server';

test.use({ timezoneId: 'Europe/Amsterdam' });

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

function seconds(text: string | null): number {
  const [m, s] = (text ?? '').replace('-', '').split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

async function json<T>(page: Page, path: string, body?: object): Promise<T> {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`${path}: ${String(res.status)}`);
      return (await res.json()) as T;
    },
    { path, body },
  );
}

test('M5 Device flow: pair by code, show Board, outage, reassign, revoke', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  // Event with a Main Stage, the Keynote Show in it and a Room Agenda Board.
  await page.goto('/event/new');
  await page.getByLabel('Event name').fill('Congress');
  await page.getByRole('button', { name: 'Create Event' }).click();
  await expect(page).toHaveURL(/\/event\/[0-9a-f-]{36}$/);
  const eventId = page.url().split('/').at(-1) ?? '';
  const cmd = (type: string, payload: object) =>
    json<{ createdId: string }>(page, `/api/v1/events/${eventId}/commands`, {
      commandId: crypto.randomUUID(),
      type,
      payload,
    });
  const room = (await cmd('room.create', { name: 'Main Stage' })).createdId;
  const { showId } = await json<{ showId: string }>(page, `/api/v1/events/${eventId}/shows`, {
    title: 'Keynote',
    roomId: room,
  });
  // 1. A Board for the Room (Event Board, Room Agenda).
  await cmd('board.create', { preset: 'room_agenda', roomId: room, name: 'Main Stage Agenda' });

  // 2-3. The display opens /device and shows a pairing code.
  const screenContext = await browser.newContext({ timezoneId: 'Europe/Amsterdam' });
  const screen = await screenContext.newPage();
  await screen.goto('/device');
  await expect(screen.getByTestId('device-pairing')).toContainText('PAIR DEVICE');
  const code = (await screen.getByTestId('pairing-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{2}$/);
  await screen.screenshot({ path: 'test-results/m5-device-pairing.png' });

  // 4-5. Pair it from Device management and assign the Keynote's Speaker Board.
  await page.goto(`/event/${eventId}/devices`);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const manager = page.getByTestId('device-manager');
  await manager.getByLabel('Pairing code').fill(code);
  await manager.getByLabel('Device name').fill('Main Stage Monitor');
  await manager
    .getByLabel('Board for new Device')
    .selectOption({ label: 'Keynote: Speaker Board' });
  await manager.getByRole('button', { name: 'Pair Device' }).click();
  const row = page.locator('[data-testid="device-row"][data-name="Main Stage Monitor"]');
  await expect(row).toBeVisible();

  // 6. The Device shows its Board (same renderer as share links) and goes online.
  await expect(screen.getByTestId('device-board')).toHaveAttribute(
    'data-device',
    'Main Stage Monitor',
  );
  // Speaker Confidence shows the Current item of the Keynote's Primary Queue.
  await expect(screen.getByTestId('board-title')).toHaveText('Timer');
  await expect(row.getByTestId('device-status')).toHaveAttribute('data-status', 'online');

  // 7. Timer updates reach the Device.
  const state = await json<{ queues: { items: { id: string }[] }[] }>(
    page,
    `/api/v1/shows/${showId}/state`,
  );
  await json(page, `/api/v1/shows/${showId}/commands`, {
    commandId: crypto.randomUUID(),
    type: 'timer.start',
    payload: { queueItemId: state.queues[0]?.items[0]?.id },
  });
  const timer = screen.getByTestId('board-timer');
  await expect(timer).toHaveAttribute('data-status', 'running');
  await expect.poll(async () => seconds(await timer.textContent())).toBeLessThan(600);
  await screen.screenshot({ path: 'test-results/m5-device-board.png' });

  // 8-9. Short server outage: the Device keeps showing and counting its last known state.
  await server.stop();
  await expect(screen.getByTestId('board-connection')).toHaveText('RECONNECTING');
  const atOutage = seconds(await timer.textContent());
  await expect
    .poll(async () => seconds(await timer.textContent()), { timeout: 10_000 })
    .toBeLessThan(atOutage);
  await expect(screen.getByTestId('device-board')).toBeVisible();

  // 10. Reconnect: the same credential resynchronizes.
  await server.start();
  await expect(screen.getByTestId('board-connection')).toHaveCount(0, { timeout: 15_000 });
  await expect(timer).toHaveAttribute('data-status', 'running');

  // 11-12. Reassign to the Room Agenda: the Device follows without reloading.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await row
    .getByLabel('Board for Main Stage Monitor')
    .selectOption({ label: 'Congress: Main Stage Agenda' });
  await expect(screen.locator('main[data-preset="room_agenda"]')).toBeVisible();
  await expect(screen.getByTestId('board-agenda')).toContainText('Timer');

  // 13-14. Revoke: the Device loses access and shows a clean unpaired state.
  await row.getByRole('button', { name: 'Revoke Main Stage Monitor' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(screen.getByTestId('device-unpaired')).toContainText('DEVICE UNPAIRED');
  await expect(row.getByTestId('device-status')).toHaveAttribute('data-status', 'revoked');
  await screen.reload();
  await expect(screen.getByTestId('device-unpaired')).toBeVisible();
  // Pair again starts a fresh pairing (a revoked credential never comes back).
  await screen.getByRole('button', { name: 'Pair again' }).click();
  await expect(screen.getByTestId('pairing-code')).toBeVisible();
  await screenContext.close();
});
