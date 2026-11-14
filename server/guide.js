// «Руководство фасилитатора»: администратор загружает .docx, сервер извлекает главы и хранит их в DATA_DIR/guide.json.
// Текст руководства не хранится в открытом репозитории. Главы «Глава N…» — вводный курс; остальное (приложения) — дополнительное чтение.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');

const FILE = path.join(config.dataDir, 'guide.json');

/** Минимальное чтение zip: один файл по имени (Deflate или без сжатия). */
function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42); const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      if (buf.readUInt32LE(off) !== 0x04034b50) return null;
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');

/** .docx → { title, chapters: [{ title, course, blocks: [{ t: 'h'|'p'|'li', text }] }] } */
function parseDocx(buf) {
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) return { error: 'bad_docx' };
  const doc = xml.toString('utf8');
  const out = { title: '', chapters: [] }; let cur = null;
  for (const p of doc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const text = unxml((p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
      .map((x) => (x === '<w:tab/>' ? ' ' : x === '<w:br/>' ? '\n' : x.replace(/<[^>]+>/g, ''))).join('')).trim();
    if (!text) continue;
    if (/^Title$/i.test(style)) { out.title = text; continue; }
    if (/^Heading1$|^Заголовок1$/i.test(style)) { cur = { title: text, course: /^Глава\s+\d+/i.test(text), blocks: [] }; out.chapters.push(cur); continue; }
    if (!cur) continue;
    if (/^Heading[2-4]$/i.test(style)) cur.blocks.push({ t: 'h', text });
    else if (/ListParagraph/i.test(style) || /<w:numPr>/.test(p)) cur.blocks.push({ t: 'li', text });
    else cur.blocks.push({ t: 'p', text });
  }
  if (!out.chapters.some((c) => c.course)) return { error: 'no_chapters' };
  return out;
}

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } }
function save(buf, byUserId) {
  const g = parseDocx(buf); if (g.error) return g;
  const data = { ...g, uploadedAt: new Date().toISOString(), uploadedBy: byUserId };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data));
  return { ok: true, chapters: g.chapters.filter((c) => c.course).length, extra: g.chapters.filter((c) => !c.course).length };
}
module.exports = { parseDocx, load, save, readZipEntry };
