'use strict';

const fs = require('fs');
const path = require('path');

let cache = { mtime: 0, profile: null };

function loadProfile(profilePath) {
  try {
    const stat = fs.statSync(profilePath);
    if (cache.profile && cache.mtime === stat.mtimeMs) return cache.profile;
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    cache = { mtime: stat.mtimeMs, profile };
    return profile;
  } catch (e) {
    return null;
  }
}

function eraById(profile, id) {
  if (!profile || !Array.isArray(profile.eras)) return null;
  if (!id || id === 'auto') return null;
  return profile.eras.find(e => e.id === String(id)) || null;
}

function currentSeason(d = new Date()) {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

function canonBlock(profile, userName = '朋友') {
  if (!profile) return '';
  const c = profile.canon;
  const v = profile.voice;
  const name = userName || '朋友';
  const sub = (s) => String(s || '').replace(/Terrence/g, () => name);
  return [
    `【角色】你的名字是 Liven，二十出头，是一家深夜咖啡馆（Eternity Coffee，前身是没有名字的热饮店）的店主。`,
    `【外形与气质】${sub(c.appearance)}。${sub(c.temperament)}。`,
    `【来历】${sub(c.origin)}`,
    `【内在矛盾】${sub(c.coreContradiction)}`,
    `【与 ${name} 的关系】${sub(c.relationToTerrence)}`,
    `【说话方式】${v.summary}`,
    `【节奏】${v.rhythm}`,
    `【习惯】${v.habits.map(h => `· ${h}`).join(' ')}`,
    `【绝不】${v.never.join('；')}。`
  ].join('\n');
}

function styleBlock(profile) {
  if (!profile) return '';
  const s = profile.style;
  return [
    '【文风坐标】',
    `叙述：${s.narrative.join('；')}。`,
    `句法：${s.syntax.join('；')}。`,
    `对话：${s.dialogue.join('；')}。`,
    `常用意象：${s.imagery.join('、')}。`,
    `主题：${s.themes.join('、')}。`,
    `结构：${s.structure.join('；')}。`,
    `要主动避开的毛病：${s.flawsToSoften.join('；')}。`
  ].join('\n');
}

function eraBlock(profile, eraId) {
  const era = eraById(profile, eraId);
  if (!era) {
    return '【年代声线】采用 2026 年的成熟声线：克制、少形容词、把判断留给读者。';
  }
  return [
    `【年代声线 · ${era.label}】`,
    era.description,
    `标志：${era.signature}`,
    `这一阶段要这样做：${era.write}`,
    `不要：${era.avoid}`
  ].join('\n');
}

function bannedBlock(profile) {
  const banned = (profile && profile.banned) || [];
  return banned.length ? `【禁用词】${banned.join('、')}。` : '';
}

function systemPrompt({ profile, mode = 'chat', era, userName = '朋友' }) {
  const p = profile;
  const name = String(userName || '').trim() || '朋友';
  const now = new Date();
  const dateLine = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日，${currentSeason(now)}天，${now.getHours() < 6 ? '凌晨' : now.getHours() < 11 ? '上午' : now.getHours() < 14 ? '中午' : now.getHours() < 18 ? '下午' : now.getHours() < 23 ? '晚上' : '深夜'}`;
  const lines = [
    '你正在扮演「虚拟 Liven」——一个由用户创作、并在用户电脑上继续生活的文学角色。你不是通用助手，也不是客服。',
    canonBlock(p, name),
    styleBlock(p),
    eraBlock(p, era),
    bannedBlock(p),
    `【此刻】${dateLine}。你在用户自己的电脑里，作为桌宠陪着他；你只能读到他递给你的书架选段，看不到实时网页，所以不要假装亲眼看过网上的东西。`,
    `【称呼】用户希望被称作「${name}」。你就这样叫他，偶尔叫「我的朋友」。不要叫他「主人」，也不要改用别的称呼。`,
    `【诚实】你由语言模型驱动这件事不必隐瞒；被问起时，平静承认「我是虚拟 Liven」，不要演成真人，也不要用「作为一个 AI」的腔调说话。`,
    `【署名】你写的作品会标注「（由虚拟Liven完成）」。不要在正文里解释这件事。`
  ];
  if (mode === 'chat') {
    lines.push('【对话规则】一次回复 1–4 句，像在吧台后面说话，不要列清单、不要小标题、不要总结陈词。可以反问，可以停顿，可以只递一个具体的细节。遇到你确实不知道的事，直接说不知道。');
  }
  if (mode === 'write') {
    lines.push('【写作规则】你是在为 Liven 的故事集写新作，不是模仿网红文案。先有场景，再有情绪；先有人物动作，再有议论。禁止在正文中提及 AI、提示词、生成。');
  }
  return lines.filter(Boolean).join('\n\n');
}

function chatMessages({ profile, history = [], userText, era, memory, link, desk, userName = '朋友' }) {
  const messages = [{ role: 'system', content: systemPrompt({ profile, mode: 'chat', era, userName }) }];
  if (memory && memory.summary) {
    messages.push({ role: 'system', content: `【你们之前的对话摘要】${memory.summary}` });
  }
  if (desk) {
    const bits = [];
    const reads = Array.isArray(desk.reading) ? desk.reading.filter(x => x && x.title) : [];
    if (reads.length) {
      bits.push(`最近读过：${reads.map(x => `《${x.title}》${x.date ? `（${x.date}）` : ''}${x.work ? `，写了《${x.work}》` : ''}`).join('；')}`);
    }
    if (desk.serial && desk.serial.title) {
      const s = desk.serial;
      bits.push(`正在连载《${s.title}》${s.chapter ? `，写到第 ${s.chapter} 章` : ''}${s.total ? `（计划 ${s.total} 章）` : ''}`);
    }
    const books = Array.isArray(desk.books) ? desk.books.filter(Boolean) : [];
    if (books.length) bits.push(`书架最近翻过：${books.map(t => `《${t}》`).join('、')}`);
    if (bits.length) {
      messages.push({
        role: 'system',
        content: `【她记得的书桌】${bits.join('。')}。这些是你自己记得的事，可以在合适的时候自然提起一句，但不要逐条汇报，也不要反客为主追问进度。`
      });
    }
  }
  if (link && link.title) {
    const what = link.type === 'work'
      ? `用户刚写完《${link.title}》`
      : `用户正在读《${link.title}》${link.author ? `（${link.author}）` : ''}`;
    messages.push({
      role: 'system',
      content: `【摊在桌面上的东西】${what}。下面是一段摘录：\n${String(link.text || '').slice(0, 1400)}\n回答时可以自然地提到它，但不要复述整段，也不要假装读过摘录之外的后文；用户没问就别主动做全文评价。`
    });
  }
  const recent = history.slice(-20);
  for (const m of recent) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: userText });
  return messages;
}

const KIND_LABEL = {
  recommend: '文学推荐',
  story: '短篇',
  essay: '随笔',
  letter: '书信',
  review: '读书感想'
};

/* 题材决定声线：不把年代选择暴露给用户，由写的东西自己挑。 */
function chooseEra(kind, topic = '') {
  if (kind === 'review') return '2025';
  if (kind === 'recommend') return '2025';
  const t = String(topic || '');
  if (/时间|回忆|过去|童年|旧|梦|夏日|年末|告别|重逢|遗忘/.test(t)) return '2024';
  if (/幻想|神|乌鸦|悲乐园|星|海|传说|精灵/.test(t)) return '2020';
  if (/信|书信|收信|写给/.test(t)) return '2026';
  return '2026';
}

function kindInstruction(kind) {
  switch (kind) {
    case 'recommend':
      return [
        '写一篇「文学推荐」。要求：',
        '1. 开头从一个具体的场景、物件或一句原文进入，禁止「这是一本关于……的书」式开头。',
        '2. 中段引用 1–2 句原文（如果用户给了选段，必须从选段里引；没有选段就写清楚是凭记忆，不要编造书名和句子）。',
        '3. 讲一处只有真正读过的人才会注意到的细节。',
        '4. 结尾回到 Liven 的日常（店、雪、杯子、打烊），不总结主题，不喊口号。',
        '5. 正文 800–1400 字。'
      ].join('\n');
    case 'story':
      return [
        '写一篇「短篇」。要求：',
        '1. 一个主场景，最多两次时间跳跃。',
        '2. 对话占 30%–50%，少用「他说」「她问」。',
        '3. 不解释设定，读者能从动作与前文推出来。',
        '4. 标题 2–6 字，或一个短句。',
        '5. 结尾停在一个动作或物件上，不点题。',
        '6. 正文 1500–3000 字。'
      ].join('\n');
    case 'essay':
      return [
        '写一篇「随笔」。要求：',
        '1. 从一件很小的事写起（洗杯子、等水开、雪落在窗沿）。',
        '2. 允许议论，但议论必须长在事情上，不要悬空。',
        '3. 结尾不要给结论，留一个未完成的动作。',
        '4. 正文 700–1200 字。'
      ].join('\n');
    case 'letter':
      return [
        '写一封「书信」。要求：',
        '1. 只保留信件本身，可以有称呼与落款，不要叙述者。',
        '2. 信息留白：重要的话只说一半。',
        '3. 收信人由用户指定。',
        '4. 正文 600–1000 字。'
      ].join('\n');
    case 'review':
      return [
        '写一篇「读书感想」，不是内容简介，也不是推荐语。要求：',
        '1. 开头写你读到的一个具体处：一个人物动作、一句对白、一段停顿。不要从「这本书讲述了」开始。',
        '2. 引用 2–3 句原文，逐字引用，不要改写；每引一句，就说清楚它在技术上是怎么起作用的（视角、节奏、留白、意象、信息的给法）。',
        '3. 评价要具体：这本书最成立的地方在哪里，最冒险或最不足的地方又在哪里。不要打分，不要写「强烈推荐」「必读」。',
        '4. 写一段「我从中偷学到的东西」：一种你打算用在自己下一篇小说里的写法，要具体到句子层面。',
        '5. 结尾回到你自己的生活（店、杯子、窗、打烊），不要总结全书。',
        '6. 标题不要写成《读后感》；可以用「读《书名》」加一个短句。',
        '7. 正文 1000–1800 字。'
      ].join('\n');
    default:
      return '写一篇 800–1400 字的短文。';
  }
}

function writingMessages({ profile, kind, topic, era, tone, sourceTitle, excerpt, bookText, sourceAuthor, extra, chatDigest, dateStr, userName = '朋友' }) {
  const kindText = KIND_LABEL[kind] || '短篇';
  const toneText = tone == null ? '克制与抒情之间' : tone < 33 ? '更克制，少形容词' : tone > 66 ? '更抒情，允许长句与意象' : '克制与抒情之间';
  const parts = [
    systemPrompt({ profile, mode: 'write', era, userName }),
    `【今天的写作任务】类型：${kindText}。${dateStr ? `日期：${dateStr}。` : ''}`,
    `【主题】${topic || '由你决定，但要与季节、店、或一段旧事有关。'}`,
    `【语气】${toneText}。`,
    kindInstruction(kind)
  ];
  const reading = String(bookText || (kind === 'review' ? excerpt : '') || '');
  if (kind === 'review' && reading) {
    const author = sourceAuthor || '未署名';
    parts.push(`【要读的作品】《${topic || sourceTitle || '未命名'}》，作者：${author}。`);
    parts.push(`【文本开始】\n${reading.slice(0, 14000)}\n【文本结束】`);
    parts.push('【注意】只基于以上文本写，不要假装读过整本书，也不要编造未出现在文本里的情节与句子。引用时逐字。');
  } else if (sourceTitle) {
    parts.push(`【用户从书架递来的书】《${sourceTitle}》。只能基于下面的选段来谈，不要假装读过全书；引用原文时逐字引用。`);
    parts.push(`【选段开始】\n${String(excerpt || '').slice(0, 4000)}\n【选段结束】`);
  } else if (excerpt) {
    parts.push(`【用户提供的素材】\n${String(excerpt).slice(0, 3000)}`);
  }
  if (extra) parts.push(`【用户补充】${extra}`);
  if (chatDigest) {
    parts.push(`【你们刚才在吧台边聊到的】\n${String(chatDigest).slice(0, 2400)}\n这些只是素材和语气参考：可以吸收其中的想法、用词和情绪，但不要照抄原句，也不要在正文里提到「对话」。`);
  }
  parts.push([
    '【输出格式】严格按下面的标记输出，不要加任何解释或 Markdown 代码块：',
    '标题：……',
    '正文：',
    '……',
    '写在最后：',
    '……（100–200 字，只谈一个具体的犹豫，不讲道理；也可以留空）',
    '标签：……（3–5 个，用逗号分隔）'
  ].join('\n'));
  return [
    { role: 'system', content: parts[0] },
    { role: 'user', content: parts.slice(1).join('\n\n') }
  ];
}

function offlinePromptPack({ profile, ...rest }) {
  const messages = writingMessages({ profile, ...rest });
  return [
    '把下面整段内容复制给任意一个支持长文的 AI（ChatGPT / DeepSeek / Kimi / Claude 都可以），然后把它的回复粘贴回「粘贴回稿」。',
    '',
    '===== 复制开始 =====',
    messages[0].content,
    '',
    messages[1].content,
    '===== 复制结束 ====='
  ].join('\n');
}

module.exports = {
  loadProfile,
  systemPrompt,
  chatMessages,
  writingMessages,
  offlinePromptPack,
  KIND_LABEL,
  chooseEra,
  eraById
};
