import { expect, test, type Locator, type Page } from '@playwright/test';
import { ApiServer } from './server';

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

async function createShow(page: Page) {
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill('05:00');
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  const boardUrl = await page.getByTestId('board-link').inputValue();
  return { operatorUrl: page.url(), editorUrl: `${page.url()}/edit`, boardUrl };
}

const editorRow = (page: Page, title: string): Locator =>
  page.locator(`[data-testid="editor-row"][data-title="${title}"]`);
const queueRow = (page: Page, title: string): Locator =>
  page.locator(`[data-testid="queue-row"][data-title="${title}"]`);

async function openEditor(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
}

/** Add an item through a UI preset and fill it in the inspector. */
async function addItem(
  page: Page,
  preset: 'Timer' | 'Speaker' | 'Note' | 'Break',
  title: string,
  duration?: string,
) {
  const rows = page.getByTestId('editor-row');
  const before = await rows.count();
  await page.getByRole('button', { name: `Add ${preset}`, exact: true }).click();
  await expect(rows).toHaveCount(before + 1);
  const inspector = page.getByTestId('item-inspector');
  await expect(inspector).toBeVisible();
  // The preset already carries its own title (e.g. "Note"); only edit what differs.
  if (title !== preset || duration !== undefined) {
    await inspector.getByLabel('Title', { exact: true }).fill(title);
    if (duration !== undefined) {
      await inspector.getByLabel('Timer duration (empty = no timer)').fill(duration);
    }
    await inspector.getByRole('button', { name: 'Save item' }).click();
  }
  await expect(editorRow(page, title)).toBeVisible();
}

async function editorOrder(page: Page): Promise<string[]> {
  return page
    .getByTestId('editor-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-title') ?? ''));
}

test('rundown: Current / Next, END + NEXT through a note, board follows, reorder survives reload', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  // 1. Quick Show.
  const { operatorUrl, editorUrl, boardUrl } = await createShow(page);

  // 2-4. Speaker A 10:00, a Note (no timer), Speaker B 15:00 — plus two later items.
  await openEditor(page, editorUrl);
  await addItem(page, 'Speaker', 'Speaker A', '10:00');
  await addItem(page, 'Note', 'Note');
  await addItem(page, 'Speaker', 'Speaker B', '15:00');
  await addItem(page, 'Timer', 'Q&A', '10:00');
  await addItem(page, 'Break', 'Closing', '05:00');
  expect(await editorOrder(page)).toEqual([
    'Timer',
    'Speaker A',
    'Note',
    'Speaker B',
    'Q&A',
    'Closing',
  ]);
  await expect(editorRow(page, 'Note')).toContainText('No timer');

  // Make Speaker A current from the Operator View, then remove the initial "Timer" item.
  await page.goto(operatorUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await page.getByRole('button', { name: 'Make current: Speaker A' }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Speaker A');
  await expect(page.getByTestId('next-title')).toHaveText('Note');

  await openEditor(page, editorUrl);
  await page.getByRole('button', { name: 'Edit Timer' }).click();
  await page.getByRole('button', { name: 'Delete item…' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(editorRow(page, 'Timer')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/m2-queue-editor.png' });

  // 5. Start Speaker A.
  await page.goto(operatorUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');

  // 6. The Speaker Board (separate device, no owner cookie) shows Speaker A.
  const boardContext = await browser.newContext();
  const board = await boardContext.newPage();
  await board.goto(boardUrl);
  await expect(board.getByTestId('board-title')).toContainText('Speaker A');
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');

  // STOP is not END: the item stays current, nothing advances.
  await page.getByRole('button', { name: /Stop timer/ }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('STOPPED');
  await expect(page.getByTestId('current-title')).toHaveText('Speaker A');
  await expect(board.getByTestId('board-title')).toContainText('Speaker A');
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');

  // 7. END + NEXT.
  await page.getByRole('button', { name: 'End + Next' }).click();

  // 8. The Note is current, without timer; the board follows automatically.
  await expect(page.getByTestId('current-title')).toHaveText('Note');
  await expect(page.getByTestId('current-no-timer')).toBeVisible();
  await expect(queueRow(page, 'Speaker A')).toHaveAttribute('data-lifecycle', 'completed');
  await expect(board.getByTestId('board-title')).toContainText('Note');
  await expect(board.getByTestId('board-timer')).toHaveCount(0);
  await expect(page.getByTestId('next-title')).toHaveText('Speaker B');

  // 9. END + NEXT on an item without timer.
  await page.getByRole('button', { name: 'End + Next' }).click();

  // 10. Speaker B is current; its timer did not start by itself.
  await expect(page.getByTestId('current-title')).toHaveText('Speaker B');
  await expect(page.getByTestId('timer-status')).toHaveText('READY');
  await expect(page.getByTestId('operator-timer')).toHaveText('15:00');
  await expect(board.getByTestId('board-title')).toContainText('Speaker B');
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'idle');

  // 11. Start Speaker B.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(board.getByTestId('board-timer')).toHaveAttribute('data-status', 'running');
  await page.screenshot({ path: 'test-results/m2-operator-view.png' });
  await board.screenshot({ path: 'test-results/m2-speaker-board.png' });

  // 12. Reorder a future item by drag & drop (structure only; nothing operational happens).
  await openEditor(page, editorUrl);
  await editorRow(page, 'Closing').dragTo(editorRow(page, 'Q&A'));
  await expect
    .poll(() => editorOrder(page))
    .toEqual(['Speaker A', 'Note', 'Speaker B', 'Closing', 'Q&A']);
  await expect(editorRow(page, 'Speaker B')).toHaveAttribute('data-lifecycle', 'current');

  // 13. Reload the browser.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');

  // 14. Queue, current and order are intact.
  expect(await editorOrder(page)).toEqual(['Speaker A', 'Note', 'Speaker B', 'Closing', 'Q&A']);
  await page.goto(operatorUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('current-title')).toHaveText('Speaker B');
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');
  await expect(page.getByTestId('next-title')).toHaveText('Closing');
  await expect(queueRow(page, 'Speaker A')).toHaveAttribute('data-lifecycle', 'completed');
  await expect(queueRow(page, 'Note')).toHaveAttribute('data-lifecycle', 'completed');
  await expect(board.getByTestId('board-title')).toContainText('Speaker B');
  await boardContext.close();
});

test('groups: add, fill, duplicate with children, move as a whole; inactive is skipped; warnings inherit', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { operatorUrl, editorUrl } = await createShow(page);
  await openEditor(page, editorUrl);

  // A Group with two items moved into it.
  await page.getByRole('button', { name: 'Add Group', exact: true }).click();
  const groupInspector = page.getByTestId('group-inspector');
  await groupInspector.getByLabel('Group title').fill('Morning');
  await groupInspector.getByRole('button', { name: 'Save group' }).click();
  await expect(page.locator('[data-testid="editor-group"][data-title="Morning"]')).toBeVisible();

  await addItem(page, 'Speaker', 'Keynote', '20:00');
  await page
    .getByTestId('item-inspector')
    .getByRole('combobox', { name: 'Group' })
    .selectOption({ label: 'Morning' });
  await expect(page.locator('[data-testid="editor-group"][data-title="Morning"]')).toContainText(
    'Keynote',
  );
  await addItem(page, 'Note', 'Tech check');
  await page
    .getByTestId('item-inspector')
    .getByRole('combobox', { name: 'Group' })
    .selectOption({ label: 'Morning' });
  await expect(page.locator('[data-testid="editor-group"][data-title="Morning"]')).toContainText(
    '2 items',
  );

  // Inactive items stay visible but are skipped by NEXT.
  // Controlled by the server state: click, then wait for the confirmed change.
  await page.getByRole('checkbox', { name: 'Active: Tech check' }).click();
  await expect(editorRow(page, 'Tech check')).toHaveAttribute('data-lifecycle', 'inactive');

  // Collapse / expand is presentation only.
  await page.getByRole('button', { name: 'Collapse group Morning' }).click();
  await expect(editorRow(page, 'Keynote')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand group Morning' }).click();
  await expect(editorRow(page, 'Keynote')).toBeVisible();

  // Duplicate the group with its children, then move the original group to the top.
  await page.getByRole('button', { name: 'Edit group Morning' }).click();
  await page.getByRole('button', { name: /Duplicate group with 2 items/ }).click();
  await expect(page.getByTestId('editor-group')).toHaveCount(2);
  await expect(page.getByTestId('editor-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Move group up: Morning' }).first().click();
  await expect
    .poll(() => editorOrder(page))
    .toEqual(['Keynote', 'Tech check', 'Timer', 'Keynote', 'Tech check']);

  // Warning override on the item, with visible source and reset to inherited.
  await page.getByRole('button', { name: 'Edit Timer' }).click();
  const warning = page.getByTestId('item-warning');
  await expect(page.getByTestId('item-warning-source')).toHaveText('Show default');
  await warning.getByLabel('Type').selectOption('absolute');
  await warning.getByRole('button', { name: 'Override', exact: true }).click();
  await expect(page.getByTestId('item-warning-source')).toHaveText('Item override');
  await expect(page.getByTestId('item-warning-effective')).toHaveText(
    'Warning ≤ 05:00 · Critical ≤ 01:00',
  );
  await page.getByRole('button', { name: /Reset to inherited/ }).click();
  await expect(page.getByTestId('item-warning-source')).toHaveText('Show default');

  // Reload keeps the structure.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('editor-group')).toHaveCount(2);
  expect(await editorOrder(page)).toEqual([
    'Keynote',
    'Tech check',
    'Timer',
    'Keynote',
    'Tech check',
  ]);
  await expect(editorRow(page, 'Tech check').first()).toHaveAttribute('data-lifecycle', 'inactive');

  // Operator: the Quick Timer item is current; Next skips the inactive copy inside the group.
  await page.goto(operatorUrl);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  await expect(page.getByTestId('current-title')).toHaveText('Timer');
  await expect(page.getByTestId('next-title')).toHaveText('Keynote');
  await page.getByRole('button', { name: 'End + Next' }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Keynote');
  await expect(page.getByTestId('next-title')).toHaveText('End of queue');
});
