'use strict';
// 冒烟测试：启动应用，通过 DevTools 协议打开写作间，走一遍离线对话与离线创作。
// 用法：node smoke.js
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const APP = __dirname;
const EXE = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9344;
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

async function targets() {
  return getJSON(`http://127.0.0.1:${PORT}/json/list`);
}

async function waitTarget(match, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await targets();
      const t = list.find(match);
      if (t) return t;
    } catch (e) { /* not up yet */ }
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
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(method + ' timeout'));
        }
      }, 30000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'eval failed');
    }
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

(async () => {
  const out = { steps: [] };
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, '.'], {
    cwd: APP,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));

  try {
    const pet = await waitTarget((t) => t.url && t.url.includes('pet.html'));
    out.steps.push('pet window up: ' + pet.title);

    const petCdp = new CDP(pet.webSocketDebuggerUrl);
    await petCdp.send('Runtime.enable');
    const petState = await petCdp.eval(`(async () => {
      const s = await window.liven.settingsGet();
      return { hasApi: !!s.settings.llm.apiKey, provider: s.settings.llm.provider, character: !!s.settings.ui.character };
    })()`);
    out.steps.push({ petState });
    await sleep(2600);
    out.steps.push({
      petBubble: (await petCdp.eval(`document.getElementById('bubbleText').textContent`)).slice(0, 60),
      spriteWidth: await petCdp.eval(`document.getElementById('sprite').naturalWidth`)
    });

    await petCdp.eval(`window.liven.openStudio('chat')`);
    const studio = await waitTarget((t) => t.url && t.url.includes('studio.html'));
    out.steps.push('studio window up: ' + studio.title);

    const cdp = new CDP(studio.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await sleep(1800);

    out.steps.push({ nav: await cdp.eval(`document.querySelectorAll('#nav button').length`) });
    out.steps.push({ offlineBanner: await cdp.eval(`document.getElementById('offlineBanner').className`) });
    out.steps.push({ chatLog: (await cdp.eval(`document.getElementById('chatLog').innerText`)).slice(0, 120) });

    // 离线对话
    await cdp.eval(`(async () => {
      const ta = document.getElementById('chatText');
      ta.value = '你好，今天有点累。';
      document.getElementById('chatForm').dispatchEvent(new Event('submit', { cancelable: true }));
    })()`);
    await sleep(2500);
    out.steps.push({ chatReply: (await cdp.eval(`document.querySelectorAll('#chatLog .msg.assistant .bubble')[document.querySelectorAll('#chatLog .msg.assistant .bubble').length - 1].innerText`)).slice(0, 200) });

    // 离线创作
    await cdp.eval(`document.querySelector('#nav button[data-section="write"]').click()`);
    await sleep(300);
    await cdp.eval(`(async () => {
      document.getElementById('wTopic').value = '打烊之后的一杯热可可';
      document.getElementById('btnGenerate').click();
    })()`);
    await sleep(2500);
    out.steps.push({
      offlinePanel: await cdp.eval(`document.getElementById('offlinePanel').className`),
      promptLength: await cdp.eval(`document.getElementById('offlinePromptText').value.length`)
    });

    // 本地书架
    const local = await cdp.eval(`(async () => {
      try {
        const r = await window.liven.librarySearch({ source: 'local', q: '' });
        const first = (r.results || [])[0] || null;
        let opened = null;
        if (first) {
          const o = await window.liven.libraryOpen({ source: 'local', id: first.id });
          opened = o.book ? { title: o.book.title, chars: (o.book.text || '').length } : { error: o.error };
        }
        return { ok: true, count: (r.results || []).length, first, opened };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    out.steps.push({ local });

    // 本地书架的界面
    await cdp.eval(`document.querySelector('#nav button[data-section="shelf"]').click()`);
    await sleep(900);
    out.steps.push({
      shelfUI: await cdp.eval(`({
        count: document.querySelectorAll('#searchResults .result-item').length,
        first: (document.querySelector('#searchResults .result-item .t') || {}).textContent || '',
        hint: document.getElementById('searchHint').textContent
      })`)
    });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(path.join(APP, 'shots', 'shelf.png'), Buffer.from(shot.data, 'base64'));

    // 远程服务（当前网络下可能失败，失败应返回中文错误）
    const search = await cdp.eval(`(async () => {
      try {
        const r = await window.liven.librarySearch({ source: 'wikisource', q: '红楼梦' });
        return Object.assign({ ok: true, count: (r.results || []).length }, r.error ? { error: r.error } : {});
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    })()`);
    out.steps.push({ search });

    // 作品列表
    const works = await cdp.eval(`window.liven.worksList()`);
    out.steps.push({ worksCount: Array.isArray(works) ? works.length : String(works) });

    // 定时写作（无 Key 应给出可读原因）
    const run = await cdp.eval(`window.liven.scheduleRun()`);
    out.steps.push({ scheduleRun: run });

    // 连载与阅读记录接口（无 Key 时只验状态与拒绝原因）
    out.steps.push({ serialStatus: await cdp.eval(`window.liven.serialStatus()`) });
    out.steps.push({ readingList: await cdp.eval(`window.liven.readingList()`) });
    out.steps.push({ serialRun: await cdp.eval(`window.liven.serialRun()`) });

    console.log(JSON.stringify(out, null, 2));

    petCdp.close();
    cdp.close();
  } catch (err) {
    console.error('SMOKE FAILED:', err.message);
    console.error(stderr.slice(-3000));
    process.exitCode = 1;
  } finally {
    child.kill();
    await sleep(800);
  }
})();
