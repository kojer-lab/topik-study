// Audit the full TOPIK question bank using only Node built-ins.
// Run: node scripts/audit-question-quality.cjs [--strict]
const fs=require("node:fs");
const vm=require("node:vm");
const strict=process.argv.includes("--strict");

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/const data=({[\s\S]*?});\n\nif\(window\.EXTRA_QUESTIONS\)/);
if(!match) throw new Error("Cannot find base question bank in index.html");
const base=vm.runInNewContext("(" + match[1] + ")");

const ctx={window:{}};
vm.createContext(ctx);
for(const file of [
  "questions-extra.js","questions-exam.js",
  "questions-training-01.js","questions-training-02.js","questions-training-03.js"
]){
  vm.runInContext(fs.readFileSync(file,"utf8"),ctx,{filename:file});
}

const groups=[
  base,
  ctx.window.EXTRA_QUESTIONS,
  ctx.window.EXAM_QUESTIONS,
  ctx.window.TRAINING_QUESTIONS_1,
  ctx.window.TRAINING_QUESTIONS_2,
  ctx.window.TRAINING_QUESTIONS_3
].filter(Boolean);

const types=["vocab","grammar","reading","listening"];
const bank={vocab:[],grammar:[],reading:[],listening:[]};
for(const group of groups){
  for(const type of types){
    if(Array.isArray(group[type])) bank[type].push(...group[type]);
  }
}

function clean(s){
  return String(s||"").toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu,"")
    .replace(/(다음|중|것은|무엇입니까|알맞은|고르세요|가장|내용|같은|맞는)/g,"");
}
function grams(s,n=2){
  const out=new Set();
  for(let i=0;i<=s.length-n;i++)out.add(s.slice(i,i+n));
  return out;
}
function similarity(a,b){
  a=clean(a);b=clean(b);
  if(!a||!b)return 0;
  const A=grams(a),B=grams(b);
  if(!A.size||!B.size)return a===b?1:0;
  let hit=0;for(const x of A)if(B.has(x))hit++;
  return 2*hit/(A.size+B.size);
}
function short(s,n=90){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s;}

const all=[];
for(const type of types)bank[type].forEach((item,index)=>all.push({type,index,item}));

const missing=[];
const badIds=[];
const badChoices=[];
const duplicateChoices=[];
const duplicateIds=[];
const duplicateQuestions=[];
const highSimilarity=[];
const missingListening=[];
const suspiciousJapanese=[];
const malformedGlosses=[];

const ids=new Map(),questions=new Map();
for(const {type,index,item} of all){
  const label=item?.id||type+"#"+index;
  for(const field of ["id","q","c","a","e"]){
    const val=item?.[field];
    if(field==="c"){
      if(!Array.isArray(val)||!val.length)missing.push({id:label,type,field});
    }else if(field==="a"){
      if(!Number.isInteger(val))missing.push({id:label,type,field});
    }else if(!String(val??"").trim()) missing.push({id:label,type,field});
  }

  if(!String(item.id||"").trim()) badIds.push({id:label,type,reason:"missing"});
  else if(ids.has(item.id)) duplicateIds.push({id:item.id,uses:[ids.get(item.id),type+"#"+index]});
  else ids.set(item.id,type+"#"+index);

  if(Array.isArray(item.c)){
    if(item.c.length!==4) badChoices.push({id:label,type,count:item.c.length,q:short(item.q)});
    if(!Number.isInteger(item.a)||item.a<0||item.a>=item.c.length){
      badChoices.push({id:label,type,answerIndex:item.a,count:item.c.length,q:short(item.q)});
    }
    const normalized=item.c.map(x=>clean(x));
    if(new Set(normalized).size!==normalized.length){
      duplicateChoices.push({id:label,type,choices:item.c,q:short(item.q)});
    }
    if(item.c.some(x=>!String(x||"").trim())){
      badChoices.push({id:label,type,reason:"blank choice",q:short(item.q)});
    }
  }

  const q=String(item.q||"").trim();
  if(q){
    const qkey=clean(q);
    const arr=questions.get(qkey)||[];
    arr.push({id:label,type,q});
    questions.set(qkey,arr);
  }

  if(type==="listening"){
    if(!String(item.audio||"").trim())missingListening.push({id:label,field:"audio",q:short(q)});
    if(!String(item.jp||"").trim())missingListening.push({id:label,field:"jp",q:short(q)});
    if(/[가-힣]/.test(String(item.jp||"")) && !/[ぁ-んァ-ヶ一-龯]/.test(String(item.jp||""))){
      suspiciousJapanese.push({id:label,type,field:"jp",text:short(item.jp)});
    }
  }
  if(item.v!=null){
    if(!Array.isArray(item.v)) malformedGlosses.push({id:label,type,reason:"v is not array"});
    else item.v.forEach((g,i)=>{
      if(!Array.isArray(g)||g.length<2||!String(g[0]||"").trim()||!String(g[1]||"").trim()){
        malformedGlosses.push({id:label,type,index:i,value:g});
      }
    });
  }
}

for(const [,uses] of questions){
  if(uses.length>1)duplicateQuestions.push(uses);
}

// Near-duplicate stems within each type. Exact duplicates are reported above.
for(const type of types){
  const arr=bank[type];
  for(let i=0;i<arr.length;i++){
    for(let j=i+1;j<arr.length;j++){
      const a=arr[i],b=arr[j];
      if(clean(a.q)===clean(b.q))continue;
      const score=similarity(a.q,b.q);
      if(score>=0.90){
        highSimilarity.push({
          type,score:+score.toFixed(2),
          a:a.id,q1:short(a.q),b:b.id,q2:short(b.q)
        });
      }
    }
  }
}
highSimilarity.sort((a,b)=>b.score-a.score);

const summary={
  total:all.length,
  byType:Object.fromEntries(types.map(t=>[t,bank[t].length])),
  missingRequired:missing.length,
  duplicateIds:duplicateIds.length,
  nonFourOrInvalidChoices:badChoices.length,
  duplicateChoicesInsideQuestion:duplicateChoices.length,
  exactDuplicateQuestionStems:duplicateQuestions.length,
  highSimilarityQuestionStems:highSimilarity.length,
  listeningMissingAudioOrJapanese:missingListening.length,
  suspiciousJapanese:suspiciousJapanese.length,
  malformedGlosses:malformedGlosses.length
};
console.log("TOPIK QUESTION QUALITY AUDIT");
console.log(JSON.stringify(summary,null,2));

function section(name,items,limit=120){
  if(!items.length)return;
  console.log("\n## "+name+" ("+items.length+")");
  for(const item of items.slice(0,limit))console.log(JSON.stringify(item));
  if(items.length>limit)console.log("... "+(items.length-limit)+" more");
}
section("Missing required fields",missing);
section("Duplicate IDs",duplicateIds);
section("Choice-count / answer-index issues",badChoices);
section("Duplicate choices inside a question",duplicateChoices);
section("Exact duplicate question stems",duplicateQuestions);
section("High-similarity question stems",highSimilarity,180);
section("Listening missing audio or Japanese",missingListening);
section("Suspicious Japanese",suspiciousJapanese);
section("Malformed glosses",malformedGlosses);

const critical=
  missing.length||duplicateIds.length||badChoices.length||duplicateChoices.length||
  duplicateQuestions.length||missingListening.length||suspiciousJapanese.length||malformedGlosses.length;
if(strict&&critical){
  console.error("\nStrict question audit failed.");
  process.exit(1);
}
