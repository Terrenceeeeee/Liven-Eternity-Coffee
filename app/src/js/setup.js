'use strict';

const A = window.liven;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const S = {
  step: 1,
  providers: {},
  cfg: null,
  skipKey: false,
  testing: false,
  saving: false
};

function setStatus(sel, text, kind) {
  const el = $(sel);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function go(step) {
  S.step = step;
  $$('.step').forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === step));
  $$('#steps li').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  const focus = $(`.step[data-step="${step}"] input, .step[data-step="${step}"] select, .step[data-step="${step}"] button`);
  if (focus) setTimeout(() => focus.focus(), 60);
}

function provider() {
  return S.providers[$('#provider').value] || {};
}

function syncProvider(id) {
  const p = S.providers[id] || {};
  $('#baseURL').value = p.baseURL || '';
  $('#model').value = p.model || '';
  $('#providerNote').textContent = p.note || '';
  $('#apiKey').placeholder = id === 'ollama' ? '本地模型可留空' : 'sk-...';
}

function currentLLM() {
  return {
    provider: $('#provider').value,
    baseURL: $('#baseURL').value.trim(),
    model: $('#model').value.trim(),
    apiKey: $('#apiKey').value.trim()
  };
}

function validateLLM() {
  const cfg = currentLLM();
  if (!cfg.baseURL) return 'Base URL 不能为空。';
  if (!cfg.model) return '模型名不能为空。';
  if (!cfg.apiKey && cfg.provider !== 'ollama') return '还没有填 Key。想先用本地台词，就点「先不填，用本地台词」。';
  return '';
}

async function testKey() {
  if (S.testing) return;
  const err = validateLLM();
  if (err) { setStatus('#status2', err, 'bad'); return; }
  S.testing = true;
  $('#testKey').disabled = true;
  setStatus('#status2', '正在敲门……', '');
  try {
    const res = await A.llmTest(currentLLM());
    if (res && res.ok) {
      setStatus('#status2', `门开了。${res.ms ? res.ms + ' ms · ' : ''}${res.sample || '在的'}`, 'ok');
    } else {
      setStatus('#status2', (res && res.error) || '连接失败，检查一下 Key 或网络。', 'bad');
    }
  } catch (e) {
    setStatus('#status2', e.message || '连接失败。', 'bad');
  } finally {
    S.testing = false;
    $('#testKey').disabled = false;
  }
}

function toStep3(skip) {
  if (skip) {
    S.skipKey = true;
    setStatus('#status3', '先用本地台词。以后想接通，到「设定 → 语言模型」里填 Key 就行。', '');
  } else {
    const err = validateLLM();
    if (err) { setStatus('#status2', err, 'bad'); return; }
    S.skipKey = false;
    S.cfg = currentLLM();
    setStatus('#status3', '', '');
  }
  go(3);
}

async function browseOutDir() {
  try {
    const res = await A.setupPickOutDir($('#outDir').value.trim());
    if (res && res.path) $('#outDir').value = res.path;
    if (res && res.error) setStatus('#status3', res.error, 'bad');
  } catch (e) {
    setStatus('#status3', e.message || '选择目录失败。', 'bad');
  }
}

async function finish() {
  if (S.saving) return;
  const outDir = $('#outDir').value.trim();
  if (!outDir) { setStatus('#status3', '作品目录不能为空。', 'bad'); return; }
  S.saving = true;
  $('#finish').disabled = true;
  $('#finish').textContent = '正在开门……';
  setStatus('#status3', '', '');
  try {
    const payload = {
      llm: S.skipKey ? null : (S.cfg || currentLLM()),
      outDir,
      userName: $('#userName').value.trim(),
      autoStart: $('#autoStart').checked,
      openStudio: $('#openStudio').checked,
      skipKey: S.skipKey
    };
    const res = await A.setupComplete(payload);
    if (res && res.ok) {
      setStatus('#status3', '好了。', 'ok');
      return;
    }
    setStatus('#status3', (res && res.error) || '保存失败，再试一次。', 'bad');
  } catch (e) {
    setStatus('#status3', e.message || '保存失败，再试一次。', 'bad');
  } finally {
    S.saving = false;
    $('#finish').disabled = false;
    $('#finish').textContent = '开始营业';
  }
}

async function boot() {
  let info;
  try {
    info = await A.setupGet();
  } catch (e) {
    setStatus('#hint1', '初始化信息读取失败：' + (e.message || e), 'bad');
    return;
  }
  S.providers = info.providers || {};
  const ids = Object.keys(S.providers);
  const providerEl = $('#provider');
  providerEl.innerHTML = '';
  ids.forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = S.providers[id].label || id;
    providerEl.appendChild(opt);
  });
  const preferred = ids.includes('deepseek') ? 'deepseek' : ids[0];
  if (preferred) {
    providerEl.value = preferred;
    syncProvider(preferred);
  }

  $('#pDataDir').textContent = info.dataDir || '%APPDATA%\\liven-pet';
  $('#pWorksDir').textContent = info.defaultOut || '文档\\Eternity coffee\\作品';
  $('#outDir').value = info.defaultOut || '';
  $('#userName').value = info.userName && info.userName !== '朋友' ? info.userName : '';

  providerEl.addEventListener('change', (e) => syncProvider(e.target.value));
  $('#agree').addEventListener('change', (e) => {
    $('#toStep2').disabled = !e.target.checked;
    setStatus('#hint1', e.target.checked ? '' : '勾选后继续', '');
  });
  $('#toStep2').addEventListener('click', () => go(2));
  $('#backTo1').addEventListener('click', () => go(1));
  $('#backTo2').addEventListener('click', () => go(2));
  $('#testKey').addEventListener('click', testKey);
  $('#toStep3').addEventListener('click', () => toStep3(false));
  $('#skipKey').addEventListener('click', () => toStep3(true));
  $('#browse').addEventListener('click', browseOutDir);
  $('#finish').addEventListener('click', finish);
}

boot();
