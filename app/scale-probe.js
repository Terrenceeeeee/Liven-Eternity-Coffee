// 连接已运行的调试端口，量桌宠窗口与精灵尺寸
const http = require('http');
const PORT = 9368;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const t = list.find(x => x.url.includes('pet.html'));
  if (!t) throw new Error('no pet target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
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
  const measure = async () => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const s = document.getElementById('sprite');
        return { w: window.outerWidth, h: window.outerHeight, sw: s ? s.clientWidth : 0, sh: s ? s.clientHeight : 0, scale: window.liven ? 1 : 0 };
      })()`,
      returnByValue: true
    });
    return r.result.result.value;
  };
  const before = await measure();
  await send('Runtime.evaluate', { expression: `window.liven.petScale(1.4)`, awaitPromise: true });
  await new Promise(r => setTimeout(r, 800));
  const big = await measure();
  await send('Runtime.evaluate', { expression: `window.liven.petScale(0.8)`, awaitPromise: true });
  await new Promise(r => setTimeout(r, 800));
  const small = await measure();
  console.log(JSON.stringify({ before, big, small }, null, 2));
  ws.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
