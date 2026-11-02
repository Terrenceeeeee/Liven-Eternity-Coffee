'use strict';
// 开发用：启动应用，逐个切换写作间视图并截图，检查氛围与排版。
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9355;
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
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

class CDP {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timeout')); }
      }, 20000);
    });
  }
}

(async () => {
  const child = spawn(EXE, ['.', `--remote-debugging-port=${PORT}`], { cwd: APP, env });
  try {
    const t = await waitTarget((x) => x.url.includes('studio.html'));
    const cdp = new CDP(t.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    const dir = path.join(APP, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const view of ['chat', 'write', 'shelf', 'works', 'settings']) {
      await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-section="${view}"]').click()` });
      await sleep(650);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(dir, `view-${view}.png`), Buffer.from(shot.data, 'base64'));
      console.log('shot', view);
    }
  } finally {
    child.kill();
    await sleep(600);
    process.exit(0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
