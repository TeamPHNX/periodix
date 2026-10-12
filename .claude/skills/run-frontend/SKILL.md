---
name: run-frontend
description: Launch the Periodix frontend with a mocked API and drive it in headless Chromium (logged in as a fake user, any viewport incl. phone width) to screenshot and check UI changes without the backend, database or Untis.
---

# Run the Periodix frontend (mocked API)

The real backend needs Postgres and Untis credentials. For UI work, run only
the Vite dev server and let the driver answer every `/api` call with fixtures.
The data is fake (one class `10a`, empty timetables, empty Resource Manager),
so use this for layout and interaction checks, not data correctness.

## 1. Start the dev server

```bash
cd periodix-frontend
npx vite --port "$PORT" --strictPort > /tmp/vite.log 2>&1 &
timeout 30 bash -c "until curl -sf http://localhost:$PORT >/dev/null; do sleep 1; done"
```

Pick any free `$PORT`. The driver defaults to `http://localhost:5173/`; set
`PERIODIX_URL` for anything else.

Stop it afterwards: `lsof -ti:"$PORT" -sTCP:LISTEN | xargs -r kill`

## 2. Install the driver dependency (once)

`playwright-core` is not a project dependency. Install it in a directory
outside the repo:

```bash
mkdir -p "$PW_DIR" && cd "$PW_DIR" && npm init -y >/dev/null && npm i playwright-core
```

Get a browser one of two ways: run `npx playwright-core install chromium` in
`$PW_DIR`, or point `CHROMIUM_PATH` at a Chromium that's already installed.

## 3. Drive it

Run [drive.mjs](drive.mjs) with `PW_DIR` pointing at that install:

```bash
PERIODIX_URL="http://localhost:$PORT/" PW_DIR="$PW_DIR" \
  node .claude/skills/run-frontend/drive.mjs "$OUT_DIR" \
  --width 390 --theme dark --role manager --steps .claude/skills/run-frontend/example-steps.mjs
```

- `--role manager|admin|student`: user managers and admins see the Resource Manager button.
- `--width`: try 390 (typical phone), 360 and 320 (smallest). The app's mobile layout applies below 640px (Tailwind `sm`).
- `--steps file.mjs`: exports `default async ({ page, shot, tap, activeNav })`.
  - `tap(label)` clicks the visible button with that `aria-label`. Desktop and mobile copies share labels.
  - `activeNav()` reports which view buttons (search / class / home / resources) are highlighted.

Then open the screenshots and look at them. The driver ends by printing any
browser console errors. Treat errors as a failure.

## Gotchas

- **Service worker:** the app registers one. Requests it handles skip
  `page.route` and hit whatever is listening on `:3001`, and a real backend
  there answers the fake token with `Invalid token`. The driver blocks service
  workers.
- **Auto-logout:** any response containing `Invalid token` logs the user out
  (`src/api.ts`), and the run ends on the login screen. If you see the login
  page, a request escaped the mock.
- **API_BASE:** some calls go straight to `http://localhost:3001/api/...`
  instead of the Vite proxy. The `**/api/**` route pattern covers both.
- **New endpoints:** endpoints without a fixture get `{}`. Add a case to
  `mock()` in `drive.mjs` if a view needs real-shaped data.
- **Hidden menus:** Playwright counts `opacity-0` dropdowns as "visible".
  Judge open/closed from the screenshot, not `isVisible`.
