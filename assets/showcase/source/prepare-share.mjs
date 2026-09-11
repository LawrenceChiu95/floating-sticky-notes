import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const output = path.resolve(root, process.argv[2] || 'release/workbuddy-deploy/site');
const bundle = process.env.SHOWCASE_NODE_MODULES;
const { marked } = await import(bundle ? pathToFileURL(path.join(bundle, 'marked/lib/marked.esm.js')).href : 'marked');
const files = {
  'assets/showcase/github/hero.png': 'a-hero.png',
  'assets/showcase/seen/hero.png': 'b-hero.png',
  'assets/showcase/xhs/01-cover.png': 'a-cover.png',
  'assets/showcase/seen/cover.png': 'b-cover.png',
  'assets/showcase/github/features.png': 'features.png',
  'assets/showcase/github/edge-dock.gif': 'demo.gif',
  'assets/showcase/video/edge-dock.mp4': 'demo.mp4',
  'assets/showcase/video/demo-poster.png': 'demo-poster.png',
  'assets/showcase/github/visibility.gif': 'visibility.gif',
  'assets/showcase/video/visibility.mp4': 'visibility.mp4',
  'assets/showcase/video/visibility-poster.png': 'visibility-poster.png',
  'assets/icons/app-icon.png': 'icon.png',
};
await fs.mkdir(path.join(output, 'media'), { recursive: true });
for (const [source, name] of Object.entries(files)) await fs.copyFile(path.join(root, source), path.join(output, 'media', name));
await fs.copyFile(path.join(here, 'share.html'), path.join(output, 'comparison.html'));
const style = `*{box-sizing:border-box}body{margin:0;background:#f6f5ef;color:#273027;font:16px/1.65 -apple-system,'PingFang SC',sans-serif}nav{max-width:980px;margin:auto;padding:22px 30px 0;display:flex;justify-content:space-between;gap:20px}article{max-width:980px;margin:22px auto 50px;padding:32px;background:white;border:1px solid #d6ddcd;border-radius:10px}a{color:#4c6541;text-underline-offset:4px}h1,h2{border-bottom:1px solid #d6ddcd;padding-bottom:8px;line-height:1.35}h1{font-size:32px}h2{font-size:25px;margin-top:30px}img{max-width:100%;height:auto}table{display:block;overflow:auto;border-collapse:collapse}th,td{border:1px solid #d6ddcd;padding:10px;min-width:140px}pre{overflow:auto;background:#f5f6f1;padding:18px;border-radius:8px}code{font-size:13px}sub{font-size:13px;color:#76836a}details{margin:20px 0}summary{cursor:pointer}li{margin:6px 0}@media(max-width:600px){nav{padding:18px 18px 0;font-size:14px}article{margin:16px 0;padding:20px 18px;border:0;border-radius:0}h2{font-size:22px}}`;
for (const [label, source, name] of [['A', 'docs/distribution/README-a.md', 'a.html'], ['B', 'README.md', 'b.html']]) {
  let html = marked.parse(await fs.readFile(path.join(root, source), 'utf8'));
  html = html.replace(/\b(href|src)="([^"#][^"]*)"/g, (whole, attribute, target) => {
    if (/^(https?:|data:|mailto:)/.test(target)) return whole;
    const [raw, hash] = target.split('#');
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), raw));
    let resolved = files[relative] ? `media/${files[relative]}` : relative.startsWith('docs/distribution/') ? 'index.html' : `https://github.com/LawrenceChiu95/floating-sticky-notes/blob/main/${relative}`;
    if (hash && resolved !== 'index.html') resolved += `#${hash}`;
    return `${attribute}="${resolved}"`;
  });
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>方案 ${label} · 悬浮便签</title><style>${style}</style><nav><a href="comparison.html">← 返回两版对比</a><span>方案 ${label} · 完整介绍</span></nav><article>${html}</article></html>`;
  await fs.writeFile(path.join(output, name), page);
  if (label === 'B') {
    let selected = html.replace('<strong>Star ⭐</strong>', '<a href="https://github.com/LawrenceChiu95/floating-sticky-notes">Star ⭐</a>');
    for (const [gif, video, poster] of [['visibility.gif', 'visibility.mp4', 'visibility-poster.png'], ['demo.gif', 'demo.mp4', 'demo-poster.png']]) {
      selected = selected.replace(new RegExp(`<img src="media/${gif.replace('.', '\\.')}"[^>]*>`), `<video controls playsinline preload="metadata" style="display:block;width:100%;height:auto;border-radius:8px" poster="media/${poster}" src="media/${video}"></video>`);
    }
    await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>悬浮便签 · 这是「看见」的力量</title><style>${style}</style><article>${selected}</article></html>`);
  }
}
console.log('Prepared selected B homepage, comparison, A/B introductions and local media.');
