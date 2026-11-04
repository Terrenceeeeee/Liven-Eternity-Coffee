'use strict';

(function () {
  const A = window.liven;

  const S = {
    settings: null,
    providers: {},
    paths: {},
    state: null,
    chat: [],
    chatBusy: false,
    chatStream: null,
    link: null,
    kind: 'recommend',
    excerpt: '',
    sourceTitle: '',
    writeBusy: false,
    writeRaw: '',
    result: null,
    works: [],
    worksFilter: 'all',
    library: {
      source: 'local',
      book: null,
      results: [],
      recent: [],
      sel: '',
      loading: false
    },
    schedule: null
  };

  const INTRO = '……你来啦。\n\n店还开着。要喝点什么吗？还是，先说说话。';
  const SOURCE_LABEL = { local: '我的故事', file: '本地文件', yan5000: '5000言', gushiwen: '古文岛', web: '网页' };
  const PROVIDER_NOTE = {
    deepseek: '在 DeepSeek 开放平台创建一个 Key。写作建议用 deepseek-chat，便宜也够用。',
    moonshot: '在 Moonshot 开放平台创建 Key。长文写作可用 moonshot-v1-8k 或更长的版本。',
    openai: '需要 OpenAI 的 Key。模型可改成 gpt-4o 或 gpt-4o-mini。',
    ollama: '本地 Ollama 默认不需要 Key。先确认 ollama serve 已经开着，模型已 pull 下来。',
    custom: '任何 OpenAI 兼容接口：填 Base URL、模型名与 Key。'
  };

  let progressTimer = null;
  let selText = '';
  let resetArmAt = 0;

  /* ================================ 工具 ================================ */

  function hasKey() {
    return !!(S.settings && S.settings.llm && String(S.settings.llm.apiKey || '').trim());
  }

  /* ============================ 时间与窗外 ============================ */

  const WEEK = '日一二三四五六';

  function daypartOf(hour) {
    if (hour < 5) return { key: 'late', label: '深夜' };
    if (hour < 7) return { key: 'dawn', label: '清晨' };
    if (hour < 11) return { key: 'morning', label: '上午' };
    if (hour < 14) return { key: 'noon', label: '正午' };
    if (hour < 17) return { key: 'afternoon', label: '午后' };
    if (hour < 19) return { key: 'dusk', label: '傍晚' };
    if (hour < 23) return { key: 'night', label: '夜晚' };
    return { key: 'late', label: '深夜' };
  }

  function updateClock() {
    const now = new Date();
    const part = daypartOf(now.getHours());
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    const timeEl = $('#clockTime');
    const dateEl = $('#clockDate');
    const phaseEl = $('#clockPhase');
    if (timeEl) timeEl.textContent = `${hh}:${mm}`;
    if (dateEl) dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEK[now.getDay()]}`;
    if (phaseEl) phaseEl.textContent = part.label;
    document.body.dataset.daypart = part.key;
    const clock = $('#sideClock');
    if (clock) {
      clock.title = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${hh}:${mm} · ${part.label}（本地时间）`;
    }
  }

  function startClock() {
    updateClock();
    setInterval(updateClock, 20000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateClock();
    });
  }

  function setLink(link) {
    if (!link || !link.title) {
      S.link = null;
    } else {
      S.link = {
        type: link.type === 'work' ? 'work' : 'book',
        title: String(link.title).slice(0, 120),
        author: String(link.author || '').slice(0, 80),
        text: String(link.text || '').slice(0, 1600)
      };
    }
    renderLink();
  }

  function renderLink() {
    const box = $('#chatLink');
    if (!box) return;
    box.classList.toggle('hidden', !S.link);
    if (!S.link) return;
    box.dataset.type = S.link.type;
    $('#chatLinkLabel').textContent = S.link.type === 'work' ? '刚写完' : '正在读';
    $('#chatLinkText').textContent = S.link.type === 'work'
      ? `《${S.link.title}》`
      : `《${S.link.title}》${S.link.author ? ` · ${S.link.author}` : ''}`;
  }

  function chatDigest() {
    const msgs = (S.chat || []).slice(-8).filter(m => m && m.content);
    if (!msgs.length) return '';
    const name = (S.settings.ui && S.settings.ui.userName) || '朋友';
    return msgs.map(m => `${m.role === 'user' ? name : 'Liven'}：${String(m.content).slice(0, 260)}`).join('\n');
  }

  function prefillChat(text) {
    nav('chat');
    const ta = $('#chatText');
    ta.value = text;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function scrollChat() {
    const log = $('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function setSendBusy(busy) {
    const btn = $('#btnSend');
    btn.disabled = busy;
    btn.textContent = busy ? '……' : '发送';
  }

  function updateStatus() {
    const dot = $('#sideStatus');
    if (!dot) return;
    const span = dot.querySelector('span');
    const label = S.providers[S.settings.llm.provider];
    if (hasKey()) {
      dot.classList.add('online');
      dot.classList.remove('offline');
      span.textContent = `已接通 ${label ? label.label : S.settings.llm.provider}`;
    } else {
      dot.classList.remove('online');
      dot.classList.add('offline');
      span.textContent = '本地台词模式';
    }
    $('#offlineBanner').classList.toggle('hidden', hasKey());
  }

  function nav(section) {
    const allowed = ['chat', 'write', 'shelf', 'works', 'settings'];
    const target = allowed.includes(section) ? section : 'chat';
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.section === target));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + target));
    S.section = target;
    try { history.replaceState(null, '', '#' + target); } catch (e) { /* ignore */ }
    if (target === 'works') { refreshWorks(); refreshSerial(); }
    if (target === 'shelf') {
      loadRecent();
      if (S.library.source === 'local' && !$('#searchResults').children.length) doSearch({ preventDefault() {} });
    }
    if (target === 'settings') { refreshSchedule(); refreshSerial(); }
    if (target === 'chat') setTimeout(scrollChat, 30);
  }

  /* ================================ 对话 ================================ */

  function appendMsg(role, text, opts = {}) {
    const wrap = makeEl('div', { class: 'msg ' + role });
    const avatar = makeEl('div', { class: 'avatar', text: role === 'user' ? '你' : '' });
    const body = makeEl('div', { class: 'body' });
    const bubble = makeEl('div', { class: 'bubble', text: text || '' });
    if (opts.streaming) bubble.classList.add('streaming');
    if (opts.error) bubble.classList.add('error');
    const meta = makeEl('div', { class: 'meta' });
    if (opts.tag) meta.appendChild(makeEl('span', { class: 'tag', text: opts.tag }));
    meta.appendChild(document.createTextNode(fmtTime(opts.t)));
    body.appendChild(bubble);
    body.appendChild(meta);
    wrap.appendChild(avatar);
    wrap.appendChild(body);
    $('#chatLog').appendChild(wrap);
    return { wrap, bubble, meta, body };
  }

  function renderChat() {
    const log = $('#chatLog');
    log.textContent = '';
    if (!S.chat.length) {
      appendMsg('assistant', INTRO, { tag: '初次见面' });
      return;
    }
    S.chat.forEach(m => appendMsg(m.role, m.content, { t: m.t }));
    scrollChat();
  }

  async function loadChat() {
    const history = await A.chatHistory();
    S.chat = Array.isArray(history.messages) ? history.messages : [];
    renderChat();
  }

  function pushChat(role, text) {
    S.chat.push({ role, content: text, t: Date.now() });
    return appendMsg(role, text);
  }

  async function sendChat(text) {
    const value = String(text || '').trim();
    if (!value) return;
    if (S.chatBusy) { toast('等她把这一句说完。'); return; }

    const ta = $('#chatText');
    ta.value = '';
    ta.style.height = 'auto';
    pushChat('user', value);
    scrollChat();

    S.chatBusy = true;
    setSendBusy(true);
    const node = appendMsg('assistant', '', { streaming: true });
    S.chatStream = { node, buffer: '' };
    scrollChat();

    let res;
    try {
      res = await A.chatSend(value, S.link);
    } catch (err) {
      res = { error: err.message || '调用失败' };
    }

    const stream = S.chatStream;
    S.chatStream = null;
    S.chatBusy = false;
    setSendBusy(false);
    if (!stream) return;

    stream.node.bubble.classList.remove('streaming');
    if (res && res.error) {
      stream.node.bubble.classList.add('error');
      stream.node.bubble.textContent = res.error;
      return;
    }
    const reply = (res && res.reply) || stream.buffer || '……';
    stream.node.bubble.textContent = reply;
    if (res && res.offline) {
      stream.node.meta.prepend(makeEl('span', { class: 'tag', text: '本地台词' }));
    }
    S.chat.push({ role: 'assistant', content: reply, t: Date.now() });
    scrollChat();
  }

  function bindChat() {
    $('#chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChat($('#chatText').value);
    });

    $('#chatText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChat(e.target.value);
      }
    });

    $('#chatText').addEventListener('input', (e) => {
      const ta = e.target;
      ta.style.height = 'auto';
      ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    });

    $('#chatChips').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-say]');
      if (!btn) return;
      sendChat(btn.dataset.say);
    });

    $('#btnGoSettings').addEventListener('click', () => nav('settings'));

    $('#btnClearLink').addEventListener('click', () => {
      setLink(null);
      toast('不带了。');
    });

    $('#btnResetChat').addEventListener('click', async () => {
      const btn = $('#btnResetChat');
      if (Date.now() < resetArmAt) {
        resetArmAt = 0;
        await A.chatReset();
        S.chat = [];
        renderChat();
        btn.textContent = '清空对话';
        toast('对话清空了。');
        return;
      }
      resetArmAt = Date.now() + 3500;
      btn.textContent = '再点一次清空';
      setTimeout(() => {
        if (Date.now() >= resetArmAt) btn.textContent = '清空对话';
      }, 3600);
    });
  }

  /* ================================ 创作 ================================ */

  function setKind(kind) {
    S.kind = kind;
    $$('#kindSeg button').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    const topic = $('#wTopic');
    if (kind === 'review') topic.placeholder = '从书架带一篇，或填书名';
    else topic.placeholder = '';
  }

  function updateTone() {
    const v = Number($('#wTone').value);
    const label = v < 34 ? '偏克制' : v < 67 ? '平衡' : '偏抒情';
    $('#toneLabel').textContent = label;
  }

  function collectWrite() {
    return {
      kind: S.kind,
      topic: $('#wTopic').value.trim(),
      tone: Number($('#wTone').value),
      sourceTitle: S.sourceTitle,
      excerpt: S.excerpt,
      extra: $('#wExtra').value.trim(),
      chatDigest: chatDigest()
    };
  }

  function resetPreview() {
    S.result = null;
    S.writeRaw = '';
    $('#previewEmpty').classList.remove('hidden');
    $('#previewBusy').classList.add('hidden');
    $('#previewResult').classList.add('hidden');
    $('#offlinePanel').classList.add('hidden');
    $('#busyText').textContent = '';
  }

  function showBusy(label) {
    $('#previewEmpty').classList.add('hidden');
    $('#previewResult').classList.add('hidden');
    $('#offlinePanel').classList.add('hidden');
    $('#previewBusy').classList.remove('hidden');
    $('#busyLabel').textContent = label || '正在写……';
    $('#busyText').textContent = '';
    $('#busyText').scrollTop = 0;
  }

  function updateWords() {
    $('#rWords').textContent = countChars($('#rBody').value) + ' 字';
  }

  function showWork(work) {
    S.result = work;
    $('#previewEmpty').classList.add('hidden');
    $('#previewBusy').classList.add('hidden');
    $('#offlinePanel').classList.add('hidden');
    $('#previewResult').classList.remove('hidden');
    $('#rTitle').value = work.title || '';
    $('#rBody').value = work.body || '';
    $('#rAfter').value = work.after || '';
    $('#afterDetails').open = !!(work.after && String(work.after).trim());
    const era = work.era || '自然声线';
    $('#rMeta').textContent = [KINDS[work.kind] || '短篇', era, work.date || ''].filter(Boolean).join(' · ');
    updateWords();
    setLink({ type: 'work', title: work.title || '未命名', text: work.body || '' });
  }

  function showOffline(promptText) {
    $('#previewEmpty').classList.add('hidden');
    $('#previewBusy').classList.add('hidden');
    $('#previewResult').classList.add('hidden');
    $('#offlinePanel').classList.remove('hidden');
    $('#offlinePromptText').value = promptText || '';
  }

  async function generateWork(opts = {}) {
    if (S.writeBusy) return;
    const payload = collectWrite();
    if (!payload.topic && !payload.excerpt) {
      toast('给她一个题目，或者从书架带一段过来。');
      $('#wTopic').focus();
      return;
    }

    S.writeBusy = true;
    S.writeRaw = '';
    const btn = $('#btnGenerate');
    btn.disabled = true;
    btn.textContent = '正在写…';
    resetPreview();
    showBusy(`正在写「${payload.topic || payload.sourceTitle || '这一篇'}」……`);
    $('#busyText').textContent = '';

    let res;
    try {
      res = await A.writeGenerate(payload);
    } catch (err) {
      res = { error: err.message || '写作失败' };
    }

    S.writeBusy = false;
    btn.disabled = false;
    btn.textContent = '让 Liven 写';

    if (res && res.error) {
      $('#previewBusy').classList.add('hidden');
      $('#previewEmpty').classList.remove('hidden');
      toast(res.error, 4200);
      return;
    }
    if (res && res.offline) {
      showOffline(res.prompt);
      toast('还没有接通模型，提示词已经备好了。', 3600);
      return;
    }
    if (res && res.work) {
      showWork(res.work);
      if (opts.autoSave) await saveCurrentWork({ quiet: true });
    } else {
      resetPreview();
      toast('没有拿到稿子，再试一次。');
    }
    return res;
  }

  async function saveCurrentWork(opts = {}) {
    if (!S.result) return;
    const work = Object.assign({}, S.result, {
      title: $('#rTitle').value.trim() || '未命名',
      body: $('#rBody').value.trim(),
      after: $('#rAfter').value.trim()
    });
    if (!work.body) { toast('正文还是空的。'); return; }

    const btn = $('#btnSave');
    btn.disabled = true;
    btn.textContent = '保存中…';
    let res;
    try {
      res = await A.writeSave({ work });
    } catch (err) {
      res = { error: err.message || '保存失败' };
    }
    btn.disabled = false;
    btn.textContent = '保存到作品';
    if (res && res.error) { toast(res.error, 4200); return res; }
    S.result = work;
    if (!opts.quiet) toast(`收好了：《${work.title}》`, 3200);
    refreshWorks();
    if (work.kind === 'review') renderReading();
    return res;
  }

  function workToText() {
    const title = $('#rTitle').value.trim() || '未命名';
    const body = $('#rBody').value.trim();
    const after = $('#rAfter').value.trim();
    return `${title}\n\n${body}${after ? '\n\n写在最后\n\n' + after : ''}\n\n—— Liven（由虚拟Liven完成）`;
  }

  async function promptOnly() {
    const payload = collectWrite();
    const btn = $('#btnPromptOnly');
    btn.disabled = true;
    btn.textContent = '准备中…';
    let res;
    try {
      res = await A.writePrompt(payload);
    } catch (err) {
      res = { error: err.message };
    }
    btn.disabled = false;
    btn.textContent = '只复制提示词';
    if (res && res.error) { toast(res.error, 4000); return; }
    showOffline(res.prompt);
    const ok = await copyText(res.prompt);
    toast(ok ? '提示词复制好了，交给任意 AI 吧。' : '提示词在下面，手动复制一下。', 4000);
  }

  function useExcerpt(text, title, maxChars = 6000) {
    const value = String(text || '').trim();
    if (!value) { toast('这一段是空的。'); return; }
    S.excerpt = value.slice(0, maxChars);
    S.sourceTitle = title || '';
    const chip = $('#excerptChip');
    chip.classList.remove('empty');
    chip.textContent = '';
    chip.appendChild(makeEl('div', { text: S.excerpt.slice(0, 190) + (S.excerpt.length > 190 ? '…' : '') }));
    chip.appendChild(makeEl('span', { class: 'src', text: `取自《${title || '未命名'}》 · 点这里回到书架` }));
    toast('选段带到创作页了。');
  }

  let modalResolve = null;

  function closeModal(value) {
    $('#modal').classList.add('hidden');
    const resolve = modalResolve;
    modalResolve = null;
    if (resolve) resolve(value);
  }

  function askText(opts = {}) {
    $('#modalTitle').textContent = opts.title || '粘贴回稿';
    $('#modalHint').textContent = opts.hint || '';
    const ta = $('#modalText');
    ta.value = opts.value || '';
    ta.placeholder = opts.placeholder || '';
    $('#modal').classList.remove('hidden');
    setTimeout(() => ta.focus(), 30);
    return new Promise(resolve => { modalResolve = resolve; });
  }

  function openPasteModal() {
    askText({
      title: '粘贴回稿',
      hint: '把 AI 的完整回复粘进来。她会自动拆出「标题」「正文」「写在最后」，你也可以再改。',
      placeholder: '标题：……\n\n正文……\n\n写在最后：……'
    }).then(async (text) => {
      if (!text) return;
      const meta = collectWrite();
      let res;
      try {
        res = await A.writeParse({ text, meta });
      } catch (err) {
        res = { error: err.message };
      }
      if (res && res.error) { toast(res.error, 4000); return; }
      if (res && res.work) {
        showWork(res.work);
        toast('收到了。看看有没有需要改的地方。');
      }
    });
  }

  function bindWrite() {
    $('#kindSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-kind]');
      if (btn) setKind(btn.dataset.kind);
    });

    $('#wTone').addEventListener('input', updateTone);

    $('#wTopic').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); generateWork(); }
    });

    $('#excerptChip').addEventListener('click', () => nav('shelf'));
    $('#btnGenerate').addEventListener('click', generateWork);
    $('#btnPromptOnly').addEventListener('click', promptOnly);
    $('#btnPasteBack').addEventListener('click', openPasteModal);
    $('#btnOfflinePaste').addEventListener('click', openPasteModal);
    $('#btnSave').addEventListener('click', saveCurrentWork);
    $('#btnDiscard').addEventListener('click', () => {
      resetPreview();
      if (S.link && S.link.type === 'work') setLink(null);
      toast('丢掉了。');
    });
    $('#btnCopyWork').addEventListener('click', async () => {
      const ok = await copyText(workToText());
      toast(ok ? '全文复制好了。' : '复制失败，手动选一下。');
    });
    $('#btnChatWork').addEventListener('click', () => {
      if (!S.result) { toast('先让她写一篇。'); return; }
      const title = $('#rTitle').value.trim() || '未命名';
      const body = $('#rBody').value.trim();
      if (!body) { toast('正文还是空的。'); return; }
      setLink({ type: 'work', title, text: body });
      prefillChat(`我刚写完《${title}》，你帮我看看。`);
    });
    $('#btnCopyPrompt').addEventListener('click', async () => {
      const ok = await copyText($('#offlinePromptText').value);
      toast(ok ? '提示词复制好了。' : '复制失败，手动选一下。');
    });
    $('#rBody').addEventListener('input', updateWords);

    $('#modalOk').addEventListener('click', () => closeModal($('#modalText').value.trim()));
    $('#modalCancel').addEventListener('click', () => closeModal(null));
    $('#modalClose').addEventListener('click', () => closeModal(null));
    $('#modalText').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeModal($('#modalText').value.trim());
    });
  }

  /* ================================ 书架 ================================ */

  function setSource(source) {
    S.library.source = source;
    $$('#sourceTabs button').forEach(b => b.classList.toggle('active', b.dataset.source === source));
    const q = $('#q');
    const hint = $('#searchHint');
    if (source === 'web') {
      q.placeholder = '粘贴网页链接，例如 https://…';
      hint.textContent = '抓取一个普通网页的正文。适合读连载、书评或作者主页。';
    } else if (source === 'local') {
      q.placeholder = '搜标题，或留空看全部';
      hint.textContent = '这三十九篇是你已经写下的。点开来读，划一句递给她。';
    } else if (source === 'gushiwen') {
      q.placeholder = '搜书名，例如 论语、史记、庄子';
      hint.textContent = '古文岛的古籍目录。选一本，她从第一章开始陪你读。';
    } else if (source === 'yan5000') {
      q.placeholder = '搜诗题、诗句或作者';
      hint.textContent = '试试：静夜思、李白、明月。诗词与古文，可直接读。';
    } else {
      q.placeholder = '搜书名、作者或关键词';
      hint.textContent = '试试：红楼梦、鲁迅、汪曾祺、聊斋志异。';
    }
    $('#searchResults').textContent = '';
    if (source === 'local' || source === 'gushiwen') {
      q.value = '';
      doSearch({ preventDefault() {} });
    }
  }

  function showReaderLoading(title) {
    $('#readerEmpty').classList.add('hidden');
    $('#readerMain').classList.remove('hidden');
    $('#readerTitle').textContent = title || '正在打开……';
    $('#readerMeta').textContent = '正在读取正文……';
    $('#chapterBar').textContent = '';
    $('#readerBody').textContent = '';
    $('#readerProgress i').style.width = '0%';
  }

  async function openBook(item) {
    if (!item || S.library.loading) return;
    S.library.loading = true;
    showReaderLoading(item.title);
    let res;
    try {
      res = await A.libraryOpen({ source: item.source || S.library.source, id: item.id || item.title });
    } catch (err) {
      res = { error: err.message };
    }
    S.library.loading = false;
    if (res && res.error) {
      $('#readerMeta').textContent = res.error;
      toast(res.error, 4200);
      return;
    }
    if (res && res.book) {
      renderBook(res.book);
      loadRecent();
    }
  }

  function renderBook(book) {
    S.library.book = book;
    $('#readerEmpty').classList.add('hidden');
    $('#readerMain').classList.remove('hidden');
    $('#readerTitle').textContent = book.title || '未命名';
    const meta = [book.author || '', SOURCE_LABEL[book.source] || '', countChars(book.text) + ' 字']
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    $('#readerMeta').textContent = meta.join(' · ');

    const body = $('#readerBody');
    body.textContent = book.text || '';
    body.scrollTop = 0;
    $('#readerProgress i').style.width = '0%';
    setLink({
      type: 'book',
      title: book.title || '未命名',
      author: book.author || '',
      text: book.text || ''
    });

    const bar = $('#chapterBar');
    bar.textContent = '';
    const chapters = Array.isArray(book.chapters) ? book.chapters : [];
    bar.classList.toggle('hidden', !chapters.length);
    chapters.forEach(ch => {
      const label = String(ch.title || '').replace(book.title + '/', '').replace(book.title + '／', '');
      const btn = makeEl('button', { type: 'button', text: label || ch.title, title: ch.title });
      if (ch.id === book.id) btn.classList.add('active');
      btn.addEventListener('click', () => {
        openBook({ source: book.source, id: ch.id, title: ch.title });
      });
      bar.appendChild(btn);
    });

    $('#btnReaderLink').onclick = () => {
      if (book.url) A.openExternal(book.url);
    };
  }

  async function doSearch(e) {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q && S.library.source !== 'local' && S.library.source !== 'gushiwen') return;

    if (S.library.source === 'web') {
      if (!/^https?:\/\//i.test(q) && !/\./.test(q)) { toast('这看起来不像一个链接。'); return; }
      openBook({ source: 'web', id: q, title: q });
      return;
    }

    const box = $('#searchResults');
    const hint = $('#searchHint');
    box.textContent = '';
    hint.textContent = '正在找……';

    let res;
    const seq = (S.library.searchSeq = (S.library.searchSeq || 0) + 1);
    try {
      res = await A.librarySearch({ source: S.library.source, q });
    } catch (err) {
      res = { error: err.message };
    }
    if (seq !== S.library.searchSeq) return;
    if (res && res.error) { hint.textContent = res.error; return; }
    const results = (res && res.results) || [];
    const local = S.library.source === 'local';
    hint.textContent = results.length
      ? (q ? `找到 ${results.length} 条。` : `共 ${results.length} 篇。`)
      : (local ? '书库是空的。' : '没有找到，换个词试试。');
    results.forEach(r => {
      const btn = makeEl('button', { class: 'result-item', type: 'button' }, [
        makeEl('div', { class: 't', text: r.title || '未命名' }),
        makeEl('div', { class: 's', text: [r.author, r.snippet].filter(Boolean).join(' · ') })
      ]);
      btn.addEventListener('click', () => openBook(r));
      box.appendChild(btn);
    });
  }

  async function loadRecent() {
    let res;
    try {
      res = await A.libraryRecent();
    } catch (err) {
      return;
    }
    const recent = (res && res.recent) || [];
    S.library.recent = recent;
    const box = $('#recentList');
    box.textContent = '';
    if (!recent.length) {
      box.appendChild(makeEl('p', { class: 'muted small', text: '还没有。' }));
      return;
    }
    recent.forEach(b => {
      const btn = makeEl('button', { class: 'recent-item', type: 'button' });
      btn.appendChild(makeEl('span', { class: 't', text: b.title || '未命名' }));
      const p = makeEl('div', { class: 'p' });
      const i = makeEl('i');
      i.style.width = Math.max(0, Math.min(100, Number(b.progress) || 0)) + '%';
      p.appendChild(i);
      btn.appendChild(p);
      btn.addEventListener('click', () => openBook(b));
      box.appendChild(btn);
    });
  }

  function bindShelf() {
    $('#sourceTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-source]');
      if (btn) setSource(btn.dataset.source);
    });
    $('#searchForm').addEventListener('submit', doSearch);

    $('#readerBody').addEventListener('mouseup', () => {
      const sel = window.getSelection();
      const text = sel ? String(sel).trim() : '';
      const body = $('#readerBody');
      if (!text || text.length < 8 || !sel.anchorNode || !body.contains(sel.anchorNode)) {
        $('#selBar').classList.add('hidden');
        return;
      }
      selText = text.slice(0, 6000);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const bar = $('#selBar');
      bar.classList.remove('hidden');
      const w = bar.offsetWidth || 190;
      const h = bar.offsetHeight || 36;
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - w - 10));
      const y = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - h - 10));
      bar.style.left = x + 'px';
      bar.style.top = y + 'px';
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#selBar')) $('#selBar').classList.add('hidden');
    });

    $('#selWrite').addEventListener('click', () => {
      useExcerpt(selText, S.library.book ? S.library.book.title : '');
      $('#selBar').classList.add('hidden');
      nav('write');
    });
    $('#selCopy').addEventListener('click', async () => {
      const ok = await copyText(selText);
      toast(ok ? '这一段复制好了。' : '复制失败。');
    });

    $('#readerBody').addEventListener('scroll', () => {
      const el = $('#readerBody');
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 0 ? Math.round((el.scrollTop / max) * 100) : 0;
      $('#readerProgress i').style.width = pct + '%';
      $('#selBar').classList.add('hidden');
      clearTimeout(progressTimer);
      progressTimer = setTimeout(() => {
        if (S.library.book && S.library.book.key) {
          A.libraryProgress({ key: S.library.book.key, percent: pct });
        }
      }, 800);
    });

    $('#btnReaderChat').addEventListener('click', () => {
      const book = S.library.book;
      if (!book) { toast('先打开一本书。'); return; }
      setLink({
        type: 'book',
        title: book.title || '未命名',
        author: book.author || '',
        text: book.text || ''
      });
      prefillChat(`我在读《${book.title || '这本'}》，想听听你怎么看。`);
    });

    $('#btnReaderRecommend').addEventListener('click', () => {
      const book = S.library.book;
      if (!book) { toast('先打开一本书。'); return; }
      useExcerpt(String(book.text || '').slice(0, 1500), book.title);
      nav('write');
    });

    $('#btnReaderReview').addEventListener('click', async () => {
      const book = S.library.book;
      if (!book) { toast('先打开一本书。'); return; }
      if (!hasKey()) {
        toast('写读书感想要先接通语言模型；也可以「带进创作」把段落带过去。', 4600);
        return;
      }
      if (S.writeBusy) { toast('她还在写上一篇，等一会儿。'); return; }
      nav('write');
      setKind('review');
      $('#wTopic').value = book.title || '';
      useExcerpt(String(book.text || ''), book.title, 14000);
      toast('她把书接过去了。写完会自己收进「读书感想」。', 3800);
      await generateWork({ autoSave: true });
      refreshWorks();
    });

    $('#btnOpenWiki').addEventListener('click', () => A.openExternal('https://www.gushiwen.cn/'));
    $('#btnImportFile').addEventListener('click', async () => {
      const res = await A.libraryImport();
      if (!res || res.canceled) return;
      if (res.error) { toast(res.error, 4000); return; }
      if (res.book) {
        renderBook(res.book);
        loadRecent();
        toast('放进来了。');
      }
    });
  }

  /* ================================ 作品 ================================ */

  async function renderReading() {
    const box = $('#readingList');
    const meta = $('#readingMeta');
    let entries = [];
    try {
      const res = await A.readingList();
      entries = (res && res.entries) || [];
    } catch (err) {
      entries = [];
    }
    meta.textContent = entries.length ? `共 ${entries.length} 次` : '';
    box.textContent = '';
    if (!entries.length) {
      const p = makeEl('p', 'muted small', '还没有记录。去书架打开一本，让她写一篇读书感想。');
      box.appendChild(p);
      return;
    }
    entries.slice(0, 4).forEach(e => {
      const row = makeEl('div', 'reading-item');
      row.appendChild(makeEl('span', 'd', String(e.date || '').slice(5)));
      row.appendChild(makeEl('span', 't', `《${e.sourceTitle || e.workTitle || '未命名'}》`));
      const b = makeEl('span', 'b', e.workTitle || '感想');
      b.title = e.workTitle || '';
      row.appendChild(b);
      row.addEventListener('click', () => nav('works'));
      box.appendChild(row);
    });
  }

  async function refreshSerial() {
    let st = null;
    try {
      st = await A.serialStatus();
    } catch (err) {
      st = null;
    }
    S.serial = st;
    const a = st && st.active;
    const box = $('#serialBox');
    if (!a) {
      box.classList.add('hidden');
      $('#serialStatus').textContent = '还没有连载。点「现在写一章」开一部。';
      return;
    }
    box.classList.remove('hidden');
    $('#serialTitle').textContent = `《${a.title}》`;
    const state = a.status === 'done' ? '已完结' : '写作中';
    $('#serialMeta').textContent = `第 ${a.chapters} / ${a.total} 章 · ${state}`;
    $('#serialTopic').textContent = a.topic || '';
    const chapters = $('#serialChapters');
    chapters.textContent = '';
    (a.list || []).slice(-8).forEach(c => {
      const b = makeEl('button', 'ghost small', `第 ${c.no} 章 · ${c.title}`);
      b.title = c.path || '';
      b.addEventListener('click', () => {
        if (c.path) A.worksOpen(c.path);
      });
      chapters.appendChild(b);
    });
    const next = a.nextAt ? new Date(a.nextAt) : null;
    $('#serialStatus').textContent = a.status === 'done'
      ? (next ? `这一部写完了。${next.getMonth() + 1} 月 ${next.getDate()} 日会自己开下一部。` : '这一部写完了。下一部会自己开始。')
      : next ? `下次更新：${next.getMonth() + 1} 月 ${next.getDate()} 日` : '';
  }

  async function refreshWorks() {
    let items;
    try {
      items = await A.worksList();
    } catch (err) {
      return;
    }
    S.works = Array.isArray(items) ? items : [];
    renderWorks();
  }

  function renderWorks() {
    const stats = $('#worksStats');
    stats.textContent = '';
    const total = S.works.length;
    const words = S.works.reduce((sum, w) => sum + (Number(w.words) || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = S.works.filter(w => String(w.date || '').startsWith(month)).length;
    const cards = [
      { n: total, l: '篇作品' },
      { n: words.toLocaleString('zh-CN'), l: '总字数' },
      { n: thisMonth, l: '本月新增' },
      { n: S.works.filter(w => w.hasDocx).length, l: '带 Word 稿' }
    ];
    cards.forEach(c => {
      stats.appendChild(makeEl('div', { class: 'stat' }, [
        makeEl('div', { class: 'n', text: String(c.n) }),
        makeEl('div', { class: 'l', text: c.l })
      ]));
    });

    const list = $('#worksList');
    list.textContent = '';
    const filtered = S.worksFilter === 'all' ? S.works : S.works.filter(w => w.kind === S.worksFilter);
    if (!filtered.length) {
      const empty = makeEl('div', { class: 'empty-state' }, [
        makeEl('div', { class: 'mark', text: '▤' }),
        makeEl('p', { text: '这里还是空的。' }),
        makeEl('p', { class: 'muted', text: '去「创作」让她写一篇，或者到「书架」挑一本书。' })
      ]);
      empty.style.gridColumn = '1 / -1';
      list.appendChild(empty);
      return;
    }

    filtered.forEach(w => list.appendChild(workCard(w)));
  }

  function workCard(w) {
    const card = makeEl('div', { class: 'work-card' });
    card.appendChild(makeEl('h4', { text: w.title || '未命名' }));
    const meta = makeEl('div', { class: 'work-meta' });
    meta.appendChild(makeEl('span', { class: 'work-tag', text: w.kindLabel || KINDS[w.kind] || '短篇' }));
    meta.appendChild(makeEl('span', { class: 'work-tag ai', text: '由虚拟Liven完成' }));
    if (w.date) meta.appendChild(makeEl('span', { text: w.date }));
    if (w.words) meta.appendChild(makeEl('span', { text: w.words + ' 字' }));
    card.appendChild(meta);

    const actions = makeEl('div', { class: 'work-actions' });
    const open = makeEl('button', { type: 'button', text: '打开' });
    open.addEventListener('click', async () => {
      const res = await A.worksOpen(w.path);
      if (res && res.error) toast('打不开：' + res.error);
    });
    const reveal = makeEl('button', { type: 'button', text: '定位' });
    reveal.addEventListener('click', () => A.worksReveal(w.path));

    const del = makeEl('button', { type: 'button', class: 'del', text: '删除' });
    let armed = false;
    let timer = null;
    del.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        del.classList.add('confirm');
        del.textContent = '确认删除？';
        timer = setTimeout(() => {
          armed = false;
          del.classList.remove('confirm');
          del.textContent = '删除';
        }, 3000);
        return;
      }
      clearTimeout(timer);
      const res = await A.worksDelete(w.path);
      if (res && res.ok) { toast('删掉了。'); refreshWorks(); }
      else toast((res && res.error) || '删除失败。');
    });

    actions.appendChild(open);
    actions.appendChild(reveal);
    actions.appendChild(del);
    card.appendChild(actions);
    return card;
  }

  function bindWorks() {
    $('#btnRefreshWorks').addEventListener('click', () => { refreshWorks(); toast('刷新了。'); });
    $('#btnOpenWorks').addEventListener('click', () => A.openFolder('works'));
    $('#worksFilter').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      S.worksFilter = btn.dataset.filter;
      $$('#worksFilter button').forEach(b => b.classList.toggle('active', b === btn));
      renderWorks();
    });
  }

  /* ================================ 设定 ================================ */

  function renderSettings() {
    const llm = S.settings.llm;
    const provider = $('#sProvider');
    provider.textContent = '';
    Object.entries(S.providers).forEach(([id, p]) => {
      provider.appendChild(makeEl('option', { value: id, text: p.label || id }));
    });
    provider.value = llm.provider;
    $('#sBaseURL').value = llm.baseURL || '';
    $('#sModel').value = llm.model || '';
    $('#sKey').value = llm.apiKey || '';
    $('#sTemp').value = llm.temperature == null ? 0.9 : llm.temperature;
    $('#sTempVal').textContent = Number($('#sTemp').value).toFixed(2);
    $('#providerNote').textContent = PROVIDER_NOTE[llm.provider] || '';

    $('#sOutDir').value = S.settings.writing.outDir || '';
    $('#sAutoDocx').checked = !!S.settings.writing.autoDocx;

    const rd = S.settings.reading || {};
    $('#sReadingEnabled').checked = rd.enabled !== false;
    $('#sReadingEvery').value = String(rd.everyDays || 7);

    const sl = S.settings.serial || {};
    $('#sSerialEnabled').checked = sl.enabled !== false;
    $('#sSerialEvery').value = String(sl.everyDays || 14);

    const sch = S.settings.schedule;
    $('#sSchedEnabled').checked = !!sch.enabled;
    $('#sSchedTime').value = sch.time || '21:30';
    $('#sSchedKind').value = sch.kind || 'mixed';
    $('#sCatchUp').checked = !!sch.catchUp;
    const days = Array.isArray(sch.weekdays) && sch.weekdays.length ? sch.weekdays : [1, 2, 3, 4, 5, 6, 7];
    $$('#sWeekdays button').forEach(b => b.classList.toggle('active', days.includes(Number(b.dataset.day))));

    const ui = S.settings.ui;
    $('#sUserName').value = ui.userName || '';
    $('#sScale').value = ui.petScale || 1;
    $('#sScaleVal').textContent = Number($('#sScale').value).toFixed(2) + '×';
    $('#sOnTop').checked = !!ui.alwaysOnTop;
    $('#sAutoStart').checked = !!ui.autoStart;
    $('#sBubbleMs').value = String(ui.bubbleMs || 9000);
  }

  function renderAbout() {
    $('#aboutVersion').textContent = 'v' + (S.state.version || '1.0.0');
    $('#aboutWorkspace').textContent = S.paths.workspace || '';
    $('#aboutCorpus').textContent = `${S.state.corpusCount || 0} 篇语料`;
    $('#aboutData').textContent = S.state.dataDir || '';
  }

  async function saveSettings() {
    const btn = $('#btnSaveSettings');
    btn.disabled = true;
    btn.textContent = '保存中…';

    const weekdays = $$('#sWeekdays button.active').map(b => Number(b.dataset.day));
    const next = {
      llm: {
        provider: $('#sProvider').value,
        baseURL: $('#sBaseURL').value.trim(),
        model: $('#sModel').value.trim(),
        // 空白通常表示“没改”，避免初次设置刚写入的 Key 被空表单覆盖；要清除请用隐私卡里的按钮。
        apiKey: $('#sKey').value.trim() || (S.settings.llm && S.settings.llm.apiKey) || '',
        temperature: Number($('#sTemp').value)
      },
      writing: {
        outDir: $('#sOutDir').value.trim() || S.settings.writing.outDir,
        autoDocx: $('#sAutoDocx').checked
      },
      reading: {
        enabled: $('#sReadingEnabled').checked,
        everyDays: Number($('#sReadingEvery').value) || 7,
        lastAt: (S.settings.reading && S.settings.reading.lastAt) || ''
      },
      serial: {
        enabled: $('#sSerialEnabled').checked,
        everyDays: Number($('#sSerialEvery').value) || 14,
        autoStart: true,
        lastAt: (S.settings.serial && S.settings.serial.lastAt) || ''
      },
      schedule: {
        enabled: $('#sSchedEnabled').checked,
        time: $('#sSchedTime').value || '21:30',
        weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6, 7],
        kind: $('#sSchedKind').value,
        catchUp: $('#sCatchUp').checked
      },
      ui: {
        userName: $('#sUserName').value.trim() || (S.settings.ui && S.settings.ui.userName) || '朋友',
        petScale: Number($('#sScale').value),
        alwaysOnTop: $('#sOnTop').checked,
        autoStart: $('#sAutoStart').checked,
        bubbleMs: Number($('#sBubbleMs').value)
      }
    };

    let saved;
    try {
      saved = await A.settingsSave(next);
    } catch (err) {
      toast(err.message || '保存失败', 4200);
      btn.disabled = false;
      btn.textContent = '保存设定';
      return;
    }
    S.settings = saved;
    S.state = await A.appState();
    updateStatus();
    refreshSchedule();
    btn.disabled = false;
    btn.textContent = '保存设定';
    toast('设定保存好了。');
  }

  async function testLLM() {
    const btn = $('#btnTestLLM');
    const out = $('#llmTestResult');
    btn.disabled = true;
    btn.textContent = '测试中…';
    out.textContent = '正在请求……';
    let res;
    try {
      res = await A.llmTest({
        provider: $('#sProvider').value,
        baseURL: $('#sBaseURL').value.trim(),
        model: $('#sModel').value.trim(),
        apiKey: $('#sKey').value.trim()
      });
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    btn.disabled = false;
    btn.textContent = '测试连接';
    if (res && res.ok) {
      out.textContent = `通了，用时 ${res.elapsed || '?'} ms。它就回了一个字：${res.text || '在的'}`;
    } else {
      out.textContent = '没通：' + ((res && res.error) || '未知错误');
    }
  }

  async function refreshSchedule() {
    let st;
    try {
      st = await A.scheduleStatus();
    } catch (err) {
      return;
    }
    S.schedule = st;
    const el = $('#schedStatus');
    if (!st) { el.textContent = ''; return; }
    if (!st.enabled) { el.textContent = '未启用'; return; }
    if (!hasKey()) { el.textContent = '已启用，但还没接通语言模型——到点了也不会写出正文。'; return; }
    if (st.running) { el.textContent = '正在写……'; return; }
    if (st.next) {
      const d = new Date(st.next);
      let text = `下次：${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      if (st.reading && st.reading.enabled) {
        const r = new Date(st.reading.next);
        text += ` · 下次读：${r.getMonth() + 1} 月 ${r.getDate()} 日`;
      }
      el.textContent = text;
    } else {
      el.textContent = '等待下一次';
    }
  }

  function bindSettings() {
    $('#sProvider').addEventListener('change', (e) => {
      const p = S.providers[e.target.value];
      if (p) {
        $('#sBaseURL').value = p.baseURL || '';
        $('#sModel').value = p.model || '';
      }
      $('#providerNote').textContent = PROVIDER_NOTE[e.target.value] || '';
    });

    $('#sTemp').addEventListener('input', (e) => {
      $('#sTempVal').textContent = Number(e.target.value).toFixed(2);
    });
    $('#sScale').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      $('#sScaleVal').textContent = v.toFixed(2) + '×';
      clearTimeout(e.target._scaleTimer);
      e.target._scaleTimer = setTimeout(async () => {
        try {
          const applied = await A.petScale(v);
          if (typeof applied === 'number') S.settings.ui.petScale = applied;
        } catch (_) { /* 缩放失败不打断拖动 */ }
      }, 140);
    });

    $('#sWeekdays').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-day]');
      if (btn) btn.classList.toggle('active');
    });

    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnTestLLM').addEventListener('click', testLLM);
    $('#btnOpenWorksDir').addEventListener('click', () => A.openFolder('works'));
    $('#btnOpenCharacterDir').addEventListener('click', () => A.openFolder('assets'));

    $('#btnPickCharacter').addEventListener('click', async () => {
      let res;
      try {
        res = await A.pickCharacter();
      } catch (err) {
        res = { error: err.message };
      }
      if (!res || res.canceled) return;
      if (res.error) { toast('换图失败：' + res.error, 4200); return; }
      toast('立绘换好了，桌宠那边会自己更新。', 3200);
    });

    $('#btnRunNow').addEventListener('click', async () => {
      const btn = $('#btnRunNow');
      btn.disabled = true;
      btn.textContent = '正在写……';
      let res;
      try {
        res = await A.scheduleRun();
      } catch (err) {
        res = { ok: false, message: err.message };
      }
      btn.disabled = false;
      btn.textContent = '现在写一篇';
      refreshSchedule();
      if (res && res.ok) toast(`写好了：《${res.work.title}》`, 4200);
      else if (res && res.reason === 'no-key') toast('还没接通语言模型，先去填一个 Key。', 4200);
      else toast((res && res.message) || '这次没写成，晚点再试。', 4200);
      refreshWorks();
    });

    async function runSerialOnce() {
      if (!hasKey()) { toast('连载要接通语言模型才能写。先去「设定」填一个 Key。', 4200); return; }
      const btns = [$('#btnSerialNow'), $('#btnSerialNext')].filter(Boolean);
      btns.forEach(b => { b.disabled = true; });
      const old = $('#btnSerialNow').textContent;
      $('#btnSerialNow').textContent = '正在写这一章……';
      let res;
      try {
        res = await A.serialRun();
      } catch (err) {
        res = { ok: false, message: err.message };
      }
      btns.forEach(b => { b.disabled = false; });
      $('#btnSerialNow').textContent = old;
      await refreshSerial();
      await refreshWorks();
      if (res && res.ok) toast(`写完了：《${res.work.title}》`, 4600);
      else toast((res && res.message) || '这一章没写成，晚点再试。', 4200);
    }

    $('#btnSerialNow').addEventListener('click', runSerialOnce);
    $('#btnSerialNext').addEventListener('click', runSerialOnce);
    $('#btnSerialFolder').addEventListener('click', () => A.serialOpen());
    $('#btnSerialOpen').addEventListener('click', () => A.serialOpen());

    $('#btnReadNow').addEventListener('click', async () => {
      const btn = $('#btnReadNow');
      btn.disabled = true;
      btn.textContent = '正在读……';
      let res;
      try {
        res = await A.readingRun();
      } catch (err) {
        res = { ok: false, message: err.message };
      }
      btn.disabled = false;
      btn.textContent = '现在读一篇';
      refreshSchedule();
      refreshWorks();
      renderReading();
      if (res && res.ok) toast(`读完了：《${res.work.title}》`, 4600);
      else if (res && res.reason === 'no-key') toast('还没接通语言模型，先去填一个 Key。', 4200);
      else toast((res && res.message) || '这次没读成，晚点再试。', 4200);
    });

    $('#btnSetupAgain').addEventListener('click', () => A.openSetup());

    function bindClear(btn, what) {
      let armed = false;
      let timer = null;
      const label = btn.textContent;
      btn.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          btn.textContent = '再点一次确认';
          btn.classList.add('confirm');
          timer = setTimeout(() => {
            armed = false;
            btn.textContent = label;
            btn.classList.remove('confirm');
          }, 3200);
          return;
        }
        clearTimeout(timer);
        armed = false;
        btn.textContent = label;
        btn.classList.remove('confirm');
        const res = await A.privacyClear(what);
        if (res && res.ok) {
          S.chat = [];
          renderChat();
          renderSettings();
          updateStatus();
          loadRecent();
          toast((res.cleared || []).join('、') + ' 已清空。', 3800);
          $('#privacyNote').textContent = '清理完成。作品仍然在「文档」里，不会被删除。';
        } else {
          toast((res && res.error) || '清理失败。', 3800);
        }
      });
    }

    bindClear($('#btnClearChatData'), 'chat');
    bindClear($('#btnClearKey'), 'apiKey');
    bindClear($('#btnClearBookData'), 'library');
    bindClear($('#btnClearAllLocal'), 'all');

    $$('[data-open-folder]').forEach(btn => {
      btn.addEventListener('click', () => A.openFolder(btn.dataset.openFolder));
    });
    $('#btnOpenReadme').addEventListener('click', () => A.openFolder('docs'));
  }

  /* ================================ 启动 ================================ */

  async function boot() {
    if (!A) {
      document.body.textContent = '预加载脚本没有运行，窗口配置可能出错了。';
      return;
    }

    bindChat();
    bindWrite();
    bindShelf();
    bindWorks();
    bindSettings();
    startClock();

    $('#nav').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) nav(btn.dataset.section);
    });
    $('#btnHide').addEventListener('click', () => window.close());

    A.onChatDelta(({ delta }) => {
      if (!S.chatStream || !delta) return;
      S.chatStream.buffer += delta;
      S.chatStream.node.bubble.textContent = S.chatStream.buffer;
      scrollChat();
    });

    A.onWriteDelta(({ delta }) => {
      if (!S.writeBusy || !delta) return;
      S.writeRaw += delta;
      const pre = $('#busyText');
      pre.textContent = S.writeRaw;
      pre.scrollTop = pre.scrollHeight;
    });

    A.onThinking(({ on }) => {
      const dot = $('#sideStatus');
      if (!dot) return;
      const span = dot.querySelector('span');
      if (on) {
        dot.dataset.restore = span.textContent;
        span.textContent = '正在想……';
        dot.classList.add('online');
      } else if (dot.dataset.restore) {
        span.textContent = dot.dataset.restore;
        dot.removeAttribute('data-restore');
      }
    });

    A.onSettingsChanged((next) => {
      S.settings = next;
      updateStatus();
      // 初次设置是在另一个窗口完成的；如果写作间已经先加载过，需要把表单刷新到最新值。
      if ($('#sProvider') && S.providers) renderSettings();
    });

    A.onWorksChanged(() => refreshWorks());

    A.onGoto((section) => nav(section));

    const cfg = await A.settingsGet();
    S.settings = cfg.settings;
    S.providers = cfg.providers || {};
    S.paths = cfg.paths || {};
    S.state = await A.appState();

    renderSettings();
    renderAbout();
    setArc();
    updateStatus();
    $('#writeDate').textContent = todayLabel();

    await Promise.all([loadChat(), loadRecent()]);
    await refreshWorks();
    await renderReading();
    await refreshSerial();
    await refreshSchedule();

    nav((location.hash || '').replace('#', '') || 'chat');

    if (!hasKey()) {
      setTimeout(() => toast('现在是本地台词模式。到「设定」填一个 API Key，她就能自己写了。', 5200), 900);
    } else if (S.state.firstRun) {
      setTimeout(() => toast('第一次见。先看看书架，或者直接让她写一篇。', 4200), 900);
    }
  }

  function setArc() {
    const v = Number($('#wTone').value);
    $('#toneLabel').textContent = v < 34 ? '偏克制' : v < 67 ? '平衡' : '偏抒情';
  }

  boot().catch((err) => {
    console.error(err);
    toast('界面初始化失败：' + (err && err.message), 6000);
  });
})();
