// Capture the unchanged production renderer using fictional in-memory data.
// This never starts the native application or touches a userData directory.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../../..');
const bundle = process.env.SHOWCASE_NODE_MODULES;
const loadTool = (name) => require(bundle ? path.join(bundle, name) : name);
const { chromium } = loadTool('playwright');
const sharp = loadTool('sharp');
const output = path.resolve(__dirname, '../ui');
const fixtures = require('./fixtures.json');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#eee9db"/><circle cx="925" cy="210" r="125" fill="#c98a51"/><path d="M0 540 Q280 140 600 550 T1200 380 V800 H0Z" fill="#a5ab8e"/><path d="M0 670 Q400 320 760 640 T1200 540 V800 H0Z" fill="#526652"/><path d="M0 770 Q250 540 580 750 T1200 660 V800 H0Z" fill="#2d463d"/><text x="75" y="125" font-family="Georgia,serif" font-size="66" fill="#293a32">A little room</text><text x="80" y="182" font-family="Georgia,serif" font-size="40" fill="#293a32">to breathe.</text><text x="82" y="740" font-family="sans-serif" font-size="18" letter-spacing="6" fill="#eae8d9">SLOW WEEKEND / 2026</text></svg>`;
  fs.writeFileSync(path.join(output, 'art.svg'), art);
  await sharp(Buffer.from(art)).png().toFile(path.join(output, 'art.png'));
  const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.SHOWCASE_CHROME ? { executablePath: process.env.SHOWCASE_CHROME } : {}) });
  const evidence = [];
  try {
    for (const fixture of fixtures) {
      const { filename, width, height, tab, collapsed, ...record } = fixture;
      const note = { id:'showcase-fictional', name:'', content:'', checklist:[], images:[], color:'#FFF3B0', opacity:0.94, bounds:{x:0,y:0,width,height}, createdAt:'2026-09-10T00:00:00.000Z', updatedAt:'2026-09-10T00:00:00.000Z', ...record };
      if (record.image) { delete note.image; note.images = [{ id:'showcase-art', filename:'art.png', width:1200, height:800, src:origin + '/assets/showcase/ui/art.png' }]; }
      if (tab) note.dock = {side:'right',y:100};
      const page = await browser.newPage({ viewport:{width,height}, deviceScaleFactor:2 });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.exposeFunction('__showcaseSetCollapsed', async value => { await page.setViewportSize({width,height:value ? 40 : height}); return value; });
      await page.addInitScript(({ note, tab }) => {
        window.stickyNotes = new Proxy({
          platform:'darwin',
          getInitialDockSide:() => tab ? 'right' : null,
          getCurrentNote:async () => note,
          getAppCopy:async () => ({noteContentPlaceholder:'可以在这里随便记点什么',checklistItemPlaceholder:'待办事项'}),
          onDockApplied:() => () => {}, onDockPreview:() => () => {},
          setCollapsed: value => window.__showcaseSetCollapsed(value),
          updateContent: async content => ({...note,content}),
          updateChecklist: async checklist => ({...note,checklist}),
          updateName: async name => ({...note,name}),
        }, {get:(target,key) => key in target ? target[key] : () => Promise.resolve(undefined)});
      }, {note,tab:!!tab});
      await page.goto(origin + '/out/renderer/index.html' + (tab ? '?view=tab&side=right' : ''));
      await page.waitForSelector('.note-shell');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0));
      if (collapsed) await page.getByRole('button', {name:'收起便签',exact:true}).click();
      await page.waitForTimeout(500);
      await page.mouse.move(width - 2, height - 2);
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({path:path.join(output,filename),omitBackground:true});
      if (['daily.png','collapsed.png','tab-yellow.png'].includes(filename)) {
        const motionAssets = path.join(__dirname,'motion/assets');
        fs.mkdirSync(motionAssets,{recursive:true});
        fs.copyFileSync(path.join(output,filename),path.join(motionAssets,filename));
      }
      evidence.push({filename,viewport:page.viewportSize(),deviceScaleFactor:2,errors});
      if (errors.length) throw new Error(errors.join('\n'));
      await page.close();
    }
    fs.writeFileSync(path.join(output,'capture-evidence.json'), JSON.stringify({ source:'Unmodified out/renderer built from version 0.1.21; synthetic IPC fixtures; not native OS recording',captures:evidence }, null, 2) + '\n');
    console.log(JSON.stringify(evidence,null,2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
