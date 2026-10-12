// Headless driver for the Periodix frontend with a mocked /api.
//
// Usage: PW_DIR=<dir with node_modules/playwright-core> node drive.mjs <outDir> [--width 390] [--height 844] [--theme dark|light]
//                       [--role manager|admin|student] [--steps steps.mjs]
//
// Without --steps it loads the dashboard and saves <outDir>/01-loaded.png.
// A steps module exports `default async ({ page, shot, tap, activeNav })`.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// playwright-core is not a project dependency; load it from PW_DIR.
const { chromium } = createRequire(
    path.resolve(process.env.PW_DIR || '.') + '/',
)('playwright-core');

const args = process.argv.slice(2);
const OUT = args[0];
if (!OUT) {
    console.error('usage: node drive.mjs <outDir> [options]');
    process.exit(2);
}
const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
};
const width = Number(opt('width', 390));
const height = Number(opt('height', 844));
const theme = opt('theme', 'dark');
const role = opt('role', 'manager');
const stepsPath = opt('steps', null);
const baseUrl = process.env.PERIODIX_URL || 'http://localhost:5173/';

const user = {
    id: 'u1',
    username: 'tester',
    displayName: 'Test User',
    isUserManager: role === 'manager',
    isAdmin: role === 'admin',
};

const now = new Date().toISOString();
const emptyTimetable = {
    userId: 'u1',
    rangeStart: null,
    rangeEnd: null,
    payload: [],
    source: 'live',
};

// Unknown endpoints get `{}`. Never answer with "Invalid token": the frontend
// logs out on that text.
function mock(pathname) {
    if (pathname === '/api/timetable/classes')
        return { classes: [{ id: 1, name: '10a', longName: 'Klasse 10a' }] };
    if (pathname === '/api/timetable/holidays') return { data: [] };
    if (pathname.startsWith('/api/timetable/absences')) return { absences: [] };
    if (pathname.startsWith('/api/timetable/')) return emptyTimetable;
    if (pathname === '/api/notifications') return { notifications: [] };
    if (pathname === '/api/users/preferences')
        return { onboardingCompleted: true, hasSeenOnboarding: true };
    if (pathname === '/api/resources/index')
        return {
            week: { key: 'mock', start: now, end: now },
            lastUpdated: now,
            coverage: { total: 1, withData: 1, classes: [] },
            teachers: [],
            rooms: [],
            job: null,
        };
    return {};
}

const browser = await chromium.launch({
    // Unset: Playwright's own browser (`npx playwright-core install chromium`).
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 640,
    hasTouch: width < 640,
    // The app's service worker would bypass page.route and hit the real backend.
    serviceWorkers: 'block',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

// Matches both the relative /api proxy and direct calls to API_BASE (:3001).
await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mock(pathname)),
    });
});
await page.addInitScript(
    ([u, t]) => {
        localStorage.setItem('token', 'fake');
        localStorage.setItem('user', JSON.stringify(u));
        localStorage.setItem('theme', t);
    },
    [user, theme],
);

let n = 0;
const shot = async (name) => {
    await page.waitForTimeout(400); // let the 200-300ms transitions finish
    const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file });
    console.log('screenshot', file);
};
// Click the visible copy of a button (desktop and mobile variants share labels).
const tap = (label) =>
    page.locator(`button[aria-label="${label}"]:visible`).click();
// Which view buttons are highlighted (the active style adds a glow shadow).
const activeNav = () =>
    page.evaluate(() => {
        const labels = [
            'Open search',
            'View my class timetable',
            'Load my timetable',
            'Open Resource Manager',
        ];
        return Object.fromEntries(
            labels.map((l) => {
                const b = [
                    ...document.querySelectorAll(`button[aria-label="${l}"]`),
                ].find((el) => el.offsetParent !== null);
                return [
                    l,
                    !b ? 'hidden' : b.className.includes('shadow-[') ? 'ACTIVE' : '-',
                ];
            }),
        );
    });

await page.goto(baseUrl);
await page.waitForSelector('button[aria-label="Open menu"]', { timeout: 20000 });
await page.waitForTimeout(1000);

if (stepsPath) {
    const steps = await import(pathToFileURL(path.resolve(stepsPath)).href);
    await steps.default({ page, shot, tap, activeNav });
} else {
    await shot('loaded');
}

const real = errors.filter((e) => !e.includes('favicon'));
console.log(real.length ? 'CONSOLE ERRORS:\n' + real.join('\n') : 'no console errors');
await browser.close();
