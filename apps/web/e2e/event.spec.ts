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

interface EventState {
  rooms: { id: string; name: string }[];
  shows: {
    id: string;
    title: string;
    roomId: string | null;
    current: { id: string } | null;
    currentTimer: { status: string; revision: number; startedAt: number | null } | null;
    revision: number;
  }[];
}

const eventState = (page: Page, eventId: string) =>
  page.evaluate(
    async (id) => (await fetch(`/api/v1/events/${id}/state`)).json() as Promise<EventState>,
    eventId,
  );

const column = (page: Page, room: string) =>
  page.locator(`[data-testid="room-column"][data-room="${room}"]`);
const card = (page: Page, title: string) =>
  page.locator(`[data-testid="show-card"][data-title="${title}"]`);

test('M5 Event flow: Rooms, Shows, live status, safe move, clean duplicate, Room view, Master, reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // 1. Create the Event (optional context; Quick Timer stays one click away).
  await page.goto('/');
  await page.getByTestId('plan-event').click();
  await page.getByLabel('Event name').fill('Congress 2026');
  await page.getByRole('button', { name: 'Create Event' }).click();
  await expect(page).toHaveURL(/\/event\/[0-9a-f-]{36}$/);
  const eventUrl = page.url();
  const eventId = eventUrl.split('/').at(-1) ?? '';
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('event-name')).toHaveText('Congress 2026');

  // 2-3. Rooms.
  for (const name of ['Main Stage', 'Breakout Room']) {
    await page.getByLabel('New Room name').fill(name);
    await page.getByRole('button', { name: '+ Room' }).click();
    await expect(column(page, name)).toBeVisible();
  }

  // 4. Shows: Keynote and Panel in Main Stage, Workshop without Room, then into Breakout.
  for (const [title, room] of [
    ['Keynote', 'Main Stage'],
    ['Panel', 'Main Stage'],
    ['Workshop', 'No Room'],
  ] as const) {
    await page.getByLabel('New Show title').fill(title);
    await page.getByLabel('Room for new Show').selectOption({ label: room });
    await page.getByRole('button', { name: '+ Show' }).click();
    await expect(card(page, title)).toBeVisible();
  }
  await expect(column(page, '__none').getByTestId('show-card')).toHaveCount(1);
  await page.getByLabel('Move Workshop').selectOption({ label: 'Breakout Room' });
  await expect(column(page, 'Breakout Room')).toContainText('Workshop');
  await expect(column(page, '__none').getByTestId('show-card')).toHaveCount(0);

  // Operate the Keynote (the Event owner manages Shows in its Event); breadcrumb shows context.
  const before = await eventState(page, eventId);
  const keynoteId = before.shows.find((s) => s.title === 'Keynote')?.id ?? '';
  await page.goto(`/show/${keynoteId}`);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('show-context')).toContainText('Congress 2026 / Main Stage');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');

  // 5-6. Dashboard shows live status per Room.
  await page.goto(eventUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(column(page, 'Main Stage').getByTestId('room-live')).toBeVisible();
  await expect(column(page, 'Breakout Room').getByTestId('room-live')).toHaveCount(0);
  await expect(card(page, 'Keynote').getByTestId('show-card-timer')).toHaveAttribute(
    'data-status',
    'running',
  );

  // 7-8. Move the inactive Panel to the Breakout: runtime state of every Show is unchanged.
  const runtime = await eventState(page, eventId);
  await page.getByLabel('Move Panel').selectOption({ label: 'Breakout Room' });
  await expect(column(page, 'Breakout Room')).toContainText('Panel');
  const moved = await eventState(page, eventId);
  for (const s of runtime.shows) {
    const after = moved.shows.find((x) => x.id === s.id);
    expect(after?.current?.id).toBe(s.current?.id);
    const pick = (t: EventState['shows'][number]['currentTimer']) =>
      t && { status: t.status, revision: t.revision, startedAt: t.startedAt };
    expect(pick(after?.currentTimer ?? null)).toEqual(pick(s.currentTimer));
    expect(after?.revision).toBe(s.revision); // the Show aggregate itself was not touched
  }
  await expect(card(page, 'Keynote').getByTestId('show-card-timer')).toHaveAttribute(
    'data-status',
    'running',
  );

  // 9-10. Duplicate the running Keynote: the copy is clean and idle.
  await page.getByRole('button', { name: 'Duplicate Keynote' }).click();
  const copy = card(page, 'Keynote (copy)');
  await expect(copy).toBeVisible();
  await expect(column(page, 'Main Stage')).toContainText('Keynote (copy)');
  await expect(copy.getByTestId('show-card-current')).toHaveText('—');
  await expect(copy.getByTestId('show-card-timer')).toHaveCount(0);
  await expect(card(page, 'Keynote').getByTestId('show-card-timer')).toHaveAttribute(
    'data-status',
    'running',
  );
  await page.screenshot({ path: 'test-results/m5-event-dashboard.png', fullPage: true });

  // 11. Room view.
  await column(page, 'Main Stage').getByRole('link', { name: 'Main Stage' }).click();
  await expect(page.getByTestId('room-view')).toHaveAttribute('data-room', 'Main Stage');
  await expect(page.getByTestId('room-current-show')).toBeVisible();
  await expect(page.getByTestId('room-agenda')).toContainText('Keynote');
  await expect(page.getByTestId('event-context')).toContainText('Congress 2026 / Main Stage');
  await page.screenshot({ path: 'test-results/m5-room-view.png', fullPage: true });

  // 12. Show Master from the Room.
  await page.getByRole('link', { name: 'Open Master of Keynote' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/show/${keynoteId}/master$`));
  await expect(page.getByTestId('show-context')).toContainText('Congress 2026 / Main Stage');

  // 13-14. Reload: hierarchy remains.
  await page.goto(eventUrl);
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(column(page, 'Main Stage').getByTestId('show-card')).toHaveCount(2);
  await expect(column(page, 'Breakout Room').getByTestId('show-card')).toHaveCount(2);
  const final = await eventState(page, eventId);
  expect(final.rooms.map((r) => r.name)).toEqual(['Main Stage', 'Breakout Room']);
  const roomOf = (title: string) =>
    final.rooms.find((r) => r.id === final.shows.find((s) => s.title === title)?.roomId)?.name;
  expect(['Keynote', 'Keynote (copy)', 'Panel', 'Workshop'].map(roomOf)).toEqual([
    'Main Stage',
    'Main Stage',
    'Breakout Room',
    'Breakout Room',
  ]);

  // A standalone Quick Timer still works without any Event.
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill('05:00');
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('show-context')).toHaveCount(0);
});
