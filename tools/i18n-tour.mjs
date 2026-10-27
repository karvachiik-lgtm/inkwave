// Drive the real game in headless Chrome with the UI language preset, visit every menu screen and list any text that is
// still English (a translation gap), plus page errors. Screenshots land in <outdir>.
//   npm run serve &   then   node tools/i18n-tour.mjs [outdir=/tmp/inkwave-tour] [lang=zh]
// Needs Chrome (CHROME_PATH or a standard install, see tools/chrome.mjs). Software rendering is slow: allow minutes.
import puppeteer from 'puppeteer-core';
import { chromePath, gpuArgs } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const SH = process.argv[2] || '/tmp/inkwave-tour', LANG = process.argv[3] || 'zh', URL_ = process.env.GAME_URL || 'http://127.0.0.1:8490/?quality=low&lazycompile';
mkdirSync(SH, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: gpuArgs(['--window-size=1280,720']), defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push('[console.error] ' + m.text()); });
await page.evaluateOnNewDocument((lang) => {
  try { localStorage.setItem('inkwave.lang', lang); localStorage.setItem('inkwave.settings', JSON.stringify({ lang })); } catch {}
}, LANG);
await page.goto(URL_, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction('window.__inkwave && __inkwave.menus', { timeout: 240000, polling: 200 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scan = () => page.evaluate(`(()=>{const root=__inkwave.uiRoot;const out=new Set();const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const s=n.nodeValue.trim();if(s.length<3||!/[A-Za-z]{3,}/.test(s)||/[\\u4e00-\\u9fff]/.test(s))continue;const el=n.parentElement;if(!el||!el.getClientRects().length)continue;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)continue;out.add(s)}return JSON.stringify([...out])})()`);
await sleep(3000);
await page.keyboard.press('Space'); await sleep(4000);
await page.screenshot({ path: SH + '/20-news-' + LANG + '.png' });
console.log('SCAN news/main:', await scan());
await page.keyboard.press('Escape'); await sleep(1500); await page.keyboard.press('Escape'); await sleep(2500);
await page.screenshot({ path: SH + '/21-main-' + LANG + '.png' });
console.log('SCAN main:', await scan());
for (const sc of ['mode', 'setup', 'loadout', 'howto', 'credits', 'settings']) {
  await page.evaluate(`__inkwave.menus._go('${sc}')`); await sleep(2500);
  console.log('SCAN ' + sc + ':', await scan());
}
await page.evaluate(`__inkwave.menus._go('settings')`); await sleep(500);
console.log('ERRORS:', JSON.stringify(errs));
await browser.close();
process.exit(0);
