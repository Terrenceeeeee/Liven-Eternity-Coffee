'use strict';
// 开发用：验证桌宠 Q 版表情切换（点击 -> 惊讶 -> 回到捧杯）。
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9360;
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitTarget(match, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      const t = list.find(match);
      if (t) return t;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('target not found');
}

(async () => {
  const child = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`], { cwd: APP, env });
  try {
    const t = await waitTarget((x) => x.url.includes('pet.html'));
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params) => new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const expr = `(async () => {
      window.liven.petDragStart = () => {};
      window.liven.petDragEnd = () => {};
      const s = document.getElementById('sprite');
      const before = s.src;
      const r = document.getElementById('pet').getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 7 };
      const pet = document.getElementById('pet');
      pet.dispatchEvent(new PointerEvent('pointerdown', opts));
      pet.dispatchEvent(new PointerEvent('pointerup', opts));
      await new Promise(r => setTimeout(r, 350));
      const during = s.src;
      await new Promise(r => setTimeout(r, 1300));
      return { before, during, after: s.src };
    })()`;
    const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(out.result && out.result.result && out.result.result.value, null, 2));
  } finally {
    child.kill();
    await sleep(500);
    process.exit(0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
