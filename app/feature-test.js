'use strict';
// 端到端测试：用本地假模型跑一遍「读书感想」与「连载第一章」。
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9366;
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function waitStudio(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      const t = list.find(x => x.url && x.url.includes('studio.html'));
      if (t) return t;
    } catch (e) { /* wait */ }
    await sleep(300);
  }
  throw new Error('studio not found');
}

class CDP {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
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
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(method + ' timeout'));
        }
      }, 60000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'eval failed');
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

(async () => {
  const out = {};
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '.'], {
    cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  let cdp = null;
  try {
    await sleep(2500);
    // 应用默认只开桌宠；用 pet 页把写作间叫出来
    const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
    const pet = list.find(x => x.url && x.url.includes('pet.html'));
    if (pet) {
      const petCdp = new CDP(pet.webSocketDebuggerUrl);
      await petCdp.eval(`window.liven.openStudio('chat')`);
      petCdp.close();
    }
    const studio = await waitStudio();
    cdp = new CDP(studio.webSocketDebuggerUrl);
    await sleep(1800);

    const before = await cdp.eval(`window.liven.worksList()`);
    out.worksBefore = Array.isArray(before) ? before.length : 0;
    const orig = await cdp.eval(`window.liven.settingsGet()`);
    out.origProvider = orig.settings.llm.provider;

    await cdp.eval(`window.liven.settingsSave({ llm: { provider: 'custom', baseURL: 'http://127.0.0.1:9377/v1', model: 'mock', apiKey: 'test-key' } })`);
    await sleep(500);

    out.reading = await cdp.eval(`window.liven.readingRun()`);
    out.serial = await cdp.eval(`window.liven.serialRun()`);
    out.serialStatus = await cdp.eval(`window.liven.serialStatus()`);
    out.readingList = await cdp.eval(`window.liven.readingList()`);
    const after = await cdp.eval(`window.liven.worksList()`);
    out.worksAfter = Array.isArray(after) ? after.length : 0;
    out.newWorks = (after || [])
      .filter(w => !(before || []).some(b => b.path === w.path))
      .map(w => ({ title: w.title, kind: w.kind, path: w.path, words: w.words }));

    // 还原模型设置
    await cdp.eval(`window.liven.settingsSave({ llm: ${JSON.stringify(orig.settings.llm)} })`);
    await sleep(300);

    console.log(JSON.stringify(out, null, 2));

    // 清理测试产物
    for (const w of out.newWorks) {
      try { fs.unlinkSync(w.path); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(w.path.replace(/\.md$/i, '.docx')); } catch (e) { /* ignore */ }
    }
    const outDir = path.join(APP, '..', '作品');
    for (const sub of ['读书感想', '连载']) {
      const dir = path.join(outDir, sub);
      try {
        const walk = (d) => {
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, ent.name);
            if (ent.isDirectory()) { walk(p); try { fs.rmdirSync(p); } catch (e) { /* ignore */ } }
          }
        };
        walk(dir);
      } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error('FEATURE TEST FAILED:', err.message);
    console.error(stderr.slice(-3000));
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    child.kill();
    await sleep(600);
    // 清掉测试写入的阅读/连载记录（测试前均为空）
    const data = path.join(process.env.APPDATA || '', 'liven-pet');
    for (const f of ['reading.json', 'serials.json']) {
      try { fs.unlinkSync(path.join(data, f)); } catch (e) { /* ignore */ }
    }
  }
})();
