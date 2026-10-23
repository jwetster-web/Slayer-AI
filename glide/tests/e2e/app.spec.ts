import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SHOTS = process.env.GLIDE_SHOTS;
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;

async function shot(name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'glide-e2e-'));
  app = await electron.launch({
    args: [resolve('.'), '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, GLIDE_USER_DATA: userData, NODE_ENV: 'production' },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
});

test.afterAll(async () => {
  await app?.close();
});

test('first launch shows the setup wizard', async () => {
  await expect(page.getByText('Create your workspace')).toBeVisible();
  await expect(page.getByText('Explore with sample data')).toBeVisible();
  await shot('01-setup');
});

test('sample mode builds a labeled sample workspace and opens the dashboard', async () => {
  await page.getByRole('button', { name: 'Launch sample mode' }).click();
  await expect(page.getByText('Building your sample workspace')).toBeVisible();
  await expect(page.getByText(/Overview/).first()).toBeVisible({ timeout: 180000 });
  await expect(page.getByText('Sample data — not real orders').first()).toBeVisible();
  await expect(page.getByText('Total secured · net after cancellations')).toBeVisible();
  await shot('02-overview');
});

const pages: [string, RegExp, string][] = [
  ['Live Orders', /orders match/, '03-orders'],
  ['Order Timeline', /Live feed|Feed paused/, '04-timeline'],
  ['Members', /Stable Discord IDs/, '05-members'],
  ['Buying Profiles', /Checkout profiles linked/, '06-profiles'],
  ['Identity Review', /Review queue/, '07-identity'],
  ['Email Accounts', /read-only/, '08-accounts'],
  ['Shipping Tracker', /last verified/, '09-shipping'],
  ['Product Catalog', /never by fuzzy title/, '10-catalog'],
  ['Analytics', /Spending & Performance/, '11-analytics'],
  ['Cook Export Studio', /Share-ready graphics/, '12-studio'],
  ['Activity Logs', /Everything GLIDE did/, '13-logs'],
  ['Settings', /Branding/, '14-settings'],
];

for (const [nav, marker, file] of pages) {
  test(`navigates to ${nav}`, async () => {
    await page.getByRole('button', { name: new RegExp(`^${nav}`) }).first().click();
    await expect(page.getByText(marker).first()).toBeVisible();
    await shot(file);
  });
}

test('opens an order with its timeline and identity evidence', async () => {
  await page.getByRole('button', { name: 'Live Orders', exact: true }).click();
  await expect(page.getByText(/orders match/)).toBeVisible();
  await page.locator('main button.absolute').first().click();
  await expect(page.getByText('Activity timeline')).toBeVisible();
  await expect(page.getByText(/Source messages/)).toBeVisible();
  await shot('15-order-detail');
  await page.keyboard.press('Escape');
});

test('studio renders a live preview and the custom creator', async () => {
  await page.getByRole('button', { name: 'Cook Export Studio', exact: true }).click();
  await page.getByRole('combobox').first().selectOption('all');
  await expect(page.locator('svg text', { hasText: 'SAMPLE DATA' }).first()).toBeVisible();
  await shot('16-studio-galactic');
  await page.getByRole('button', { name: /Legendary Drop/ }).click();
  await shot('17-studio-legendary');
  await page.getByRole('button', { name: /Custom Creator/ }).click();
  await expect(page.getByText('Inspector')).toBeVisible();
  await shot('18-studio-custom');
});

test('global search drills into orders', async () => {
  await page.getByPlaceholder(/Search orders, members/).fill('Elite Trainer');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/orders match/)).toBeVisible();
  await expect
    .poll(async () => Number(((await page.getByText(/orders match/).textContent()) ?? '').match(/([\d,]+) orders match/)?.[1].replace(/,/g, '') ?? 0))
    .toBeGreaterThan(0);
  const narrowed = Number(((await page.getByText(/orders match/).textContent()) ?? '').match(/([\d,]+) orders match/)?.[1].replace(/,/g, ''));
  expect(narrowed).toBeLessThan(1000);
});

test('light theme toggles', async () => {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByLabel('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await shot('19-overview-light');
  await page.getByLabel('Toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
