// 打包版 UI 检查：打开写作间，截设定页，读标题/品牌/作品目录
const http = require('http');
const fs = require('fs');
const PORT = 9370;

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, res => {
    let d = '';
    res.on('data', c => (d += c));
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  return { ws, send, evalJs };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const pet = list.find(x => x.url.includes('pet.html'));
  if (!pet) throw new Error('no pet');
  const P = await connect(pet.webSocketDebuggerUrl);
  await P.evalJs(`window.liven.openStudio('settings')`);
  let studio = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    studio = list.find(x => x.url.includes('studio.html'));
    if (studio) break;
  }
  if (!studio) throw new Error('no studio');
  const S = await connect(studio.webSocketDebuggerUrl);
  await sleep(800);
  const info = await S.evalJs(`({
    title: document.title,
    brand: document.querySelector('.brand h1').textContent,
    sub: document.querySelector('.brand p').textContent,
    outDir: document.querySelector('#sOutDir').value,
    scale: document.querySelector('#sScaleVal').textContent
  })`);
  const shot = await S.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shots/pkg-studio.png', Buffer.from(shot.result.data, 'base64'));
  console.log(JSON.stringify(info, null, 2));
  P.ws.close(); S.ws.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
