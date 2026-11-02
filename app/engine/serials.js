'use strict';

/* 连载：先由 Liven 自己拟一个中篇的骨架，再按骨架一章一章写。 */

function planMessages({ system, dateStr }) {
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `【今天的写作任务】类型：连载策划。日期：${dateStr}。`,
        '',
        '你要为自己开一部中篇连载。不要问读者想读什么，自己决定。',
        '它应当像你会写的东西：一个人和另一个人，在一个具体的地方，遇到一件需要时间才会显出重量的事。',
        '可以延续你熟悉的母题（店、雪、烟花、河、旧信、海、墓园），也可以换一个你还没写过的行当。',
        '不要写奇幻设定说明，不要写大纲式说教。先想清楚：谁，在哪里，失去了什么，又还在等什么。',
        '',
        '请只输出一个 JSON 对象，不要代码块，不要解释：',
        '{',
        '  "title": "连载标题，不超过 12 字",',
        '  "topic": "一句话故事核，不超过 40 字",',
        '  "characters": [{"name": "名字", "role": "他是谁，想要什么，怕什么"}],',
        '  "arc": "整部作品的情感走向，2-3 句",',
        '  "chapters": [{"title": "章节标题", "beat": "这一章发生什么，停在哪个画面"}]',
        '}',
        '',
        '要求：chapters 5 到 8 章；每章的 beat 必须是一个可以写出来的场景，不要写成主题概述；',
        '人物 2 到 4 个；标题不要用《》包裹。'
      ].join('\n')
    }
  ];
}

function parsePlan(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('连载策划没有给出可用的结构。');
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error('连载策划的 JSON 解析失败，再试一次。');
  }
  const chapters = Array.isArray(data.chapters)
    ? data.chapters
      .map(c => ({
        title: String((c && c.title) || '').trim(),
        beat: String((c && c.beat) || '').trim()
      }))
      .filter(c => c.title || c.beat)
    : [];
  if (!chapters.length) throw new Error('连载策划没有给出章节。');
  return {
    title: String(data.title || '无题连载').replace(/^《|》$/g, '').trim(),
    topic: String(data.topic || '').trim(),
    characters: Array.isArray(data.characters) ? data.characters.slice(0, 6) : [],
    arc: String(data.arc || '').trim(),
    chapters: chapters.slice(0, 12)
  };
}

function chapterMessages({ system, serial, chapter, prevTail, dateStr }) {
  const plan = serial.plan || {};
  const chapters = (plan.chapters || []).map((c, i) =>
    `${i + 1}. ${c.title}${c.beat ? `：${c.beat}` : ''}`).join('\n');
  const people = (plan.characters || []).map(c =>
    `- ${c.name || '未命名'}：${c.role || ''}`).join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `【今天的写作任务】类型：连载第 ${chapter.no} 章。日期：${dateStr}。`,
        '',
        `连载标题：${serial.title}`,
        `故事核：${plan.topic || serial.topic || ''}`,
        `整体走向：${plan.arc || ''}`,
        '',
        '人物：',
        people || '（见前文）',
        '',
        '章节骨架：',
        chapters,
        '',
        `这一章要写：第 ${chapter.no} 章「${chapter.title}」。`,
        chapter.beat ? `这一章的核心场景：${chapter.beat}` : '',
        '',
        '要求：',
        '1. 直接接着上一章写，不要复述前情，不要写「上回说到」。',
        '2. 这一章要有完整的起落：至少一个场景、一次对话、一个没有说破的东西。',
        '3. 篇幅 1800 到 3200 字。不要为了长而拖，也不要写成梗概。',
        '4. 保留你的句子：长句可以慢，短句要落得下来。少用形容词堆叠。',
        '5. 这一章结束时可以留一个钩子，但不要用「欲知后事如何」。',
        '',
        prevTail
          ? `上一章结尾（仅供衔接，不要照抄）：\n${prevTail}`
          : '这是第一章。开场不要解释设定，让人物先动起来。',
        '',
        '请按下面格式输出，不要附加说明：',
        '标题：这一章的标题',
        '正文：',
        '（正文）',
        '写在最后：',
        '（可留空；连载章节一般只写一两句）',
        '标签：连载'
      ].filter(Boolean).join('\n')
    }
  ];
}

module.exports = { planMessages, parsePlan, chapterMessages };
