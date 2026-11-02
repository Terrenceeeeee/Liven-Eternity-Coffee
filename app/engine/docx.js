'use strict';

/**
 * 不依赖第三方库的 .docx 文本提取：
 * docx 就是一个 zip，里面 word/document.xml 是正文。
 * 只读中央目录 + inflateRawSync，够把段落文字按顺序取出来。
 */

const fs = require('fs');
const zlib = require('zlib');

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function readEntries(buf) {
  let eocd = -1;
  const stop = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这个 .docx 不是有效的 Word 文件。');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new Error('这个 .docx 的文件目录损坏了。');
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('这个 .docx 用了不支持的压缩方式。');
}

function documentXmlToText(xml) {
  const paragraphs = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = pRe.exec(xml))) {
    const inner = m[1]
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n');
    const runs = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(inner))) runs.push(decodeXml(t[1]));
    paragraphs.push(runs.join(''));
  }
  if (!paragraphs.length) {
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(xml))) paragraphs.push(decodeXml(t[1]));
  }
  return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractDocx(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw new Error('读不到这个 Word 文件。');
  }
  const entries = readEntries(buf);
  const doc = entries.get('word/document.xml');
  if (!doc) throw new Error('这个文件里没有 Word 正文。');
  const xml = readEntry(buf, doc).toString('utf8');
  const text = documentXmlToText(xml);
  if (!text) throw new Error('这个 Word 文件是空的，或者正文全是图片。');
  return text;
}

module.exports = { extractDocx };
