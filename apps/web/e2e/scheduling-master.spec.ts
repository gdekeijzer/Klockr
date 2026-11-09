import { expect, test, type Locator, type Page } from '@playwright/test';
import { ApiServer } from './server';

const TZ = 'Europe/Amsterdam';
test.use({ timezoneId: TZ });

const server = new ApiServer();
test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

const MIN = 60_000;
/** HH:MM of an instant in the Show timezone. */
const hhmm = (epoch: number) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(epoch);

async function createShow(page: Page, duration = '10:00') {
  await page.goto('/');
  await page.getByLabel('Duration (mm:ss)').fill(duration);
  await page.getByRole('button', { name: 'Create Quick Timer' }).click();
  await expect(page).toHaveURL(/\/show\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
  return { operatorUrl: page.url(), masterUrl: `${page.url()}/master` };
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');
}

const row = (page: Page, title: string): Locator =>
  page.locator(`[data-testid="editor-row"][data-title="${title}"]`);
const num = async (locator: Locator, attribute: string) =>
  Number(await locator.getAttribute(attribute));

async function select(page: Page, title: string) {
  await page.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await expect(page.getByTestId('item-inspector')).toBeVisible();
}

async function rename(page: Page, from: string, to: string, duration?: string) {
  await select(page, from);
  const inspector = page.getByTestId('item-inspector');
  await inspector.getByLabel('Title', { exact: true }).fill(to);
  if (duration) await inspector.getByLabel('Timer duration (empty = no timer)').fill(duration);
  await inspector.getByRole('button', { name: 'Save item' }).click();
}

async function add(
  page: Page,
  preset: 'Speaker' | 'Break' | 'Timer',
  title: string,
  duration: string,
) {
  const count = await page.getByTestId('editor-row').count();
  await page.getByRole('button', { name: `Add ${preset}`, exact: true }).click();
  await expect(page.getByTestId('editor-row')).toHaveCount(count + 1);
  const inspector = page.getByTestId('item-inspector');
  await inspector.getByLabel('Title', { exact: true }).fill(title);
  await inspector.getByLabel('Timer duration (empty = no timer)').fill(duration);
  await inspector.getByRole('button', { name: 'Save item' }).click();
  await expect(row(page, title)).toBeVisible();
}

async function plan(page: Page, title: string, start: number, anchor = false) {
  await select(page, title);
  const section = page.getByTestId('schedule-section');
  await section.getByLabel('Planned start').fill(hhmm(start));
  if (anchor) await section.getByLabel(/Fixed anchor/).check();
  await section.getByRole('button', { name: 'Save schedule' }).click();
  await expect(row(page, title)).toHaveAttribute('data-planned-start', String(start));
}

async function setQueueTiming(page: Page, mode: 'strict' | 'sliding') {
  const close = page.getByTestId('item-inspector').getByRole('button', { name: 'Close' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('combobox', { name: 'Queue timing mode' }).selectOption(mode);
  await expect(page.getByTestId('timing-mode')).toHaveAttribute('data-mode', mode);
}

test('M3: Planned / Projected / Actual, Sliding vs Strict, fixed anchor recovery, lock + Emergency Override, audit, reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // 1. Show.
  const { operatorUrl, masterUrl } = await createShow(page);

  // 2. Rundown: Opening, Speaker A, Speaker B, Lunch (fixed anchor).
  await open(page, masterUrl);
  await rename(page, 'Timer', 'Opening');
  await add(page, 'Speaker', 'Speaker A', '20:00');
  await add(page, 'Speaker', 'Speaker B', '20:00');
  await add(page, 'Break', 'Lunch', '45:00');

  // 3. Planned times: Opening started "on paper" 20 min ago; Lunch FIXED at Opening + 50 min.
  const t0 = Math.floor((Date.now() - 20 * MIN) / MIN) * MIN;
  await plan(page, 'Opening', t0);
  await plan(page, 'Lunch', t0 + 50 * MIN, true);
  await expect(row(page, 'Speaker A')).toHaveAttribute('data-planned-start', String(t0 + 10 * MIN));
  await expect(row(page, 'Speaker B')).toHaveAttribute('data-planned-start', String(t0 + 30 * MIN));
  await expect(row(page, 'Lunch')).toHaveAttribute('data-anchor', 'true');
  const planned = {
    a: t0 + 10 * MIN,
    b: t0 + 30 * MIN,
    lunch: t0 + 50 * MIN,
  };

  // 4. Queue -> Sliding (override of the Show default).
  await setQueueTiming(page, 'sliding');

  // 5. Speaker A starts ~10 minutes later than planned.
  await open(page, operatorUrl);
  await page.getByRole('button', { name: 'End + Next' }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Speaker A');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('timer-status')).toHaveText('RUNNING');

  // 6. BEHIND (above 5 min it is the severe/red variant).
  const offset = page.getByTestId('show-offset');
  await expect(offset).toHaveAttribute('data-status', /behind|severe/);
  await expect(offset).toContainText('BEHIND');
  const offsetBefore = await num(offset, 'data-offset');
  expect(offsetBefore).toBeGreaterThan(9 * MIN);
  await expect(page.getByTestId('current-actual-start')).not.toHaveText('—');
  await page.screenshot({ path: 'test-results/m3-operator-view.png' });

  await open(page, masterUrl);
  const projectedB = await num(row(page, 'Speaker B'), 'data-projected-start');
  expect(projectedB).toBeGreaterThan(planned.b + 9 * MIN);

  // 7. +30 s on the running timer.
  await open(page, operatorUrl);
  await page.getByRole('button', { name: 'Add 30 seconds' }).click();
  await expect(page.getByTestId('adjustment')).toHaveText('+00:30');
  await expect
    .poll(() => num(page.getByTestId('show-offset'), 'data-offset'))
    .toBe(offsetBefore + 30_000);

  // 8. Projected times shift immediately; Planned stays.
  await open(page, masterUrl);
  await expect(row(page, 'Speaker B')).toHaveAttribute(
    'data-projected-start',
    String(projectedB + 30_000),
  );
  await expect(row(page, 'Speaker B')).toHaveAttribute('data-planned-start', String(planned.b));

  // 9. Recovery to the Lunch anchor (distinct from the Show offset); Lunch stays FIXED at its time.
  const anchor = page.getByTestId('next-anchor');
  await expect(anchor).toContainText('Lunch');
  await expect(anchor).toContainText(hhmm(planned.lunch));
  await expect(anchor).toContainText('TO RECOVER');
  await expect(row(page, 'Lunch')).toHaveAttribute('data-planned-start', String(planned.lunch));
  expect(await num(anchor, 'data-recovery')).toBe(projectedB + 30_000 + 20 * MIN - planned.lunch);
  await page.screenshot({ path: 'test-results/m3-master-view.png' });

  // 10. Switch the Queue to Strict.
  await setQueueTiming(page, 'strict');

  // 11. Planned times are intact.
  await expect(row(page, 'Speaker A')).toHaveAttribute('data-planned-start', String(planned.a));
  await expect(row(page, 'Speaker B')).toHaveAttribute('data-planned-start', String(planned.b));
  await expect(row(page, 'Lunch')).toHaveAttribute('data-planned-start', String(planned.lunch));

  // 12. Lock Speaker B.
  await select(page, 'Speaker B');
  await page.getByRole('button', { name: 'Lock item' }).click();
  await expect(row(page, 'Speaker B')).toHaveAttribute('data-locked', 'true');
  await expect(row(page, 'Speaker B')).toContainText('LOCKED');

  // 13. Editing the locked item is blocked.
  const inspector = page.getByTestId('item-inspector');
  await inspector.getByLabel('Title', { exact: true }).fill('Speaker B (new)');
  await inspector.getByRole('button', { name: 'Save item' }).click();
  const notice = page.getByTestId('locked-notice');
  await expect(notice).toContainText('LOCKED');
  await expect(row(page, 'Speaker B')).toBeVisible();

  // 14. Emergency Override (explicit, with reason).
  await notice.getByRole('button', { name: 'Emergency Override…' }).click();
  await notice.getByLabel('Override reason').fill('Speaker changed on stage');
  await notice.getByRole('button', { name: 'Confirm Emergency Override' }).click();
  await expect(row(page, 'Speaker B (new)')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(row(page, 'Speaker B (new)')).toHaveAttribute('data-locked', 'true');

  // 15. Audit trail.
  const audit = page.getByTestId('audit-event');
  await expect(
    page.locator('[data-testid="audit-event"][data-action="lock.override"]'),
  ).toContainText('Speaker changed on stage');
  await expect(page.locator('[data-testid="audit-event"][data-action="lock.set"]')).toHaveCount(1);
  await expect(
    page.locator('[data-testid="audit-event"][data-action="timing_mode.update"]'),
  ).toHaveCount(2);
  expect(await audit.count()).toBeGreaterThanOrEqual(6);

  // 16. Reload.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toHaveText('LIVE');

  // 17. Planning, locks and actuals are intact.
  await expect(row(page, 'Speaker A')).toHaveAttribute('data-planned-start', String(planned.a));
  await expect(row(page, 'Lunch')).toHaveAttribute('data-anchor', 'true');
  await expect(row(page, 'Speaker B (new)')).toHaveAttribute('data-locked', 'true');
  await expect(page.getByTestId('timing-mode')).toHaveAttribute('data-mode', 'strict');
  await select(page, 'Speaker A');
  await expect(page.getByTestId('ppa-actual')).not.toHaveAttribute('data-start', '');
  await select(page, 'Opening');
  await expect(page.getByTestId('ppa-actual')).not.toHaveAttribute('data-end', '');
});

test('soft scheduled start: SHOULD HAVE STARTED, never auto-started, gone once current', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { operatorUrl, masterUrl } = await createShow(page, '30:00');
  await open(page, masterUrl);
  await rename(page, 'Timer', 'Panel');
  await add(page, 'Speaker', 'Keynote', '30:00');
  await select(page, 'Keynote');
  await page.getByTestId('item-inspector').getByLabel('Start mode').selectOption('scheduled');
  await page.getByTestId('item-inspector').getByRole('button', { name: 'Save item' }).click();
  await expect(row(page, 'Keynote')).toContainText('SCHED');
  const due = Math.floor((Date.now() - 2 * MIN) / MIN) * MIN;
  await plan(page, 'Keynote', due);
  await expect(row(page, 'Keynote').getByTestId('should-have-started')).toContainText(
    'SHOULD HAVE STARTED',
  );

  await open(page, operatorUrl);
  await expect(page.getByTestId('next-title')).toHaveText('Keynote');
  await expect(page.getByTestId('next-should-have-started')).toContainText(
    /SHOULD HAVE STARTED \d\d:\d\d AGO/,
  );
  // Never auto-started.
  await expect(page.getByTestId('current-title')).toHaveText('Panel');

  await page.getByRole('button', { name: 'Make current: Keynote' }).click();
  await expect(page.getByTestId('current-title')).toHaveText('Keynote');
  await expect(page.getByTestId('timer-status')).toHaveText('READY');
  await open(page, masterUrl);
  await expect(row(page, 'Keynote').getByTestId('should-have-started')).toHaveCount(0);
});
