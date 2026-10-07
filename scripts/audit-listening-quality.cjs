// Dedicated audit for all TOPIK listening questions.
// Run: node scripts/audit-listening-quality.cjs
const fs=require("node:fs");
const vm=require("node:vm");

const html=fs.readFileSync("index.html","utf8");
const match=html.match(/const data=({[\s\S]*?});\n\nif\(window\.EXTRA_QUESTIONS\)/);
if(!match) throw new Error("Cannot find base question data");
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
  base,ctx.window.EXTRA_QUESTIONS,ctx.window.EXAM_QUESTIONS,
  ctx.window.TRAINING_QUESTIONS_1,ctx.window.TRAINING_QUESTIONS_2,ctx.window.TRAINING_QUESTIONS_3
].filter(Boolean);
const listening=[];
for(const g of groups) if(Array.isArray(g.listening)) listening.push(...g.listening);
listening.forEach((q,i)=>{if(!q.id)q.id="L"+String(i+1).padStart(3,"0")});

function raw(s){return String(s||"").toLowerCase().replace(/[\s\p{P}\p{S}]/gu,"");}
function grams(s,n=2){const out=new Set();for(let i=0;i<=s.length-n;i++)out.add(s.slice(i,i+n));return out;}
function sim(a,b){a=raw(a);b=raw(b);if(!a||!b)return 0;const A=grams(a),B=grams(b);let hit=0;for(const x of A)if(B.has(x))hit++;return 2*hit/(A.size+B.size||1);}
function short(s,n=120){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s;}

const exactAudio=new Map();
const duplicateAudio=[];
const nearAudio=[];
const tooShort=[];
const tooLong=[];
const speakerIssues=[];
const jpIssues=[];
const choiceIssues=[];
const typeCounts={place:0,time:0,reason:0,next:0,topic:0,detail:0,opinion:0,number:0,other:0};
const sourceCounts={single:0,dialogue:0,multiTurn:0};
const answerTextSeen=new Map();
const repeatedAnswerTexts=[];

function classify(q){
  const s=String(q||"");
  if(/어디|장소/.test(s))return "place";
  if(/언제|몇 시|시간/.test(s))return "time";
  if(/왜|이유/.test(s))return "reason";
  if(/다음|하려고|하겠|할 것/.test(s))return "next";
  if(/무엇에 대해|주제|내용|무슨 이야기/.test(s))return "topic";
  if(/어떻게 생각|생각|마음|기분/.test(s))return "opinion";
  if(/몇 번|몇 명|몇 개|얼마|몇 층|몇 분|몇 시간/.test(s))return "number";
  if(/무엇|어떤|맞는|알맞은/.test(s))return "detail";
  return "other";
}

for(const q of listening){
  const audio=String(q.audio||"").trim();
  const jp=String(q.jp||"").trim();
  const norm=raw(audio);
  const prev=exactAudio.get(norm);
  if(prev) duplicateAudio.push({ids:[prev,q.id],audio:short(audio)});
  else exactAudio.set(norm,q.id);

  const chars=[...audio.replace(/\s/g,"")].length;
  if(chars<18)tooShort.push({id:q.id,chars,audio:short(audio)});
  if(chars>260)tooLong.push({id:q.id,chars,audio:short(audio)});

  const lines=audio.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const speakerLines=lines.filter(x=>/^(남자|여자|남|여)\s*:/.test(x));
  if(lines.length===1)sourceCounts.single++;
  else if(speakerLines.length>=2){
    sourceCounts.dialogue++;
    if(speakerLines.length>=3)sourceCounts.multiTurn++;
  }
  if(lines.length>1 && speakerLines.length!==lines.length){
    speakerIssues.push({id:q.id,reason:"mixed or missing speaker labels",audio:short(audio)});
  }
  if(lines.length>=2 && speakerLines.length<2){
    speakerIssues.push({id:q.id,reason:"multi-line audio without two labelled turns",audio:short(audio)});
  }

  if(!jp)jpIssues.push({id:q.id,reason:"missing Japanese"});
  if(/[가-힣]/.test(jp) && !/[ぁ-んァ-ヶ一-龯]/.test(jp))jpIssues.push({id:q.id,reason:"Japanese field looks Korean",jp:short(jp)});
  if(audio && jp && raw(audio)===raw(jp))jpIssues.push({id:q.id,reason:"Japanese appears identical to Korean",jp:short(jp)});

  if(!Array.isArray(q.c)||q.c.length!==4)choiceIssues.push({id:q.id,reason:"choice count",count:q.c?.length});
  if(!Number.isInteger(q.a)||q.a<0||q.a>=4)choiceIssues.push({id:q.id,reason:"answer index",a:q.a});
  if(Array.isArray(q.c)){
    const ns=q.c.map(raw);
    if(new Set(ns).size!==ns.length)choiceIssues.push({id:q.id,reason:"duplicate choices",choices:q.c});
    const ans=String(q.c[q.a]||"");
    const arr=answerTextSeen.get(raw(ans))||[];
    arr.push(q.id); answerTextSeen.set(raw(ans),arr);
  }

  typeCounts[classify(q.q)]++;
}

for(const [text,ids] of answerTextSeen){
  if(text&&ids.length>=8) repeatedAnswerTexts.push({answerText:text,uses:ids.length,ids:ids.slice(0,20)});
}

// Near-duplicate audio: only strong similarities and non-exact.
for(let i=0;i<listening.length;i++){
  for(let j=i+1;j<listening.length;j++){
    const a=listening[i],b=listening[j];
    if(raw(a.audio)===raw(b.audio))continue;
    const score=sim(a.audio,b.audio);
    if(score>=0.88){
      nearAudio.push({score:+score.toFixed(2),a:a.id,b:b.id,audio1:short(a.audio),audio2:short(b.audio)});
    }
  }
}
nearAudio.sort((a,b)=>b.score-a.score);
repeatedAnswerTexts.sort((a,b)=>b.uses-a.uses);

const summary={
  total:listening.length,
  typeCounts,
  sourceCounts,
  exactDuplicateAudio:duplicateAudio.length,
  nearDuplicateAudio:nearAudio.length,
  tooShortAudio:tooShort.length,
  tooLongAudio:tooLong.length,
  speakerLabelIssues:speakerIssues.length,
  japaneseIssues:jpIssues.length,
  choiceIssues:choiceIssues.length,
  heavilyRepeatedAnswerTexts:repeatedAnswerTexts.length
};
console.log("TOPIK LISTENING QUALITY AUDIT");
console.log(JSON.stringify(summary,null,2));
function section(name,items,limit=120){
  if(!items.length)return;
  console.log("\n## "+name+" ("+items.length+")");
  for(const x of items.slice(0,limit))console.log(JSON.stringify(x));
  if(items.length>limit)console.log("... "+(items.length-limit)+" more");
}
section("Exact duplicate audio",duplicateAudio);
section("Near duplicate audio",nearAudio,180);
section("Very short audio",tooShort);
section("Very long audio",tooLong);
section("Speaker label issues",speakerIssues);
section("Japanese issues",jpIssues);
section("Choice issues",choiceIssues);
section("Heavily repeated answer texts",repeatedAnswerTexts,80);
