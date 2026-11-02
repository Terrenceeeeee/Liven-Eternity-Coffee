'use strict';

const api = window.liven;
const el = {
  stage: document.getElementById('stage'),
  pet: document.getElementById('pet'),
  sprite: document.getElementById('sprite'),
  bubble: document.getElementById('bubble'),
  text: document.getElementById('bubbleText'),
  thinking: document.getElementById('thinking'),
  hint: document.getElementById('hint'),
  btnWrite: document.getElementById('btnWrite'),
  btnStudio: document.getElementById('btnStudio')
};

let settings = { ui: { bubbleMs: 9000 } };
let typingTimer = null;
let hideTimer = null;
let idleTimer = null;
let fullText = '';
let typing = false;
let thinking = false;
let poses = {};
let customChar = '';
let poseTimer = null;
let poseActive = false;
let blinkTimer = null;
let blinkBusy = false;
let basePose = 'blinkOpen';
let lastInteraction = Date.now();

function clearTimers() {
  if (typingTimer) clearInterval(typingTimer);
  if (hideTimer) clearTimeout(hideTimer);
  typingTimer = null;
  hideTimer = null;
}

function hideBubble() {
  clearTimers();
  el.bubble.classList.add('hidden');
  el.text.textContent = '';
  el.sprite.classList.remove('talking');
  typing = false;
  fullText = '';
}

function scheduleHide(ms) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBubble, Math.max(2600, ms));
}

function showLine(text) {
  if (!text) return;
  if (thinking) return;
  if (!el.bubble.classList.contains('hidden') && text === fullText) return;
  if (el.sprite.src === poses.blinkClose) setSprite(poses.blinkOpen);
  clearTimers();
  el.bubble.classList.remove('hidden');
  el.text.textContent = '';
  el.sprite.classList.add('talking');
  fullText = text;
  typing = true;
  let i = 0;
  const speed = text.length > 60 ? 18 : 26;
  typingTimer = setInterval(() => {
    i += 1;
    el.text.textContent = text.slice(0, i);
    if (i >= text.length) {
      finishTyping();
    }
  }, speed);
}

function finishTyping() {
  if (typingTimer) clearInterval(typingTimer);
  typingTimer = null;
  typing = false;
  el.text.textContent = fullText;
  scheduleHide(settings.ui.bubbleMs || 9000);
}

async function speak(kind = 'idle', event) {
  try {
    const line = await api.petLine({ kind, event });
    if (line) showLine(line);
  } catch (e) { /* ignore */ }
}

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  const wait = 42000 + Math.random() * 40000;
  idleTimer = setTimeout(() => {
    if (el.bubble.classList.contains('hidden') && !thinking) speak('idle');
    scheduleIdle();
  }, wait);
}

function setThinking(on) {
  thinking = !!on;
  el.thinking.classList.toggle('hidden', !thinking);
  if (thinking) hideBubble();
}

/* -------------------------------- poses --------------------------------- */

function hasCustom() {
  return !!(settings.ui && settings.ui.character) && !!customChar;
}

function setSprite(url) {
  if (url && el.sprite.src !== url) el.sprite.src = url;
}

function applyPose(name, holdMs) {
  if (hasCustom()) return;
  const url = poses[name];
  if (!url) return;
  setSprite(url);
  poseActive = true;
  el.sprite.classList.remove('pose-swap');
  void el.sprite.offsetWidth;
  el.sprite.classList.add('pose-swap');
  setTimeout(() => el.sprite.classList.remove('pose-swap'), 460);
  if (poseTimer) clearTimeout(poseTimer);
  poseTimer = null;
  if (holdMs) {
    poseTimer = setTimeout(() => { restorePose(); }, holdMs);
  }
}

function restorePose() {
  poseActive = false;
  if (poseTimer) clearTimeout(poseTimer);
  poseTimer = null;
  if (hasCustom()) { setSprite(customChar); return; }
  setSprite(poses[basePose] || '');
}

/* 眨眼：只在待机帧上闪一下，动作/说话/自定义立绘时不做 */
function scheduleBlink() {
  if (blinkTimer) clearTimeout(blinkTimer);
  blinkTimer = setTimeout(async () => {
    const canBlink = !blinkBusy && !poseActive && !hasCustom()
      && !thinking && !document.hidden
      && el.bubble.classList.contains('hidden')
      && el.sprite.src === poses.blinkOpen;
    if (canBlink && poses.blinkClose) {
      blinkBusy = true;
      setSprite(poses.blinkClose);
      await new Promise((r) => setTimeout(r, 118));
      if (!poseActive && el.sprite.src === poses.blinkClose) setSprite(poses.blinkOpen);
      blinkBusy = false;
    }
    scheduleBlink();
  }, 3800 + Math.random() * 3600);
}

/* 打哈欠：夜里或长时间没互动时偶尔来一次 */
function scheduleNap() {
  const wait = 90000 + Math.random() * 90000;
  setTimeout(() => {
    const hour = new Date().getHours();
    const late = hour >= 22 || hour < 2;
    const away = Date.now() - lastInteraction > 4 * 60 * 1000;
    if ((late || away) && !poseActive && !thinking && !hasCustom()
      && el.bubble.classList.contains('hidden')) {
      applyPose('yawn', 2400);
    }
    scheduleNap();
  }, wait);
}

function preloadPoses() {
  Object.values(poses).forEach((u) => {
    if (!u) return;
    const im = new Image();
    im.src = u;
  });
}

/* ------------------------------- events -------------------------------- */

let down = null;
let moved = false;

el.pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY };
  moved = false;
  el.pet.classList.add('dragging');
  try { el.pet.setPointerCapture(e.pointerId); } catch (err) {}
  api.petDragStart({ x: e.screenX, y: e.screenY });
});

el.pet.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) moved = true;
});

el.pet.addEventListener('pointerup', (e) => {
  if (!down) return;
  api.petDragEnd();
  el.pet.classList.remove('dragging');
  try { el.pet.releasePointerCapture?.(e.pointerId); } catch (err) {}
  const wasClick = !moved && e.button === 0;
  down = null;
  lastInteraction = Date.now();
  if (wasClick) {
    if (!el.bubble.classList.contains('hidden')) {
      if (typing) finishTyping();
      else hideBubble();
    } else {
      applyPose('surprise', 900);
      speak('idle');
    }
  }
}); 

el.pet.addEventListener('pointercancel', () => {
  if (down) api.petDragEnd();
  down = null;
  el.pet.classList.remove('dragging');
});

// 焦点被游戏/其他窗口抢走时 pointerup 可能收不到，兜底结束拖动，避免窗口一直跟着鼠标跑。
function endDragOnBlur() {
  if (!down) return;
  api.petDragEnd();
  down = null;
  el.pet.classList.remove('dragging');
}
window.addEventListener('blur', endDragOnBlur);
document.addEventListener('pointerleave', endDragOnBlur);

el.pet.addEventListener('dblclick', (e) => {
  e.preventDefault();
  lastInteraction = Date.now();
  applyPose('wave', 1500);
  hideBubble();
  setTimeout(() => api.openStudio('chat'), 620);
});

el.stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.petMenu();
});

el.bubble.addEventListener('click', (e) => {
  e.stopPropagation();
  if (typing) finishTyping();
  else hideBubble();
});

el.btnStudio.addEventListener('click', (e) => {
  e.stopPropagation();
  api.openStudio('chat');
});

el.btnWrite.addEventListener('click', (e) => {
  e.stopPropagation();
  api.openStudio('write');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideBubble();
});

api.onPetLine((payload) => {
  if (payload && payload.text) showLine(payload.text);
});

api.onThinking((payload) => setThinking(payload && payload.on));

api.onSettingsChanged(async (next) => {
  const prevChar = settings.ui && settings.ui.character;
  settings = next;
  if (prevChar !== (next.ui && next.ui.character)) {
    const state = await api.appState();
    customChar = (next.ui && next.ui.character && state.characterUrl) || '';
    if (state.petPoses) {
      poses = state.petPoses;
      preloadPoses();
    }
    restorePose();
  }
});

/* -------------------------------- init ---------------------------------- */

(async function init() {
  let state = null;
  try {
    const [got, st] = await Promise.all([api.settingsGet(), api.appState()]);
    state = st;
    settings = (got && got.settings) || settings;
    poses = (state && state.petPoses) || {};
    preloadPoses();
    customChar = (settings.ui && settings.ui.character && state.characterUrl) || '';
    if (customChar) el.sprite.src = customChar;
    else restorePose();
  } catch (e) { /* keep defaults */ }
  scheduleIdle();
  scheduleBlink();
  scheduleNap();
  el.hint.classList.remove('hidden');
  setTimeout(() => el.hint.classList.add('hidden'), 5200);
  setTimeout(() => {
    if (state && state.firstRun) {
      applyPose('offer', 1800);
      speak('event', 'welcome');
    } else {
      speak('idle');
    }
  }, 1200);
})();
