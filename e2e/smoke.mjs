// E2E smoke test: serves dist/, drives the scene in headless Chromium,
// verifies rendering + grab wiring, and captures screenshots.
// Run: npm run build && node e2e/smoke.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const shots = fileURLToPath(new URL('./shots', import.meta.url));
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path === '/') path = '/index.html';
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__app, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  check('app boots without page errors', errors.length === 0, errors.join('; '));

  await mkdir(shots, { recursive: true });
  await page.evaluate(() => window.__app.ui.setLocked(true));
  await page.waitForTimeout(300);
  const shot1 = await page.screenshot({ path: join(shots, '1-scene.png') });
  check('scene renders (non-trivial frame)', shot1.length > 30000, `${shot1.length} bytes`);

  // Place the box on the floor in front of the player, then let the app's
  // physics loop run: Rapier's query pipeline (broad phase) only refreshes on
  // world.step(), so a raycast in the same synchronous task as setTranslation
  // would still see the old position.
  await page.evaluate(() => {
    const app = window.__app;
    let boxBody = null;
    for (const pv of app['propVisuals']) if (pv.handle.spec.name === 'box') boxBody = pv.handle.body;
    const eye = app.player.eyePos();
    boxBody.setTranslation({ x: eye.x, y: 0.5, z: eye.z + 1.6 }, true);
    boxBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    boxBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });
  await page.waitForTimeout(400);

  // Aim the camera at the box's current position and grab synchronously
  // through the real code path (no frame can interleave within one evaluate).
  const grabInfo = await page.evaluate(() => {
    const app = window.__app;
    const grab = app.grab;
    let boxBody = null;
    for (const pv of app['propVisuals']) if (pv.handle.spec.name === 'box') boxBody = pv.handle.body;
    const eye = app.player.eyePos();
    const bp = boxBody.translation();
    app.camera.position.set(eye.x, eye.y, eye.z);
    app.camera.lookAt(bp.x, bp.y, bp.z);
    app.camera.updateMatrixWorld(true);
    const hovered = !!grab.hoveredProp(app.camera);
    const ok = grab.tryGrab(app.camera);
    return { ok, holding: grab.isHolding, hovered };
  });
  check('crosshair hover detects the box', grabInfo.hovered);
  check('tryGrab succeeds on the box', grabInfo.ok && grabInfo.holding);

  // Walk forward for 1.2s and confirm the box is carried along.
  const carry = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const app = window.__app;
        let boxBody = null;
        for (const pv of app['propVisuals']) if (pv.handle.spec.name === 'box') boxBody = pv.handle.body;
        const z0 = boxBody.translation().z;
        app.keys.add('KeyW');
        setTimeout(() => {
          app.keys.delete('KeyW');
          const z1 = boxBody.translation().z;
          resolve({
            dz: z1 - z0,
            posError: app.grab.diag?.posError ?? -1,
            uiProp: document.getElementById('kv-prop')?.textContent ?? '',
            uiErr: document.getElementById('kv-posErr')?.textContent ?? '',
          });
        }, 1200);
      }),
  );
  check('held box is carried while walking', carry.dz > 1.0, `dz=${carry.dz.toFixed(2)}m`);
  check('follow error stays small in free space', carry.posError >= 0 && carry.posError < 0.35, `${(carry.posError * 100).toFixed(1)}cm`);
  check('UI shows held prop and error readout', carry.uiProp.includes('木箱') && carry.uiErr.includes('cm'), `${carry.uiProp} / ${carry.uiErr}`);

  await page.screenshot({ path: join(shots, '2-holding.png') });

  // Push the box into the slide wall: error must grow, no penetration, and
  // the UI must show the divergence (no silent teleport).
  const wall = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const app = window.__app;
        const player = app.player;
        // Face +z toward the slide wall at z=5 and walk into it.
        player['curYaw'] = Math.PI;
        player['curPitch'] = 0;
        app.keys.add('KeyW');
        app.keys.add('ShiftLeft');
        setTimeout(() => {
          app.keys.delete('KeyW');
          app.keys.delete('ShiftLeft');
          const d = app.grab.diag;
          resolve({
            posError: d?.posError ?? -1,
            minContact: app.grab.minContactDist,
            uiErr: document.getElementById('kv-posErr')?.textContent ?? '',
            boxZ: (() => {
              for (const pv of app['propVisuals']) if (pv.handle.spec.name === 'box') return pv.handle.body.translation().z;
              return NaN;
            })(),
          });
        }, 2200);
      }),
  );
  check('wall blocks the prop, follow error grows', wall.posError > 0.25, `err=${(wall.posError * 100).toFixed(1)}cm`);
  check('no deep penetration against the wall', wall.minContact > -0.004, `minDist=${(wall.minContact * 1000).toFixed(1)}mm`);
  check('prop stays on the near side of the wall', wall.boxZ < 4.8, `z=${wall.boxZ.toFixed(2)}`);
  await page.screenshot({ path: join(shots, '3-wall-block.png') });

  const rel = await page.evaluate(() => {
    const app = window.__app;
    app.grab.release();
    return { holding: app.grab.isHolding };
  });
  check('release works', !rel.holding);

  check('no page errors during interaction', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
