// Deterministically capture the unchanged production renderer's real motion.
// Fictional fixtures and mocked bridge geometry only; never launches Electron or reads userData.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../../..');
const bundle = process.env.SHOWCASE_NODE_MODULES;
const loadTool = (name) => require(bundle ? path.join(bundle, name) : name);
const { chromium } = loadTool('playwright');
const sharp = loadTool('sharp');
const fixtures = require('./fixtures.json');
const motionRoot = path.join(__dirname, 'motion/assets');
const collapseDir = path.join(motionRoot, 'collapse-frames');
const dockDir = path.join(motionRoot, 'dock-frames');
const manifestPath = path.join(motionRoot, 'motion-capture.json');
const evidenceRoot = process.env.SHOWCASE_EVIDENCE_DIR || path.join(require('node:os').tmpdir(), 'sticky-motion-capture');
const sampleTimes = Array.from({ length: 19 }, (_, index) => Number((index * 300 / 18).toFixed(3)));

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function makeNote() {
  const fixture = fixtures.find((entry) => entry.filename === 'daily.png');
  const { filename, width, height, tab, collapsed, ...record } = fixture;
  return {
    id: 'showcase-fictional',
    name: '',
    content: '',
    checklist: [],
    images: [],
    color: '#FFF3B0',
    opacity: 0.94,
    bounds: { x: 0, y: 0, width, height },
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...record
  };
}

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function installBridge(page, note, mode) {
  if (mode === 'collapse') {
    await page.exposeFunction('__captureSetCollapsed', async () => true);
  } else {
    await page.exposeFunction('__captureSetCollapsed', async (value) => {
      if (value) await page.setViewportSize({ width: 360, height: 40 });
      return true;
    });
    await page.exposeFunction('__captureDockReady', async () => {
      await page.setViewportSize({ width: 408, height: 40 });
    });
  }
  await page.addInitScript(({ note: fixture, mode: captureMode }) => {
    window.__captureEvents = [];
    window.__dockAppliedListener = null;
    if (captureMode === 'dock') {
      Object.defineProperty(window, 'screenX', { configurable: true, get: () => 0 });
      Object.defineProperty(window, 'screenY', { configurable: true, get: () => 0 });
      const originalAnimate = Element.prototype.animate;
      Element.prototype.animate = function captureActualDockAnimation(keyframes, options) {
        const animation = originalAnimate.call(this, keyframes, options);
        if (this.classList?.contains('dock-shrink-stub')) {
          animation.pause();
          animation.currentTime = 0;
          window.__dockAnimation = animation;
          window.__captureEvents.push({ type: 'dock-animation-created', options });
        }
        return animation;
      };
    }
    window.stickyNotes = new Proxy({
      platform: 'darwin',
      getInitialDockSide: () => null,
      getCurrentNote: async () => fixture,
      getAppCopy: async () => ({ noteContentPlaceholder: '可以在这里随便记点什么', checklistItemPlaceholder: '待办事项' }),
      onDockApplied: (listener) => { window.__dockAppliedListener = listener; return () => {}; },
      onDockPreview: () => () => {},
      setCollapsed: (value) => window.__captureSetCollapsed(value),
      dockShrinkReady: (transitionId) => {
        window.__captureEvents.push({ type: 'dock-shrink-ready', transitionId });
        void window.__captureDockReady();
      },
      dockShrinkUnionSized: (transitionId) => window.__captureEvents.push({ type: 'dock-shrink-union-sized', transitionId }),
      dockShrinkFinished: (transitionId) => window.__captureEvents.push({ type: 'dock-shrink-finished', transitionId }),
      updateContent: async (content) => ({ ...fixture, content }),
      updateChecklist: async (checklist) => ({ ...fixture, checklist }),
      updateName: async (name) => ({ ...fixture, name })
    }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve(undefined) });
  }, { note, mode });
}

async function inspectPng(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let nonTransparentPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      nonTransparentPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!nonTransparentPixels) throw new Error(`Blank frame rejected: ${file}`);
  return {
    width: info.width,
    height: info.height,
    nonTransparentPixels,
    alphaBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  };
}

async function captureFrame(page, directory, index, timestampMs, domGeometry) {
  const filename = `frame-${String(index).padStart(3, '0')}.png`;
  const file = path.join(directory, filename);
  await page.screenshot({ path: file, omitBackground: true });
  const pixels = await inspectPng(file);
  return { index, timestampMs, filename, ...pixels, domGeometry };
}

async function captureCollapse(browser, origin, note) {
  const page = await browser.newPage({ viewport: { width: 360, height: 310 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await installBridge(page, note, 'collapse');
  await page.clock.install({ time: new Date('2026-09-10T00:00:00.000Z') });
  await page.goto(`${origin}/out/renderer/index.html`);
  await page.waitForSelector('.note-shell');
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(new Date('2026-09-10T00:00:01.000Z'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  await page.getByRole('button', { name: '收起便签', exact: true }).click();
  await page.clock.runFor(34);
  const didStart = await page.evaluate(() => document.querySelector('.note-shell')?.classList.contains('note-shell--collapsed'));
  if (!didStart) throw new Error('Collapse class did not start after two animation frames');
  const animationCount = await page.evaluate(() => document.querySelector('.note-shell')?.getAnimations({ subtree: true }).length ?? 0);
  if (!animationCount) throw new Error('No real CSS transitions were created for collapse');

  const frames = [];
  for (let index = 0; index < sampleTimes.length - 1; index += 1) {
    const timestampMs = sampleTimes[index];
    const domGeometry = await page.evaluate((time) => {
      const shell = document.querySelector('.note-shell');
      const animations = shell?.getAnimations({ subtree: true }) ?? [];
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = time;
      }
      const rect = shell.getBoundingClientRect();
      return {
        shell: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        animationCount: animations.length,
        transitioning: shell.classList.contains('note-shell--collapse-transitioning')
      };
    }, timestampMs);
    frames.push(await captureFrame(page, collapseDir, index, timestampMs, domGeometry));
  }

  await page.evaluate(() => {
    const shell = document.querySelector('.note-shell');
    for (const animation of shell?.getAnimations({ subtree: true }) ?? []) {
      const endTime = animation.effect?.getComputedTiming().endTime;
      if (typeof endTime === 'number') animation.currentTime = endTime;
    }
    shell?.dispatchEvent(new TransitionEvent('transitionend', { bubbles: true, propertyName: 'height' }));
  });
  await page.clock.runFor(34);
  const terminalGeometry = await page.evaluate(() => {
    const shell = document.querySelector('.note-shell');
    const rect = shell.getBoundingClientRect();
    return {
      shell: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      animationCount: shell.getAnimations({ subtree: true }).length,
      transitioning: shell.classList.contains('note-shell--collapse-transitioning'),
      contentMounted: Boolean(document.querySelector('.note-content'))
    };
  });
  frames.push(await captureFrame(page, collapseDir, 18, 300, terminalGeometry));
  if (errors.length) throw new Error(`Collapse page errors: ${errors.join(' | ')}`);
  await page.close();
  return { status: 'success', canvas: { width: 720, height: 620 }, durationMs: 300, frameCount: frames.length, timingControl: 'CDP playback rate 0 + Web Animations currentTime; Playwright clock paused JS fallback timers; terminal height transitionend dispatched after seeking final styles', frames };
}

async function captureDock(browser, origin, note) {
  const page = await browser.newPage({ viewport: { width: 360, height: 310 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await installBridge(page, note, 'dock');
  await page.goto(`${origin}/out/renderer/index.html`);
  await page.waitForSelector('.note-shell');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: '收起便签', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.note-shell')?.classList.contains('note-shell--collapsed'));
  await page.waitForTimeout(320);
  await page.waitForFunction(() => innerWidth === 360 && innerHeight === 40);
  await page.evaluate(() => window.__dockAppliedListener?.({
    dock: { side: 'right' },
    transitionId: 1,
    shrinkFromStrip: {
      unionWidth: 408,
      unionHeight: 40,
      strip: { x: 0, y: 0, width: 360, height: 40 },
      bookmark: { x: 312, y: 0, width: 96, height: 32 }
    }
  }));
  await page.waitForFunction(() => innerWidth === 408 && innerHeight === 40 && window.__dockAnimation);
  await page.waitForFunction(() => window.__captureEvents.some((event) => event.type === 'dock-shrink-union-sized'));

  const frames = [];
  for (let index = 0; index < sampleTimes.length - 1; index += 1) {
    const timestampMs = sampleTimes[index];
    const domGeometry = await page.evaluate((time) => {
      const animation = window.__dockAnimation;
      animation.pause();
      animation.currentTime = time;
      const stub = document.querySelector('.dock-shrink-stub:not(.dock-shrink-stub--landing)');
      const rect = stub.getBoundingClientRect();
      const style = getComputedStyle(stub);
      return {
        stub: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        transform: style.transform,
        clipPath: style.clipPath,
        playState: animation.playState
      };
    }, timestampMs);
    frames.push(await captureFrame(page, dockDir, index, timestampMs, domGeometry));
  }

  await page.evaluate(() => {
    const animation = window.__dockAnimation;
    animation.currentTime = 300;
    animation.finish();
  });
  await page.waitForFunction(() => window.__captureEvents.some((event) => event.type === 'dock-shrink-finished'));
  const terminalGeometry = await page.evaluate(() => {
    const stub = document.querySelector('.dock-shrink-stub:not(.dock-shrink-stub--landing)');
    const rect = stub.getBoundingClientRect();
    return {
      stub: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      transform: getComputedStyle(stub).transform,
      clipPath: getComputedStyle(stub).clipPath,
      events: window.__captureEvents
    };
  });
  frames.push(await captureFrame(page, dockDir, 18, 300, terminalGeometry));
  if (errors.length) throw new Error(`Dock page errors: ${errors.join(' | ')}`);
  await page.close();
  return { status: 'success', canvas: { width: 816, height: 80 }, durationMs: 300, frameCount: frames.length, timingControl: 'Element.prototype.animate wrapper pauses the actual dock-shrink-stub WAAPI animation at creation; currentTime seeks source samples; finish() runs the renderer terminal handoff', frames };
}

async function makeContactSheet(sequence, directory, output, tileWidth) {
  const indices = [0, 4, 9, 14, 18];
  const tiles = [];
  let tileHeight = 0;
  for (const index of indices) {
    const input = path.join(directory, sequence.frames[index].filename);
    const { data, info } = await sharp(input).resize({ width: tileWidth }).png().toBuffer({ resolveWithObject: true });
    tileHeight = info.height;
    tiles.push(data);
  }
  await sharp({ create: { width: tileWidth * tiles.length, height: tileHeight, channels: 4, background: { r: 238, g: 238, b: 238, alpha: 1 } } })
    .composite(tiles.map((input, index) => ({ input, left: index * tileWidth, top: 0 })))
    .png()
    .toFile(output);
}

async function main() {
  resetDirectory(collapseDir);
  resetDirectory(dockDir);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.SHOWCASE_CHROME ? { executablePath: process.env.SHOWCASE_CHROME } : {}) });
  const manifest = {
    source: 'Unmodified out/renderer built from version 0.1.21; fictional in-memory bridge fixture; renderer-only capture, not native OS recording',
    fixture: { name: '今日待办', color: '#FFF3B0', expandedViewportCssPx: { width: 360, height: 310 }, deviceScaleFactor: 2 },
    sampleTimesMs: sampleTimes
  };
  try {
    manifest.collapse = await captureCollapse(browser, origin, makeNote());
    manifest.dock = await captureDock(browser, origin, makeNote());
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await makeContactSheet(manifest.collapse, collapseDir, path.join(evidenceRoot, 'collapse-contact-sheet.png'), 240);
    await makeContactSheet(manifest.dock, dockDir, path.join(evidenceRoot, 'dock-contact-sheet.png'), 352);
    console.log(JSON.stringify({ manifest: manifestPath, collapse: manifest.collapse.frameCount, dock: manifest.dock.frameCount, evidenceRoot }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
