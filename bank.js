/* 통장 내역 (관리자, 업데이트 15 · 팝빌은 업데이트 12) — 결산 › 통장 내역
   회사 통장 입출금이 bank_tx 표에 들어옴: 사장님 갤럭시의 은행 알림(알림 서버 notify bank_in) + 한 달에 한 번 올리는 은행 엑셀(여기서 읽음).
   팝빌 계좌조회(서버 bank)도 남아 있지만 API 요금(계좌당 월 10만원)이 커서 안 씀. 팝빌로 가져온 적이 있을 때만 팝빌 칸을 보여 줌.
   여기서는 한 줄씩 어디에 넣을지 정함:
   나간 돈 → 회사 지출 · 거래처 지급(매입 지급 체크) · 시공자 정산 지급 · 현장 매입 새로 넣기 · 건너뛰기
   들어온 돈 → 고객 입금(수금 입금 확인) · 건너뛰기
   이름과 금액이 맞으면 제안을 띄우고, 회사 지출·건너뛰기로 정한 이름은 기억해서(bank_kv rules) 다음부터 같은 곳을 제안함.
   처리한 줄은 되돌리기로 원래대로(넣은 지출 지우기, 체크 풀기). app.js보다 먼저 읽고, 단추는 app.js가 bankInit()으로 연결 */
let bankTx=[],bank12=true,bank15=true,bankChan=null,bankRules=[],bankState=null,bankSt=null,bankStAt=0,bankStBusy=false,
  bankAccts=[],bankXl={},bankPing={},bankX=null,bankXBusy=false,bankAOpen=false,bankADel="",bankKeyOpen=false,bankKeyErr="",bankConnOpen=null,
  bankF="new",bankM="",bankA="",bankJoinCorp=null,bankOpen="",bankKind="",bankMsg="",bankMsgOk=false,bankBusy=false,bankLater=false,bankRT=null;
const BANK_URLS={acct:"계좌 등록·관리",rate:"정액제 신청·연장",point:"포인트 충전",login:"팝빌 열기"};
const normTx=r=>({id:String(r.id),acct:r.acct||"",corp:r.corp||"",day:String(r.day||"").slice(0,10),at:r.at||"",dir:r.dir==="in"?"in":"out",amount:+r.amount||0,
  balance:r.balance==null?null:+r.balance,r1:r.r1||"",r2:r.r2||"",r3:r.r3||"",r4:r.r4||"",memo:r.memo||"",
  status:["done","skip"].includes(r.status)?r.status:"new",link:r.link&&typeof r.link==="object"?r.link:null,note:r.note||"",done_by:r.done_by||"",src:r.src||"",raw:r.raw||""});
const normRules=d=>(d&&Array.isArray(d.list)?d.list:[]).filter(r=>r&&typeof r.k==="string"&&r.k.length>=2&&(r.t==="skip"||(r.t==="exp"&&EXP_CATS.includes(r.cat))))
  .map(r=>({k:r.k,t:r.t,...(r.t==="exp"?{cat:r.cat}:{}),name:String(r.name||r.k).slice(0,40)}));
async function loadBank(){if(!isAdmin){bankTx=[];return;}
  const all=[];let error=null;
  for(let p=0;p<20;p++){const r=await sb.from("bank_tx").select("*").order("day",{ascending:false}).order("at",{ascending:false}).range(p*1000,p*1000+999);
    if(r.error){error=r.error;break;}all.push(...(r.data||[]));if((r.data||[]).length<1000)break;}
  bank12=!(error&&/bank_tx|42P01|PGRST20/i.test(`${error.code} ${error.message}`));
  if(!error)bankTx=all.map(normTx);
  /* 업데이트 15(알림·엑셀)를 했는지: bank_tx 에 src 칸이 있는지 */
  if(bank12&&!error){if(all.length)bank15="src" in all[0];else{const r=await sb.from("bank_tx").select("src").limit(1);bank15=!r.error;}}
  if(bank12){const kv=await sb.from("bank_kv").select("*");
    if(!kv.error){const g=k=>(kv.data||[]).find(r=>r.key===k);bankRules=normRules(g("rules")&&g("rules").data);bankState=(g("state")&&g("state").data)||null;
      const ac=g("accts")&&g("accts").data;bankAccts=normAccts(ac);bankXl=ac&&ac.xl&&typeof ac.xl==="object"?ac.xl:{};bankPing=(g("ping")&&g("ping").data)||{};}}
  if(bank12&&!error&&!bankChan)bankChan=sb.channel("nest-bank").on("postgres_changes",{event:"*",schema:"public",table:"bank_tx"},bankReload)
    .on("postgres_changes",{event:"*",schema:"public",table:"bank_kv"},bankReload).subscribe();}
function bankReload(){clearTimeout(bankRT);bankRT=setTimeout(()=>loadBank().then(()=>{if(isAdmin){renderBank();renderHome();}}),400);}
function bankReset(){bankTx=[];bank12=true;bank15=true;bankRules=[];bankState=null;bankSt=null;bankStAt=0;bankOpen="";bankMsg="";bankAccts=[];bankXl={};bankPing={};bankX=null;bankAOpen=false;bankADel="";bankKeyOpen=false;bankKeyErr="";bankConnOpen=null;if(bankChan){sb.removeChannel(bankChan);bankChan=null;}}

/* ---------- 서버(bank) 부르기 ---------- */
async function bankCall(body){
  try{const {data,error}=await sb.functions.invoke("bank",{body});if(!error)return{data:data||{}};
    let d={};try{d=await error.context.json();}catch(e){}
    const st=error.context&&error.context.status;
    return{error:d.error||(st&&st!==404?"server":"nofn"),status:st,code:d.code,message:d.message||""};}
  catch(e){return{error:"offline"};}}
function bankErrText(r){if(!r||!r.error)return"";
  if(r.error==="nofn")return"통장 서버(bank)에 연결이 안 돼요. README 업데이트 12의 1단계(통장 서버 만들기)를 했는지 확인해 주세요.";
  if(r.error==="offline")return"인터넷 연결을 확인하고 다시 눌러 주세요.";
  if(r.error==="admin only")return"관리자 계정만 쓸 수 있어요.";
  if(r.error==="not configured")return"팝빌 열쇠(Secrets)가 아직 안 들어갔어요. README 업데이트 12의 2단계를 확인해 주세요.";
  if(r.error==="popbill")return`팝빌: ${r.message||"오류"}${r.code?` (${r.code})`:""}`;
  return`서버 오류: ${r.message||r.error}`;}
async function bankStatus(force){if(!isAdmin||!bank12||bankStBusy||!bankPop())return;
  if(!force&&bankSt&&Date.now()-bankStAt<60e3)return;
  bankStBusy=true;const r=await bankCall({action:"status"});bankStBusy=false;bankStAt=Date.now();
  bankSt=r.error?{fail:r}:r.data;renderBank();}
async function bankCollect(btn){if(bankBusy)return;bankBusy=true;btn.disabled=true;btn.textContent="가져오는 중…";
  const r=await bankCall({action:"collect"});bankBusy=false;
  if(r.error){bankMsg=bankErrText(r);bankMsgOk=false;}
  else if(r.data.skipped){bankMsg="방금 가져왔어요. 잠시 뒤에 다시 눌러 주세요.";bankMsgOk=false;}
  else{const e=r.data.errors||[];bankMsg=r.data.error?`팝빌: ${r.data.error.message}`:`새 거래 ${r.data.added||0}건을 가져왔어요.`+(e.length?` ${e.map(x=>`${x.acct}: ${x.message}`).join(" / ")}`:"");bankMsgOk=!r.data.error&&!e.length;}
  await loadBank();bankStatus(true);renderBank();renderHome();}
/* 팝빌 화면(계좌 등록·정액제·포인트 충전)은 주소가 30초만 살아 있어서 누르는 순간 새 창을 먼저 열고 주소를 받아 넣음 */
async function bankPopup(to,btn){let w=null;try{w=window.open("","_blank");if(w)w.opener=null;}catch(e){}
  btn.disabled=true;const r=await bankCall({action:"url",to,corp:btn.dataset.bkcorp||""});btn.disabled=false;
  const url=r.data&&r.data.url;
  if(url&&/^https:\/\//.test(url)){if(w&&!w.closed){w.location.href=url;bankMsg=`팝빌 ${BANK_URLS[to]} 화면을 새 창으로 열었어요. 마치고 돌아오면 여기 상태가 바뀌어요.`;bankMsgOk=true;}
    else{bankMsg=`<a href="${esc(url)}" target="_blank" rel="noopener">팝빌 ${BANK_URLS[to]} 열기</a> (30초 안에 눌러 주세요)`;bankMsgOk=true;}}
  else{if(w)w.close();bankMsg=r.error?bankErrText(r):"팝빌 화면 주소를 받지 못했어요.";bankMsgOk=false;}
  renderBank();}

/* ---------- 이름 맞추기 ---------- */
const bnNorm=s=>String(s||"").replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|[\s()·.,\-_/'"]/g,"").toLowerCase();
const txWho=t=>t.r1||t.r2||t.r3||t.r4||"";
const txAll=t=>bnNorm([t.r1,t.r2,t.r3,t.r4,t.memo].join(" "));
/* 통장 글자 안에 이름이 있거나, 은행이 적은 이름이 그 이름의 일부(은행이 잘라 적는 경우)이면 맞음 */
function nameHit(t,name){const n=bnNorm(name),w=bnNorm(txWho(t));if(n.length<2)return false;
  return txAll(t).includes(n)||(w.length>=2&&n.includes(w));}
const custName=j=>String(j.name||"").replace(/\s*고객\s*$/,"").trim();
const ruleKey=t=>bnNorm(txWho(t)).slice(0,40);
const ruleOf=t=>{const k=ruleKey(t);return k.length>=2?bankRules.find(r=>r.k===k)||null:null;};
const BANK_CAT=[["차량·유류",/주유|오일|에너지|칼텍스|s-?oil|충전소|하이패스|도로공사|주차|카센터|타이어|정비/i],
  ["통신·사무",/^kt|kt$|skt|sk텔레콤|lgu|유플러스|통신|인터넷요금|휴대폰|모바일/i],
  ["세금·공과금",/국세|지방세|부가세|세무서|구청|시청|한전|한국전력|전기요금|수도|가스|관리비|과태료|자동차세/],
  ["급여·4대보험",/국민연금|건강보험|고용보험|산재|근로복지|4대보험|급여|월급|상여/],
  ["임대료",/월세|임대|임차/],["광고·홍보",/네이버|광고|오늘의집|숨고|인스타|페이스북|구글|당근|블로그/i],
  /* 자재·외주 매입 (app.js BUY_EXP): 현장마다 안 나누고 회사 지출로 적는 매입. 결산에서는 매입으로 셈 */
  ["자재·외주 매입",/목재|합판|보드|자재|도장|하드웨어|블룸|blum|헤펠레|hafele|유리|상판|필름|몰딩|엣지|건재|가구|인테리어|용달|화물/i],
  ["소모품",/다이소|쿠팡|철물|오피스|문구/],["공구·장비",/공구|장비|렌탈|리스/],
  ["식대·복리후생",/식당|식사|편의점|커피|카페|스타벅스|배달|요기요|김밥|마트/],["수수료·기타",/수수료|보험/]];
const guessCat=t=>{const s=[t.r1,t.r2,t.r3,t.r4,t.memo].join(" ");const c=BANK_CAT.find(([,re])=>re.test(s));return c?c[0]:"";};

/* 한 번 그릴 때 한 번만 모으는 후보: 안 받은 입금, 안 준 거래처 매입, 지급 전 시공자 정산(이번 달 포함 3달) */
function bankCtx(){
  const pays=[];jobs.forEach(j=>{const m=moneyOf(j.id),open=m.pays.map((p,i)=>({p,i})).filter(o=>!o.p.paid&&o.p.amount>0);
    open.forEach(o=>pays.push({j,idx:[o.i],sum:o.p.amount,label:o.p.label,due:o.p.due}));
    if(open.length>1)pays.push({j,idx:open.map(o=>o.i),sum:open.reduce((a,o)=>a+o.p.amount,0),label:`안 받은 ${open.length}건 모두`,due:""});});
  const vend={};costList().filter(o=>isVend(o.x)&&!o.x.paid&&o.x.amount>0).forEach(o=>(vend[o.x.v]??=[]).push(o));
  const wages=[];if(pay08){for(let k=0;k<3;k++){const d=addDays(TODAY.slice(0,8)+"01",-1*k*28),y=+d.slice(0,4),m=+d.slice(5,7);
    if(wages.some(w=>w.y===y&&w.m===m))continue;const W=wageMonth(y,m);
    W.people.filter(p=>!p.paid&&p.total>0).forEach(p=>wages.push({y,m,n:p.n,total:p.total}));}}
  /* 이미 손으로 적어 둔 것 (처음 가져올 때 겹침): 입금 확인한 입금, 지급 체크한 매입, 통장에서 넣지 않은 회사 지출, 지급 완료한 시공자 정산 */
  const paid=[];jobs.forEach(j=>moneyOf(j.id).pays.forEach(p=>{if(p.paid&&p.amount>0)paid.push({j,amount:p.amount,day:p.paidOn,label:p.label});}));
  const gave=costList().filter(o=>o.x.paid&&o.x.amount>0).map(o=>({amount:o.x.amount,day:o.x.paidOn||"",l:`${o.x.v||o.x.cat} · ${o.j.name}`}));
  expenses.filter(x=>!x.bank_id&&!x.repeat&&x.amount>0).forEach(x=>gave.push({amount:x.amount,day:x.day,l:`회사 지출 ${x.cat}`}));
  Object.entries(wage.months||{}).forEach(([ym,r])=>Object.entries(r.p||{}).forEach(([n,o])=>{if(o.paid&&o.snap&&+o.snap.total>0)gave.push({amount:+o.snap.total,day:o.paid,l:`시공자 정산 ${n} ${+ym.slice(5)}월`});}));
  return{pays,vend,wages,paid,gave};}
const near=(a,b,n=3)=>!!a&&!!b&&Math.abs((new Date(a+"T12:00:00")-new Date(b+"T12:00:00"))/864e5)<=n;
/* 제안: {t, conf:'high'(이름·금액 맞음 또는 기억한 이름)|'mid'(확인 필요), …} */
function bankSuggest(t,C){const r=ruleOf(t);
  if(t.dir==="in"){
    const ex=C.pays.filter(o=>o.sum===t.amount),named=ex.filter(o=>nameHit(t,custName(o.j)));
    if(named.length===1)return{t:"pay",conf:"high",o:named[0],why:"이름·금액 맞음"};
    if(r&&r.t==="skip")return{t:"skip",conf:"high",why:"기억한 이름"};
    if(named.length>1)return{t:"pay",conf:"mid",o:named[0],why:"이름·금액 맞는 입금이 여러 개"};
    if(ex.length===1)return{t:"pay",conf:"mid",o:ex[0],why:"금액만 맞음"};
    const dup=C.paid.find(o=>o.amount===t.amount&&(near(o.day,t.day)||nameHit(t,custName(o.j))));
    if(dup)return{t:"skip",conf:"mid",why:"이미 입금 확인함",note:`이미 입금 확인함 · ${custName(dup.j)} ${dup.label}`};
    if(/이자|결산이자/.test(t.r1+t.r2))return{t:"skip",conf:"mid",why:"이자",note:"이자"};
    return null;}
  for(const [v,rows] of Object.entries(C.vend)){if(!nameHit(t,v))continue;
    const one=rows.filter(o=>o.x.amount===t.amount);
    if(one.length===1)return{t:"cost",conf:"high",rows:one,v,why:"거래처·금액 맞음"};
    if(rows.length>1&&rows.reduce((a,o)=>a+o.x.amount,0)===t.amount)return{t:"cost",conf:"high",rows,v,why:`거래처 미지급 ${rows.length}건 합계와 맞음`};}
  const wx=C.wages.filter(w=>w.total===t.amount&&nameHit(t,w.n));
  if(wx.length===1)return{t:"wage",conf:"high",w:wx[0],why:"이름·금액 맞음"};
  if(r)return r.t==="skip"?{t:"skip",conf:"high",why:"기억한 이름"}:{t:"exp",conf:"high",cat:r.cat,why:"기억한 이름"};
  const vn=Object.entries(C.vend).find(([v])=>nameHit(t,v));
  if(vn)return{t:"cost",conf:"mid",rows:[],v:vn[0],why:"거래처 이름만 맞음 (금액 다름)"};
  const wn=C.wages.find(w=>nameHit(t,w.n));if(wn)return{t:"wage",conf:"mid",w:wn,why:"이름만 맞음 (금액 다름)"};
  const vx=Object.values(C.vend).flat().filter(o=>o.x.amount===t.amount);if(vx.length===1)return{t:"cost",conf:"mid",rows:vx,v:vx[0].x.v,why:"금액만 맞음"};
  const dup=C.gave.find(o=>o.amount===t.amount&&near(o.day,t.day));
  if(dup)return{t:"skip",conf:"mid",why:"이미 적은 것과 같음",note:`이미 적음 · ${dup.l}`};
  const c=guessCat(t);if(c)return{t:"exp",conf:"mid",cat:c,why:"이름으로 짐작"};
  return null;}
/* 바로 처리해도 되는 제안: 이름·금액이 맞거나 전에 정한 이름 (거래처는 줄까지 정해졌을 때만) */
const sugReady=s=>!!s&&s.conf==="high"&&(s.t!=="cost"||s.rows.length>0);
const payLbl=o=>`${custName(o.j)} · ${o.label} ${won(o.sum)}`;
function sugText(s){if(!s)return"";
  if(s.t==="pay")return`<b>고객 입금</b> ${esc(payLbl(s.o))}`;
  if(s.t==="cost")return s.rows.length?`<b>거래처 지급</b> ${esc(s.v)} · ${s.rows.length>1?`${s.rows.length}건 `:""}${s.rows.map(o=>esc(o.j.name)).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}`:`<b>거래처 지급</b> ${esc(s.v)} (줄 고르기)`;
  if(s.t==="wage")return`<b>시공자 정산 지급</b> ${esc(s.w.n)} ${s.w.m}월 ${won(s.w.total)}`;
  if(s.t==="exp")return`<b>회사 지출</b> ${esc(s.cat)}`;
  return`<b>건너뛰기</b>${s.note?` ${esc(s.note)}`:""}`;}

/* ---------- 처리 · 되돌리기 ---------- */
const bnId=()=>crypto.randomUUID?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
const qcDo=fn=>new Promise(res=>{qcQ=qcQ.then(async()=>res(await fn())).catch(()=>res(false));});
async function bankClaim(t,status,link,note){const at=new Date().toISOString();
  const {data,error}=await sb.from("bank_tx").update({status,link,note:String(note||"").slice(0,300),done_at:at,done_by:String(userName||userEmail||"").slice(0,40),updated_at:at})
    .eq("id",t.id).eq("status","new").select();
  if(error)return"저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";
  if(!data||!data.length)return"다른 기기에서 먼저 처리했어요. 화면을 새로 고쳤어요.";
  Object.assign(t,normTx(data[0]));return"";}
async function bankRelease(t){const {data,error}=await sb.from("bank_tx").update({status:"new",link:null,note:"",done_at:null,done_by:"",updated_at:new Date().toISOString()}).eq("id",t.id).select();
  if(error)return false;if(data&&data[0])Object.assign(t,normTx(data[0]));return true;}
async function bankRemember(t,r){const k=ruleKey(t);if(k.length<2)return;
  bankRules=[{k,t:r.t,...(r.t==="exp"?{cat:r.cat}:{}),name:txWho(t).slice(0,40)},...bankRules.filter(x=>x.k!==k)].slice(0,300);
  await sb.from("bank_kv").upsert({key:"rules",data:{list:bankRules},updated_at:new Date().toISOString()});}
async function bankForget(k){bankRules=bankRules.filter(x=>x.k!==k);renderBank();
  await sb.from("bank_kv").upsert({key:"rules",data:{list:bankRules},updated_at:new Date().toISOString()});}
/* 실제로 넣기. a = {t, …}. 성공하면 "" */
async function bankApply(t,a){
  const fail=async(m)=>{await bankRelease(t);return m;};
  if(a.t==="skip"){const e=await bankClaim(t,"skip",{t:"skip",l:`건너뜀${a.why?` · ${a.why}`:""}`},a.why);if(e)return e;if(a.rem)await bankRemember(t,{t:"skip"});return"";}
  if(a.t==="exp"){const id=bnId(),note=a.note||txWho(t);
    const e=await bankClaim(t,"done",{t:"exp",id,l:`회사 지출 · ${a.cat}`},note);if(e)return e;
    const row={id,day:t.day,cat:a.cat,amount:t.amount,note,repeat:false,until:"",bank_id:t.id};
    const {error}=await sb.from("expenses").insert(row);
    if(error)return fail("회사 지출에 넣지 못했어요. 다시 눌러 주세요.");
    expenses=expenses.filter(x=>x.id!==id);expenses.push(normExp(row));if(a.rem)await bankRemember(t,{t:"exp",cat:a.cat});return"";}
  if(a.t==="pay"){const j=jobs.find(x=>x.id===a.jid);if(!j)return"현장을 찾지 못했어요.";const m0=moneyOf(j.id);
    const amt=a.idx.map(i=>m0.pays[i]?m0.pays[i].amount:0),lbl=a.idx.map(i=>m0.pays[i]?m0.pays[i].label:"").join("·");
    const e=await bankClaim(t,"done",{t:"pay",jid:j.id,idx:a.idx,amt,day:t.day,l:`고객 입금 · ${j.name} ${lbl}`});if(e)return e;
    const ok=await qcDo(async()=>{const m=moneyOf(j.id);if(a.idx.some((i,k)=>!m.pays[i]||m.pays[i].paid||m.pays[i].amount!==amt[k]))return false;
      return qcWrite(j,{col:"money",val:{...m,pays:m.pays.map((p,i)=>a.idx.includes(i)?{...p,paid:true,paidOn:t.day}:p)}});});
    return ok?"":fail("입금 확인을 저장하지 못했어요. 그새 수금 내용이 바뀌었을 수 있어요.");}
  if(a.t==="cost"){const rows=a.rows.map(o=>({jid:o.j.id,i:o.i,sig:costSig(o.x)})),v=a.rows[0]?a.rows[0].x.v:"";
    const e=await bankClaim(t,"done",{t:"cost",rows,day:t.day,l:`거래처 지급 · ${v}${rows.length>1?` ${rows.length}건`:""}`});if(e)return e;
    const ok=await costSet(rows,()=>({paid:true,paidOn:t.day}));
    if(!ok){await costSet(rows,x=>x.paidOn===t.day?{paid:false,paidOn:""}:{});return fail("거래처 지급을 저장하지 못했어요. 그새 매입 내용이 바뀌었을 수 있어요.");}return"";}
  if(a.t==="newcost"){const j=jobs.find(x=>x.id===a.jid);if(!j)return"현장을 고르세요.";
    const row=normCost({cat:a.cat,amount:t.amount,note:a.note||"",v:a.v||"",d:t.day,paid:true,paidOn:t.day}),sig=costSig(row);
    const e=await bankClaim(t,"done",{t:"newcost",jid:j.id,sig,day:t.day,l:`현장 매입 · ${j.name} ${a.cat}`});if(e)return e;
    const ok=await qcDo(async()=>{const m=moneyOf(j.id);return qcWrite(j,{col:"money",val:{...m,costs:[...m.costs,row]}});});
    return ok?"":fail("현장 매입을 저장하지 못했어요. 다시 눌러 주세요.");}
  if(a.t==="wage"){const W=wageMonth(a.y,a.m),p=W.people.find(x=>x.n===a.n);if(!p||p.paid||p.total===null)return"그 시공자 정산을 찾지 못했어요.";
    const e=await bankClaim(t,"done",{t:"wage",ym:ymKey(a.y,a.m),n:a.n,day:t.day,l:`시공자 정산 · ${a.n} ${a.m}월`});if(e)return e;
    const ok=await wagePaySet(a.y,a.m,a.n,true,t.day);return ok?"":fail("시공자 정산 지급을 저장하지 못했어요.");}
  return"처리할 곳을 고르세요.";}
async function bankUndo(t){const L=t.link||{};let warn="";
  if(L.t==="exp"&&L.id){const {error}=await sb.from("expenses").delete().eq("id",L.id);if(error)return"회사 지출을 지우지 못했어요. 다시 눌러 주세요.";expenses=expenses.filter(x=>x.id!==L.id);}
  if(L.t==="pay"){const j=jobs.find(x=>x.id===L.jid);
    if(j){const ok=await qcDo(async()=>{const m=moneyOf(j.id),idx=(L.idx||[]).filter(i=>m.pays[i]&&m.pays[i].paid&&m.pays[i].paidOn===L.day);if(!idx.length)return true;
      return qcWrite(j,{col:"money",val:{...m,pays:m.pays.map((p,i)=>idx.includes(i)?{...p,paid:false,paidOn:""}:p)}});});if(!ok)return"입금 확인을 풀지 못했어요. 다시 눌러 주세요.";}}
  if(L.t==="cost"&&Array.isArray(L.rows)){const ok=await costSet(L.rows,x=>x.paid&&x.paidOn===L.day?{paid:false,paidOn:""}:{});if(!ok)warn="그새 바뀐 매입은 지급 체크를 그대로 뒀어요.";}
  if(L.t==="newcost"){const j=jobs.find(x=>x.id===L.jid);
    if(j){const ok=await qcDo(async()=>{const m=moneyOf(j.id),i=m.costs.map((x,k)=>costSig(x)===L.sig&&x.paidOn===L.day?k:-1).filter(k=>k>=0).pop();if(i===undefined)return true;
      return qcWrite(j,{col:"money",val:{...m,costs:m.costs.filter((x,k)=>k!==i)}});});if(!ok)return"현장 매입을 지우지 못했어요. 다시 눌러 주세요.";}}
  if(L.t==="wage"&&L.ym){const y=+L.ym.slice(0,4),m=+L.ym.slice(5,7),o=wmOf(L.ym).p[L.n];if(o&&o.paid===L.day)await wagePaySet(y,m,L.n,false);}
  if(!(await bankRelease(t)))return"되돌리지 못했어요. 다시 눌러 주세요.";
  return warn;}
/* 회사 지출에서 통장으로 넣은 지출을 지우면 그 거래는 다시 '확인할 것'으로 */
async function bankUnlinkExp(bankId,expId){const t=bankTx.find(x=>x.id===bankId);
  if(t&&!(t.link&&t.link.t==="exp"&&t.link.id===expId))return;
  await sb.from("bank_tx").update({status:"new",link:null,note:"",done_at:null,done_by:"",updated_at:new Date().toISOString()}).eq("id",bankId).eq("status","done");
  if(t){t.status="new";t.link=null;t.note="";}}

/* ---------- 화면 ---------- */
const acctLbl=k=>{const f=acctOf(k);if(f)return`${f.bank} ${f.no.slice(-4)}`;if(String(k).startsWith("?"))return`${String(k).slice(1)||"은행"} (통장 모름)`;
  const a=(bankState&&bankState.accts||{})[k]||bkCorps(bankSt).flatMap(c=>c.accounts||[]).find(x=>x.key===k);return a?`${String(a.bank||"").replace(/은행$/,"")} ${a.tail}`:String(k).slice(-4);};
/* 사업자 (리브젠·네스트처럼 여럿일 때): 서버가 알려 준 이름 → 없으면 마지막으로 가져온 상태의 이름 */
const fmtCorp=n=>/^\d{10}$/.test(n)?`${n.slice(0,3)}-${n.slice(3,5)}-${n.slice(5)}`:String(n||"");
const bkCorps=S=>S&&Array.isArray(S.corps)&&S.corps.length?S.corps:S&&S.configured?[{num:"",corp:S.corp||"",name:"",member:S.member,accounts:S.accounts,point:S.point,errors:S.errors||[]}]:[];
function bizMap(){const m={};Object.entries((bankState&&bankState.corps)||{}).forEach(([k,v])=>{m[k]=(v&&v.name)||fmtCorp(k);});
  bankAccts.forEach(a=>{if(a.corp)m[a.corp]=a.corp;});
  bkCorps(bankSt).forEach(c=>{if(c.num)m[c.num]=c.name||fmtCorp(c.num);});return m;}
const txCorp=t=>t.corp||(acctOf(t.acct)||{}).corp||((bankState&&bankState.accts||{})[t.acct]||{}).corp||"";
const bankMulti=()=>Object.keys(bizMap()).length>1||new Set(bankTx.map(txCorp).filter(Boolean)).size>1;
/* 계좌 고르기: "c:사업자번호"면 그 사업자 계좌 전부 */
const bkIn=t=>!bankA||(bankA.startsWith("c:")?txCorp(t)===bankA.slice(2):t.acct===bankA);
const bkBusy=()=>{const a=document.activeElement;return!!(a&&a.closest&&a.closest(".bk-pick,.bk-conn")&&a.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]):not([readonly]),select,textarea"));};
const kstTime=iso=>{const d=new Date(iso);return isNaN(d)?"":`${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;};
/* 사업자 하나의 연결 상태: 가입 → 계좌 등록 → 계좌 목록 */
function corpConn(S,c,multi,st){
  const btn=(to,extra="")=>`<button class="btn ghost sm" type="button" data-bkurl="${to}" data-bkcorp="${esc(c.num)}">${BANK_URLS[to]}${extra}</button>`;
  const errs=(c.errors||[]).map(e=>`<p class="err">팝빌: ${esc(e.message)}${e.code?` (${esc(e.code)})`:""}</p>`).join("");
  if(c.member===false)return{setup:true,title:"팝빌 회원 가입이 필요해요",body:`<p>사업자번호 ${esc(c.corp)}는 아직 팝빌 회원이 아니에요. 아래에서 가입하면 바로 계좌를 등록할 수 있어요.</p>${errs}`,
    btns:`<button class="btn sm" type="button" data-bkjoin="${esc(c.num)}">${multi?`${esc(c.name)} `:""}팝빌 회원 가입</button>`};
  if(c.member==null)return{setup:true,title:"팝빌에 연결하지 못했어요",body:errs||"<p>잠시 뒤 다시 확인해 주세요.</p>",btns:""};
  const pt=[c.point,S.partnerPoint].filter(v=>v!=null),pts=pt.length?` (${pt.map(v=>`${comma(v)||0}P`).join(" · ")})`:"";
  const acc=c.accounts||[];
  if(!acc.length)return{setup:true,title:"등록한 계좌가 없어요",body:`<p>계좌 등록·관리에서 통장을 등록해 주세요. 이용료는 계좌를 등록할 때 포인트에서 나가니 포인트를 먼저 충전해 두세요. 신한·아이엠뱅크·신협은 은행에서 빠른조회 아이디를, 국민은행은 인터넷뱅킹 아이디를 함께 넣어요.</p>${errs}`,
    btns:btn("acct")+btn("point",pts)};
  const rows=acc.map(a=>{const tags=[a.state!==1?`<span class="tag late">정지</span>`:"",a.contract===2?`<span class="tag late">해지</span>`:"",a.unpaid?`<span class="tag late">미납</span>`:"",a.restrict?`<span class="tag late">사용 제한</span>`:"",a.closing?`<span class="tag soon">해지 예정</span>`:"",
      a.end&&a.end<addDays(TODAY,7)&&a.contract!==2?`<span class="tag soon">기한 곧 끝남</span>`:""].join("");
    const s=(st.accts||{})[a.key]||{};
    return`<li><span><b>${esc(a.bank)} ···${esc(a.tail)}</b>${a.name?` <span class="hint">${esc(a.name)}</span>`:""}</span><span class="hint">${a.end?`${fmt(a.end)}까지`:""}</span>${tags}${s.err?`<span class="err">${esc(s.err.message)}</span>`:""}</li>`;}).join("");
  return{setup:false,bad:acc.some(a=>a.state!==1||a.contract===2||a.unpaid||a.restrict)||!!(c.errors||[]).length,
    sum:acc.map(a=>`${esc(a.bank.replace(/은행$/,""))} ${esc(a.tail)}`).join(" · "),body:`<ul class="bk-accts">${rows}</ul>${errs}`,btns:btn("acct")+btn("rate")+btn("point",pts)+btn("login")};}
function bankConnHtml(){const S=bankSt,st=bankState||{};
  if(!S)return`<div class="bk-conn"><p class="hint">팝빌 연결을 확인하는 중이에요…</p></div>`;
  if(S.fail){const t=bankErrText(S.fail);return`<div class="bk-conn bad"><b>통장 연결 안 됨</b><p>${t}</p><p class="hint">처음이면 <a href="https://github.com/nestfurniture/nest-schedule#업데이트-12-통장-거래내역-자동-연결-적용" target="_blank" rel="noopener">README 업데이트 12</a> 순서대로 해 주세요.</p><div class="bk-btns"><button class="btn ghost sm" type="button" data-bkre>다시 확인</button></div></div>`;}
  const test=S.test?` <span class="tag soon">팝빌 시험 환경</span>`:"",re=`<button class="btn ghost sm" type="button" data-bkre>다시 확인</button>`;
  const cfgBad=(S.bad||[]).length?`<p class="err">Secrets의 POPBILL_CORP_NUM에서 알아보지 못한 칸이 있어요: ${S.bad.map(esc).join(", ")} (사업자번호 10자리로 적어 주세요)</p>`:"";
  if(!S.configured)return`<div class="bk-conn bad"><p><b>팝빌 열쇠가 아직 없어요</b>${test}</p><p>Supabase → Edge Functions → Secrets에 <code>POPBILL_LINK_ID</code> · <code>POPBILL_SECRET_KEY</code> · <code>POPBILL_CORP_NUM</code>을 넣어 주세요. 사업자번호는 <code>네스트:000-00-00000, 리브젠:000-00-00000</code>처럼 사업자마다 이름과 함께 적어요. 팝빌 연동 신청을 하면 메일로 링크아이디와 비밀키가 와요.</p>${cfgBad}<div class="bk-btns">${re}</div></div>`;
  const C=bkCorps(S),multi=C.length>1,P=C.map(c=>corpConn(S,c,multi,st)),setup=P.some(p=>p.setup);
  const lastErr=st.err&&st.err.message?`<p class="err">마지막 가져오기: ${esc(st.err.message)}</p>`:"";
  const get=`<button class="btn sm" type="button" data-bkget>지금 가져오기</button>`;
  const last=st.lastEnd?`${kstTime(st.lastEnd)}에 가져옴${st.added?` · 새 거래 ${st.added}건`:""}`:"아직 안 가져옴";
  const hint=`<p class="hint">한국 시간 아침 6시~밤 11시에 매시간 저절로 가져와요. 정액제 기한이 끝나면 팝빌에서 자동 연장되고 포인트에서 나가요.</p>`;
  if(!multi){const p=P[0];
    if(p.setup)return`<div class="bk-conn bad"><p><b>${p.title}</b>${test}</p>${p.body}${cfgBad}<div class="bk-btns">${p.btns}${re}</div></div>`;
    const bad=p.bad||!!lastErr||!!cfgBad;
    return`<details class="bk-conn${bad?" bad":""}" ${bad||bankMsg?"open":""}><summary><b>통장 연결</b>${test} <span class="hint">${p.sum} · ${last}</span><span class="bk-more">설정</span></summary>
    ${p.body}${lastErr}${cfgBad}${hint}<div class="bk-btns">${get}${p.btns}</div></details>`;}
  /* 사업자가 여럿: 사업자마다 가입·계좌·포인트를 따로 보여 줌 */
  const sec=P.map((p,i)=>`<div class="bk-corp${p.setup||p.bad?" bad":""}"><p class="bk-corp-h"><b>${esc(C[i].name)}</b> <span class="hint">${esc(C[i].corp)}</span>${p.setup?` <span class="tag late">${p.title}</span>`:""}</p>${p.body}${p.btns?`<div class="bk-btns">${p.btns}</div>`:""}</div>`).join("");
  if(setup)return`<div class="bk-conn bad"><p><b>통장 연결 준비</b>${test}</p><p class="hint">사업자마다 팝빌 가입과 계좌 등록을 따로 해요.</p>${sec}${lastErr}${cfgBad}<div class="bk-btns">${P.some(p=>!p.setup)?get:""}${re}</div></div>`;
  const bad=P.some(p=>p.bad)||!!lastErr||!!cfgBad;
  return`<details class="bk-conn${bad?" bad":""}" ${bad||bankMsg?"open":""}><summary><b>통장 연결</b>${test} <span class="hint">${P.map((p,i)=>`${esc(C[i].name)} ${p.sum}`).join(" · ")} · ${last}</span><span class="bk-more">설정</span></summary>
    ${sec}${lastErr}${cfgBad}${hint}<div class="bk-btns">${get}</div></details>`;}
function bankPickHtml(t,s,C){
  const kinds=t.dir==="in"?[["pay","고객 입금"],["skip","건너뛰기"]]:[["exp","회사 지출"],["cost","거래처 지급"],["wage","시공자 정산 지급"],["newcost","현장 매입 새로"],["skip","건너뛰기"]];
  const has=v=>kinds.some(x=>x[0]===v),k=has(bankKind)?bankKind:s&&has(s.t)?s.t:kinds[0][0];
  let body="";const who=esc(txWho(t));
  if(k==="exp"){const cat=s&&s.t==="exp"?s.cat:guessCat(t)||EXP_CATS[EXP_CATS.length-1];
    body=`<div class="bk-grid"><label>항목<select data-bkf="cat">${EXP_CATS.map(c=>`<option ${c===cat?"selected":""}>${esc(c)}</option>`).join("")}</select></label><label class="note">메모<input data-bkf="note" value="${who}"></label></div>
      ${ruleKey(t).length>=2?`<label class="check"><input type="checkbox" data-bkf="rem" checked>다음에도 '${who}'은(는) 이 항목으로</label>`:""}`;}
  else if(k==="skip")body=`<div class="bk-grid"><label class="note">이유 <small class="hint">(예: 내 계좌로 옮김, 개인 돈)</small><input data-bkf="why" value="${s&&s.t==="skip"?esc(s.note||""):""}"></label></div>
      ${ruleKey(t).length>=2?`<label class="check"><input type="checkbox" data-bkf="rem" ${s&&s.t==="skip"&&s.why==="기억한 이름"?"checked":""}>다음에도 '${who}'은(는) 건너뛰기</label>`:""}`;
  else if(k==="pay"){const list=[...C.pays].sort((a,b)=>(nameHit(t,custName(b.j))-nameHit(t,custName(a.j)))||((b.sum===t.amount)-(a.sum===t.amount))||a.j.name.localeCompare(b.j.name,"ko")).slice(0,40);
    const pre=s&&s.t==="pay"?s.o:null;
    body=list.length?`<div class="bk-opts">${list.map((o,n)=>`<label class="check"><input type="radio" name="bkp-${esc(t.id)}" data-bkf="pay" value="${esc(o.j.id)}|${o.idx.join(".")}" ${o===pre?"checked":""}><span>${esc(custName(o.j))} · ${esc(o.label)} <b>${won(o.sum)}</b>${o.due?` <span class="hint">받을 날 ${fmt(o.due)}</span>`:""}${o.sum===t.amount?` <span class="tag ok">금액 맞음</span>`:""}</span></label>`).join("")}</div>`
      :`<p class="hint">아직 안 받은 입금이 없어요. 현장의 수금에 입금을 먼저 적어 주세요.</p>`;}
  else if(k==="cost"){const all=Object.entries(C.vend).sort((a,b)=>(nameHit(t,b[0])-nameHit(t,a[0]))||a[0].localeCompare(b[0],"ko"));
    const pre=new Set(s&&s.t==="cost"?s.rows.map(o=>`${o.j.id}|${o.i}`):[]);
    body=all.length?`<div class="bk-opts">${all.map(([v,rows])=>`<div class="bk-vg"><div><b>${esc(v)}</b>${nameHit(t,v)?` <span class="tag ok">이름 맞음</span>`:""}</div>${rows.map(o=>`<label class="check"><input type="checkbox" data-bkf="cost" value="${esc(o.j.id)}|${o.i}" data-amt="${o.x.amount}" ${pre.has(`${o.j.id}|${o.i}`)?"checked":""}><span>${esc(o.j.name)} · ${esc(o.x.cat)}${o.x.note?` ${esc(o.x.note)}`:""} <b>${won(o.x.amount)}</b></span></label>`).join("")}</div>`).join("")}</div>
      <p class="hint" data-bksum>고른 합계 ${won([...pre].length?s.rows.reduce((a,o)=>a+o.x.amount,0):0)} / 통장 ${won(t.amount)}</p>`
      :`<p class="hint">거래처를 적은 미지급 현장 매입이 없어요. 자재·외주비라면 <b>회사 지출</b>에서 '자재·외주 매입'을 고르면 결산 매입에 들어가요.</p>`;}
  else if(k==="wage"){const pre=s&&s.t==="wage"?s.w:null,list=[...C.wages].sort((a,b)=>(nameHit(t,b.n)-nameHit(t,a.n))||((b.total===t.amount)-(a.total===t.amount)));
    body=list.length?`<div class="bk-opts">${list.map(w=>`<label class="check"><input type="radio" name="bkw-${esc(t.id)}" data-bkf="wage" value="${w.y}|${w.m}|${esc(w.n)}" ${pre&&pre.n===w.n&&pre.m===w.m&&pre.y===w.y?"checked":""}><span>${esc(w.n)} · ${w.m}월 <b>${won(w.total)}</b>${w.total===t.amount?` <span class="tag ok">금액 맞음</span>`:""}</span></label>`).join("")}</div>`
      :`<p class="hint">지급 전 시공자 정산이 없어요 (이번 달 포함 3달).</p>`;}
  else if(k==="newcost"){const live=[...jobs].sort((a,b)=>(ended(a)-ended(b))||a.name.localeCompare(b.name,"ko"));
    body=`<div class="bk-grid"><label>현장<select data-bkf="jid"><option value="">고르세요</option>${live.map(j=>`<option value="${esc(j.id)}">${esc(j.name)}${ended(j)?" (종료)":""}</option>`).join("")}</select></label>
      <label>항목<select data-bkf="ccat">${COST_CATS.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label><label>거래처<input data-bkf="v" list="vendList" value="${who}"></label><label class="note">메모<input data-bkf="note"></label></div>
      <p class="hint">지급까지 끝난 매입으로 들어가요(거래처 정산에도 지급 완료로 보임).</p>`;}
  return`<div class="bk-pick" data-bkp="${esc(t.id)}"><div class="bk-kinds" role="radiogroup">${kinds.map(([v,l])=>`<button type="button" class="chip${v===k?" on":""}" data-bkk="${v}" aria-pressed="${v===k}">${l}</button>`).join("")}</div>${body}
    <div class="bk-btns"><button class="btn sm" type="button" data-bkdo="${k}">이렇게 처리</button><button class="btn ghost sm" type="button" data-bkclose>닫기</button></div></div>`;}
function renderBank(){if(!isAdmin||!$("view-bank")||$("view-bank").hidden)return;
  $("bkUpdate").hidden=bank12&&bank15;$("bkBody").hidden=!bank12;if(!bank12)return;
  if(bkBusy()){bankLater=true;return;}bankLater=false;
  $("bkConn").innerHTML=(bankPop()?bankConnHtml():bank15?bankFreeHtml()+bankXHtml():"")+(bankMsg?`<p class="${bankMsgOk?"ok-msg":"err"}">${bankMsg}</p>`:"");
  const months=[...new Set(bankTx.map(t=>t.day.slice(0,7)))].sort().reverse(),accts=[...new Set(bankTx.map(t=>t.acct))];
  const multi=bankMulti(),BZ=bizMap(),aCorp={};bankTx.forEach(t=>{if(!(t.acct in aCorp))aCorp[t.acct]=txCorp(t);});
  const aOpts=[["","모든 계좌"]];
  if(multi){[...new Set(accts.map(a=>aCorp[a]))].sort((a,b)=>(!a)-(!b)||String(BZ[a]||a).localeCompare(String(BZ[b]||b),"ko")).forEach(c=>{const my=accts.filter(a=>aCorp[a]===c);
      if(c)aOpts.push([`c:${c}`,`${BZ[c]||fmtCorp(c)} 전체`]);my.forEach(a=>aOpts.push([a,`${c?`${BZ[c]||fmtCorp(c)} · `:""}${acctLbl(a)}`]));});}
  else accts.forEach(a=>aOpts.push([a,acctLbl(a)]));
  if(bankM&&!months.includes(bankM))bankM="";if(bankA&&!aOpts.some(o=>o[0]===bankA))bankA="";
  $("bk-m").innerHTML=`<option value="">전체 기간</option>`+months.map(m=>`<option value="${m}" ${m===bankM?"selected":""}>${m.slice(0,4)}년 ${+m.slice(5)}월</option>`).join("");
  $("bk-a").hidden=aOpts.length<3;$("bk-a").innerHTML=aOpts.map(([v,l])=>`<option value="${esc(v)}" ${v===bankA?"selected":""}>${esc(l)}</option>`).join("");
  const inScope=bankTx.filter(t=>(!bankM||t.day.startsWith(bankM))&&bkIn(t));
  const cnt=s=>inScope.filter(t=>!s||t.status===s).length;
  $("bkChips").innerHTML=[["new","확인할 것"],["done","처리함"],["skip","건너뜀"],["","전체"]].map(([k,l])=>`<button class="chip${k===bankF?" on":""}${k==="new"&&cnt("new")?" soon":""}" type="button" data-bkf-cat="${k}" aria-pressed="${k===bankF}">${l} <b>${cnt(k)}</b></button>`).join("");
  const ym=bankM||TODAY.slice(0,7),inM=bankTx.filter(t=>t.day.startsWith(ym)&&bkIn(t)),sum=d=>inM.filter(t=>t.dir===d).reduce((a,t)=>a+t.amount,0);
  const nw=bankTx.filter(t=>t.status==="new"&&bkIn(t));
  const aName=a=>multi&&aCorp[a]?`${BZ[aCorp[a]]||fmtCorp(aCorp[a])} ${acctLbl(a)}`:acctLbl(a);
  const bal=accts.map(a=>bankTx.find(t=>t.acct===a&&t.balance!=null)).filter(t=>t&&bkIn(t));
  $("bkTiles").innerHTML=`<div class="tile ${nw.length?"warn":""}"><small>확인할 것</small><b>${nw.length}건</b><small>들어온 ${won(nw.filter(t=>t.dir==="in").reduce((a,t)=>a+t.amount,0))} · 나간 ${won(nw.filter(t=>t.dir==="out").reduce((a,t)=>a+t.amount,0))}</small></div>
    <div class="tile"><small>${+ym.slice(5)}월 들어온 돈</small><b>${won(sum("in"))}</b></div><div class="tile"><small>${+ym.slice(5)}월 나간 돈</small><b>${won(sum("out"))}</b></div>
    ${bal.length?`<div class="tile"><small>통장 잔액 (마지막 거래 기준)</small><b>${won(bal.reduce((a,t)=>a+t.balance,0))}</b>${bal.length>1?`<small>${bal.map(t=>esc(aName(t.acct))).join(" · ")}</small>`:""}</div>`:""}`;
  const C=bankCtx(),list=inScope.filter(t=>!bankF||t.status===bankF);
  const sugs=new Map(list.filter(t=>t.status==="new").map(t=>[t.id,bankSuggest(t,C)]));
  const high=list.filter(t=>t.status==="new"&&sugReady(sugs.get(t.id)));
  $("bkBulk").innerHTML=bankF==="new"&&high.length>1?`<button class="btn sm" type="button" data-bkall>제안대로 모두 처리 (${high.length}건)</button> <span class="hint">이름·금액이 맞거나 전에 정한 이름만</span>`:"";
  $("bkList").innerHTML=list.length?list.slice(0,300).map(t=>{const s=sugs.get(t.id),open=bankOpen===t.id,sign=t.dir==="in"?"+":"−";
    const more=[t.r2,t.r3,t.r4,t.memo].filter(x=>x&&x!==txWho(t)).map(esc).join(" · ");
    let act="";
    if(t.status==="new"){act=`<div class="bk-sug">${s?`<span>제안: ${sugText(s)} <span class="tag ${s.conf==="high"?"ok":"wait"}">${esc(s.why)}</span></span>`:`<span class="hint">어디에 넣을지 골라 주세요.</span>`}
      <span class="bk-btns">${s&&(s.t!=="cost"||s.rows.length)?`<button class="btn sm" type="button" data-bkok="${esc(t.id)}">이걸로 처리</button>`:""}<button class="btn ghost sm" type="button" data-bkopen="${esc(t.id)}">${s?"다르게":"고르기"}</button>${s&&s.t==="skip"?"":`<button class="btn ghost sm" type="button" data-bkskip="${esc(t.id)}">건너뛰기</button>`}</span></div>`;
      if(open)act+=bankPickHtml(t,s,C);}
    else act=`<div class="bk-done"><span>${t.status==="skip"?"–":"✓"} ${esc((t.link&&t.link.l)||(t.status==="skip"?"건너뜀":"처리함"))}${t.done_by?` <span class="hint">${esc(t.done_by)}</span>`:""}</span><button class="linkish" type="button" data-bku="${esc(t.id)}">되돌리기</button></div>`;
    return`<li class="bk-row ${t.dir} ${t.status}" data-bk="${esc(t.id)}"><div class="bk-top"><span class="d">${fmtW(t.day)}${t.at?` ${t.at}`:""}</span>${multi&&aCorp[t.acct]?`<span class="tag biz">${esc(BZ[aCorp[t.acct]]||fmtCorp(aCorp[t.acct]))}</span>`:""}${accts.length>1?`<span class="hint">${esc(acctLbl(t.acct))}</span>`:""}<b class="bk-amt">${sign}${won(t.amount)}</b></div>
      <div class="bk-who"><b>${esc(txWho(t))||"(내용 없음)"}</b>${more?` <span class="hint">${more}</span>`:""}</div>${act}</li>`;}).join("")+(list.length>300?`<li class="hint">위에서 300건만 보여요. 달이나 계좌를 골라 주세요.</li>`:"")
    :`<li class="none">${bankTx.length?bankF==="new"?"확인할 거래가 없어요. 다 정리됐어요.":"이 조건에 맞는 거래가 없어요.":bankPop()?"아직 가져온 거래가 없어요. 통장 연결을 마치면 매시간 저절로 들어와요.":"아직 들어온 거래가 없어요. 휴대폰 은행 알림을 연결하거나 은행 엑셀을 올려 주세요."}</li>`;
  $("bkRuleN").textContent=bankRules.length?`${bankRules.length}개`:"없음";
  $("bkRules").innerHTML=bankRules.length?bankRules.map(r=>`<li><span>${esc(r.name)}</span><span class="hint">${r.t==="skip"?"건너뛰기":`회사 지출 · ${esc(r.cat)}`}</span><button class="linkish" type="button" data-bkforget="${esc(r.k)}">지우기</button></li>`).join("")
    :`<li class="hint">회사 지출이나 건너뛰기로 처리할 때 '다음에도'를 체크하면 여기 쌓여요.</li>`;}
/* 처리 화면에서 고른 값 읽기 */
function bankPickRead(t,k,box){const v=f=>{const el=box.querySelector(`[data-bkf="${f}"]`);return el?(el.type==="checkbox"?el.checked:el.value):"";};
  if(k==="exp")return{t:"exp",cat:v("cat"),note:String(v("note")).trim(),rem:!!v("rem")};
  if(k==="skip")return{t:"skip",why:String(v("why")).trim(),rem:!!v("rem")};
  if(k==="pay"){const r=box.querySelector('[data-bkf="pay"]:checked');if(!r)return{err:"받은 입금을 고르세요."};const [jid,ix]=r.value.split("|");return{t:"pay",jid,idx:ix.split(".").map(Number)};}
  if(k==="cost"){const rows=[...box.querySelectorAll('[data-bkf="cost"]:checked')].map(c=>{const [jid,i]=c.value.split("|"),j=jobs.find(x=>x.id===jid),x=j&&moneyOf(j.id).costs[+i];return j&&x?{j,i:+i,x}:null;}).filter(Boolean);
    return rows.length?{t:"cost",rows}:{err:"지급한 매입을 하나 이상 고르세요."};}
  if(k==="wage"){const r=box.querySelector('[data-bkf="wage"]:checked');if(!r)return{err:"지급한 시공자 정산을 고르세요."};const [y,m,...n]=r.value.split("|");return{t:"wage",y:+y,m:+m,n:n.join("|")};}
  if(k==="newcost"){if(!v("jid"))return{err:"현장을 고르세요."};return{t:"newcost",jid:v("jid"),cat:v("ccat"),v:String(v("v")).trim(),note:String(v("note")).trim()};}
  return{err:"처리할 곳을 고르세요."};}
function sugAction(s){if(s.t==="pay")return{t:"pay",jid:s.o.j.id,idx:s.o.idx};if(s.t==="cost")return{t:"cost",rows:s.rows};if(s.t==="wage")return{t:"wage",y:s.w.y,m:s.w.m,n:s.w.n};
  if(s.t==="exp")return{t:"exp",cat:s.cat,rem:true};return{t:"skip",why:s.note||""};}
async function bankRun(t,a,btn){if(btn)btn.disabled=true;const e=await bankApply(t,a);if(btn)btn.disabled=false;
  bankMsg=e;bankMsgOk=false;if(!e){bankOpen="";bankKind="";}
  if(/다른 기기/.test(e))await loadBank();
  laborCache=null;render();return!e;}
/* ---------- 팝빌 없이 (업데이트 15): 회사 통장 등록 · 휴대폰 은행 알림 · 은행 엑셀 올리기 ----------
   통장 목록은 bank_kv accts {list:[{id,bank,no,corp,name}], xl:{계좌id:{at,from,to,n}}}. 알림 서버가 알림에 보이는 번호로 계좌를 맞춤.
   bank_kv ping 은 알림 서버가 적음 (마지막 알림, 오늘 넣은 수, 못 읽은 알림 5개). */
const BANK_LIST=["신한","기업","국민","농협","우리","하나","카카오","토스","케이","새마을","우체국","기타"];
const normAccts=d=>(d&&Array.isArray(d.list)?d.list:[]).filter(a=>a&&typeof a.id==="string"&&/^k[a-z0-9]{4,16}$/.test(a.id))
  .map(a=>({id:a.id,bank:String(a.bank||"").slice(0,10),no:String(a.no||"").replace(/\D/g,"").slice(0,20),corp:String(a.corp||"").slice(0,20),name:String(a.name||"").slice(0,20)}));
const acctOf=k=>bankAccts.find(a=>a.id===k)||null;
/* 팝빌로 가져온 적이 있으면 팝빌 칸, 아니면 알림·엑셀 칸 */
const bankPop=()=>!!(bankState&&(bankState.lastEnd||bankState.corps||bankState.accts));
async function bankAcctSave(list,xl=bankXl){const {error}=await sb.from("bank_kv").upsert({key:"accts",data:{list,xl},updated_at:new Date().toISOString()});
  if(!error){bankAccts=list;bankXl=xl;}return!error;}
async function bankAcctAdd(box){const v=f=>{const el=box.querySelector(`[data-bka="${f}"]`);return el?el.value.trim():"";};
  const bank=v("bank"),no=v("no").replace(/\D/g,"");
  if(no.length<4)return"계좌번호를 4자리 이상 넣어 주세요. 끝 4자리만 넣어도 돼요.";
  if(bankAccts.some(a=>a.bank===bank&&(a.no.endsWith(no)||no.endsWith(a.no))))return"이미 넣은 통장이에요.";
  const id="k"+bnId().replace(/[^0-9a-f]/g,"").slice(0,10);
  return await bankAcctSave([...bankAccts,{id,bank,no,corp:v("corp").slice(0,20),name:v("name").slice(0,20)}])?"":"저장하지 못했어요. 업데이트 15를 했는지 확인해 주세요.";}
async function bankKeyGet(){bankKeyErr="";const {data,error}=await sb.rpc("as_key",{p_reset:false});
  if(error||typeof data!=="string")bankKeyErr=/admin only/.test(error&&error.message||"")?"관리자만 볼 수 있어요.":"열쇠를 불러오지 못했어요. 업데이트 14(AS 자동 접수)를 했는지 확인해 주세요.";else asKey=data;
  bankKeyOpen=true;renderBank();}
const bkAgo=iso=>{const m=(Date.now()-new Date(iso))/6e4;if(!(m>=0))return"";if(m<2)return"방금";if(m<60)return`${Math.round(m)}분 전`;if(m<1440)return`${Math.round(m/60)}시간 전`;return kstTime(iso);};
function bankFreeHtml(){const P=bankPing||{},cfg=window.NEST_CONFIG||{};
  const live=!!P.last&&Date.now()-new Date(P.last)<3*864e5,nToday=P.day===TODAY?+P.n||0:0,miss=Array.isArray(P.miss)?P.miss:[];
  const unk=bankTx.filter(t=>t.acct.startsWith("?")&&t.status==="new").length;
  const rows=bankAccts.map(a=>{const x=bankXl[a.id],del=bankADel===a.id;
    return`<li><span><b>${esc(a.bank)} ···${esc(a.no.slice(-4))}</b>${a.corp||a.name?` <span class="hint">${esc([a.corp,a.name].filter(Boolean).join(" · "))}</span>`:""}</span>
      <span class="hint">${x&&x.to?`엑셀 ${fmt(x.to)}까지 올림`:"엑셀 아직 안 올림"}</span><button class="linkish" type="button" data-bkadel="${esc(a.id)}">${del?"정말 뺄까요? 들어온 거래는 남아요":"빼기"}</button></li>`;}).join("");
  const corps=[...new Set([...bankAccts.map(a=>a.corp),"네스트","리브젠"].filter(Boolean))];
  const form=`<div class="bk-grid bk-aform"><label>은행<select data-bka="bank">${BANK_LIST.map(b=>`<option>${b}</option>`).join("")}</select></label>
    <label>계좌번호 <small class="hint">전체 또는 끝 4자리</small><input data-bka="no" inputmode="numeric" autocomplete="off" placeholder="110-123-456789"></label>
    <label>사업자<input data-bka="corp" list="bkCorpList" autocomplete="off" placeholder="네스트"></label><label>별명 <small class="hint">안 써도 돼요</small><input data-bka="name" autocomplete="off" placeholder="운영 통장"></label></div>
    <datalist id="bkCorpList">${corps.map(c=>`<option value="${esc(c)}">`).join("")}</datalist>
    <div class="bk-btns"><button class="btn sm" type="button" data-bkaadd>통장 넣기</button>${bankAccts.length?`<button class="btn ghost sm" type="button" data-bkaform>닫기</button>`:""}</div>`;
  const copy=(l,v)=>`<label class="as-copy">${l}<span><input readonly value="${esc(v)}"><button type="button" class="btn ghost sm" data-bkcopy>복사</button></span></label>`;
  const last=P.ok&&+P.ok.amount?`마지막으로 넣은 거래: ${P.ok.dir==="in"?"입금":"출금"} ${won(+P.ok.amount)} · ${esc(acctLbl(P.ok.acct||""))} (${kstTime(P.ok.at)})`:"";
  const setup=!bankAccts.length||!P.last;
  const sum=[bankAccts.length?bankAccts.map(a=>`${esc(a.bank)} ${esc(a.no.slice(-4))}`).join(" · "):"통장 없음",P.last?`알림 ${bkAgo(P.last)}`:""].filter(Boolean).join(" · ");
  const open=(bankConnOpen===null?setup:bankConnOpen)||bankAOpen||bankKeyOpen||!!bankADel;
  return`<details class="bk-conn${setup||unk?" bad":""}"${open?" open":""}><summary><b>통장 연결</b> <span class="tag ${live?"ok":"wait"}">${live?"알림 받는 중":"알림 연결 전"}</span> <span class="hint">${sum}</span><span class="bk-more">설정</span></summary>
  <p class="hint">휴대폰에 오는 은행 입출금 알림이 저절로 들어오고, 한 달에 한 번 인터넷뱅킹 거래내역 엑셀을 올리면 알림이 놓친 거래가 채워져요. 팝빌 없이 무료예요.</p>
  <div class="bk-corp"><p class="bk-corp-h"><b>① 회사 통장</b> <span class="hint">알림이 어느 통장 것인지 계좌번호로 알아봐요</span></p>
    ${bankAccts.length?`<ul class="bk-accts">${rows}</ul>`:""}
    ${!bankAccts.length||bankAOpen?form:`<div class="bk-btns"><button class="btn ghost sm" type="button" data-bkaform>+ 통장 더 넣기</button></div>`}</div>
  <div class="bk-corp"><p class="bk-corp-h"><b>② 휴대폰 은행 알림</b> <span class="hint">${P.last?`마지막 알림 ${kstTime(P.last)} · 오늘 넣은 거래 ${nToday}건`:"아직 받은 알림이 없어요"}</span></p>
    ${last?`<p class="hint">${last}</p>`:""}
    ${unk?`<p class="err">어느 통장인지 모르는 거래가 ${unk}건 있어요. ①에 그 통장 계좌번호를 넣으면 다음부터 알아보고, 그 통장 엑셀을 올리면 채워져요.</p>`:""}
    ${miss.length?`<details class="as-raw"><summary>못 읽은 은행 알림 ${miss.length}개</summary><ul class="bk-miss">${miss.map(m=>`<li><span class="hint">${kstTime(m.at)}${m.app?` · ${esc(m.app)}`:""}</span> ${esc(m.text)}</li>`).join("")}</ul><p class="hint">거래 알림인데 여기 있으면 엑셀을 올릴 때 채워져요. 자주 생기면 그 알림 화면을 캡처해서 알려 주세요.</p></details>`:""}
    <p class="hint">갤럭시의 MacroDroid에 '은행 알림' 매크로를 하나 더 만들어요. 주소 끝의 key는 AS 자동 접수와 같아요. 순서는 <a href="https://github.com/nestfurniture/nest-schedule#업데이트-15-통장-내역-은행-알림과-엑셀-적용" target="_blank" rel="noopener">README 업데이트 15</a>에 있어요.</p>
    ${asKey?`<div class="as-keys">${copy("은행 알림 받을 때 주소",`${cfg.SUPABASE_URL}/functions/v1/notify?action=bank_in&key=${asKey}`)}${copy("헤더 Authorization 값",`Bearer ${cfg.SUPABASE_ANON_KEY||""}`)}<p class="hint">주소 끝의 key는 비밀번호 같은 거예요. 다른 사람에게 보내지 말고, 화면을 캡처할 때는 가려 주세요.</p></div>`
      :`<div class="bk-btns"><button type="button" class="btn ghost sm" data-bkkey>MacroDroid에 넣을 주소 보기</button></div>`}
    ${bankKeyErr?`<p class="err">${esc(bankKeyErr)}</p>`:""}</div>
  </details>`;}

/* ---------- 은행 엑셀 읽기 ----------
   파일은 일꾼(bank-xlsx.js)이 표로 풀고, 여기서 머리줄(거래일시·입금·출금·잔액·내용 …)을 찾아 거래로 바꿈.
   신한·기업 말고도 대부분 은행의 '거래내역조회' 엑셀을 읽음. 알림으로 들어온 줄과 겹치면 그 줄을 엑셀 내용으로 채움. */
const bxH=s=>String(s??"").replace(/\s+/g,"").replace(/[(\[](원|KRW|원화)[)\]]/gi,"").replace(/[()\[\]:.]/g,"");
const BXC={date:/^(거래일시|거래일자|거래일|거래날짜|일시|일자|날짜|거래년월일|처리일시|처리일자|입출금일시|거래일시분|조회일자)$/,
  time:/^(거래시간|시간|시각|거래시각|처리시간|처리시각)$/,
  in:/^(입금|입금액|입금금액|맡기신금액|맡기신|받은금액|입금하신금액|입금원)$/,
  out:/^(출금|출금액|출금금액|찾으신금액|찾으신|지급|지급액|지급금액|보낸금액|출금원)$/,
  amt:/^(거래금액|금액|입출금액|입출금금액)$/,kind:/^(입출금구분|입출구분|입금출금구분|입지구분|구분)$/,
  bal:/^(잔액|거래후잔액|잔고|거래후잔고|현재잔액|거래후잔액원)$/,
  who:/^(내용|기재내용|거래내용|보낸분|받는분|보낸분받는분|받는분보낸분|보낸분\/받는분|받는분\/보낸분|보낸사람|받는사람|의뢰인|수취인|의뢰인수취인|의뢰인\/수취인|예금주|입금자|입금인|입금자명|입금인명|상대예금주|상대예금주명|상대계좌예금주명|상대방|거래처|상호|가맹점|가맹점명|통장표시내용|적요내용)$/,
  sum:/^(적요|거래구분|거래종류|거래유형|구분|종류|거래방법|거래수단|거래점구분)$/,
  memo:/^(메모|송금메모|비고|기록사항|내통장표시|받는통장표시)$/,where:/^(거래점|취급점|처리점|거래점명|취급점명|상대은행|상대은행명|은행|지점|취급기관)$/};
const bxAmt=v=>{if(typeof v==="number")return Math.round(v);const s=String(v??"").trim();if(!s)return 0;
  const n=+s.replace(/[^\d.]/g,"");return isNaN(n)?0:Math.round(/^\(.*\)$|^[-−]|[-−]$/.test(s)?-n:n);};
function bxAt(v){if(typeof v==="number"&&v>=0&&v<1){const n=Math.round(v*1440);return`${pad(Math.floor(n/60)%24)}:${pad(n%60)}`;}
  const s=String(v??"");let m=s.match(/(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(오전|오후|AM|PM)?/i);
  if(m){let h=+m[2];const ap=(m[1]||m[4]||"").toUpperCase();if((ap==="오후"||ap==="PM")&&h<12)h+=12;if((ap==="오전"||ap==="AM")&&h===12)h=0;return h<24&&+m[3]<60?`${pad(h)}:${m[3]}`:"";}
  m=s.trim().match(/^(\d{2})(\d{2})(\d{2})?$/);return m&&+m[1]<24&&+m[2]<60?`${m[1]}:${m[2]}`:"";}
/* 날짜 칸 → {day, at}. 2026-11-23 14:05:33 · 2026.11.23 · 20261123 · 11/23/26 · 엑셀 날짜 숫자 */
function bxWhen(v){let y,mo,d,m;const s=String(v??"").trim();
  if(typeof v==="number"&&v>20000&&v<80000){const iso=new Date(Math.round((v-25569)*864e5)).toISOString();return{day:iso.slice(0,10),at:iso.slice(11,16)==="00:00"?"":iso.slice(11,16)};}
  if((m=s.match(/^(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?\.?/)))[y,mo,d]=[+m[1],+m[2],+m[3]];
  else if((m=s.match(/^(\d{4})(\d{2})(\d{2})(?!\d)/)))[y,mo,d]=[+m[1],+m[2],+m[3]];
  else if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/)))[y,mo,d]=[+m[3]<100?2000+ +m[3]:+m[3],+m[1],+m[2]];
  else return null;
  const day=`${y}-${pad(mo)}-${pad(d)}`,t=new Date(day+"T12:00:00Z");
  if(isNaN(t)||t.toISOString().slice(0,10)!==day||y<2000||y>2100)return null;
  return{day,at:bxAt(s.slice(m[0].length))};}
/* 파일 머리(계좌번호·은행 이름)와 파일 이름으로 어느 통장인지 짐작 */
function bxGuess(text){const T=String(text||""),nums=[...T.matchAll(/\d{2,6}-\d{2,8}-\d{1,8}(?:-\d{1,4})?|\d{10,16}/g)].map(m=>m[0]).filter(x=>!/^(19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(x)).map(x=>x.replace(/\D/g,""));
  const hit=bankAccts.filter(a=>a.no.length>=4&&nums.some(n=>n===a.no||n.endsWith(a.no)||(n.length>=8&&a.no.endsWith(n))));
  if(hit.length===1)return hit[0].id;
  const b=BANK_LIST.find(x=>x!=="기타"&&(x==="기업"?/기업은행|IBK/i:new RegExp(x)).test(T)),same=bankAccts.filter(a=>a.bank===b&&(!hit.length||hit.includes(a)));
  return same.length===1?same[0].id:"";}
function bxParse(sheets,fname){let best=null;
  for(const sh of sheets){const rows=sh.rows||[];
    for(let r=0;r<Math.min(rows.length,40);r++){const H=(rows[r]||[]).map(bxH),col=k=>H.findIndex(h=>BXC[k].test(h)),all=k=>H.map((h,i)=>BXC[k].test(h)?i:-1).filter(i=>i>=0);
      const C={date:col("date"),time:col("time"),in:col("in"),out:col("out"),amt:col("amt"),bal:col("bal"),who:all("who"),memo:all("memo"),where:all("where")};
      if(C.date<0||!((C.in>=0&&C.out>=0)||C.amt>=0))continue;
      const two=C.in>=0&&C.out>=0;C.kind=two?-1:col("kind");C.sum=all("sum").filter(i=>i!==C.kind);
      const out=[];
      for(let i=r+1;i<rows.length;i++){const row=rows[i]||[],g=c=>c>=0&&c<row.length?row[c]:"",txt=c=>String(g(c)??"").replace(/\s+/g," ").trim().slice(0,60);
        const w=bxWhen(g(C.date));if(!w)continue;
        let dir="",amount=0;
        if(two){const a=bxAmt(g(C.in)),b=bxAmt(g(C.out));if(a>0&&!(b>0)){dir="in";amount=a;}else if(b>0&&!(a>0)){dir="out";amount=b;}}
        else{const a=bxAmt(g(C.amt)),k=txt(C.kind);amount=Math.abs(a);
          dir=/입금|^입$|받|^\+/.test(k)?"in":/출금|^출$|지급|찾|^[-−]/.test(k)?"out":a<0?"out":a>0&&C.kind<0?"in":"";}
        if(!dir||!amount)continue;
        const whos=C.who.map(txt).filter(Boolean),sums=C.sum.map(txt).filter(Boolean),bs=txt(C.bal);
        out.push({day:w.day,at:w.at||(C.time>=0?bxAt(g(C.time)):""),dir,amount,balance:C.bal>=0&&bs!==""?bxAmt(g(C.bal)):null,
          r1:whos[0]||sums[0]||"",r2:(whos[0]?sums:sums.slice(1)).join(" ").slice(0,60),r3:[...whos.slice(1),...C.memo.map(txt)].filter(Boolean).join(" ").slice(0,80),r4:C.where.map(txt).filter(Boolean).join(" ").slice(0,40)});}
      if(out.length&&(!best||out.length>best.rows.length))best={rows:out,sheet:sh.name,head:rows.slice(0,r).map(x=>(x||[]).join(" ")).join(" ")};
      break;}}
  if(!best)return{rows:[],err:"날짜·입금·출금 칸을 찾지 못했어요. 은행 인터넷뱅킹의 '거래내역조회'에서 엑셀로 저장한 파일인지 확인해 주세요."};
  /* 계좌번호가 다른 표에 따로 있는 파일도 있어서(은행 html 엑셀) 다른 표의 위쪽 몇 줄도 같이 봄 */
  const other=sheets.filter(x=>x.name!==best.sheet).map(x=>(x.rows||[]).slice(0,8).map(r=>(r||[]).join(" ")).join(" ")).join(" ");
  return{rows:best.rows,sheet:best.sheet,acct:bxGuess(`${best.head} ${other} ${fname||""}`)};}
/* 엑셀 줄마다: 이미 넣은 엑셀 줄(같은 번호)이면 건너뜀 → 같은 통장·방향·금액·하루 안팎의 알림 줄(잔액이 둘 다 있으면 잔액까지 같아야)이면 채움 → 아니면 새로 */
const bxT=(d,at)=>{const m=/^(\d{1,2}):(\d{2})/.exec(at||"");return m?Date.parse(d+"T00:00:00Z")/6e4+ +m[1]*60+ +m[2]:null;};
function bxPlan(rows,A){const ids=new Set(bankTx.map(t=>t.id)),used=new Set(),seen={},add=[],fill=[],same=[];
  const pool=bankTx.filter(t=>t.acct===A.id||t.acct==="?"||t.acct===`?${A.bank}`);
  for(const e of rows){const k=`${A.id}:${e.day}:${e.at.replace(":","")}:${e.dir}:${e.amount}:${e.balance??"-"}`,n=seen[k]=(seen[k]||0)+1,id=`x:${k}:${n}`;
    if(ids.has(id)){same.push(e);continue;}
    const gap=t=>{if(t.balance!=null&&e.balance!=null)return-1;const a=bxT(t.day,t.at),b=bxT(e.day,e.at);return a!=null&&b!=null?Math.abs(a-b):t.day===e.day?600:9999;};
    const c=pool.filter(t=>!used.has(t.id)&&t.dir===e.dir&&t.amount===e.amount&&near(t.day,e.day,1)&&(t.balance==null||e.balance==null||t.balance===e.balance))
      .map(t=>({t,g:gap(t)})).filter(o=>o.g<=(o.t.src==="alert"?180:30)||o.g===600).sort((a,b)=>a.g-b.g)[0];
    if(!c){add.push({...e,id});continue;}
    used.add(c.t.id);
    if(c.t.src==="alert"||c.t.acct.startsWith("?"))fill.push({t:c.t,e});else same.push(e);}
  return{add,fill,same};}
function bxRead(file){return new Promise((ok,no)=>{
  if(file.size>15*1024*1024)return no(new Error("파일이 너무 커요 (15MB까지). 기간을 나눠서 받아 주세요."));
  let w;try{w=new Worker("bank-xlsx.js");}catch(e){return no(new Error("이 브라우저에서는 엑셀을 읽을 수 없어요."));}
  const end=()=>{clearTimeout(t);w.terminate();};
  const t=setTimeout(()=>{w.terminate();no(new Error("파일을 읽는 데 너무 오래 걸려요. 은행에서 .xlsx 나 .csv 로 받아 보세요."));},45e3);
  w.onmessage=e=>{end();e.data&&e.data.ok?ok(e.data.sheets):no(new Error(`엑셀을 읽지 못했어요. ${(e.data&&e.data.error)||""}`));};
  w.onerror=()=>{end();no(new Error("엑셀을 읽지 못했어요. 인터넷 연결을 확인하고 다시 골라 주세요."));};
  file.arrayBuffer().then(buf=>w.postMessage({buf},[buf]),e=>{end();no(e);});});}
async function bankXOpen(file){bankX={name:file.name,busy:true};bankMsg="";renderBank();
  try{const sheets=await bxRead(file),r=bxParse(sheets,file.name);
    bankX=r.rows.length?{name:file.name,rows:r.rows,sheet:sheets.length>1?r.sheet:"",acct:r.acct||(bankAccts.length===1?bankAccts[0].id:""),old:false,before:TODAY.slice(0,8)+"01"}
      :{name:file.name,err:r.err||"거래를 찾지 못했어요."};}
  catch(e){bankX={name:file.name,err:e.message||String(e)};}
  renderBank();}
function bankXHtml(){const X=bankX;
  if(!X)return`<div class="bk-xbar"><label class="btn ghost sm">은행 엑셀 올리기<input type="file" id="bk-file" accept=".xls,.xlsx,.csv,.htm,.html" hidden></label><span class="hint">인터넷뱅킹 거래내역조회에서 내려받은 파일</span></div>`;
  if(X.busy)return`<div class="bk-conn"><p class="hint">${esc(X.name)} 읽는 중…</p></div>`;
  if(X.err)return`<div class="bk-conn bad"><p><b>${esc(X.name)}</b></p><p class="err">${esc(X.err)}</p><div class="bk-btns"><button class="btn ghost sm" type="button" data-bkxno>닫기</button></div></div>`;
  const A=acctOf(X.acct),R=X.rows,days=R.map(r=>r.day).sort(),inN=R.filter(r=>r.dir==="in").length;
  X.plan=A?bxPlan(R,A):null;const p=X.plan,old=p&&X.old&&X.before?p.add.filter(e=>e.day<X.before).length:0;
  const plan=!bankAccts.length?`<p class="err">위 ① 회사 통장에서 통장을 먼저 넣어 주세요.</p>`:!p?`<p class="hint">통장을 고르면 이미 들어온 거래와 겹치는지 찾아봐요.</p>`
    :`<p>새로 넣을 거래 <b>${p.add.length}건</b>${p.fill.length?` · 알림으로 들어온 ${p.fill.length}건은 엑셀 내용으로 채워요`:""}${p.same.length?` · 이미 있는 ${p.same.length}건은 건너뛰어요`:""}</p>
      ${p.add.length?`<div class="bk-old"><label class="check"><input type="checkbox" data-bkx="old" ${X.old?"checked":""}><span>이 날짜 전 거래는 확인 안 하고 '건너뜀'으로 넣기${X.old?` (${old}건)`:""}</span></label><input type="date" data-bkx="before" value="${esc(X.before)}" aria-label="이 날짜 전"></div>
      <p class="hint">결산에 이미 손으로 다 적어 둔 지난 달이면 체크하세요. 건너뜀으로 넣은 줄도 나중에 되돌리기로 다시 처리할 수 있어요.</p>`:""}`;
  return`<div class="bk-conn bk-x"><p><b>은행 엑셀 올리기</b> <span class="hint">${esc(X.name)}${X.sheet?` · ${esc(X.sheet)} 표`:""}</span></p>
    <p>${fmt(days[0])} ~ ${fmt(days[days.length-1])} · 거래 ${R.length}건 <span class="hint">(들어온 ${inN} · 나간 ${R.length-inN})</span></p>
    <label class="bk-xacct">어느 통장 거래내역인가요? <select data-bkx="acct"><option value="">고르세요</option>${bankAccts.map(a=>`<option value="${esc(a.id)}" ${a.id===X.acct?"selected":""}>${esc(acctLbl(a.id))}${a.corp?` · ${esc(a.corp)}`:""}${a.name?` · ${esc(a.name)}`:""}</option>`).join("")}</select></label>
    ${plan}<div class="bk-btns"><button class="btn sm" type="button" data-bkxgo ${p&&(p.add.length||p.fill.length)?"":"disabled"}>넣기</button><button class="btn ghost sm" type="button" data-bkxno>취소</button></div></div>`;}
async function bankXGo(btn){const X=bankX,A=X&&acctOf(X.acct);if(!A||bankXBusy)return;
  bankXBusy=true;btn.disabled=true;btn.textContent="넣는 중…";
  const p=bxPlan(X.rows,A),at=new Date().toISOString(),by=String(userName||userEmail||"").slice(0,40),old=e=>X.old&&X.before&&e.day<X.before;
  const rows=p.add.map(e=>({id:e.id,acct:A.id,corp:A.corp,day:e.day,at:e.at,dir:e.dir,amount:e.amount,balance:e.balance,r1:e.r1,r2:e.r2,r3:e.r3,r4:e.r4,memo:"",src:"excel",raw:"",
    ...(old(e)?{status:"skip",link:{t:"skip",l:"건너뜀 · 엑셀로 넣은 지난 거래"},note:"엑셀로 넣은 지난 거래",done_at:at,done_by:by}:{status:"new",link:null,note:"",done_at:null,done_by:""}),updated_at:at}));
  let err="",added=0,filled=0;
  for(let i=0;i<rows.length&&!err;i+=400){const part=rows.slice(i,i+400),{error}=await sb.from("bank_tx").upsert(part,{onConflict:"id",ignoreDuplicates:true});if(error)err=error.message;else added+=part.length;}
  for(const {t,e} of p.fill){if(err)break;
    const {error}=await sb.from("bank_tx").update({acct:A.id,corp:A.corp,day:e.day,at:e.at||t.at,balance:e.balance??t.balance,r1:e.r1||t.r1,r2:e.r2,r3:e.r3,r4:e.r4,src:"excel",updated_at:at}).eq("id",t.id);
    if(error)err=error.message;else filled++;}
  if(added||filled){const days=X.rows.map(r=>r.day).sort(),pv=bankXl[A.id]||{},to=days[days.length-1];
    await bankAcctSave(bankAccts,{...bankXl,[A.id]:{at,from:pv.from&&pv.from<days[0]?pv.from:days[0],to:pv.to&&pv.to>to?pv.to:to,n:X.rows.length}});}
  bankXBusy=false;
  bankMsg=`${added?`엑셀에서 새 거래 ${added}건을 넣었어요.`:""}${filled?` 알림으로 들어온 ${filled}건은 엑셀 내용으로 채웠어요.`:""}${err?` 다 넣지 못했어요: ${esc(err)} 다시 올리면 남은 것만 들어가요.`:""}`.trim()||"넣을 거래가 없었어요.";
  bankMsgOk=!err;if(!err)bankX=null;
  await loadBank();laborCache=null;render();}
/* ---------- 팝빌 회원 가입 ---------- */
function openBankJoin(num){const C=bkCorps(bankSt),c=C.find(x=>x.num===num)||C[0]||{num:"",corp:"",name:""},co=(typeof estConf!=="undefined"&&estConf.company)||{};
  /* 다른 사업자로 바꿔 열면 칸을 비움. 회사 정보(견적서 설정)는 그 사업자와 같을 때만 미리 채움 */
  if(bankJoinCorp!==c.num){["bj-id","bj-corp","bj-ceo","bj-addr","bj-type","bj-cls","bj-name","bj-email","bj-tel"].forEach(id=>{$(id).value="";});bankJoinCorp=c.num;}
  const biz=String(co.bizNo||"").replace(/\D/g,""),cn=bnNorm(c.name),on=bnNorm(co.name);
  const mine=C.length<2||(biz?biz===c.num:!!cn&&!!on&&(on.includes(cn)||cn.includes(on)));
  const set=(id,v)=>{const el=$(id);if(el&&!el.value)el.value=v||"";};
  if(mine){set("bj-corp",co.name);set("bj-ceo",co.ceo);set("bj-addr",co.addr);set("bj-tel",co.tel);}else set("bj-corp",c.name);
  set("bj-email",mine&&co.email||userEmail);set("bj-name",userName||(mine?co.ceo:""));
  $("bj-corpnum").textContent=`${C.length>1&&c.name?`${c.name} `:""}${c.corp||""}`;$("bj-err").hidden=true;$("bankJoin").hidden=false;document.body.style.overflow="hidden";}
function closeBankJoin(){$("bankJoin").hidden=true;document.body.style.overflow="";$("bj-pw").value="";}
/* 화면 단추 연결: app.js가 시작할 때 부름 (이 파일은 app.js보다 먼저 읽음) */
function bankInit(){
$("view-bank").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;const d=b.dataset;
  const T=id=>bankTx.find(x=>x.id===id);
  if("bkfCat" in d){bankF=d.bkfCat;bankOpen="";renderBank();return;}
  if("bkre" in d){bankMsg="";bankSt=null;renderBank();bankStatus(true);return;}
  if("bkget" in d){bankCollect(b);return;}
  if("bkaform" in d){bankAOpen=!bankAOpen;bankMsg="";renderBank();return;}
  if("bkaadd" in d){const box=b.closest(".bk-corp");if(!box)return;b.disabled=true;const m=await bankAcctAdd(box);b.disabled=false;
    if(document.activeElement)document.activeElement.blur();bankMsg=m||"통장을 넣었어요.";bankMsgOk=!m;if(!m)bankAOpen=false;renderBank();return;}
  if(d.bkadel){if(bankADel!==d.bkadel){bankADel=d.bkadel;renderBank();return;}
    bankADel="";const xl={...bankXl};delete xl[d.bkadel];const ok=await bankAcctSave(bankAccts.filter(a=>a.id!==d.bkadel),xl);
    bankMsg=ok?"통장을 뺐어요. 그 통장으로 들어온 거래는 그대로 있어요.":"저장하지 못했어요. 다시 눌러 주세요.";bankMsgOk=ok;renderBank();return;}
  if("bkkey" in d){b.disabled=true;bankKeyGet();return;}
  if("bkcopy" in d){const i=b.parentElement.querySelector("input");i.select();
    try{navigator.clipboard.writeText(i.value).then(()=>{b.textContent="복사됨";setTimeout(()=>{b.textContent="복사"},1500);},()=>document.execCommand("copy"));}catch(x){document.execCommand("copy");}return;}
  if("bkxno" in d){bankX=null;renderBank();return;}
  if("bkxgo" in d){bankXGo(b);return;}
  if(d.bkurl){bankPopup(d.bkurl,b);return;}
  if("bkjoin" in d){openBankJoin(d.bkjoin);return;}
  if(d.bkopen){bankOpen=bankOpen===d.bkopen?"":d.bkopen;bankKind="";bankMsg="";renderBank();return;}
  if("bkclose" in d){bankOpen="";bankKind="";renderBank();return;}
  if(d.bkk){const box=b.closest(".bk-pick");bankKind=d.bkk;if(box)bankOpen=box.dataset.bkp;renderBank();return;}
  if(d.bkforget){bankForget(d.bkforget);return;}
  if(d.bkok){const t=T(d.bkok);if(!t)return;const s=bankSuggest(t,bankCtx());if(!s)return;bankRun(t,sugAction(s),b);return;}
  if(d.bkskip){const t=T(d.bkskip);if(t)bankRun(t,{t:"skip",why:""},b);return;}
  if(d.bkdo){const box=b.closest(".bk-pick"),t=box&&T(box.dataset.bkp);if(!t)return;const a=bankPickRead(t,d.bkdo,box);
    if(a.err){bankMsg=a.err;bankMsgOk=false;renderBank();return;}bankRun(t,a,b);return;}
  if(d.bku){const t=T(d.bku);if(!t)return;b.disabled=true;const m=await bankUndo(t);b.disabled=false;bankMsg=m;bankMsgOk=false;laborCache=null;render();return;}
  if("bkall" in d){const C=bankCtx(),todo=bankTx.filter(t=>t.status==="new"&&(!bankM||t.day.startsWith(bankM))&&bkIn(t)).map(t=>({t,s:bankSuggest(t,C)}))
      .filter(o=>sugReady(o.s));
    if(!todo.length||!confirm(`제안대로 ${todo.length}건을 처리할까요? 처리한 뒤에도 줄마다 되돌리기를 누를 수 있어요.`))return;
    b.disabled=true;let okN=0,bad=0;
    for(const o of todo){const s=bankSuggest(o.t,bankCtx());if(!sugReady(s)){bad++;continue;}const e=await bankApply(o.t,sugAction(s));if(e)bad++;else okN++;laborCache=null;}
    b.disabled=false;bankMsg=`${okN}건을 처리했어요.${bad?` ${bad}건은 처리하지 못해 그대로 뒀어요.`:""}`;bankMsgOk=!bad;render();}});
$("view-bank").addEventListener("change",e=>{const t=e.target;
  if(t.id==="bk-m"){bankM=t.value;bankOpen="";renderBank();return;}
  if(t.id==="bk-a"){bankA=t.value;bankOpen="";renderBank();return;}
  if(t.id==="bk-file"){const f=t.files&&t.files[0];if(f)bankXOpen(f);return;}
  if(t.dataset.bkx&&bankX){const k=t.dataset.bkx;if(k==="old")bankX.old=t.checked;else if(k==="acct")bankX.acct=t.value;else if(k==="before")bankX.before=t.value;
    if(k!=="old")t.blur();renderBank();return;}
  if(t.dataset.bkf==="cost"){const box=t.closest(".bk-pick"),s=box&&box.querySelector("[data-bksum]"),tx=box&&bankTx.find(x=>x.id===box.dataset.bkp);
    if(s&&tx){const v=[...box.querySelectorAll('[data-bkf="cost"]:checked')].reduce((a,c)=>a+(+c.dataset.amt||0),0);s.textContent=`고른 합계 ${won(v)} / 통장 ${won(tx.amount)}${v&&v!==tx.amount?" · 금액이 달라요":""}`;}}});
/* 통장 연결 칸을 열고 닫은 것은 다시 그려도 그대로 */
$("view-bank").addEventListener("click",e=>{const sm=e.target.closest&&e.target.closest("details.bk-conn>summary");if(sm&&!bankPop())bankConnOpen=!sm.parentElement.open;});
$("view-bank").addEventListener("focusout",()=>setTimeout(()=>{if(bankLater&&!bkBusy())renderBank();},0));
$("bj-close").onclick=closeBankJoin;
$("bankJoin").addEventListener("click",e=>{if(e.target===$("bankJoin"))closeBankJoin();});
$("bj-save").onclick=async()=>{const g=id=>$(id).value.trim(),err=m=>{$("bj-err").textContent=m;$("bj-err").hidden=false;};
  const form={id:g("bj-id"),pw:$("bj-pw").value,corp:g("bj-corp"),ceo:g("bj-ceo"),addr:g("bj-addr"),type:g("bj-type"),cls:g("bj-cls"),name:g("bj-name"),email:g("bj-email"),tel:g("bj-tel")};
  if(Object.values(form).some(v=>!v))return err("빈 칸을 모두 채워 주세요.");
  if(form.id.length<6)return err("아이디는 6자 이상이에요.");
  if(!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[~!@#$%^&*()_+]).{8,20}$/.test(form.pw))return err("비밀번호는 8~20자로 영문·숫자·특수문자(~!@#$%^&*()_+)를 모두 넣어 주세요.");
  $("bj-save").disabled=true;const r=await bankCall({action:"join",form,corp:bankJoinCorp||""});$("bj-save").disabled=false;
  if(r.error)return err(bankErrText(r));if(!r.data.ok)return err(r.data.message||"가입하지 못했어요.");
  const jn=(bkCorps(bankSt).length>1&&(bkCorps(bankSt).find(x=>x.num===bankJoinCorp)||{}).name)||"";
  closeBankJoin();bankMsg=`${jn?`${esc(jn)} `:""}팝빌 회원 가입이 끝났어요. 이제 계좌 등록·관리에서 통장을 등록해 주세요. 팝빌 아이디·비밀번호는 따로 적어 두세요.`;bankMsgOk=true;bankStatus(true);};}
