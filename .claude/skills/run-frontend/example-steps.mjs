// Example steps: the mobile menu and view switching (home / class / resources).
export default async ({ page, shot, tap, activeNav }) => {
    await shot('home');
    console.log('home', await activeNav());

    await page.click('button[aria-label="Open menu"]');
    await shot('menu-open');
    await page.mouse.click(100, 500); // outside tap closes it
    await shot('menu-closed');

    await tap('View my class timetable');
    console.log('class', await activeNav());
    await tap('Open Resource Manager');
    await shot('resource-manager');
    console.log('resource manager', await activeNav());
    await tap('Load my timetable');
    console.log('home again', await activeNav());
};
