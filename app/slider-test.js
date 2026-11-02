// 验证设定页滑杆输入后，桌宠窗口是否立即缩放（CDP 9369）
const http = require('http');
const PORT = 9369;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

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
  return { ws, evalJs };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const pet = list.find(x => x.url.includes('pet.html'));
  if (!pet) throw new Error('no pet target');
  const P = await connect(pet.webSocketDebuggerUrl);
  await P.evalJs(`window.liven.petScale(0.85)`);
  await sleep(600);
  const before = await P.evalJs(`({ w: outerWidth, h: outerHeight })`);
  await P.evalJs(`window.liven.openStudio('settings')`);

  for (let i = 0; i < 30; i++) {
    await sleep(300);
    list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    if (list.some(x => x.url.includes('studio.html'))) break;
  }
  const studio = list.find(x => x.url.includes('studio.html'));
  if (!studio) throw new Error('studio not opened');
  const S = await connect(studio.webSocketDebuggerUrl);
  await sleep(500);
  await S.evalJs(`document.querySelector('[data-section="settings"]').click()`);
  await sleep(300);
  const label = await S.evalJs(`document.querySelector('#sScaleVal').textContent`);
  await S.evalJs(`(() => { const el = document.querySelector('#sScale'); el.value = '1.3'; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
  await sleep(900);
  const after = await P.evalJs(`({ w: outerWidth, h: outerHeight })`);
  const labelAfter = await S.evalJs(`document.querySelector('#sScaleVal').textContent`);
  console.log(JSON.stringify({ label, labelAfter, before, after }, null, 2));
  P.ws.close();
  S.ws.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
