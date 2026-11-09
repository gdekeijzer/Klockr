import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function createShow(page: Page) {
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill('10:00');
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const showId = page.url().split('/').at(-1) ?? '';
  return {
    showId,
    operatorUrl: page.url(),
    masterUrl: `${page.url()}/master`,
    boardsUrl: `${page.url()}/boards`,
  };
}

/** Same-origin API call with the page's owner cookie (bulk setup only; key steps use the UI). */
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

async function stateOf(page: Page, showId: string) {
  return page.evaluate(async (showId) => {
    const res = await fetch(`/api/v1/shows/${showId}/state`);
    return (await res.json()) as {
      show: { primaryQueueId: string };
      queues: {
        id: string;
        name: string;
        isPrimary: boolean;
        currentItemId: string | null;
        items: { id: string; title: string; timer: { status: string } | null }[];
      }[];
      relations: { sourceItemId: string; targetItemId: string; offsetMs: number }[];
      suggestions: { targetQueueId: string; targetItemId: string }[];
    };
  }, showId);
}

async function live(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
}

const tab = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="queue-tab"][data-queue="${name}"]`);

test('M4 multi-Queue: peer Queues, independent Current, simultaneous timers, relations, suggested follow, reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // 1-2. Show; the existing Program Queue is Primary.
  const { showId, operatorUrl, masterUrl } = await createShow(page);
  await live(page, masterUrl);
  await expect(page.getByTestId('master-queue-name')).toContainText('★');

  // 3-4. Audio and Lighting through the Master UI.
  for (const name of ['Audio', 'Lighting']) {
    await page.getByLabel('New queue name').fill(name);
    await page.getByRole('button', { name: '+ Queue' }).click();
    await expect(
      page.getByRole('button', { name: `Select queue ${name}`, exact: true }),
    ).toBeVisible();
  }
  const state = await stateOf(page, showId);
  const program = state.show.primaryQueueId;
  const audio = state.queues.find((q) => q.name === 'Audio')?.id ?? '';
  const light = state.queues.find((q) => q.name === 'Lighting')?.id ?? '';
  expect(state.queues.map((q) => [q.name, q.isPrimary])).toEqual([
    ['Program', true],
    ['Audio', false],
    ['Lighting', false],
  ]);

  // 5-7. Items per Queue.
  const opening = state.queues[0]?.items[0]?.id ?? '';
  await api(page, showId, 'item.update', { queueItemId: opening, patch: { title: 'Opening' } });
  const keynote = await api(page, showId, 'item.add', { title: 'Keynote', durationMs: 20 * MIN });
  await api(page, showId, 'item.add', { title: 'Q&A', durationMs: 10 * MIN });
  const walkin = await api(page, showId, 'item.add', {
    title: 'Walk-in',
    durationMs: 10 * MIN,
    queueId: audio,
  });
  const mic = await api(page, showId, 'item.add', {
    title: 'Keynote mic',
    durationMs: 20 * MIN,
    queueId: audio,
  });
  await api(page, showId, 'item.add', { title: 'Q&A mics', durationMs: 10 * MIN, queueId: audio });
  const olook = await api(page, showId, 'item.add', {
    title: 'Opening look',
    durationMs: 10 * MIN,
    queueId: light,
  });
  const klook = await api(page, showId, 'item.add', {
    title: 'Keynote look',
    durationMs: 20 * MIN,
    queueId: light,
  });
  await api(page, showId, 'item.add', { title: 'Q&A look', durationMs: 10 * MIN, queueId: light });

  // 8-10. Keynote -> Keynote mic (-00:30) via the Master UI; Keynote -> Keynote look via API.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await page.getByRole('button', { name: 'Edit Keynote', exact: true }).click();
  const relations = page.getByTestId('relations-section');
  await relations.getByLabel('Relation target').selectOption({ label: 'Audio: Keynote mic' });
  await relations.getByLabel('Relation offset').fill('-00:30');
  await relations.getByRole('button', { name: 'Add relation' }).click();
  await expect(relations.getByTestId('relation-row')).toHaveCount(1);
  await expect(relations.getByTestId('relation-row')).toContainText('Audio: Keynote mic');
  await api(page, showId, 'relation.create', {
    sourceItemId: keynote,
    targetItemId: klook,
    offsetMs: 0,
    preserveOffset: true,
  });

  // 11. Different Current per Queue.
  await api(page, showId, 'queue.setCurrent', { queueItemId: walkin });
  await api(page, showId, 'queue.setCurrent', { queueItemId: olook });

  // 12-13. Timers in Program and Audio run at the same time.
  await live(page, operatorUrl);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await tab(page, 'Audio').click();
  await expect(page.getByTestId('current-title')).toHaveText('Walk-in');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await expect(page.getByTestId('other-running')).toContainText('Opening');
  const running = await stateOf(page, showId);
  expect(
    running.queues
      .flatMap((q) => q.items)
      .filter((i) => i.timer?.status === 'running')
      .map((i) => i.title),
  ).toEqual(['Opening', 'Walk-in']);

  // 14. END + NEXT on Program.
  await tab(page, 'Program').click();
  await expect(page.getByTestId('current-title')).toHaveText('Opening');
  await page.getByRole('button', { name: 'End + Next' }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Keynote');

  // 15. Audio and Lighting did NOT change Current.
  const after = await stateOf(page, showId);
  expect(after.queues.map((q) => q.currentItemId)).toEqual([keynote, walkin, olook]);

  // 16. Pending suggestions are visible.
  await expect(tab(page, 'Audio')).toContainText('SUGGESTED');
  await expect(tab(page, 'Lighting')).toContainText('SUGGESTED');
  expect(after.suggestions.map((s) => [s.targetQueueId, s.targetItemId])).toEqual([
    [audio, mic],
    [light, klook],
  ]);

  // 17. Accept the Audio suggestion.
  await tab(page, 'Audio').click();
  await expect(page.getByTestId('suggestion-target')).toHaveText('Keynote mic');
  await page.getByRole('button', { name: 'GO', exact: true }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Keynote mic');
  await expect(page.getByTestId('timer-status')).toHaveText('READY'); // GO never starts a timer

  // 18. Ignore the Lighting suggestion.
  await tab(page, 'Lighting').click();
  await expect(page.getByTestId('suggestion-target')).toHaveText('Keynote look');
  await page.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(page.getByTestId('suggestion-banner')).toHaveCount(0);
  await expect(page.getByTestId('current-title')).toHaveText('Opening look');
  await page.screenshot({ path: 'test-results/m4-operator-view.png' });

  // 19. Relation / projected timing in Master (list + timeline).
  await live(page, masterUrl);
  await page.getByRole('button', { name: 'Edit Keynote', exact: true }).click();
  await expect(page.getByTestId('relation-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByTestId('timeline-lane')).toHaveCount(3);
  await expect(
    page.locator('[data-testid="timeline-block"][data-title="Keynote mic"]'),
  ).toContainText('LINK');
  await expect(page.getByTestId('timeline-now')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/m4-master-timeline.png' });

  // 20-21. Reload: Currents, relations and (no longer pending) suggestions persist.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const reloaded = await stateOf(page, showId);
  expect(reloaded.queues.map((q) => q.currentItemId)).toEqual([keynote, mic, olook]);
  expect(reloaded.relations.map((r) => [r.sourceItemId, r.targetItemId, r.offsetMs])).toEqual([
    [keynote, mic, -30_000],
    [keynote, klook, 0],
  ]);
  expect(reloaded.suggestions).toEqual([]);
  await expect(page.getByTestId('queue-overview-cell')).toHaveCount(3);
  expect(program).toBe(reloaded.show.primaryQueueId);
});
