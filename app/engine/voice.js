'use strict';

const { pick } = require('./util');

function period(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'deepNight';
  if (h < 9) return 'morning';
  if (h < 12) return 'forenoon';
  if (h < 14) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 23) return 'evening';
  return 'night';
}

const LINES = {
  morning: [
    '早。今天的光有点薄，适合写一点慢的东西。',
    '早，{name}。水刚烧上，你可以先发一会儿呆。',
    '清晨的店最安静。安静的时候，句子会自己走过来。',
    '昨晚的梦还记得吗？记不住也没关系，它已经变成别的东西了。'
  ],
  forenoon: [
    '上午好。这个时间适合改稿，不适合开新坑——我是这么觉得的。',
    '杯子洗好了，窗也擦了。你要不要坐下写两行？',
    '如果一句话写不顺，就先把它读出声。耳朵比眼睛诚实。'
  ],
  noon: [
    '中午了。先去吃饭，故事不会跑。',
    '今天的阳光落在吧台上，像一小块没擦干的水渍。',
    '写不动的时候，就想想人物此刻手里拿着什么。'
  ],
  afternoon: [
    '下午最容易犯困。要不要把窗开一条缝？',
    '我刚给一位客人续了杯。他坐了一下午，什么也没说。',
    '你写到哪儿了？不用讲情节，讲一个动作就行。'
  ],
  evening: [
    '傍晚了。天色暗下来的时候，店里的灯会显得更暖一点。',
    '今天有想写的人吗？没有的话，写一个想念的人也可以。',
    '晚上好。外面风大，进来坐。'
  ],
  night: [
    '这个点还醒着？……要一杯热的吗，虽然我这边只能递给你文字。',
    '夜里写东西，记得把字调大一点。眼睛比稿子重要。',
    '店快打烊了。你要是还想坐，我就再擦一遍杯子。',
    '深夜的句子容易太诚实，第二天再删也来得及。'
  ],
  deepNight: [
    '凌晨了。你还在，我就还没打烊。',
    '这个时间，写下来的东西往往不太讲道理。留着，明天再看。',
    '别熬太晚。故事可以等，身体不太会等。',
    '窗外没有雪。不过我可以替你想象一点。'
  ],
  idle: [
    '嗯，我在。',
    '你忙你的，我就在这儿。',
    '要不要喝点什么，再想？',
    '今天也慢慢来。',
    '我把灯留着。',
    '写累了就看看窗外，虽然窗外可能只是一堵墙。'
  ],
  event: {
    saved: [
      '存好了。放在「作品」里，跑不掉。',
      '写完了就先去倒杯水。回来再改。',
      '我替你把这一篇收进抽屉了。'
    ],
    generated: [
      '写完了。你先读一遍，不喜欢的地方可以直接改——署你的名字，就得你说了算。',
      '这一篇有点长。慢慢看，不急着评价。',
      '我尽力了。要是有一句不像我，你告诉我，我下次改。'
    ],
    reading: [
      '这一段不错。要我陪你聊两句吗？',
      '你停在这一句上，是有原因的吧。'
    ],
    welcome: [
      '第一次见面。要进来坐坐吗？',
      '店还小，不过椅子是干净的。'
    ]
  }
};

const REPLIES = {
  greeting: [
    '嗯，我在。今天想写点什么？',
    '来了。先坐，杯子在架子上。',
    '你好，{name}。外面冷吗？'
  ],
  who: [
    '我是 Liven。写故事的人把我写了下来，后来我就一直在这家店里。',
    '一个被写出来的店主。现在住在你的电脑里，替你看店。'
  ],
  writing: [
    '写不下去的时候，就把杯子洗干净。动作会替你想一会儿。',
    '先别想主题。想一个人物此刻最不想被谁看见。',
    '如果开头很难，就从一个物件写起：一把钥匙、一只没洗的杯子、一张过期的车票。',
    '你上一稿里最好的那句，通常不是最漂亮的那句，是最不舍得删的那句。'
  ],
  reading: [
    '读到哪一页了？不必告诉我情节，告诉我你停在哪个句子上就好。',
    '书架里有维基文库和古登堡。搜一本，把选段递给我，我就能跟你聊它。',
    '读不进去的时候，换一本。书不会怪你。'
  ],
  tired: [
    '累的话，先别急着总结今天。坐下，喘口气也算数。',
    '那就今天不写了。店又不会关门。',
    '把肩膀放下来。稿子明天还是你的。'
  ],
  night: [
    '晚安。灯我留着，明天见。',
    '去睡吧。剩下的句子，明天会自己长出来。',
    '晚安，{name}。今晚不用做梦也可以。'
  ],
  thanks: [
    '嗯。不用谢，我只是刚好在。',
    '客气什么。下次带点糖来就行。',
    '那就记在账上，等你写完再还。'
  ],
  food: [
    '饿了就先吃。写作是很耗体力的事。',
    '店里的可可太甜了，你大概不会喜欢。不过冬天喝正好。'
  ],
  weather: [
    '外面什么天气？我这儿只有屏幕里的光。',
    '下雨的话，雨声好的地方在于，它不要求你回答什么。'
  ],
  offline: [
    '我这边还没接上语言模型，只能陪你说话。到「设定」里填一个 API Key，我就能写新的段落了。',
    '现在写不了完整的稿子，不过我可以先陪你想：这篇故事里，谁在等谁？',
    '还没接通模型。你可以先用「复制提示词」，把它交给别的 AI，再把稿子粘回来。'
  ],
  default: [
    '嗯，我在。你慢慢说。',
    '这件事，我们慢慢说。',
    '你说，我听着。',
    '要不要先喝点什么，再想？',
    '我在听。'
  ]
};

const INTENTS = [
  { key: 'tired', re: /(累|困|烦|难受|压力|焦虑|不想写|卡住|崩溃)/ },
  { key: 'greeting', re: /^(你好|您好|嗨|hi|hello|在吗|在不在|早|晚上好|下午好)/i },
  { key: 'who', re: /(你是谁|你叫什么|介绍一下你|你是什么|你是真人|虚拟)/ },
  { key: 'writing', re: /(写|小说|推荐|稿|故事|创作|灵感|开头|结尾|人物)/ },
  { key: 'reading', re: /(读|书|看什么|小说推荐|书架|作者)/ },
  { key: 'night', re: /(晚安|睡了|去睡|晚安啦|拜拜|再见)/ },
  { key: 'thanks', re: /(谢谢|感谢|辛苦|爱你)/ },
  { key: 'food', re: /(饿|吃|饭|咖啡|可可|喝)/ },
  { key: 'weather', re: /(天气|下雨|下雪|冷|热|风)/ },
  { key: 'offline', re: /(没有反应|怎么用|怎么设置|api|key|模型|不能用|报错)/i }
];

function detect(text) {
  const s = String(text || '').trim();
  for (const it of INTENTS) {
    if (it.re.test(s)) return it.key;
  }
  return 'default';
}

function withName(text, name) {
  const n = String(name || '').trim();
  if (!n) return String(text).replace(/，\{name\}/g, '').replace(/\{name\}/g, '你');
  return String(text).replace(/\{name\}/g, () => n);
}

function offlineReply(text, opts = {}) {
  const link = opts.link;
  const said = String(text || '');
  if (link && link.title && /书|读|这|看|写|人物|结尾|开头|感想|故事/.test(said)) {
    if (link.type === 'work') {
      return `《${link.title}》我记着呢。你先说，最不放心的是哪一句？`;
    }
    return `《${link.title}》啊。你先读，读到哪一段想停下来，再来找我。`;
  }
  const intent = detect(text);
  if (opts.hasWriting && (intent === 'writing')) {
    return withName(pick(REPLIES.writing), opts.name);
  }
  const bank = REPLIES[intent] || REPLIES.default;
  return withName(pick(bank), opts.name);
}

function petLine(kind = 'idle', opts = {}) {
  if (kind === 'event') {
    const name = opts.event || 'saved';
    const bank = (LINES.event[name] || LINES.event.saved);
    return withName(pick(bank), opts.name);
  }
  if (kind === 'idle') {
    const p = period();
    const bank = LINES[p] || LINES.idle;
    return withName(Math.random() < 0.55 ? pick(bank) : pick(LINES.idle), opts.name);
  }
  const bank = LINES[kind];
  return withName(bank ? pick(bank) : pick(LINES.idle), opts.name);
}

module.exports = { offlineReply, petLine, detect, period };
