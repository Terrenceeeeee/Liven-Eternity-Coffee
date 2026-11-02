// 桌宠缩放实测：通过 CDP 调 settingsSave，量窗口与精灵的实际尺寸
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9368;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const t = list.find(x => x.type === 'page' && x.url.includes('pet.html'));
      if (t) return t;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('pet target not found');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); }
    }));
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    ws.addEventListener('error', reject);
  });
}

(async () => {
  const child = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: APP,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    stdio: 'ignore'
  });
  try {
    const t = await waitTarget();
    const cdp = await connect(t.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const measure = async () => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const s = document.getElementById('sprite');
          return { w: window.outerWidth, h: window.outerHeight, sw: s ? s.clientWidth : 0, sh: s ? s.clientHeight : 0 };
        })()`,
        returnByValue: true
      });
      return r.result.value;
    };
    const before = await measure();
    await cdp.send('Runtime.evaluate', {
      expression: `window.liven.settingsSave({ ui: { petScale: 1.4 } })`,
      awaitPromise: true
    });
    await new Promise(r => setTimeout(r, 700));
    const big = await measure();
    await cdp.send('Runtime.evaluate', {
      expression: `window.liven.settingsSave({ ui: { petScale: 0.8 } })`,
      awaitPromise: true
    });
    await new Promise(r => setTimeout(r, 700));
    const small = await measure();
    console.log(JSON.stringify({ before, big, small }, null, 2));
    cdp.close();
  } finally {
    child.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
