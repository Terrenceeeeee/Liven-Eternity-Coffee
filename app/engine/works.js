'use strict';

const fs = require('fs');
const path = require('path');
const {
  sanitizeFilename, todayStr, countWords, readJson, writeJsonAtomic, clamp
} = require('./util');

class Library {
  constructor(file) {
    this.file = file;
    this.data = readJson(file, { books: {}, recent: [] });
    if (!this.data.books) this.data.books = {};
    if (!Array.isArray(this.data.recent)) this.data.recent = [];
  }

  save() {
    writeJsonAtomic(this.file, this.data);
  }

  upsert(book) {
    const key = book.key;
    if (!key) return;
    const prev = this.data.books[key] || {};
    this.data.books[key] = {
      ...prev,
      key,
      source: book.source,
      id: book.id,
      title: book.title,
      author: book.author,
      url: book.url,
      chapters: Array.isArray(book.chapters) ? book.chapters.slice(0, 200) : (prev.chapters || []),
      lastOpened: Date.now(),
      progress: prev.progress || 0,
      lastChapter: book.lastChapter || prev.lastChapter || ''
    };
    this.data.recent = [key, ...this.data.recent.filter(k => k !== key)].slice(0, 24);
    this.save();
  }

  progress(key, percent) {
    const b = this.data.books[key];
    if (!b) return;
    b.progress = clamp(Math.round(Number(percent) || 0), 0, 100);
    b.lastOpened = Date.now();
    this.save();
  }

  recent() {
    return this.data.recent
      .map(k => this.data.books[k])
      .filter(Boolean)
      .slice(0, 8);
  }
}

/* --------------------------------- Works --------------------------------- */

const KIND_FOLDER = {
  recommend: '文学推荐',
  story: '小说',
  essay: '随笔',
  letter: '书信',
  review: '读书感想'
};

const KIND_LABEL = {
  recommend: '文学推荐',
  story: '短篇',
  essay: '随笔',
  letter: '书信',
  review: '读书感想'
};

function mdContent(work) {
  const date = work.date || todayStr();
  const kind = KIND_LABEL[work.kind] || '短篇';
  const meta = [
    `> 作者：Liven（由虚拟Liven完成）`,
    `> 日期：${date}`,
    `> 类型：${kind}${work.topic ? ` · ${work.topic}` : ''}`
  ];
  if (work.sourceTitle) meta.push(`> 取材：《${work.sourceTitle}》${work.sourceAuthor ? ` · ${work.sourceAuthor}` : ''}`);
  if (work.era) meta.push(`> 声线：${work.era}`);
  const parts = [
    `# ${work.title}`,
    '',
    ...meta,
    '',
    '---',
    '',
    String(work.body || '').trim(),
    ''
  ];
  if (work.after && work.after.trim()) {
    parts.push('---', '', '### 写在最后', '', work.after.trim(), '');
  }
  parts.push(
    '---',
    '',
    '> 本文由虚拟 Liven 依据 Liven 既有作品文风生成，经人工筛选后收录。署名「Liven」指角色，不代表作者本人。',
    ''
  );
  return parts.join('\n');
}

function paragraphs(text, opts = {}) {
  const { Paragraph, TextRun, AlignmentType } = require('docx');
  const size = opts.size || 24; // half-points
  return String(text || '')
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => new Paragraph({
      children: [new TextRun({ text: p, size })],
      spacing: { line: 360, after: 120 },
      indent: opts.indent === false ? undefined : { firstLine: 480 },
      alignment: opts.align || AlignmentType.JUSTIFIED
    }));
}

async function docxBuffer(work) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle
  } = require('docx');
  const date = work.date || todayStr();
  const kind = KIND_LABEL[work.kind] || '短篇';
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: work.title || '未命名', bold: true, size: 44 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 }
  }));

  const meta = [
    `Liven（由虚拟Liven完成）`,
    date,
    kind + (work.topic ? ` · ${work.topic}` : '')
  ].join('    ');
  children.push(new Paragraph({
    children: [new TextRun({ text: meta, size: 18, color: '7a7166' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 }
  }));

  children.push(new Paragraph({
    children: [],
    border: { bottom: { color: 'd8c9b2', size: 6, style: BorderStyle.SINGLE, space: 6 } },
    spacing: { after: 240 }
  }));

  for (const p of paragraphs(work.body)) children.push(p);

  if (work.after && work.after.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: '写在最后', bold: true, size: 24 })],
      spacing: { before: 360, after: 120 }
    }));
    for (const p of paragraphs(work.after, { size: 20, indent: false })) children.push(p);
  }

  children.push(new Paragraph({
    children: [new TextRun({
      text: '本文由虚拟 Liven 依据 Liven 既有作品文风生成，经人工筛选后收录。署名「Liven」指角色，不代表作者本人。',
      size: 17,
      color: '8a8074',
      italics: false
    })],
    spacing: { before: 480 },
    alignment: AlignmentType.LEFT
  }));

  const doc = new Document({
    creator: 'Liven',
    title: work.title || '未命名',
    description: '由虚拟Liven完成',
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '宋体' },
            size: 24
          }
        }
      }
    },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children
    }]
  });

  return Packer.toBuffer(doc);
}

function uniqueBase(dir, base) {
  let name = base;
  let i = 2;
  while (fs.existsSync(path.join(dir, name + '.md')) || fs.existsSync(path.join(dir, name + '.docx'))) {
    name = `${base}-${i++}`;
  }
  return name;
}

async function saveWork({ work, outDir, formats = ['md', 'docx'] }) {
  const folder = KIND_FOLDER[work.kind] || '小说';
  const dir = path.join(outDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const base = uniqueBase(dir, `${work.date || todayStr()}_${sanitizeFilename(work.title || '未命名')}`);
  const mdPath = path.join(dir, base + '.md');
  fs.writeFileSync(mdPath, mdContent(work), 'utf8');

  let docxPath = '';
  if (formats.includes('docx')) {
    try {
      const buf = await docxBuffer(work);
      docxPath = path.join(dir, base + '.docx');
      fs.writeFileSync(docxPath, buf);
    } catch (e) {
      docxPath = '';
    }
  }
  return { mdPath, docxPath, dir };
}

async function saveSerialChapter({ serial, work, outDir, formats = ['md'] }) {
  const dir = path.join(outDir, '连载', sanitizeFilename(serial.title || '无题连载'));
  fs.mkdirSync(dir, { recursive: true });
  const no = String(work.chapterNo || 1).padStart(2, '0');
  const base = `第${no}章_${sanitizeFilename(work.title || '未命名')}`;
  const mdPath = path.join(dir, base + '.md');
  const payload = { ...work, kind: 'story', topic: `连载《${serial.title}》` };
  fs.writeFileSync(mdPath, mdContent(payload), 'utf8');

  let docxPath = '';
  if (formats.includes('docx')) {
    try {
      const buf = await docxBuffer(payload);
      docxPath = path.join(dir, base + '.docx');
      fs.writeFileSync(docxPath, buf);
    } catch (e) {
      docxPath = '';
    }
  }
  return { mdPath, docxPath, dir, base };
}

function parseWorkFile(file) {
  const name = path.basename(file);
  if (/^阅读记录\.md$/i.test(name)) return null;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || path.basename(file, '.md');
  const date = (/^(\d{4}-\d{2}-\d{2})_/.exec(name) || [])[1] || '';
  const kindDir = path.basename(path.dirname(file));
  const kindMap = { '文学推荐': 'recommend', '小说': 'story', '随笔': 'essay', '书信': 'letter', '读书感想': 'review' };
  return {
    path: file,
    name,
    title: title.trim(),
    date,
    kind: kindMap[kindDir] || 'story',
    kindLabel: KIND_LABEL[kindMap[kindDir]] || kindDir,
    words: countWords(text),
    mtime: fs.statSync(file).mtimeMs,
    hasDocx: fs.existsSync(file.replace(/\.md$/i, '.docx'))
  };
}

function listWorks(outDir) {
  const out = [];
  if (!fs.existsSync(outDir)) return out;
  const dirs = [outDir, ...fs.readdirSync(outDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(outDir, d.name))];
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (ent.isFile() && /\.md$/i.test(ent.name)) {
        const info = parseWorkFile(path.join(dir, ent.name));
        if (info) out.push(info);
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function readWork(file) {
  return fs.readFileSync(file, 'utf8');
}

module.exports = {
  Library, saveWork, saveSerialChapter, listWorks, readWork, mdContent, KIND_FOLDER, KIND_LABEL
};
