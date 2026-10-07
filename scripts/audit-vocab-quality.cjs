// Audit all 1,500 TOPIK vocabulary entries using only Node built-ins.
// Run: node scripts/audit-vocab-quality.cjs [--strict]
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const strict = process.argv.includes("--strict");
const sources = [
  "vocab-catalog.js","vocab-essential.js",
  "vocab-examples-001-100.js","vocab-examples-101-200.js",
  "vocab-examples-201-300.js","vocab-examples-301-400.js",
  "vocab-examples-401-500.js","vocab-examples-501-600.js",
  "vocab-examples-601-700.js","vocab-examples-701-800.js",
  ..."abcdefg".split("").map(c => "vocab-upper-batch-" + c + ".js")
];

const ctx = {window:{}};
vm.createContext(ctx);
for (const name of sources) {
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), name), "utf8"), ctx, {filename:name});
}
const catalog = ctx.window.VOCAB_CATALOG;
if (!Array.isArray(catalog)) throw new Error("VOCAB_CATALOG was not created");

function clean(s){
  return String(s||"")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu,"")
    .replace(/(저는|제가|오늘|주말에|우리|정말|아주|조금|다시|보통|같이|함께)/g,"");
}
function bigramSet(s){
  const out = new Set();
  for(let i=0;i<s.length-1;i++) out.add(s.slice(i,i+2));
  return out;
}
function similarity(a,b){
  a=clean(a); b=clean(b);
  if(!a || !b) return 0;
  const A=bigramSet(a), B=bigramSet(b);
  if(!A.size || !B.size) return a===b ? 1 : 0;
  let hit=0;
  for(const x of A) if(B.has(x)) hit++;
  return (2*hit)/(A.size+B.size);
}
function short(s,n=72){
  s=String(s||"");
  return s.length>n ? s.slice(0,n-1)+"…" : s;
}

const required = ["id","word","meaning","pron","sentence","sentenceJp","sentence2","sentenceJp2"];
const missing=[];
const badIds=[];
const exactPairs=[];
const similarPairs=[];
const duplicateSentences=[];
const duplicateWords=[];
const suspiciousJapanese=[];
const unusuallyShort=[];
const unusuallyLong=[];

const idSeen = new Map();
const wordSeen = new Map();
const sentenceSeen = new Map();

for(const v of catalog){
  for(const key of required){
    if(!String(v?.[key]||"").trim()) missing.push({id:v?.id||"?",word:v?.word||"?",field:key});
  }
  if(!/^V\d{3,4}$/.test(String(v.id||""))) badIds.push({id:v.id,word:v.word});
  if(idSeen.has(v.id)) badIds.push({id:v.id,word:v.word,duplicateWith:idSeen.get(v.id)});
  else idSeen.set(v.id,v.word);

  const wl = wordSeen.get(v.word)||[];
  wl.push(v.id); wordSeen.set(v.word,wl);

  for(const [field,text] of [["sentence",v.sentence],["sentence2",v.sentence2]]){
    const t=String(text||"").trim();
    if(!t) continue;
    const arr=sentenceSeen.get(t)||[];
    arr.push(v.id+":"+field); sentenceSeen.set(t,arr);
    const len=[...t].length;
    if(len<7) unusuallyShort.push({id:v.id,word:v.word,field,text:t});
    if(len>55) unusuallyLong.push({id:v.id,word:v.word,field,text:short(t,100)});
  }

  const s1=String(v.sentence||"").trim(), s2=String(v.sentence2||"").trim();
  const j1=String(v.sentenceJp||"").trim(), j2=String(v.sentenceJp2||"").trim();
  if(s1 && s2){
    if(clean(s1)===clean(s2)) exactPairs.push({id:v.id,word:v.word,s1,s2});
    else {
      const score=similarity(s1,s2);
      if(score>=0.58) similarPairs.push({id:v.id,word:v.word,score:+score.toFixed(2),s1,s2});
    }
  }
  if(j1 && j2 && j1===j2) exactPairs.push({id:v.id,word:v.word,japanese:true,s1:j1,s2:j2});

  // Translation fields should normally contain Japanese, not raw Hangul-only text.
  for(const [field,text] of [["meaning",v.meaning],["sentenceJp",v.sentenceJp],["sentenceJp2",v.sentenceJp2]]){
    const t=String(text||"");
    if(/[가-힣]/.test(t) && !/[ぁ-んァ-ヶ一-龯]/.test(t)){
      suspiciousJapanese.push({id:v.id,word:v.word,field,text:short(t)});
    }
  }
}

for(const [word,ids] of wordSeen){
  if(ids.length>1) duplicateWords.push({word,ids});
}
for(const [sentence,uses] of sentenceSeen){
  if(uses.length>1) duplicateSentences.push({sentence:short(sentence,100),uses});
}

similarPairs.sort((a,b)=>b.score-a.score);

const summary = {
  total: catalog.length,
  missingFields: missing.length,
  badOrDuplicateIds: badIds.length,
  duplicateWords: duplicateWords.length,
  exactExamplePairs: exactPairs.length,
  highSimilarityPairs: similarPairs.length,
  duplicateSentences: duplicateSentences.length,
  suspiciousJapanese: suspiciousJapanese.length,
  unusuallyShortExamples: unusuallyShort.length,
  unusuallyLongExamples: unusuallyLong.length
};

console.log("TOPIK VOCAB QUALITY AUDIT");
console.log(JSON.stringify(summary,null,2));

function section(name,items,limit=80){
  if(!items.length) return;
  console.log("\n## "+name+" ("+items.length+")");
  for(const item of items.slice(0,limit)) console.log(JSON.stringify(item));
  if(items.length>limit) console.log("... "+(items.length-limit)+" more");
}
section("Missing required fields",missing);
section("Bad or duplicate IDs",badIds);
section("Duplicate words",duplicateWords);
section("Exact example pairs",exactPairs);
section("High-similarity example pairs",similarPairs,150);
section("Exact duplicate sentences across entries",duplicateSentences,120);
section("Suspicious Japanese fields",suspiciousJapanese);
section("Very short examples",unusuallyShort);
section("Very long examples",unusuallyLong);

const critical = catalog.length!==1500 || missing.length || badIds.length || exactPairs.length;
if(strict && critical){
  console.error("\nStrict audit failed.");
  process.exit(1);
}
