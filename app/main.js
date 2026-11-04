'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen,
  shell, Notification, globalShortcut, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 打包后 exe 改名会让 Electron 推断出不同的应用名，这里固定数据目录，
// 保证源码版与绿色版共用同一份设定、对话记忆和书架记录。
try {
  app.setName('Eternity coffee');
  app.setPath('userData', path.join(app.getPath('appData'), 'liven-pet'));
  // 供自动化测试/高级用户指定独立数据目录；平时不设置，仍使用上面的固定目录。
  if (process.env.LIVEN_DATA_DIR) {
    app.setPath('userData', path.resolve(process.env.LIVEN_DATA_DIR));
  }
} catch (e) { /* 早期 Electron 忽略 */ }

const util = require('./engine/util');
const llm = require('./engine/llm');
const prompt = require('./engine/prompt');
const voice = require('./engine/voice');
const sources = require('./engine/sources');
const serialPrompt = require('./engine/serials');
const { Library, saveWork, saveSerialChapter, listWorks, readWork } = require('./engine/works');
const { Scheduler } = require('./engine/scheduler');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const KNOWLEDGE = path.join(ROOT, 'knowledge');
const CORPUS = path.join(KNOWLEDGE, 'corpus');
const PROFILE_PATH = path.join(KNOWLEDGE, 'style-profile.json');
const DOCS = path.join(ROOT, 'docs');
const PRELOAD = path.join(__dirname, 'preload.js');

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

let settings = null;
let settingsFile = '';
let firstRunDetected = false;
let memory = { messages: [], summary: '' };
let memoryFile = '';
let library = null;
let reading = [];
let readingFile = '';
let serial = { active: null, history: [] };
let serialFile = '';
let serialBusy = false;
let readingBusy = false;
let scheduler = null;
let petWin = null;
let studioWin = null;
let setupWin = null;
let tray = null;
let quitting = false;
let chatBusy = false;
let writeBusy = false;
let drag = null;

/* -------------------------------- settings ------------------------------- */

function defaults() {
  return {
    version: 3,
    setupDone: false,
    llm: {
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
      temperature: 0.9
    },
    ui: {
      petScale: 0.85,
      alwaysOnTop: true,
      bubbleMs: 9000,
      autoStart: true,
      petPos: null,
      character: '',
      userName: '朋友'
    },
    writing: {
      // 作品放在「文档」下，移动/分享绿色版时不会把作品一起带走或覆盖
      outDir: path.join(app.getPath('documents'), 'Eternity coffee', '作品'),
      autoDocx: true,
      era: 'auto'
    },
    schedule: {
      enabled: false,
      time: '21:30',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      kind: 'mixed',
      catchUp: true,
      lastRun: ''
    },
    reading: {
      enabled: true,
      everyDays: 7,
      lastAt: ''
    },
    serial: {
      enabled: true,
      everyDays: 14,
      autoStart: true,
      lastAt: ''
    }
  };
}

function loadSettings() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  settingsFile = file;
  const saved = util.readJson(file, null);
  settings = util.deepMerge(defaults(), saved || {});
  let migrated = false;
  // 旧版本没有 setupDone 字段：已经是老用户，不再弹初次设置。
  // 全新安装没有 settings 文件，才会走首次启动向导。
  if (saved && saved.setupDone === undefined) {
    settings.setupDone = true;
    migrated = true;
  }
  firstRunDetected = !settings.setupDone;
  if (saved && (!saved.version || saved.version < 2)) {    // v2：默认更小的桌宠、默认开机自启动（一次迁移，之后尊重用户选择）
    settings.ui.petScale = 0.85;
    settings.ui.autoStart = true;
    settings.version = 2;
    migrated = true;
  }
  // v3：称呼。老用户此前被固定叫作 Terrence，先保持原样；新装由初次设置询问。
  if (saved && saved.ui && saved.ui.userName === undefined) {
    settings.ui.userName = settings.setupDone ? 'Terrence' : '';
    settings.version = 3;
    migrated = true;
  }
  // 早期版本把作品放在 dist 或程序目录里；统一迁到「文档」，避免分享绿色版时带走作品
  const defaultOut = path.join(app.getPath('documents'), 'Eternity coffee', '作品');
  if (!settings.writing.outDir || /[\\/]dist[\\/]/i.test(settings.writing.outDir)) {
    settings.writing.outDir = defaultOut;
    migrated = true;
  }
  if (!saved || migrated) saveSettings();
}

function saveSettings() {
  util.writeJsonAtomic(settingsFile, settings);
}

function llmConfig() {
  const l = settings.llm;
  return {
    apiKey: l.apiKey,
    baseURL: l.baseURL,
    model: l.model,
    temperature: Number(l.temperature) || 0.9
  };
}

function hasKey() {
  return !!(settings.llm.apiKey && String(settings.llm.apiKey).trim());
}

/* -------------------------------- memory -------------------------------- */

function loadMemory() {
  memoryFile = path.join(app.getPath('userData'), 'chat.json');
  const saved = util.readJson(memoryFile, null);
  if (saved && Array.isArray(saved.messages)) {
    memory = { messages: saved.messages.slice(-80), summary: saved.summary || '' };
  }
}

function saveMemory() {
  util.writeJsonAtomic(memoryFile, { messages: memory.messages.slice(-80), summary: memory.summary });
}

/* -------------------------------- reading -------------------------------- */

function loadReading() {
  readingFile = path.join(app.getPath('userData'), 'reading.json');
  const saved = util.readJson(readingFile, null);
  reading = saved && Array.isArray(saved.entries) ? saved.entries : [];
}

function saveReading() {
  util.writeJsonAtomic(readingFile, { entries: reading.slice(0, 300) });
}

function appendReadingLog(entry) {
  try {
    const dir = path.join(settings.writing.outDir, '读书感想');
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, '阅读记录.md');
    if (!fs.existsSync(log)) {
      fs.writeFileSync(log, [
        '# 阅读记录',
        '',
        '> 由虚拟 Liven 记录。每读完一篇，写一篇感想，记下日期。',
        '',
        '| 日期 | 读的 | 感想 |',
        '| --- | --- | --- |'
      ].join('\n') + '\n', 'utf8');
    }
    const book = entry.sourceTitle || entry.title;
    const line = `| ${entry.date} | 《${book}》${entry.author ? ` · ${entry.author}` : ''} | ${entry.workTitle || ''} |\n`;
    fs.appendFileSync(log, line, 'utf8');
  } catch (e) {
    console.error('[reading log]', e.message);
  }
}

function recordReading(work, saved) {
  const entry = {
    date: work.date || util.todayStr(),
    at: Date.now(),
    title: work.title,
    workTitle: work.title,
    sourceTitle: work.sourceTitle || work.topic || '',
    author: work.sourceAuthor || '',
    path: saved && saved.mdPath ? saved.mdPath : '',
    words: util.countWords(work.body || '')
  };
  reading.unshift(entry);
  saveReading();
  appendReadingLog(entry);
  return entry;
}

/* --------------------------------- serials -------------------------------- */

function loadSerials() {
  serialFile = path.join(app.getPath('userData'), 'serials.json');
  const saved = util.readJson(serialFile, null);
  if (saved && typeof saved === 'object') {
    serial = {
      active: saved.active || null,
      history: Array.isArray(saved.history) ? saved.history : []
    };
  }
}

function saveSerials() {
  util.writeJsonAtomic(serialFile, serial);
}

function serialDue() {
  if (!settings.serial || !settings.serial.enabled) return false;
  const a = serial.active;
  const days = Math.max(1, Number(settings.serial.everyDays) || 14);
  if (a) {
    // 写完一部后，按这部自己的 nextAt 开下一部；还在连载中则按下一章时间。
    const next = a.nextAt ? new Date(a.nextAt).getTime() : 0;
    if (next) return Date.now() >= next;
    if (a.status === 'done') return true;
  }
  if (!a && !settings.serial.autoStart) return false;
  const last = settings.serial.lastAt ? new Date(settings.serial.lastAt).getTime() : 0;
  return Date.now() - last >= days * 86400000;
}

function serialStatus() {
  const a = serial.active;
  return {
    enabled: !!(settings.serial && settings.serial.enabled),
    everyDays: Number(settings.serial && settings.serial.everyDays) || 14,
    lastAt: (settings.serial && settings.serial.lastAt) || '',
    active: a ? {
      id: a.id,
      title: a.title,
      topic: a.topic,
      status: a.status || 'writing',
      chapters: (a.chapters || []).length,
      total: (a.plan && a.plan.chapters ? a.plan.chapters.length : 0),
      list: (a.chapters || []).map(c => ({ no: c.no, title: c.title, date: c.date, path: c.path })),
      nextAt: a.nextAt || ''
    } : null
  };
}

/* --------------------------------- assets -------------------------------- */

function characterPath() {
  const custom = settings.ui.character;
  if (custom && fs.existsSync(custom)) return custom;
  const candidates = [
    path.join(ASSETS, 'character', 'liven.png'),
    path.join(ASSETS, 'character', 'liven.webp'),
    path.join(ASSETS, 'character', 'liven.jpg')
  ];
  return candidates.find(p => fs.existsSync(p)) || '';
}

function characterUrl() {
  const p = characterPath();
  return p ? pathToFileURL(p).href : '';
}

function assetUrl(...parts) {
  const p = path.join(ASSETS, ...parts);
  return fs.existsSync(p) ? pathToFileURL(p).href : '';
}

function petPoses() {
  return {
    blinkOpen: assetUrl('character', 'q', 'q-blink-open.png'),
    blinkClose: assetUrl('character', 'q', 'q-blink-close.png'),
    sip: assetUrl('character', 'q', 'q-sip.png'),
    offer: assetUrl('character', 'q', 'q-offer.png'),
    surprise: assetUrl('character', 'q', 'q-surprise.png'),
    wave: assetUrl('character', 'q', 'q-wave.png'),
    yawn: assetUrl('character', 'q', 'q-yawn.png')
  };
}

function iconPath() {
  const p = path.join(ASSETS, 'ui', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

// Windows 任务栏/窗口边框对 .ico 更可靠；托盘仍用 png。
function windowIconPath() {
  const ico = path.join(ASSETS, 'ui', 'icon.ico');
  if (fs.existsSync(ico)) return ico;
  return iconPath();
}

/* --------------------------------- windows -------------------------------- */

function defaultPetPos(w, h) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - w - 28,
    y: area.y + area.height - h + 36
  };
}

function pinPet(on) {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.setAlwaysOnTop(!!on, on ? 'floating' : 'normal');
}

function createPet() {
  const scale = util.clamp(Number(settings.ui.petScale) || 1, 0.7, 1.8);
  const w = Math.round(380 * scale);
  const h = Math.round(560 * scale);
  const saved = settings.ui.petPos;
  const pos = saved && Number.isFinite(saved.x) ? saved : defaultPetPos(w, h);

  petWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: w,
    height: h,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: !!settings.ui.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Eternity coffee',
    icon: windowIconPath(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  petWin.setMenuBarVisibility(false);
  pinPet(!!settings.ui.alwaysOnTop);
  petWin.loadFile(path.join(__dirname, 'src', 'pet.html'));
  petWin.once('ready-to-show', () => petWin.show());
  // 透明窗口在个别显卡/远程桌面下不一定触发 ready-to-show，加载完成后再兜底显示一次。
  petWin.webContents.once('did-finish-load', () => {
    if (petWin && !petWin.isDestroyed() && !petWin.isVisible()) petWin.showInactive();
  });
  petWin.on('closed', () => { petWin = null; });
  petWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createStudio() {
  studioWin = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    title: 'Eternity coffee · 写作间',
    backgroundColor: '#f4ebdb',
    icon: windowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  studioWin.setMenuBarVisibility(false);
  studioWin.loadFile(path.join(__dirname, 'src', 'studio.html'));
  studioWin.once('ready-to-show', () => {
    const wantStudio = process.argv.includes('--studio') && settings.setupDone;
    if (!startHidden && wantStudio) studioWin.show();
  });
  studioWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      studioWin.hide();
    }
  });
  studioWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.show();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 820,
    height: 644,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Eternity coffee · 初次见面',
    backgroundColor: '#f4efe4',
    icon: windowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(path.join(__dirname, 'src', 'setup.html'));
  setupWin.once('ready-to-show', () => {
    if (!setupWin || setupWin.isDestroyed()) return;
    setupWin.show();
    setupWin.focus();
  });
  setupWin.on('closed', () => { setupWin = null; });
  setupWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function finishSetup(payload) {
  const data = payload || {};
  // 只有初次设置会写这些项；普通设定保存不会碰 setupDone。
  if (!data.skipKey && data.llm) {
    const provider = llm.PROVIDERS[data.llm.provider] ? data.llm.provider : 'custom';
    settings.llm.provider = provider;
    settings.llm.baseURL = String(data.llm.baseURL || '').trim();
    settings.llm.model = String(data.llm.model || '').trim();
    settings.llm.apiKey = String(data.llm.apiKey || '').trim();
  } else if (data.skipKey) {
    settings.llm.apiKey = '';
  }

  const fallbackDir = path.join(app.getPath('documents'), 'Eternity coffee', '作品');
  const outDir = data.outDir ? path.resolve(String(data.outDir)) : fallbackDir;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    settings.writing.outDir = outDir;
  } catch (err) {
    return { error: '这个目录写不进去：' + (err.message || outDir) };
  }

  settings.ui.userName = String(data.userName || '').trim().slice(0, 20) || '朋友';
  settings.ui.autoStart = !!data.autoStart;
  settings.setupDone = true;
  saveSettings();
  applyAutoStart();
  broadcastSettings();
  refreshTrayMenu();

  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  petSay(`灯亮起来了。以后就住这儿，${settings.ui.userName || '朋友'}。`);
  if (data.openStudio !== false) {
    setTimeout(() => openStudio('chat'), 120);
  }
  return { ok: true, outDir };
}

function openStudio(section) {
  if (!studioWin || studioWin.isDestroyed()) createStudio();
  if (studioWin.isMinimized()) studioWin.restore();
  studioWin.show();
  studioWin.focus();
  if (section) {
    studioWin.webContents.send('ui:goto', section);
  }
}

function petSay(text) {
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('pet:line', { text });
  }
}

/* --------------------------------- tray ---------------------------------- */

function buildTray() {
  const img = iconPath() ? nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Eternity coffee · 虚拟桌宠');
  refreshTrayMenu();
  tray.on('double-click', () => openStudio());
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开写作间', click: () => openStudio() },
    { label: '让 Liven 说句话', click: () => petSay(voice.petLine('idle', { name: settings.ui.userName })) },
    { type: 'separator' },
    {
      label: '今日写一篇',
      click: () => runScheduledWriting('manual')
    },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: !!settings.ui.alwaysOnTop,
      click: (item) => {
        settings.ui.alwaysOnTop = item.checked;
        saveSettings();
        pinPet(item.checked);
        broadcastSettings();
      }
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: !!settings.ui.autoStart,
      click: (item) => {
        settings.ui.autoStart = item.checked;
        saveSettings();
        applyAutoStart();
        broadcastSettings();
      }
    },
    { type: 'separator' },
    { label: '让 Liven 休息（退出）', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function applyAutoStart() {
  try {
    if (app.isPackaged) {
      // 优先用带图标的启动器，它会清掉可能存在的 ELECTRON_RUN_AS_NODE
      const dir = path.dirname(process.execPath);
      const launcher = path.join(dir, 'Eternity coffee.exe');
      const launchPath = fs.existsSync(launcher) ? launcher : process.execPath;
      app.setLoginItemSettings({ openAtLogin: !!settings.ui.autoStart, path: launchPath });
    } else {
      app.setLoginItemSettings({
        openAtLogin: !!settings.ui.autoStart,
        path: process.execPath,
        args: [app.getAppPath(), '--hidden']
      });
    }
  } catch (e) { /* ignore */ }
}

/* -------------------------------- helpers -------------------------------- */

let aumidReady = false;
function ensureAumid() {
  if (aumidReady) return;
  try {
    // 启动时不设 AUMID，任务栏才会使用 exe/窗口图标；
    // 真正要弹系统通知时再补上，避免任务栏图标被 AUMID 的默认图标覆盖。
    app.setAppUserModelId('com.eternitycoffee.liven');
    aumidReady = true;
  } catch (e) { /* ignore */ }
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      ensureAumid();
      new Notification({ title, body, icon: iconPath() }).show();
    }
  } catch (e) { /* ignore */ }
}

function sendStudio(channel, payload) {
  if (studioWin && !studioWin.isDestroyed()) {
    studioWin.webContents.send(channel, payload);
  }
}

function broadcastSettings() {
  sendStudio('settings:changed', settings);
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('settings:changed', settings);
  }
}

function profile() {
  return prompt.loadProfile(PROFILE_PATH);
}

function corpusCount() {
  try {
    const rows = fs.readFileSync(path.join(KNOWLEDGE, 'corpus', '_manifest.csv'), 'utf8').split('\n').filter(Boolean);
    return Math.max(0, rows.length - 1);
  } catch (e) {
    try {
      return fs.readdirSync(path.join(KNOWLEDGE, 'corpus')).filter(f => f.endsWith('.txt')).length;
    } catch (e2) { return 0; }
  }
}

function appState() {
  return {
    version: app.getVersion(),
    workspace: ROOT,
    dataDir: app.getPath('userData'),
    settingsFile,
    hasKey: hasKey(),
    provider: settings.llm.provider,
    model: settings.llm.model,
    characterUrl: characterUrl(),
    petPoses: petPoses(),
    corpusCount: corpusCount(),
    worksCount: listWorks(settings.writing.outDir).length,
    schedule: scheduler ? scheduler.status() : null,
    firstRun: firstRunDetected
  };
}

/* --------------------------------- chat ---------------------------------- */

function trimMemory() {
  if (memory.messages.length <= 60) return;
  const drop = memory.messages.length - 50;
  const old = memory.messages.splice(0, drop);
  if (!hasKey()) return;
  const who = settings.ui.userName || '朋友';
  const transcript = old.map(m => `${m.role === 'user' ? who : 'Liven'}：${m.content}`).join('\n').slice(-4000);
  llm.chat({
    ...llmConfig(),
    messages: [
      { role: 'system', content: '把下面的对话压缩成 200 字以内的第三人称摘要，保留人物、情绪与未完成的事。只输出摘要。' },
      { role: 'user', content: transcript }
    ],
    temperature: 0.3,
    maxTokens: 300,
    stream: false,
    timeoutMs: 60000
  }).then(text => {
    memory.summary = (memory.summary ? memory.summary + ' ' : '') + text.trim();
    memory.summary = memory.summary.slice(-1200);
    saveMemory();
  }).catch(() => {});
}

function chatDesk() {
  const a = serialStatus().active;
  return {
    reading: reading.slice(0, 3).map(r => ({
      date: r.date,
      title: r.sourceTitle || r.workTitle,
      work: r.workTitle
    })),
    serial: a ? { title: a.title, chapter: a.chapters, total: a.total } : null,
    books: library.recent().slice(0, 3).map(b => b.title).filter(Boolean)
  };
}

async function handleChat(text, link) {
  const message = String(text || '').trim();
  if (!message) throw new Error('说点什么吧。');
  if (chatBusy) throw new Error('我还在想上一句，稍等一下。');
  const context = link && link.title
    ? {
        type: link.type === 'work' ? 'work' : 'book',
        title: String(link.title).slice(0, 120),
        author: String(link.author || '').slice(0, 80),
        text: String(link.text || '').slice(0, 1600)
      }
    : null;
  chatBusy = true;
  sendStudio('pet:thinking', { on: true });
  try {
    memory.messages.push({ role: 'user', content: message, t: Date.now() });
    saveMemory();

    if (!hasKey()) {
      const reply = voice.offlineReply(message, { link: context, name: settings.ui.userName });
      memory.messages.push({ role: 'assistant', content: reply, t: Date.now() });
      saveMemory();
      petSay(reply.length > 60 ? reply.slice(0, 58) + '…' : reply);
      return { reply, offline: true };
    }

    const p = profile();
    const messages = prompt.chatMessages({
      profile: p,
      history: memory.messages.slice(0, -1),
      userText: message,
      era: settings.writing.era,
      memory,
      link: context,
      desk: chatDesk(),
      userName: settings.ui.userName
    });

    let full = '';
    try {
      full = await llm.chat({
        ...llmConfig(),
        messages,
        temperature: Math.min(1.1, Number(settings.llm.temperature) || 0.9),
        maxTokens: 500,
        stream: true,
        onDelta: (delta) => sendStudio('chat:delta', { delta })
      });
    } catch (err) {
      memory.messages.pop();
      saveMemory();
      throw new Error(err.message || '调用失败');
    }

    memory.messages.push({ role: 'assistant', content: full, t: Date.now() });
    saveMemory();
    trimMemory();
    petSay(full.length > 60 ? full.slice(0, 58) + '…' : full);
    return { reply: full, offline: false };
  } finally {
    chatBusy = false;
    sendStudio('pet:thinking', { on: false });
  }
}

/* -------------------------------- writing -------------------------------- */

function normalizeWorkPayload(payload = {}) {
  const kind = payload.kind || 'story';
  const topic = String(payload.topic || '').trim();
  const era = payload.era && payload.era !== 'auto'
    ? payload.era
    : prompt.chooseEra(kind, topic);
  return {
    kind,
    topic,
    era,
    tone: payload.tone == null ? 50 : util.clamp(Number(payload.tone), 0, 100),
    sourceTitle: String(payload.sourceTitle || '').trim(),
    sourceAuthor: String(payload.sourceAuthor || '').trim(),
    excerpt: String(payload.excerpt || '').trim(),
    extra: String(payload.extra || '').trim(),
    chatDigest: String(payload.chatDigest || '').trim()
  };
}

async function generateWork(payload) {
  const opts = normalizeWorkPayload(payload);
  const p = profile();
  const dateStr = util.todayStr();
  if (writeBusy) throw new Error('我还在写上一篇，等一会儿。');
  writeBusy = true;
  sendStudio('pet:thinking', { on: true });
  try {
    if (!hasKey()) {
      const promptText = prompt.offlinePromptPack({
        profile: p, ...opts, dateStr, userName: settings.ui.userName
      });
      return {
        offline: true,
        prompt: promptText,
        meta: { ...opts, date: dateStr }
      };
    }

    const messages = prompt.writingMessages({
      profile: p, ...opts, dateStr, userName: settings.ui.userName
    });
    const maxTokens = opts.kind === 'story' ? 4500 : opts.kind === 'review' ? 4200 : opts.kind === 'recommend' ? 3200 : 2600;
    const raw = await llm.chat({
      ...llmConfig(),
      messages,
      temperature: Math.min(1.15, Number(settings.llm.temperature) || 0.9),
      maxTokens,
      stream: true,
      onDelta: (delta) => sendStudio('write:delta', { delta })
    });

    const parsed = util.parseMarkedWork(raw);
    if (!parsed.body || parsed.body.length < 80) {
      throw new Error('模型没有按格式给出正文，换个模型或再试一次。');
    }
    const era = prompt.eraById(p, opts.era);
    const work = {
      title: parsed.title || opts.topic || (opts.kind === 'recommend' ? '读后' : '未命名'),
      kind: opts.kind,
      body: parsed.body,
      after: parsed.after,
      tags: parsed.tags,
      topic: opts.topic,
      sourceTitle: opts.sourceTitle,
      sourceAuthor: opts.sourceAuthor,
      era: era ? era.label : '自然声线',
      date: dateStr
    };
    return { work, raw, meta: { ...opts, date: dateStr } };
  } finally {
    writeBusy = false;
    sendStudio('pet:thinking', { on: false });
  }
}

async function handleSaveWork(payload) {
  const work = payload && payload.work;
  if (!work || !work.body) throw new Error('没有可保存的正文。');
  if (!work.date) work.date = util.todayStr();
  const formats = settings.writing.autoDocx ? ['md', 'docx'] : ['md'];
  const result = await saveWork({ work, outDir: settings.writing.outDir, formats });
  if (work.kind === 'review') recordReading(work, result);
  notify('Liven', `《${work.title}》写完了，已收进「作品」。`);
  petSay(voice.petLine('event', { event: 'saved', name: settings.ui.userName }));
  sendStudio('works:changed', {});
  return result;
}

function parsePasted(text, meta = {}) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('还没有粘贴内容。');
  const marked = util.parseMarkedWork(raw);
  if (marked.title || (marked.body && marked.tags.length)) {
    return {
      ...meta,
      title: marked.title || meta.topic || '未命名',
      body: marked.body,
      after: marked.after,
      tags: marked.tags
    };
  }
  const lines = raw.split('\n');
  let title = lines[0].replace(/^#+\s*/, '').replace(/^《|》$/g, '').trim();
  if (title.length > 40) title = meta.topic || '未命名';
  let body = lines.slice(1).join('\n').trim();
  let after = '';
  const idx = body.lastIndexOf('写在最后');
  if (idx > body.length * 0.5) {
    after = body.slice(idx).replace(/^写在最后[:：]?\s*/, '').trim();
    body = body.slice(0, idx).trim();
  }
  return { ...meta, title, body, after, tags: [] };
}

/* -------------------------------- schedule -------------------------------- */

async function runScheduledWriting(reason, topicArg, kindArg) {
  // 先记下今天已经跑过，避免没 Key / 失败时 Scheduler 每 20 秒重试。
  settings.schedule.lastRun = new Date().toISOString();
  saveSettings();
  if (!hasKey()) {
    notify('Liven', '还没有接通语言模型。到「设定」里填一个 API Key，我就能自己写了。');
    petSay('今天还没接通模型。要不要先到设定里看看？');
    return { ok: false, reason: 'no-key' };
  }
  const topic = topicArg || scheduler.pickTopic();
  const kind = kindArg || scheduler.pickKind();
  notify('Liven', '开始写今天的稿子了。');
  petSay('我去写点东西。你先忙。');
  try {
    const result = await generateWork({ kind, topic, era: 'auto', tone: 50 });
    if (result.offline) return { ok: false, reason: 'offline' };
    const saved = await handleSaveWork({ work: result.work });
    return { ok: true, work: result.work, saved };
  } catch (e) {
    notify('Liven', `今天没写成：${e.message}`);
    petSay('今天没写成。晚点再试。');
    return { ok: false, reason: 'error', message: e.message };
  }
}

function readingDue() {
  if (!settings.reading || !settings.reading.enabled) return false;
  const last = settings.reading.lastAt ? new Date(settings.reading.lastAt).getTime() : 0;
  const days = Math.max(1, Number(settings.reading.everyDays) || 7);
  return Date.now() - last >= days * 86400000;
}

function pickReadingBook() {
  const list = sources.listLocalBooks(CORPUS, '')
    .filter(b => b.chars >= 1200 && b.chars <= 16000);
  if (!list.length) return null;
  const used = new Set(reading.map(e => e.sourceTitle || '').filter(Boolean));
  const fresh = list.filter(b => !used.has(b.title));
  const pool = fresh.length ? fresh : list;
  const day = Math.floor(Date.now() / 86400000);
  return pool[day % pool.length];
}

async function runScheduledReading(reason) {
  if (readingBusy) return { ok: false, reason: 'busy' };
  readingBusy = true;
  if (!hasKey()) {
    readingBusy = false;
    notify('Liven', '还没有接通语言模型，读完了也写不成感想。到「设定」里填个 Key 吧。');
    return { ok: false, reason: 'no-key' };
  }
  const book = pickReadingBook();
  if (!book) {
    readingBusy = false;
    return { ok: false, reason: 'no-book' };
  }
  notify('Liven', `开始读《${book.title}》，读完写一篇感想。`);
  petSay('我去读点东西。读完写给你看。');
  try {
    const full = sources.readLocalBook(CORPUS, book.id);
    const result = await generateWork({
      kind: 'review',
      topic: book.title,
      sourceTitle: book.title,
      sourceAuthor: book.author,
      excerpt: full.text || '',
      tone: 45
    });
    if (result.offline) return { ok: false, reason: 'offline' };
    const saved = await handleSaveWork({ work: result.work });
    settings.reading.lastAt = new Date().toISOString();
    saveSettings();
    notify('Liven', `读完了，感想收在「读书感想」里。`);
    return { ok: true, work: result.work, saved };
  } catch (e) {
    notify('Liven', `这次没读成：${e.message}`);
    return { ok: false, reason: 'error', message: e.message };
  } finally {
    readingBusy = false;
  }
}

async function runScheduledSerial(reason) {
  if (!hasKey()) {
    notify('Liven', '还没有接通语言模型，连载也写不成。到「设定」里填个 Key 吧。');
    return { ok: false, reason: 'no-key' };
  }
  if (serialBusy) return { ok: false, reason: 'busy', message: '正在写上一章。' };
  serialBusy = true;
  try {
    if (serial.active && serial.active.status === 'done') {
      serial.history.unshift(serial.active);
      serial.history = serial.history.slice(0, 8);
      serial.active = null;
      saveSerials();
    }

    if (!serial.active) {
      const p = profile();
      const system = prompt.systemPrompt({ profile: p, mode: 'write', era: '2026', userName: settings.ui.userName });
      notify('Liven', '在想一部新的连载。');
      petSay('我想开一部新的连载。先让我想一会儿。');
      const raw = await llm.chat({
        ...llmConfig(),
        messages: serialPrompt.planMessages({ system, dateStr: util.todayStr() }),
        temperature: Math.min(1.1, Number(settings.llm.temperature) || 0.9),
        maxTokens: 2600,
        timeoutMs: 120000
      });
      const plan = serialPrompt.parsePlan(raw);
      serial.active = {
        id: `serial-${Date.now()}`,
        title: plan.title,
        topic: plan.topic,
        era: prompt.chooseEra('story', `${plan.topic} ${plan.arc}`),
        plan,
        chapters: [],
        status: 'writing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextAt: ''
      };
      saveSerials();
    }

    const a = serial.active;
    const total = (a.plan && a.plan.chapters ? a.plan.chapters.length : 0);
    const no = (a.chapters || []).length + 1;
    if (no > total) {
      a.status = 'done';
      saveSerials();
      return { ok: false, reason: 'done', message: '这一部已经写完了。' };
    }
    const meta = a.plan.chapters[no - 1];
    const prevTail = (() => {
      const last = (a.chapters || [])[a.chapters.length - 1];
      if (!last || !last.path) return '';
      try {
        const text = readWork(last.path);
        const parts = text.split(/\n---\n/);
        return (parts[1] || text).slice(-2200);
      } catch (e) { return ''; }
    })();

    const system = prompt.systemPrompt({ profile: profile(), mode: 'write', era: a.era, userName: settings.ui.userName });
    notify('Liven', `开始写《${a.title}》第 ${no} 章。`);
    petSay(`我去写《${a.title}》的下一章。`);
    const raw = await llm.chat({
      ...llmConfig(),
      messages: serialPrompt.chapterMessages({
        system, serial: a,
        chapter: { no, title: meta.title, beat: meta.beat },
        prevTail, dateStr: util.todayStr()
      }),
      temperature: Math.min(1.15, Number(settings.llm.temperature) || 0.9),
      maxTokens: 5200,
      timeoutMs: 180000
    });
    const parsed = util.parseMarkedWork(raw);
    if (!parsed.body || parsed.body.length < 200) {
      throw new Error('这一章没有写出可用的正文，再试一次。');
    }
    const work = {
      title: parsed.title || meta.title || `第 ${no} 章`,
      kind: 'story',
      body: parsed.body,
      after: parsed.after || '',
      tags: Array.from(new Set(['连载', a.title].concat(parsed.tags || []))).slice(0, 6),
      topic: `连载《${a.title}》`,
      era: (prompt.eraById(profile(), a.era) || {}).label || '自然声线',
      date: util.todayStr(),
      chapterNo: no
    };
    const formats = settings.writing.autoDocx ? ['md', 'docx'] : ['md'];
    const saved = await saveSerialChapter({ serial: a, work, outDir: settings.writing.outDir, formats });
    a.chapters.push({
      no,
      title: work.title,
      date: work.date,
      path: saved.mdPath,
      words: util.countWords(work.body)
    });
    a.updatedAt = new Date().toISOString();
    a.nextAt = new Date(Date.now() + Math.max(1, Number(settings.serial.everyDays) || 14) * 86400000).toISOString();
    if (no >= total) a.status = 'done';
    saveSerials();
    settings.serial.lastAt = new Date().toISOString();
    saveSettings();
    sendStudio('works:changed', {});
    notify('Liven', `《${a.title}》第 ${no} 章写完了。`);
    return { ok: true, work, saved, serial: serialStatus() };
  } catch (e) {
    notify('Liven', `连载没写成：${e.message}`);
    return { ok: false, reason: 'error', message: e.message };
  } finally {
    serialBusy = false;
  }
}

function initScheduler() {
  scheduler = new Scheduler({
    getSettings: () => settings,
    onFire: async ({ topic, kind }) => {
      // 写作与阅读/连载彻底分开：到点先写今天的稿子。
      await runScheduledWriting('scheduled', topic, kind);
    }
  });
  scheduler.start();
  startAuxScheduler();
}

let auxTimer = null;
let auxKick = null;
function startAuxScheduler() {
  if (auxTimer) clearInterval(auxTimer);
  if (auxKick) clearTimeout(auxKick);
  auxKick = setTimeout(auxTick, 25000);
  auxTimer = setInterval(auxTick, 30 * 60 * 1000);
}

async function auxTick() {
  if (!hasKey() || writeBusy || readingBusy || serialBusy) return;
  try {
    if (readingDue()) await runScheduledReading('timer');
    if (serialDue()) await runScheduledSerial('timer');
  } catch (e) {
    // 定时轮询失败不弹窗，等下一个周期再试。
    console.warn('[aux]', e.message);
  }
}

/* ---------------------------------- IPC ---------------------------------- */

function registerIpc() {
  ipcMain.handle('privacy:clear', (e, what) => {
    try {
      const cleared = [];
      const doChat = what === 'chat' || what === 'all';
      const doLibrary = what === 'library' || what === 'all';
      const doReading = what === 'reading' || what === 'all';
      const doSerials = what === 'serials' || what === 'all';
      const doKey = what === 'apiKey' || what === 'all';

      if (doChat) {
        memory = { messages: [], summary: '' };
        saveMemory();
        cleared.push('聊天记录');
      }
      if (doLibrary) {
        const file = library ? library.file : path.join(app.getPath('userData'), 'library.json');
        try { fs.rmSync(file, { force: true }); } catch (err) { /* ignore */ }
        library = new Library(file);
        library.save();
        cleared.push('书架记录');
      }
      if (doReading) {
        reading = [];
        saveReading();
        cleared.push('阅读记录');
      }
      if (doSerials) {
        serial = { active: null, history: [] };
        saveSerials();
        cleared.push('连载记录');
      }
      if (doKey) {
        settings.llm.apiKey = '';
        saveSettings();
        broadcastSettings();
        cleared.push('API Key');
      }
      return { ok: true, cleared };
    } catch (err) {
      return { error: err.message || '清理失败。' };
    }
  });

  ipcMain.handle('settings:get', () => ({
    settings,
    providers: llm.PROVIDERS,
    paths: {
      workspace: ROOT, dataDir: app.getPath('userData'), docs: DOCS,
      knowledge: KNOWLEDGE, assets: ASSETS, settingsFile
    }
  }));

  ipcMain.handle('settings:save', (e, next) => {
    const merged = util.deepMerge(settings, next || {});
    merged.llm.temperature = util.clamp(Number(merged.llm.temperature) || 0.9, 0, 1.5);
    merged.ui.petScale = util.clamp(Number(merged.ui.petScale) || 1, 0.7, 1.8);
    merged.ui.userName = String(merged.ui.userName || '').trim().slice(0, 20) || '朋友';
    settings = merged;
    saveSettings();
    applyAutoStart();
    if (petWin) {
      pinPet(!!settings.ui.alwaysOnTop);
      const scale = util.clamp(Number(settings.ui.petScale) || 1, 0.7, 1.8);
      const w = Math.round(380 * scale);
      const h = Math.round(560 * scale);
      const b = petWin.getBounds();
      petWin.setBounds({ x: b.x, y: b.y + (b.height - h), width: w, height: h });
      petWin.webContents.send('settings:changed', settings);
    }
    initScheduler();
    refreshTrayMenu();
    broadcastSettings();
    return settings;
  });

  ipcMain.handle('pet:scale', (e, value) => {
    if (!petWin) return null;
    const scale = util.clamp(Number(value) || settings.ui.petScale || 1, 0.7, 1.8);
    settings.ui.petScale = scale;
    saveSettings();
    const w = Math.round(380 * scale);
    const h = Math.round(560 * scale);
    const b = petWin.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const x = Math.min(Math.max(b.x, area.x), area.x + area.width - w);
    const y = Math.min(Math.max(b.y + (b.height - h), area.y), area.y + area.height - h);
    petWin.setBounds({ x, y, width: w, height: h });
    petWin.webContents.send('settings:changed', settings);
    return scale;
  });

  ipcMain.handle('app:state', () => appState());

  ipcMain.handle('chat:history', () => ({
    messages: memory.messages.slice(-40),
    summary: memory.summary,
    hasKey: hasKey()
  }));

  ipcMain.handle('chat:send', async (e, payload) => {
    try {
      const text = typeof payload === 'string' ? payload : (payload && payload.text);
      const link = typeof payload === 'object' && payload ? payload.link : null;
      return await handleChat(text, link);
    } catch (err) {
      return { error: err.message || '调用失败' };
    }
  });

  ipcMain.handle('chat:reset', () => {
    memory = { messages: [], summary: '' };
    saveMemory();
    return { ok: true };
  });

  ipcMain.handle('llm:test', async (e, cfg) => {
    try {
      const merged = { ...llmConfig(), ...(cfg || {}) };
      const result = await llm.testConnection(merged);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('write:generate', async (e, payload) => {
    try {
      return await generateWork(payload || {});
    } catch (err) {
      return { error: err.message || '写作失败' };
    }
  });

  ipcMain.handle('write:prompt', (e, payload) => {
    try {
      const opts = normalizeWorkPayload(payload);
      const dateStr = util.todayStr();
      return {
        prompt: prompt.offlinePromptPack({ profile: profile(), ...opts, dateStr, userName: settings.ui.userName }),
        meta: { ...opts, date: dateStr }
      };
    } catch (err) {
      return { error: err.message || '生成提示词失败' };
    }
  });

  ipcMain.handle('write:save', async (e, payload) => {
    try {
      return await handleSaveWork(payload || {});
    } catch (err) {
      return { error: err.message || '保存失败' };
    }
  });

  ipcMain.handle('write:parse', (e, payload) => {
    try {
      return { work: parsePasted(payload && payload.text, (payload && payload.meta) || {}) };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('works:list', () => listWorks(settings.writing.outDir));

  ipcMain.handle('works:read', (e, file) => {
    try { return { content: readWork(file) }; }
    catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('works:reveal', async (e, file) => {
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    return { ok: true };
  });

  ipcMain.handle('works:open', async (e, file) => {
    const target = fs.existsSync(file) ? file : file.replace(/\.md$/i, '.docx');
    const err = await shell.openPath(target);
    return { ok: !err, error: err };
  });

  ipcMain.handle('works:delete', async (e, file) => {
    try {
      const md = file;
      const docx = file.replace(/\.md$/i, '.docx');
      if (fs.existsSync(md)) await shell.trashItem(md);
      if (fs.existsSync(docx)) await shell.trashItem(docx);
      sendStudio('works:changed', {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

function friendlyNetError(err) {
  const msg = String((err && err.message) || '');
  if (/fetch failed|timeout|timed out|ajax|net::|ECONN|ENOTFOUND|ERR_/i.test(msg)) {
    return '连不上这个站点（当前网络可能无法访问）。可以换「我的故事」或「网页」。';
  }
  return msg || '网络请求失败';
}

  ipcMain.handle('library:search', async (e, { source, q }) => {
    try {
      if (source === 'local') return { results: sources.listLocalBooks(CORPUS, q) };
      if (source === 'gushiwen') return { results: await sources.searchGushiwen(q) };
      return { results: await sources.search5000yan(q) };
    } catch (err) {
      return { error: friendlyNetError(err) };
    }
  });

  ipcMain.handle('library:open', async (e, { source, id }) => {
    try {
      let book;
      if (source === 'local') book = sources.readLocalBook(CORPUS, id);
      else if (source === 'file') book = sources.readLocalFile(id);
      else if (source === 'gushiwen') book = await sources.readGushiwenBook(id);
      else if (source === 'web') book = await sources.readUrl(id);
      else if (source === 'yan5000') book = await sources.read5000yan(id);
      else throw new Error('这是旧版书架留下的记录，已经失效了。重新搜一本吧。');
      library.upsert(book);
      return { book };
    } catch (err) {
      return { error: friendlyNetError(err) };
    }
  });

  ipcMain.handle('library:progress', (e, { key, percent }) => {
    library.progress(key, percent);
    return { ok: true };
  });

  ipcMain.handle('library:recent', () => ({ recent: library.recent() }));

  ipcMain.handle('library:import', async () => {
    try {
      const r = await dialog.showOpenDialog(studioWin, {
        title: '打开本地文本或 Word',
        properties: ['openFile'],
        filters: [
          { name: '文本与 Word', extensions: ['txt', 'md', 'docx'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (r.canceled || !r.filePaths.length) return { canceled: true };
      const book = sources.readLocalFile(r.filePaths[0]);
      library.upsert(book);
      return { book };
    } catch (err) {
      return { error: err.message || '导入失败' };
    }
  });

  ipcMain.handle('schedule:status', () => {
    const base = scheduler ? scheduler.status() : null;
    if (!base) return null;
    const days = Math.max(1, Number(settings.reading.everyDays) || 7);
    const last = settings.reading.lastAt ? new Date(settings.reading.lastAt).getTime() : 0;
    return {
      ...base,
      reading: {
        enabled: !!settings.reading.enabled,
        everyDays: days,
        lastAt: settings.reading.lastAt || '',
        next: new Date((last || Date.now()) + days * 86400000).toISOString()
      },
      serial: serialStatus()
    };
  });

  ipcMain.handle('schedule:run', async () => runScheduledWriting('manual'));

  ipcMain.handle('reading:run', async () => runScheduledReading('manual'));

  ipcMain.handle('reading:list', () => ({ entries: reading.slice(0, 100) }));

  ipcMain.handle('serial:status', () => serialStatus());

  ipcMain.handle('serial:run', async () => runScheduledSerial('manual'));

  ipcMain.handle('serial:read', (e, file) => {
    try {
      return { text: readWork(file) };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('serial:open', async () => {
    const a = serial.active;
    const last = a && a.chapters && a.chapters.length ? a.chapters[a.chapters.length - 1] : null;
    if (!last) return { ok: false, message: '还没有章节。' };
    const dir = path.dirname(last.path);
    await shell.openPath(dir);
    return { ok: true };
  });

  ipcMain.handle('setup:get', () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    defaultOut: path.join(app.getPath('documents'), 'Eternity coffee', '作品'),
    docs: DOCS,
    userName: settings.ui.userName || '',
    providers: llm.PROVIDERS
  }));

  ipcMain.handle('setup:pick-outdir', async () => {
    const options = {
      title: '选择作品目录',
      defaultPath: settings.writing.outDir || path.join(app.getPath('documents'), 'Eternity coffee', '作品'),
      properties: ['openDirectory', 'createDirectory']
    };
    const result = setupWin && !setupWin.isDestroyed()
      ? await dialog.showOpenDialog(setupWin, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('setup:complete', (e, payload) => {
    try {
      return finishSetup(payload);
    } catch (err) {
      return { error: err.message || '保存初次设置失败。' };
    }
  });

  ipcMain.handle('setup:skip', () => {
    settings.setupDone = true;
    if (!settings.ui.userName) settings.ui.userName = '朋友';
    saveSettings();
    if (setupWin && !setupWin.isDestroyed()) setupWin.close();
    return { ok: true };
  });

  ipcMain.handle('setup:open', () => {
    openSetup();
    return { ok: true };
  });

  ipcMain.handle('app:open-external', async (e, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('app:open-folder', async (e, which) => {
    const map = {
      works: settings.writing.outDir,
      data: app.getPath('userData'),
      docs: DOCS,
      assets: path.join(ASSETS, 'character')
    };
    const target = map[which] || settings.writing.outDir;
    fs.mkdirSync(target, { recursive: true });
    await shell.openPath(target);
    return { ok: true };
  });

  ipcMain.handle('app:open-studio', (e, section) => {
    openStudio(section);
    return { ok: true };
  });

  ipcMain.handle('app:pick-character', async () => {
    const win = studioWin && !studioWin.isDestroyed() ? studioWin : null;
    const options = {
      title: '选择 Liven 的立绘',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'webp', 'jpg', 'jpeg'] }]
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const dir = path.join(ASSETS, 'character');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, 'custom' + ext);
      fs.copyFileSync(src, dest);
      settings.ui.character = dest;
      saveSettings();
      broadcastSettings();
      return { ok: true, path: dest, url: pathToFileURL(dest).href };
    } catch (err) {
      return { error: err.message || '复制图片失败' };
    }
  });

  ipcMain.handle('app:notify', (e, { title, body }) => {
    notify(title || 'Liven', body || '');
    return { ok: true };
  });

  ipcMain.handle('pet:say', (e, text) => {
    petSay(text || voice.petLine('idle', { name: settings.ui.userName }));
    return { ok: true };
  });

  ipcMain.handle('pet:line', (e, opts) => voice.petLine((opts && opts.kind) || 'idle', { ...(opts || {}), name: settings.ui.userName }));

  ipcMain.on('pet:drag-start', (e, p) => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    drag = { start: p, win: { x, y }, moved: false, startedAt: Date.now() };
    if (drag.timer) clearInterval(drag.timer);
    drag.timer = setInterval(() => {
      if (!petWin || !drag) return;
      // 兜底：鼠标在别的窗口松开时 pointerup 可能丢失，别让拖动无限持续。
      if (Date.now() - drag.startedAt > 30000) {
        clearInterval(drag.timer);
        drag = null;
        return;
      }
      const c = screen.getCursorScreenPoint();
      const dx = c.x - drag.start.x;
      const dy = c.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const b = petWin.getBounds();
      const area = screen.getDisplayNearestPoint(c).workArea;
      const nx = util.clamp(Math.round(drag.win.x + dx), area.x - b.width + 80, area.x + area.width - 80);
      const ny = util.clamp(Math.round(drag.win.y + dy), area.y - 40, area.y + area.height - 80);
      petWin.setPosition(nx, ny);
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    const moved = !!(drag && drag.moved);
    if (drag && drag.timer) clearInterval(drag.timer);
    drag = null;
    // 只保存真正拖动过的位置；单击桌宠不应该改写位置。
    if (petWin && moved) {
      const b = petWin.getBounds();
      settings.ui.petPos = { x: b.x, y: b.y };
      saveSettings();
    }
  });

  ipcMain.on('pet:menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开写作间', click: () => openStudio() },
      { label: '和 Liven 说话', click: () => openStudio('chat') },
      { label: '写一篇', click: () => openStudio('write') },
      { label: '逛书架', click: () => openStudio('shelf') },
      { type: 'separator' },
      { label: '说句话', click: () => petSay(voice.petLine('idle', { name: settings.ui.userName })) },
      { type: 'separator' },
      { label: '让 Liven 休息（退出）', click: () => { quitting = true; app.quit(); } }
    ]);
    menu.popup({ window: petWin });
  });
}

/* --------------------------------- lifecycle ------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openStudio());

  app.whenReady().then(() => {
    loadSettings();
    loadMemory();
    loadReading();
    loadSerials();
    library = new Library(path.join(app.getPath('userData'), 'library.json'));

    Menu.setApplicationMenu(null);
    registerIpc();
    createPet();
    createStudio();
    if (!settings.setupDone) setTimeout(openSetup, 500);
    buildTray();
    applyAutoStart();
    initScheduler();

    if (!startHidden) {
      setTimeout(() => {
        const p = profile();
        petSay(p ? voice.petLine('idle', { name: settings.ui.userName }) : '我还没读到你的故事。要不要先看看设定？');
      }, 1800);
    }

    if (isDev) {
      globalShortcut.register('CommandOrControl+Shift+L', () => openStudio());
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    if (scheduler) scheduler.stop();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray; quitting goes through the tray menu.
  });

  app.on('activate', () => openStudio());
}
