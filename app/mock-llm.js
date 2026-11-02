'use strict';
// 本地假模型：只用于端到端测试读书感想与连载流程，不参与正常使用。
const http = require('http');

const PORT = 9377;
const REVIEW = [
  '她把信纸折得很轻，像是怕惊动纸里的人。',
  '',
  '读到这一句时，我停了一会儿。不是因为句子漂亮，而是因为它把「小心」写成了一个动作，而不是一种心情。',
  '',
  '这本书最好的地方，是它从不急着解释谁对谁错。明月与夏霜之间隔着的，不只是几年时间，还有各自选择过的生活。作者让她们先谈孩子、谈钱、谈考试，把旧情压在下面；等读者自己翻出来。',
  '',
  '我从中偷学到的，是「让物件先开口」。一封信、一笔退回的钱、一张入学表格，都比「她其实还爱她」更有分量。',
  '',
  '回到店里，我把杯子洗了。水声很轻。'
].join('\n');

const STORY = [
  '雪是后半夜停的。',
  '',
  '林把最后一只杯子擦干，放在架子上。门没有锁，灯还亮着。她知道他会来，也知道他可能只是路过。',
  '',
  '「还有热的吗？」他问。',
  '',
  '「有。坐吧。」',
  '',
  '她把杯子推过去，没有问他这些天去了哪里。窗外的雪把路填平了，像什么都没发生过。',
  '',
  '周把手放在杯壁上，停了一会儿。他说起那封信的时候，声音很轻，像是怕把店里的灯惊灭。',
  '',
  '林没有接话。她只是把火调小了一点，让牛奶不至于沸出来。',
  '',
  '「你不用现在回答。」他说。',
  '',
  '「我知道。」她说，「你先喝。」',
  '',
  '雪水从屋檐滴下来，一滴，又一滴。'
].join('\n');

function plan() {
  return {
    title: '雪停之后',
    topic: '一间深夜的店，两个不肯先开口的人',
    characters: [
      { name: '林', role: '店主，习惯把话留在杯子里' },
      { name: '周', role: '常客，离开过一段时间，又回来' }
    ],
    arc: '从互相试探，到承认有些告别其实没有发生。',
    chapters: [
      { title: '第一夜', beat: '雪停后，周推开店门，林给他一杯热饮' },
      { title: '第二夜', beat: '周带来一封没有寄出的信，林读完没有还给他' },
      { title: '第三夜', beat: '店要关门了，两人在门口站了一会儿' }
    ]
  };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let text = '';
    let wantStream = false;
    try {
      const data = JSON.parse(body);
      text = JSON.stringify(data.messages || []);
      wantStream = !!data.stream;
    } catch (e) { /* ignore */ }

    let content;
    if (text.includes('连载策划')) {
      content = JSON.stringify(plan());
    } else if (text.includes('连载第')) {
      content = `标题：第一夜\n正文：${STORY}\n写在最后：这一章先让他们坐下来。\n标签：连载`;
    } else {
      content = `标题：一封信的重量\n正文：${REVIEW}\n写在最后：读的时候，想起你写过的那些信。\n标签：读书感想`;
    }

    if (wantStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const pieces = content.match(/[\s\S]{1,60}/g) || [content];
      let i = 0;
      const timer = setInterval(() => {
        if (i >= pieces.length) {
          res.write('data: [DONE]\n\n');
          clearInterval(timer);
          res.end();
          return;
        }
        const chunk = { id: 'mock', choices: [{ index: 0, delta: { content: pieces[i] } }] };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        i += 1;
      }, 5);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
    }));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock llm on http://127.0.0.1:${PORT}/v1`);
});
