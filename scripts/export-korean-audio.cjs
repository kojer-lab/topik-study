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
function addUtterance(record){
  const existing=utterances.get(record.key);
  if(existing && existing.text!==record.text)throw new Error('Audio hash collision: '+record.key);
  if(!existing)utterances.set(record.key,record);
}

// Listening clips are intentionally added BEFORE vocabulary so the next
// synthesis batch upgrades all TOPIK listening questions first.
const listeningStart = Math.max(0, parseInt(process.argv[4] || '0', 10));
const listeningEnd = Math.max(listeningStart, parseInt(process.argv[5] || '10', 10));
const html = fs.readFileSync('index.html','utf8');
const match = html.match(/const data=({[\s\S]*?});\n\nif\(window\.EXTRA_QUESTIONS\)/);
if (!match) throw new Error('Cannot find base listening bank');
const initialBank = vm.runInNewContext('(' + match[1] + ')');
const allListening = initialBank.listening.slice();
for (const file of ['questions-extra.js','questions-exam.js','questions-training-01.js','questions-training-02.js','questions-training-03.js']){
  vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
}
for (const group of [ctx.window.EXTRA_QUESTIONS,ctx.window.EXAM_QUESTIONS,
  ctx.window.TRAINING_QUESTIONS_1,ctx.window.TRAINING_QUESTIONS_2,ctx.window.TRAINING_QUESTIONS_3]){
  if(Array.isArray(group?.listening))allListening.push(...group.listening);
}
const selectedListening=allListening.slice(listeningStart,listeningEnd);
for(const item of selectedListening){
  if(!item.audio)continue;
  const raw=String(item.audio).trim();
  const text=raw.replace(/^(여자|남자):\s*/gm,"").trim();
  const segments=raw.split(/\n+/).map(line=>{
    const m=line.match(/^(여자|남자):\s*(.+)$/);
    return m?{speaker:m[1]==='여자'?'female':'male',text:m[2].trim()}:{speaker:'neutral',text:line.trim()};
  }).filter(x=>x.text);
  addUtterance({key:hash(text),text,kind:'dialogue',segments});
}

for (const v of catalog) {
  const id = Number(v.id.slice(1));
  if (id < start || id > end) continue;
  for (const field of ['word','sentence','sentence2']) {
    const text = String(v[field] || '').trim();
    if (!text) throw new Error(v.id + ' has empty ' + field);
    addUtterance({key:hash(text),text,kind:'vocab'});
  }
}
const output = Array.from(utterances.values());
fs.writeFileSync('/tmp/topik-korean-corpus.json',JSON.stringify(output,null,2),'utf8');
console.log(JSON.stringify({start,end,vocabulary:end-start+1,listening:selectedListening.length,uniqueAudio:output.length}));
