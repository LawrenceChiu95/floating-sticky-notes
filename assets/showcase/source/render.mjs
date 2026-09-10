import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = process.env.SHOWCASE_NODE_MODULES;
const { chromium } = require(bundle ? path.join(bundle, 'playwright') : 'playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const seen = process.argv.includes('--seen');
const cards = path.join(here, seen ? 'seen.html' : 'cards.html');
const outputs = seen ? [
  { card: 'hero', dir: 'seen', name: 'hero.png', width: 1600, height: 1000 },
  { card: 'cover', dir: 'seen', name: 'cover.png', width: 1080, height: 1440 },
  { card: 'philosophy', dir: 'seen', name: 'philosophy.png', width: 1080, height: 1440 },
  { card: 'cover', dir: 'xhs-b', name: '01-cover.png', width: 1080, height: 1440 },
  { card: 'philosophy', dir: 'xhs-b', name: '02-seen.png', width: 1080, height: 1440 },
  { card: '02', source: 'cards.html', dir: 'xhs-b', name: '03-space.png', width: 1080, height: 1440 },
  { card: '03', source: 'cards.html', dir: 'xhs-b', name: '04-daily.png', width: 1080, height: 1440 },
  { card: '04', source: 'cards.html', dir: 'xhs-b', name: '05-reference.png', width: 1080, height: 1440 },
  { card: '06', source: 'cards.html', dir: 'xhs-b', name: '06-download.png', width: 1080, height: 1440 },
] : [
  { card: 'hero', dir: 'github', name: 'hero.png', width: 1600, height: 1000 },
  { card: 'states', dir: 'github', name: 'states.png', width: 1600, height: 1000 },
  { card: 'features', dir: 'github', name: 'features.png', width: 1600, height: 1000 },
  { card: '01', dir: 'xhs', name: '01-cover.png', width: 1080, height: 1440 },
  { card: '02', dir: 'xhs', name: '02-space.png', width: 1080, height: 1440 },
  { card: '03', dir: 'xhs', name: '03-daily.png', width: 1080, height: 1440 },
  { card: '04', dir: 'xhs', name: '04-reference.png', width: 1080, height: 1440 },
  { card: '05', dir: 'xhs', name: '05-local.png', width: 1080, height: 1440 },
  { card: '06', dir: 'xhs', name: '06-download.png', width: 1080, height: 1440 },
];

const browserPath = process.env.SHOWCASE_CHROME;
const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const checks = [];

try {
  for (const item of outputs) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    const url = `${pathToFileURL(item.source ? path.join(here, item.source) : cards)}?card=${encodeURIComponent(item.card)}${seen ? '&direction=seen' : ''}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const images = [...document.images];
      await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
    });
    const state = await page.evaluate(({ width, height }) => {
      const frame = document.querySelector('.frame');
      const missing = [...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.getAttribute('src'));
      const overflow = document.documentElement.scrollWidth > width + 2 || document.documentElement.scrollHeight > height + 2;
      const rect = frame?.getBoundingClientRect();
      return { missing, overflow, frame: rect && { width: rect.width, height: rect.height }, imageCount: document.images.length };
    }, { width: item.width, height: item.height });
    if (state.overflow) throw new Error(`${item.card}: document overflow at ${item.width}x${item.height}`);
    if (!state.frame || Math.round(state.frame.width) !== item.width || Math.round(state.frame.height) !== item.height) {
      throw new Error(`${item.card}: frame size ${JSON.stringify(state.frame)} did not match ${item.width}x${item.height}`);
    }
    if (state.missing.length) throw new Error(`${item.card}: missing UI assets: ${[...new Set(state.missing)].join(', ')}`);
    if (consoleErrors.length) throw new Error(`${item.card}: browser errors: ${consoleErrors.join(' | ')}`);
    const output = path.join(root, item.dir, item.name);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, animations: 'disabled' });
    const size = (await fs.stat(output)).size;
    checks.push({card:item.card,width:item.width,height:item.height,bytes:size,missingImages:state.missing,overflow:state.overflow,consoleErrors});
    console.log(`${item.card.padEnd(8)} ${item.width}x${item.height} ${String(size).padStart(8)} bytes -> ${path.relative(process.cwd(), output)}`);
    await page.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(here,seen ? 'render-checks-seen.json' : 'render-checks.json'), JSON.stringify(checks,null,2)+'\n');
