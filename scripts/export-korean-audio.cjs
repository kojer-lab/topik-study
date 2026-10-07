// Export Korean vocabulary audio phrases without changing existing SRS identifiers.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const start = Math.max(1, parseInt(process.argv[2] || '1', 10));
const end = Math.min(1500, parseInt(process.argv[3] || '20', 10));
if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
  throw new Error('Usage: node scripts/export-korean-audio.cjs START END');
}
const sources = [
  'vocab-catalog.js','vocab-essential.js',
  'vocab-examples-301-400.js','vocab-examples-401-500.js',
  'vocab-examples-001-100.js','vocab-examples-101-200.js',
  'vocab-examples-201-300.js','vocab-examples-501-600.js',
  'vocab-examples-601-700.js','vocab-examples-701-800.js',
  ...'abcdefg'.split('').map(c => 'vocab-upper-batch-' + c + '.js')
];
const ctx = {window:{}};
vm.createContext(ctx);
for (const name of sources) {
  vm.runInContext(fs.readFileSync(path.join(process.cwd(),name),'utf8'),ctx,{filename:name});
}
const catalog = ctx.window.VOCAB_CATALOG;
if (!Array.isArray(catalog) || catalog.length !== 1500) throw new Error('Expected exactly 1,500 vocabulary entries');
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8,'0') + '-' + text.length;
}
const utterances = new Map();
for (const v of catalog) {
  const id = Number(v.id.slice(1));
  if (id < start || id > end) continue;
  for (const field of ['word','sentence','sentence2']) {
    const text = String(v[field] || '').trim();
    if (!text) throw new Error(v.id + ' has empty ' + field);
    const key = hash(text);
    if (utterances.has(key) && utterances.get(key) !== text) throw new Error('Audio hash collision: ' + key);
    utterances.set(key,text);
  }
}
const output = Array.from(utterances,([key,text])=>({key,text}));
fs.writeFileSync('/tmp/topik-korean-corpus.json',JSON.stringify(output,null,2),'utf8');
console.log(JSON.stringify({start,end,vocabulary:end-start+1,uniqueAudio:output.length}));
