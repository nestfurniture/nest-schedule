let CREW=[];
let jobs=[],files=[],money={},pending=[],sb=null,calY,calM,editing=null,loaded=false;
let uid="",isAdmin=false,migrated=true,curTab="board";
const BUCKET="job-files",MAX_BYTES=50*1024*1024,KINDS={drawing:"도면",estimate:"견적서"};
const STAGES=["실측","시공 전","시공 후","마감","AS","기타"];
const PAY_LABELS=["계약금","중도금","잔금","추가금"];
const COST_CATS=["자재비","시공 인건비","추가 투입 인건비","외주·가공","운반·기타"];
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const now=new Date();let TODAY=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
calY=now.getFullYear();calM=now.getMonth();
const fmt=d=>d?d.slice(5).replace("-","/"):"—";
const addDays=(d,n)=>{const t=new Date(d+"T12:00:00");t.setDate(t.getDate()+n);return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`};
const dayDiff=(a,b)=>Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5);
const sub=j=>[j.item,j.addr].filter(Boolean).map(esc).join(" · ");
/* 고객 전화번호: 숫자만 적어도 010-1234-5678 꼴로 맞춤. 보기 화면에서 누르면 전화·문자 */
function fmtTel(v){const t=String(v||"").trim(),d=t.replace(/\D/g,"");if(!/^[\d\s.-]+$/.test(t))return t;
  if(/^02\d{7,8}$/.test(d))return d.replace(/^(02)(\d{3,4})(\d{4})$/,"$1-$2-$3");
  if(/^0\d{9,10}$/.test(d))return d.replace(/^(0\d{2})(\d{3,4})(\d{4})$/,"$1-$2-$3");return t;}
const telNum=v=>{const m=String(v||"").match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/);return m?m[0].replace(/\D/g,""):"";};
const telBtns=v=>{const n=telNum(v);return n?`<a class="btn ghost sm" href="tel:${n}">전화</a><a class="btn ghost sm" href="sms:${n}">문자</a>`:"";};
const WD="일월화수목금토";
const dow=d=>new Date(d+"T12:00:00").getDay();
const fmtW=d=>d?`${fmt(d)}<span class="wk">(${WD[dow(d)]})</span>`:"—";
const short=j=>esc(j.name.replace(" 고객",""));
/* 시공 작업일: 시작~종료 중 토·일은 따로 체크한 경우에만 포함, '쉬는 날'로 뺀 날은 제외 */
function spanDays(i){const out=[];if(!i.start)return out;const end=i.end&&i.end>=i.start?i.end:i.start;
  for(let d=i.start,n=0;d<=end&&n<370;d=addDays(d,1),n++){const w=dow(d);if((w===6&&!i.sat)||(w===0&&!i.sun))continue;out.push(d);}return out;}
function workDays(j){const off=j.i.off||[];return spanDays(j.i).filter(d=>!off.includes(d));}
/* 그날 들어가는 시공자: 날짜별로 따로 정했으면 그 사람들, 아니면 기본 시공자 */
const crewOn=(j,d)=>Array.isArray(j.i.days&&j.i.days[d])?j.i.days[d]:j.i.crew;
const crewAll=j=>{const wd=workDays(j);return wd.length?[...new Set(wd.flatMap(d=>crewOn(j,d)))]:j.i.crew;};
const noCrewDays=j=>workDays(j).filter(d=>!crewOn(j,d).length);
const dayCustom=j=>Object.keys(j.i.days||{}).length>0||(j.i.off||[]).length>0;
/* 현장 상태: 종료(시공 마감 완료 체크, 또는 종료 처리) · 진행중(시공 시작한 뒤) · 대기중(시공 전, 날짜 미정 포함).
   정산(수금·매입)과는 따로: 수금이 남아도 시공이 끝나면 종료 현장 */
const ended=j=>!!(j.f.done||j.f.closed);
const jobStage=j=>ended(j)?"end":j.i.start&&j.i.start<=TODAY?"run":"wait";
const JOB_STAGE={wait:"대기중",run:"진행중",end:"종료"};
const stageTag=j=>{const s=jobStage(j);return`<span class="tag st-${s}">${JOB_STAGE[s]}</span>`;};
/* 진행 흐름: 문의 → 실측 → 설계·견적 → 도면 확정 → 생산 → 시공 대기 → 시공 → 정산 → 완료. 달력에는 넣지 않음.
   지금 단계 = 기록된 가장 뒤 단계의 다음. 시공일이 잡힌 현장은 계약한 것으로 봄. 정산 단계는 관리자에게만 */
const FLOW=[["ask","문의"],["msr","실측"],["des","설계·견적"],["dwg","도면 확정"],["prd","생산"],["rdy","시공 대기"],["ins","시공"],["set","정산"],["done","완료"]];
const FLOW_NAME=Object.fromEntries(FLOW);
const contracted=j=>!!(j.i.fl.ct||j.i.start);
function flowStage(j){const fl=j.i.fl;
  if(ended(j)){const m=moneyOf(j.id);return isAdmin&&billTotal(m)>0&&!settledM(m)?"set":"done";}
  if(j.i.start&&j.i.start<=TODAY)return"ins";
  if(fl.pr.ok)return"rdy";if(fl.dw.ok)return"prd";if(contracted(j))return"dwg";
  return j.m.done?"des":j.m.date?"msr":"ask";}
const flowTag=j=>{const s=flowStage(j);return`<span class="tag fl-tag fl-${s}">${FLOW_NAME[s]}</span>`;};
/* 지나온 표시: 실측 · 계약 · 도면 확정 · 생산 · 시공 · 마감 · 정산(관리자, 계약금액 있을 때) */
function flowSteps(j){const fl=j.i.fl,lw=lastWork(j),started=!!(j.i.start&&j.i.start<=TODAY);
  const s=[{l:"실측",ok:j.m.done,on:j.m.date,plan:j.m.date?`${fmt(j.m.date)} 예정`:"",due:j.m.date},
    {l:"계약",ok:contracted(j),on:j.i.fl.ct},
    {l:"도면 확정",ok:!!fl.dw.ok,on:fl.dw.ok,plan:fl.dw.due?`${fmt(fl.dw.due)}까지`:"",due:fl.dw.due},
    {l:"생산",ok:!!fl.pr.ok,on:fl.pr.ok,plan:fl.pr.due?`납기 ${fmt(fl.pr.due)}`:"",due:fl.pr.due},
    {l:"시공",ok:started,on:j.i.start,plan:j.i.start?`${fmt(j.i.start)} 시작`:""},
    {l:"마감",ok:ended(j),plan:lw?`${fmt(lw)} 끝`:"",due:lw}];
  if(isAdmin){const m=moneyOf(j.id);if(billTotal(m)>0){const u=unpaidOf(m);s.push({l:"정산",ok:settledM(m),plan:u?`미수 ${won(u)}`:costIn(m)?"":"매입 입력 전"});}}
  const last=s.map(x=>x.ok).lastIndexOf(true);
  s.forEach((x,i)=>{x.c=x.ok?"ok":i<last?"gap":i===last+1?"cur":"todo";x.late=x.c==="cur"&&!!x.due&&x.due<TODAY;});
  return s;}
function flowStrip(j){return`<ol class="fl-steps">${flowSteps(j).map(x=>{const d=x.ok?(x.on?fmt(x.on):""):x.c==="gap"?"기록 없음":x.plan||"";
  return`<li class="${x.c}${x.late?" late":""}"><span class="fl-l">${x.ok?"✓ ":""}${x.l}</span>${d?`<span class="fl-d">${d}</span>`:""}</li>`;}).join("")}</ol>`;}
function flowBar(j){const s=flowSteps(j);
  return`<span class="fl-bar" role="img" aria-label="${s.map(x=>`${x.l} ${x.ok?"됨":x.c==="gap"?"기록 없음":"전"}`).join(", ")}">${s.map(x=>`<i class="${x.c}"></i>`).join("")}</span>`;}
const range=j=>{if(!j.i.start)return"";const one=!j.i.end||j.i.end===j.i.start;const n=workDays(j).length;
  return (one?fmtW(j.i.start):`${fmtW(j.i.start)}~${fmtW(j.i.end)}`)+(one?"":` <span class="wk">· 작업 ${n}일</span>`);};
const COLORS=["orange","banana","avocado"];
const kc=j=>"k-"+(COLORS.includes(j.i.color)?j.i.color:"orange");
const asOpen=j=>j.f.as.filter(a=>!a.done);
const extraSum=j=>j.f.extra.reduce((a,e)=>a+(+e.people||0),0);
const noCrewSoon=j=>!ended(j)&&noCrewDays(j).some(d=>d>=TODAY&&d<=addDays(TODAY,7));
const thisWeek=j=>workDays(j).some(d=>d>=TODAY&&d<=addDays(TODAY,6));
function norm(id,d){d=d||{};return{id,name:d.name||"",item:d.item||"",addr:d.addr||"",
  m:{date:d.m?.date||"",done:!!d.m?.done},i:{start:d.i?.start||"",end:d.i?.end||"",crew:Array.isArray(d.i?.crew)?d.i.crew:[],sat:!!d.i?.sat,sun:!!d.i?.sun,color:COLORS.includes(d.i?.color)?d.i.color:"orange",
    gate:d.i?.gate||"",door:d.i?.door||"",tel:typeof d.i?.tel==="string"?d.i.tel:"",mgr:Array.isArray(d.i?.mgr)?d.i.mgr:[],days:normDays(d.i?.days),off:(Array.isArray(d.i?.off)?d.i.off:[]).filter(isDate),
    apps:(Array.isArray(d.i?.apps)?d.i.apps:[]).filter(a=>a&&a.id).map(a=>({id:String(a.id),type:a.type||"",model:a.model||"",spec:a.spec||"",...(typeof a.join==="boolean"?{join:a.join}:{})})),
    chk:Array.isArray(d.i?.chk)?d.i.chk.map(String).filter(Boolean):[],fl:normFl(d.i?.fl)},
  f:{done:!!d.f?.done,extra:Array.isArray(d.f?.extra)?d.f.extra:[],as:Array.isArray(d.f?.as)?d.f.as:[],closed:isDate(d.f?.closed)?d.f.closed:"",closedBy:d.f?.closedBy==="auto"?"auto":d.f?.closed?"manual":""},createdAt:d.created_at||""};}
const isDate=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v);
/* 도면 · 생산 (진행 흐름). jobs.i.fl 에 둠 (새 칸 없이): ct 계약일(수금에서 가져옴) · dw 설계 담당·도면 확정 목표일·확정일 · pr 생산 방식·외주처·납기·생산 완료일 */
const PR_HOW={own:"자체 공장",out:"외주",both:"자체 + 외주"};
function normFl(x){x=x&&typeof x==="object"?x:{};const dw=x.dw||{},pr=x.pr||{},str=v=>typeof v==="string"?v:"",dt=v=>isDate(v)?v:"";
  return{ct:dt(x.ct),dw:{by:str(dw.by),due:dt(dw.due),ok:dt(dw.ok)},pr:{how:PR_HOW[pr.how]?pr.how:"",out:str(pr.out),due:dt(pr.due),ok:dt(pr.ok)}};}
function normDays(o){const out={};if(o&&typeof o==="object")for(const k in o)if(isDate(k)&&Array.isArray(o[k]))out[k]=o[k].map(String).filter(Boolean);return out;}

/* 돈: 계약금액·입금·원가 (관리자만) */
const toNum=v=>+String(v??"").replace(/[^\d]/g,"")||0;
const comma=n=>n?n.toLocaleString("ko-KR"):"";
const won=n=>`${(n<0?"-":"")+Math.abs(n).toLocaleString("ko-KR")}원`;
const pct=(a,b)=>b?`${Math.round(a/b*100)}%`:"—";
/* 받을 날 자동: 계약금 = 계약일, 중도금 = 시공 시작일, 잔금 = 시공 끝나는 날(마지막 작업일).
   받을 날이 비어 있는 입금에만 넣고(auto 표시), 그 뒤 일정이 바뀌면 따라 바뀜. 받을 날을 직접 고치면 자동이 풀림 */
const AUTO_KINDS=["contract","start","end"],AUTO_OF={계약금:"contract",중도금:"start",잔금:"end"},AUTO_TXT={contract:"계약일",start:"시공 시작일",end:"시공 끝나는 날"};
const autoDate=(j,m,k)=>k==="contract"?m.contract.date:!j?"":k==="start"?j.i.start:(lastWork(j)||j.i.end);
function fillDues(j,m){let ch=false;
  const pays=m.pays.map(p=>{if(p.paid)return p;const k=p.auto||(!p.due&&AUTO_OF[p.label])||"";if(!k)return p;
    const d=autoDate(j,m,k)||"";if(!p.auto&&!d)return p;if(p.auto===k&&p.due===d)return p;ch=true;return{...p,auto:k,due:d};});
  return ch?{...m,pays}:null;}
function normMoney(d){d=d||{};const c=d.contract||{};
  return{contract:{date:c.date||"",amount:toNum(c.amount),vat:!!c.vat},
    pays:(Array.isArray(d.pays)?d.pays:[]).map(p=>({label:p.label||"계약금",amount:toNum(p.amount),due:p.due||"",paid:!!p.paid,paidOn:p.paidOn||"",...(AUTO_KINDS.includes(p.auto)?{auto:p.auto}:{})})),
    costs:(Array.isArray(d.costs)?d.costs:[]).map(normCost)};}
/* 매입 한 줄: 항목·금액·메모 + (있을 때만) 거래처 v, 매입일 d, 입고 예정 due, 입고일 got, 지급 paid·paidOn */
function normCost(x){x=x||{};const o={cat:x.cat||COST_CATS[0],amount:toNum(x.amount),note:x.note||""},v=String(x.v||"").trim();
  if(v)o.v=v;["d","due","got"].forEach(k=>{if(isDate(x[k]))o[k]=x[k];});
  if(x.paid){o.paid=true;o.paidOn=isDate(x.paidOn)?x.paidOn:"";}
  return o;}
const moneyOf=id=>money[id]||normMoney();
const billTotal=m=>Math.round(m.contract.amount*(m.contract.vat?1.1:1));
const received=m=>m.pays.filter(p=>p.paid).reduce((a,p)=>a+p.amount,0);
const unpaidOf=m=>Math.max(0,billTotal(m)-received(m));
const costSum=m=>m.costs.reduce((a,x)=>a+x.amount,0);
const overdue=m=>m.pays.filter(p=>!p.paid&&p.due&&p.due<TODAY);
const hasMoney=m=>m.contract.amount>0||m.pays.length>0||m.costs.length>0;
function payTotals(){let bill=0,recv=0,unpaid=0,lateN=0,lateAmt=0;
  jobs.forEach(j=>{const m=moneyOf(j.id);bill+=billTotal(m);recv+=received(m);unpaid+=unpaidOf(m);overdue(m).forEach(p=>{lateN++;lateAmt+=p.amount})});
  return{bill,recv,unpaid,lateN,lateAmt};}
function payTag(j){const m=moneyOf(j.id),t=billTotal(m);if(!t)return`<span class="hint">미입력</span>`;
  const u=unpaidOf(m);if(!u)return`<span class="tag ok">완납</span>`;
  return overdue(m).length?`<span class="tag late">지연 · 미수 ${won(u)}</span>`:`<span class="tag soon">미수 ${won(u)}</span>`;}

/* 시공자별: 사람 → 날짜 → 그날 들어가는 현장/AS */
function crewMap(from,to){const map={};const add=(n,d,it)=>{(map[n]??={});(map[n][d]??=[]).push(it)};
  jobs.forEach(j=>{workDays(j).forEach(d=>{if(d<from||d>to)return;const cr=crewOn(j,d);if(cr.length)cr.forEach(c=>add(c,d,{t:"i",j}));else add("",d,{t:"i",j});});
    j.f.as.forEach(a=>{if(a.date&&a.date>=from&&a.date<=to)add(a.crew||"",a.date,{t:"a",j,a});});});
  return map;}
const clashAt=items=>new Set(items.filter(x=>!(x.t==="a"&&x.a.done)).map(x=>x.j.id)).size>=2;
function clashList(from,to){const m=crewMap(from,to),out=[];
  for(const n in m){if(!n)continue;for(const d in m[n])if(clashAt(m[n][d]))out.push({n,d});}return out;}

function measureTag(j){if(!j.m.date)return`<span class="tag wait">날짜 미정</span>`;
  if(j.m.done)return`<span class="tag ok">완료</span>`;
  return j.m.date<TODAY?`<span class="tag late">지남·미완료</span>`:`<span class="tag wait">예정</span>`;}
function crewHtml(j){if(!j.i.start)return`<span class="tag wait">시공일 미정</span>`;
  const all=crewAll(j),none=noCrewDays(j).length;
  if(!all.length)return`<span class="tag ${noCrewSoon(j)?"late":"soon"}">미배정</span>`;
  return`<span class="tag ok">배정</span><span class="crew">${all.map(esc).join(", ")}</span>`+(none?`<span class="tag ${noCrewSoon(j)?"late":"soon"}">미배정 ${none}일</span>`:"")+(dayCustom(j)?`<span class="hint">날짜별</span>`:"");}
function finishTag(j){if(j.f.done)return`<span class="tag ok">완료</span>`;
  if(j.i.end&&j.i.end<TODAY)return`<span class="tag soon">마감 중</span>`;
  return`<span class="tag wait">시공 전</span>`;}
function asTag(j){const o=asOpen(j);if(!o.length)return"";const next=o.map(a=>a.date).filter(Boolean).sort()[0];
  return`<span class="tag ${next&&next<TODAY?"late":"soon"}">AS ${o.length}건${next?` · ${fmt(next)}`:""}</span>`;}
function extraHtml(j){const n=extraSum(j);if(!n)return`<span class="hint">없음</span>`;
  return`<span class="tag soon">+${n}명 · ${j.f.extra.length}회</span>`;}

const filesOf=(jobId,kind)=>files.filter(f=>f.job_id===jobId&&(!kind||f.kind===kind));
function fileCount(j){const parts=[["drawing","도면"],["estimate","견적"],["photo","사진"]].map(([k,l])=>{const n=filesOf(j.id,k).length;return n?`${l} ${n}`:""}).filter(Boolean);
  return parts.length?`<span class="fcount">${parts.join(" · ")}</span>`:`<span class="hint">없음</span>`;}
const fsize=b=>b>=1048576?(b/1048576).toFixed(1)+"MB":Math.max(1,Math.round(b/1024))+"KB";

/* 위쪽 분류: 누르면 현장 목록을 그 분류만 보여 줌 (다시 누르면 전체). 기본은 종료 현장을 뺀 전체 */
let boardCat="";
function catDefs(){const m=crewMap(TODAY,addDays(TODAY,60)),clash=new Set();
  for(const n in m){if(!n)continue;for(const d in m[n])if(clashAt(m[n][d]))m[n][d].forEach(x=>clash.add(x.j.id));}
  return[["wait","대기중인 현장","",j=>jobStage(j)==="wait"],["run","진행중인 현장","",j=>jobStage(j)==="run"],["end","종료 현장","",j=>jobStage(j)==="end"],
    ["as","AS","soon",j=>asOpen(j).length>0],["nocrew","시공자 미배정","late",j=>!ended(j)&&noCrewDays(j).some(d=>d>=TODAY)],["clash","시공자 겹침","late",j=>clash.has(j.id)]];}
/* 진행 흐름 화면 (현장 묶음): 단계별 현장 수 + 단계별 목록과 다음 할 일. 단계를 누르면 그 단계만, 완료는 눌러야 보임 */
let flowCat="";
const flowKey=(j,k)=>(k==="msr"?j.m.date:k==="dwg"?j.i.fl.dw.due:k==="prd"?j.i.fl.pr.due:k==="rdy"||k==="ins"?j.i.start:"")||"9"+j.name;
function flowNext(j,st){const fl=j.i.fl,lw=lastWork(j);let t="",late=false,tags="";
  if(st==="ask")t="실측일 잡기";
  else if(st==="msr"){t=`실측 ${fmtW(j.m.date)}`;late=j.m.date<TODAY;}
  else if(st==="des"){const es=isAdmin&&est10?estOfJob(j.id):[],e=es[es.length-1];t=e?`견적 ${estTag(e)}`:"도면·견적 → 계약";}
  else if(st==="dwg"){t=`도면 확정 ${fl.dw.due?`${fmtW(fl.dw.due)}까지`:"목표일 없음"}`;late=!!fl.dw.due&&fl.dw.due<TODAY;}
  else if(st==="prd"){t=`납기 ${fl.pr.due?fmtW(fl.pr.due):"미정"}${fl.pr.how?` · ${PR_HOW[fl.pr.how]}`:""}${fl.pr.out?` ${esc(fl.pr.out)}`:""}`;late=!!fl.pr.due&&fl.pr.due<TODAY;}
  else if(st==="rdy")t=j.i.start?`시공 ${fmtW(j.i.start)}`:"시공일 잡기";
  else if(st==="ins"){late=!!lw&&lw<TODAY;t=late?`시공 끝 ${fmt(lw)} · 마감 완료 체크 전`:`시공 중 · ${fmt(lw)}까지`;}
  else if(st==="set"){const u=unpaidOf(moneyOf(j.id));t=u?`미수 ${won(u)}`:"매입 입력 전";}
  if((st==="dwg"||st==="prd")&&j.i.start&&j.i.start<=addDays(TODAY,7))tags+=`<span class="tag late">시공 ${fmt(j.i.start)}</span>`;
  if(prLate(j))tags+=`<span class="tag late">납기가 시공보다 늦음</span>`;
  if(fl.dw.by&&(st==="des"||st==="dwg"))tags+=`<span class="hint">설계 ${esc(fl.dw.by)}</span>`;
  return{t,late,tags};}
function renderFlow(){if(!loaded)return;
  const st=new Map(jobs.map(j=>[j.id,flowStage(j)])),stages=FLOW.filter(([k])=>k!=="set"||isAdmin),cnt=k=>jobs.filter(j=>st.get(j.id)===k).length;
  if(!stages.some(([k])=>k===flowCat))flowCat="";
  $("flCats").innerHTML=stages.map(([k,l],i)=>`${i?`<span class="fl-arr" aria-hidden="true">›</span>`:""}<button class="chip${k===flowCat?" on":""}" type="button" data-flcat="${k}" aria-pressed="${k===flowCat}">${l} <b>${cnt(k)}</b></button>`).join("");
  let h="";
  stages.filter(([k])=>flowCat?k===flowCat:k!=="done").forEach(([k,l])=>{const list=jobs.filter(j=>st.get(j.id)===k).map(j=>({j,x:flowNext(j,k)}));if(!list.length)return;
    list.sort((a,b)=>(b.x.late-a.x.late)||flowKey(a.j,k).localeCompare(flowKey(b.j,k)));
    h+=`<div class="fl-grp"><h3>${l} <span class="hint">${list.length}곳</span></h3><ul class="dlist fl-list">${list.map(({j,x})=>`<li data-j="${esc(j.id)}" tabindex="0" role="button"><div><b>${esc(j.name)}</b>${sub(j)?`<small>${sub(j)}</small>`:""}${flowBar(j)}<div class="dmeta"><span class="${x.late?"fl-late":""}">${x.t}</span>${x.late?`<span class="tag late">지남</span>`:""}${x.tags}</div></div></li>`).join("")}</ul></div>`;});
  $("flList").innerHTML=h||`<div class="empty">${flowCat?"이 단계에 있는 현장이 없어요.":"진행 중인 현장이 없어요."}</div>`;
  const doneN=cnt("done");
  $("flNote").innerHTML=flowCat?`<b>${FLOW_NAME[flowCat]}</b>만 보고 있어요. <button class="linkish" type="button" data-flcat="${flowCat}">전체 보기</button>`:doneN?`완료된 현장 ${doneN}곳은 위의 <b>완료</b>를 누르면 보여요.`:"";
  $("flNote").hidden=!$("flNote").innerHTML;}
document.addEventListener("click",e=>{const c=e.target.closest("[data-flcat]");if(!c)return;flowCat=flowCat===c.dataset.flcat?"":c.dataset.flcat;renderFlow();});
/* 현장 검색: 이름·품목·주소·고객 전화·시공자·현장 담당자. 검색할 때는 종료 현장도 같이 찾음. 전화는 숫자만 맞아도 찾음 */
let boardQ="";
function qHit(j){const q=boardQ.trim().toLowerCase();if(!q)return true;
  if([j.name,j.item,j.addr,j.i.tel,...crewAll(j),...j.i.mgr].join(" ").toLowerCase().includes(q))return true;
  const d=q.replace(/[^\d]/g,"");return d.length>=3&&d.length===q.replace(/[\s-]/g,"").length&&[j.i.tel,...j.i.mgr].some(t=>String(t||"").replace(/\D/g,"").includes(d));}
function render(){renderBoard();renderFlow();
  renderCal();renderCrew();
  if(isAdmin){renderPay();renderVend();renderSales();renderWage();renderEst();}
  $("vendList").innerHTML=isAdmin?vendNames().map(n=>`<option value="${esc(n)}">`).join(""):"";
  renderHome();
  if(viewing)renderView();
}
function renderBoard(){
  const cats=catDefs(),cur=cats.find(c=>c[0]===boardCat);if(!cur)boardCat="";
  $("summary").innerHTML=cats.map(([k,label,tone,fn])=>{const n=jobs.filter(fn).length;
    return`<button class="chip ${n&&tone?tone:""}${k===boardCat?" on":""}" type="button" data-cat="${k}" aria-pressed="${k===boardCat}">${label} <b>${n}</b></button>`;}).join("");
  const q=boardQ.trim(),shown=(cur?jobs.filter(cur[3]):q?jobs:jobs.filter(j=>!ended(j))).filter(qHit),closedN=jobs.filter(ended).length;
  $("catNote").innerHTML=q?`‘${esc(q)}’ 검색 결과 ${shown.length}곳${cur?` (<b>${cur[1]}</b> 안에서)`:" (종료 현장 포함)"}. <button class="linkish" type="button" id="qClear">검색 지우기</button>`
    :cur?`<b>${cur[1]}</b>만 보고 있어요 (${shown.length}곳). <button class="linkish" type="button" data-cat="${cur[0]}">전체 보기</button>`
    :closedN?`종료된 현장 ${closedN}곳은 위의 <b>종료 현장</b>을 누르면 보여요.`:"";
  $("catNote").hidden=!$("catNote").innerHTML;
  const key=j=>(noCrewSoon(j)?"0":"1")+(ended(j)?"1":"0")+(j.i.start||j.m.date||"9"),endDay=j=>j.f.closed||lastWork(j)||"";
  const sorted=[...shown].sort((a,b)=>boardCat==="end"?endDay(b).localeCompare(endDay(a)):key(a).localeCompare(key(b)));
  $("catEmpty").hidden=!(loaded&&jobs.length&&!sorted.length);$("catEmpty").textContent=q?`‘${q}’에 맞는 현장이 없어요.`:"이 분류에 해당하는 현장이 없어요.";
  const empty=loaded&&!jobs.length;
  $("empty").hidden=!empty;
  $("thead").innerHTML=`<tr><th>현장</th><th>실측일</th><th>시공 기간</th><th>시공자</th><th>마감</th><th>추가 투입</th><th>파일 · 사진</th>${isAdmin?"<th>수금</th>":""}</tr>`;
  $("tbody").innerHTML=sorted.map(j=>`<tr data-j="${esc(j.id)}" tabindex="0">
    <td class="job"><b>${esc(j.name)} ${stageTag(j)}</b><small>${sub(j)}</small></td>
    <td><div class="cell"><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</div></td>
    <td><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></td>
    <td><div class="cell">${crewHtml(j)}</div></td>
    <td><div class="cell">${finishTag(j)}${asTag(j)}${clTag(j)}</div></td>
    <td>${extraHtml(j)}</td>
    <td>${fileCount(j)}</td>${isAdmin?`<td>${payTag(j)}</td>`:""}</tr>`).join("");
  $("cards").innerHTML=sorted.map(j=>`<button class="card ${noCrewSoon(j)?"flag":""}" data-j="${esc(j.id)}">
    <div class="job"><b>${esc(j.name)} ${stageTag(j)}</b><small>${sub(j)}</small></div>
    <dl class="kv">
      <dt>실측</dt><dd><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</dd>
      <dt>시공</dt><dd><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></dd>
      <dt>시공자</dt><dd>${crewHtml(j)}</dd>
      <dt>마감</dt><dd>${finishTag(j)}${extraSum(j)?extraHtml(j):""}${asTag(j)}${clTag(j)}</dd>
      <dt>파일</dt><dd>${fileCount(j)}</dd>${isAdmin?`<dt>수금</dt><dd>${payTag(j)}</dd>`:""}
    </dl></button>`).join("");
}
$("q").addEventListener("input",()=>{boardQ=$("q").value;renderBoard();});
$("q").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("q").blur();}if(e.key==="Escape"&&$("q").value){$("q").value="";boardQ="";renderBoard();}});
document.addEventListener("click",e=>{if(e.target.id==="qClear"){$("q").value="";boardQ="";renderBoard();}});
/* 월별 달력: 보기 전용. 날짜를 누르면 그날 일정만 보여줌 (수정은 현장 목록에서) */
let selDay="",dayFrom=null;
function dayItems(ds){const out=[];
  jobs.forEach(j=>{if(j.m.date===ds)out.push({t:"m",j});});
  jobs.forEach(j=>{if(workDays(j).includes(ds))out.push({t:"i",j});});
  jobs.forEach(j=>j.f.as.forEach(a=>{if(a.date===ds)out.push({t:"a",j,a});}));
  jobs.forEach(j=>j.f.extra.forEach(x=>{if(x.date===ds)out.push({t:"x",j,x});}));
  return out;}
function renderCal(){
  $("calTitle").textContent=`${calY}년 ${calM+1}월`;
  const first=new Date(calY,calM,1),start=new Date(first);start.setDate(1-first.getDay());
  let h="일월화수목금토".split("").map(d=>`<div class="dow">${d}</div>`).join("");
  const cells=Math.ceil((first.getDay()+new Date(calY,calM+1,0).getDate())/7)*7;
  for(let k=0;k<cells;k++){const d=new Date(start);d.setDate(start.getDate()+k);
    const ds=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const items=dayItems(ds);
    const ev=items.map(x=>{const j=x.j;
      if(x.t==="m")return`<div class="ev m"><span class="evp">실측 </span>${short(j)}</div>`;
      if(x.t==="i"){const cr=crewOn(j,ds),who=cr.length?cr.join("·"):"미배정";return`<div class="ev i ${kc(j)} ${cr.length?"":"none"}">${short(j)}<span class="evc"> · ${esc(who)}</span></div>`;}
      if(x.t==="a")return`<div class="ev a ${x.a.done?"done":""}"><span class="evp">AS </span>${short(j)}<span class="evc">${x.a.crew?` · ${esc(x.a.crew)}`:""}</span></div>`;
      return`<div class="ev x ${kc(j)}">+${+x.x.people}명 ${short(j)}</div>`;}).join("");
    const we=d.getDay()===0||d.getDay()===6;
    h+=`<div class="day ${d.getMonth()!==calM?"other":""} ${ds===TODAY?"today":""} ${we?"we":""} ${ds===selDay?"sel":""}" data-day="${ds}" role="button" tabindex="0" aria-label="${d.getMonth()+1}월 ${d.getDate()}일 일정 ${items.length}건"><span class="n">${d.getDate()}</span>${ev}</div>`;}
  $("cal").innerHTML=h;
}
function openDay(ds){selDay=ds;
  const [y,m]=ds.split("-").map(Number);if(y!==calY||m-1!==calM){calY=y;calM=m-1;}
  renderCal();
  const items=dayItems(ds),by=t=>items.filter(x=>x.t===t);
  const place=j=>sub(j)?`<small>${sub(j)}</small>`:"";
  const sec=(title,list,fn)=>list.length?`<div class="dsec"><h3>${title} <span class="hint">${list.length}곳</span></h3><ul class="dlist">${list.map(fn).join("")}</ul></div>`:"";
  $("dayTitle").innerHTML=`${+ds.slice(5,7)}월 ${+ds.slice(8)}일 <span class="wk">(${WD[dow(ds)]})</span>`;
  $("dayBody").innerHTML=(
    sec("시공",by("i"),x=>{const wd=workDays(x.j),k=wd.indexOf(ds)+1;
      const cr=crewOn(x.j,ds);
      return`<li><i class="dot k ${kc(x.j)}"></i><div>${jvName(x.j)}${place(x.j)}<div class="dmeta">${cr.length?`시공자 ${cr.map(esc).join(", ")}`:`<span class="tag late">시공자 미배정</span>`}<span class="hint">${wd.length>1?`작업 ${wd.length}일 중 ${k}일째`:"하루 작업"}</span></div><button class="btn ghost sm cp-msg" type="button" data-msg="${esc(x.j.id)}">시공자 문자 복사</button>${clOf(x.j.id)?` <button class="btn ghost sm cp-msg" type="button" data-clmsg="${esc(x.j.id)}">체크리스트 문자 복사</button>`:""}</div></li>`})+
    sec("실측",by("m"),x=>`<li><i class="dot" style="background:var(--c-measure)"></i><div>${jvName(x.j)}${place(x.j)}<div class="dmeta">${x.j.m.done?`<span class="tag ok">실측 완료</span>`:`<span class="tag wait">실측 예정</span>`}</div></div></li>`)+
    sec("AS",by("a"),x=>`<li><i class="dot" style="background:var(--c-as)"></i><div>${jvName(x.j)}${place(x.j)}<div class="dmeta">담당 ${esc(x.a.crew||"미정")}${x.a.note?` · ${esc(x.a.note)}`:""}${x.a.done?` <span class="tag ok">완료</span>`:""}</div></div></li>`)+
    sec("마감 추가 투입",by("x"),x=>`<li><i class="dot ring ${kc(x.j)}"></i><div>${jvName(x.j)}${place(x.j)}<div class="dmeta">추가 ${+x.x.people}명${x.x.note?` · ${esc(x.x.note)}`:""}</div></div></li>`)
  )||`<p class="sub" style="margin:0">이날은 잡힌 일정이 없어요.</p>`;
  if($("daySheet").hidden){dayFrom=document.activeElement;$("daySheet").hidden=false;document.body.style.overflow="hidden";$("dayClose").focus();}
}
function closeDay(){$("daySheet").hidden=true;document.body.style.overflow="";selDay="";renderCal();
  if(dayFrom&&dayFrom.isConnected&&dayFrom.focus)dayFrom.focus({preventScroll:true});dayFrom=null;}
document.addEventListener("click",e=>{const c=e.target.closest("[data-day]");if(c)openDay(c.dataset.day);});
document.addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&e.target.dataset&&e.target.dataset.day){e.preventDefault();openDay(e.target.dataset.day);return;}
  if($("daySheet").hidden)return;
  if(e.key==="Escape")closeDay();});
$("dayClose").onclick=closeDay;
$("dayPrev").onclick=()=>openDay(addDays(selDay,-1));
$("dayNext").onclick=()=>openDay(addDays(selDay,1));
$("daySheet").addEventListener("click",e=>{if(e.target===$("daySheet"))closeDay();});

/* 현장 보기: 목록에서 누르면 먼저 내용만 보여 주고, '수정'을 눌러야 입력 화면이 열림 (휴대폰 키패드가 바로 뜨지 않게) */
let viewing=null,viewFrom=null;
const jvName=j=>`<button type="button" class="linkish jv-name" data-jv="${esc(j.id)}">${esc(j.name)}</button>`;
/* 정산·결산 화면에서 현장을 누르면 '정산 보기'(수금·매입·이익·견적서·종료만), 그 밖에서는 '현장 보기' */
let viewMode="site",msAdd=false,msErr="";
const MONEY_TABS=["pay","wage","vend","sales","exp"];
const costIn=m=>m.costs.length>0;
/* 정산 종료: 받을 돈을 다 받았고 매입을 입력함 (일당으로 자동 계산된 인건비는 매입 입력으로 안 침). 현장 종료와는 따로 */
const settledM=m=>billTotal(m)>0&&!unpaidOf(m)&&costIn(m);
const settleTag=j=>settledM(moneyOf(j.id))?`<span class="tag st-end">정산 종료</span>`:`<span class="tag st-run">정산 중</span>`;
function openView(j,mode){viewing=j.id;qc={jid:j.id,done:[],err:""};msAdd=false;msErr="";
  viewMode=isAdmin&&(mode==="money"||(!mode&&MONEY_TABS.includes(curTab)))?"money":"site";renderView();
  if($("jobSheet").hidden){viewFrom=document.activeElement;$("jobSheet").hidden=false;document.body.style.overflow="hidden";$("jvClose").focus({preventScroll:true});}}
function closeView(){$("jobSheet").hidden=true;viewing=null;qc={jid:"",done:[],err:""};if($("daySheet").hidden)document.body.style.overflow="";
  if(viewFrom&&viewFrom.isConnected&&viewFrom.focus)viewFrom.focus({preventScroll:true});viewFrom=null;}
function renderView(){const j=jobs.find(x=>x.id===viewing);if(!j){if(!$("jobSheet").hidden)closeView();return;}
  if(viewMode==="money"&&isAdmin)return renderMoneyView(j);
  const kv=(k,v)=>v?`<dt>${k}</dt><dd>${v}</dd>`:"",li=a=>a.length?`<ul class="jv-list">${a.map(x=>`<li>${x}</li>`).join("")}</ul>`:"";
  const off=j.i.off||[],days=dayCustom(j)?spanDays(j.i).map(d=>{const cr=crewOn(j,d);return`<span class="d">${fmtW(d)}</span> ${off.includes(d)?`<span class="tag wait">쉬는 날</span>`:cr.length?cr.map(esc).join(", "):`<span class="tag late">미배정</span>`}`;}):[];
  const c=clOf(j.id),apps=j.i.apps.filter(a=>a.model||a.type);
  $("jvTitle").innerHTML=`${esc(j.name)} ${stageTag(j)}`;
  let h=sub(j)?`<p class="sub" style="margin:0">${sub(j)}</p>`:"";
  if(j.i.tel)h+=`<div class="jv-tel"><span>고객 전화</span><b class="d">${esc(j.i.tel)}</b>${telBtns(j.i.tel)}</div>`;
  const fl=j.i.fl,flm=[fl.dw.by&&`설계 ${esc(fl.dw.by)}`,fl.pr.how&&`생산 ${PR_HOW[fl.pr.how]}${fl.pr.out?` (${esc(fl.pr.out)})`:""}`].filter(Boolean);
  h+=`<div class="dsec jv-flow"><h3>진행 단계 ${flowTag(j)}</h3>${flowStrip(j)}${flm.length?`<p class="sub" style="margin:0">${flm.join(" · ")}</p>`:""}${prLate(j)?`<p class="ms-warn">납기(${fmt(fl.pr.due)})가 시공 시작(${fmt(j.i.start)})보다 늦어요.</p>`:""}</div>`;
  h+=qcHtml(j);
  h+=`<div class="dsec"><h3>일정</h3><dl class="kv">${kv("실측",`<span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}`)}${kv("시공",`<span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span>`)}
    ${kv("시공자",crewHtml(j))}${kv("마감",`${finishTag(j)}${extraSum(j)?extraHtml(j):""}`)}</dl>${days.length?`<h3 style="margin-top:8px">날짜별 시공자</h3>${li(days)}`:""}</div>`;
  if(j.f.extra.length)h+=`<div class="dsec"><h3>마감 추가 투입</h3>${li(j.f.extra.map(x=>`<span class="d">${fmtW(x.date)}</span> ${+x.people}명${x.note?` · ${esc(x.note)}`:""}`))}</div>`;
  if(j.f.as.length)h+=`<div class="dsec"><h3>AS</h3>${li(j.f.as.map(a=>`<span class="d">${fmtW(a.date)}</span> 담당 ${esc(a.crew||"미정")}${a.note?` · ${esc(a.note)}`:""} ${a.done?`<span class="tag ok">완료</span>`:`<span class="tag soon">예정</span>`}`))}</div>`;
  h+=`<div class="dsec"><h3>현장 출입</h3><dl class="kv">${kv("공동현관",esc(j.i.gate)||"—")}${kv("세대현관",esc(j.i.door)||"—")}${kv("담당자",j.i.mgr.map(esc).join(", ")||"—")}</dl>
    <div class="jv-btns"><button class="btn ghost sm" type="button" data-msg="${esc(j.id)}">시공자 문자 복사</button>${c?`<button class="btn ghost sm" type="button" data-clmsg="${esc(j.id)}">체크리스트 문자 복사</button>`:""}</div></div>`;
  const more=[kv("가전",apps.map(a=>esc(`${NEST_CL.typeName(NEST_CL.appType(a))}${a.model?` ${a.model}`:""}`)).join(", ")),kv("체크리스트",c?(clTag(j)||(c.status==="submitted"?`<span class="tag ok">제출됨</span>`:`<span class="tag wait">링크 보냄</span>`)):""),kv("파일",fileCount(j))].join("");
  if(more)h+=`<div class="dsec"><h3>가전 · 체크리스트 · 파일</h3><dl class="kv">${more}</dl></div>`;
  if(isAdmin){const m=moneyOf(j.id),b=billTotal(m),cost=jobCost(j),labor=jobLabor(j),buy=cost-labor;
    if(b||cost)h+=`<div class="dsec"><h3>수금 · 매입 ${b?settleTag(j):""}</h3><dl class="kv">${kv("받을 돈",won(b))}${kv("받은 돈",won(received(m)))}${kv("미수금",b?payTag(j):"")}${kv("매입",costIn(m)?won(buy):`${buy?`${won(buy)} `:""}<span class="tag late">매입 입력 안 됨</span>`)}${kv("시공비",labor?won(labor):"")}${kv("거래처 미지급",vendDue(m)?won(vendDue(m)):"")}${kv("입고 대기",(n=>n?`${n}건${m.costs.some(x=>gotWait(x)&&x.due<TODAY)?` <span class="tag late">늦음</span>`:""}`:"")(m.costs.filter(gotWait).length))}${kv("이익",m.contract.amount?`${won(m.contract.amount-cost)} <span class="hint">${pct(m.contract.amount-cost,m.contract.amount)}</span>`:"")}</dl><div class="jv-btns"><button class="btn ghost sm" type="button" data-vmode="money">정산 보기</button></div></div>`;
    if(est10){const es=estOfJob(j.id);h+=`<div class="dsec"><h3>견적서</h3>${li(es.map(e=>`<button type="button" class="linkish" data-es="${esc(e.id)}"><span class="d">${fmtW(e.d.date)}</span>${e.d.ver>1?` ${e.d.ver}차`:""} · ${won(E.calc(e.d).total)}</button> ${estTag(e)}`))}<div class="jv-btns"><button class="btn ghost sm" type="button" data-esnew="${esc(j.id)}">+ 견적서 작성</button></div></div>`;}}
  const money=isAdmin&&billTotal(moneyOf(j.id))>0?` 수금·매입은 정산에서 따로 마무리해요 (${settledM(moneyOf(j.id))?"정산 종료":"정산 중"}).`:"";
  h+=`<div class="dsec jv-stage">${ended(j)?`<p class="sub" style="margin:0">${j.f.closed?`${+j.f.closed.slice(5,7)}월 ${+j.f.closed.slice(8)}일 ${j.f.closedBy==="auto"?"종료 현장으로 옮겨졌어요":"종료 처리됐어요"}`:"시공 마감 완료라 종료 현장이에요"}.${money}</p><div><button class="btn ghost sm" type="button" id="jvOpen">다시 진행중으로</button></div>`
    :`<p class="sub" style="margin:0">시공 마감 완료를 체크하면 종료 현장으로 넘어가요.${money}</p><div><button class="btn ghost sm" type="button" id="jvEnd">지금 종료 처리</button></div>`}</div>`;
  $("jvBody").innerHTML=h;}
/* 바로 체크: '수정'에 들어가지 않고 보기 화면에서 실측 완료 · 입금 확인(관리자) · 시공 마감 완료 · AS 완료를 체크.
   체크하면 바로 저장되고 그 체크칸은 사라짐. 잘못 눌렀을 때를 위해 이 화면을 닫기 전까지는 '되돌리기'가 남음 */
let qc={jid:"",done:[],err:""},qcQ=Promise.resolve();
function qcItems(j){const out=[];
  if(!j.m.done)out.push({k:"m",l:"실측 완료",h:j.m.date?fmtW(j.m.date):"실측일이 없으면 오늘 날짜로 적혀요",late:j.m.date&&j.m.date<TODAY});
  const st=flowStage(j),fl=j.i.fl;
  if(st==="dwg")out.push({k:"dw",l:"도면 확정",h:fl.dw.due?`${fmt(fl.dw.due)}까지 · 고객이 최종 도면을 확인하면`:"고객이 최종 도면을 확인하면 체크",late:fl.dw.due&&fl.dw.due<TODAY});
  if(st==="prd")out.push({k:"pr",l:"생산 완료",h:fl.pr.due?`납기 ${fmt(fl.pr.due)}`:"납기 미정",late:fl.pr.due&&fl.pr.due<TODAY});
  if(isAdmin)moneyOf(j.id).pays.forEach((p,n)=>{if(!p.paid&&p.amount>0)out.push({k:`p${n}`,l:`${esc(p.label)} 입금 확인`,h:`${won(p.amount)}${p.due?` · ${fmt(p.due)}까지`:""}`,late:p.due&&p.due<TODAY});});
  if(!j.f.done&&j.i.start&&j.i.start<=TODAY){const lw=lastWork(j);out.push({k:"f",l:"시공 마감 완료",h:`${lw&&lw<TODAY?`시공 끝 ${fmt(lw)}`:"시공 중"} · 체크하면 종료 현장으로`});}
  j.f.as.forEach((a,n)=>{if(!a.done)out.push({k:`a${n}`,l:"AS 완료",h:`${a.date?fmtW(a.date):"날짜 미정"}${a.note?` · ${esc(a.note)}`:""}`,late:a.date&&a.date<TODAY});});
  return out;}
function qcHtml(j){if(qc.jid!==j.id)qc={jid:j.id,done:[],err:""};
  const items=qcItems(j);if(!items.length&&!qc.done.length)return"";
  return`<div class="dsec jv-qc"><h3>바로 체크<span class="hint">체크하면 바로 저장돼요</span></h3>${items.map(x=>`<label class="qc"><input type="checkbox" data-qc="${x.k}"><span>${x.l}</span><span class="hint">${x.h}</span>${x.late?`<span class="tag late">지남</span>`:""}</label>`).join("")}
    ${qc.done.map((x,i)=>`<div class="qc-done"><span>✓ ${x.l} 체크했어요</span><button type="button" class="linkish" data-qu="${i}">되돌리기</button></div>`).join("")}${qc.err?`<p class="err">${qc.err}</p>`:""}</div>`;}
/* 바뀌는 칸(실측 m · 마감/AS f · 수금 job_money)만 저장 */
function qcChange(j,k,on,prev){
  if(k==="m")return{col:"m",val:{...j.m,done:on,date:on?(j.m.date||TODAY):(prev&&"date" in prev?prev.date:j.m.date)}};
  if(k==="f")return{col:"f",val:{...j.f,done:on}};
  if(k==="dw"||k==="pr"){const fl=j.i.fl;return{col:"i",val:{...j.i,fl:{...fl,[k]:{...fl[k],ok:on?TODAY:""}}}};}
  if(k==="pall"){const m=moneyOf(j.id),idx=on?m.pays.map((p,i)=>p.paid?-1:i).filter(i=>i>=0):((prev&&prev.idx)||[]);if(!idx.length)return null;
    return{col:"money",idx,val:{...m,pays:m.pays.map((p,i)=>idx.includes(i)?{...p,paid:on,paidOn:on?TODAY:""}:p)}};}
  if(k==="c"){const m=moneyOf(j.id),x=prev&&prev.cost,n=x?m.costs.map((y,i)=>y.cat===x.cat&&y.amount===x.amount&&y.note===x.note?i:-1).filter(i=>i>=0).pop():undefined;
    if(on||n===undefined)return null;return{col:"money",val:{...m,costs:m.costs.filter((y,i)=>i!==n)}};}
  const n=+k.slice(1);
  if(k[0]==="a"){if(!j.f.as[n])return null;return{col:"f",val:{...j.f,as:j.f.as.map((a,i)=>i===n?{...a,done:on}:a)}};}
  const m=moneyOf(j.id);if(!m.pays[n])return null;
  return{col:"money",val:{...m,pays:m.pays.map((p,i)=>i===n?{...p,paid:on,paidOn:on?TODAY:""}:p)}};}
async function qcWrite(j,c){const at=new Date().toISOString();
  if(c.col==="money"){const {error}=await sb.from("job_money").upsert({job_id:j.id,data:c.val,updated_at:at});if(error)return false;money[j.id]=c.val;laborCache=null;return true;}
  const {error}=await sb.from("jobs").update({[c.col]:c.val,updated_at:at}).eq("id",j.id);if(error)return false;j[c.col]=c.val;return true;}
function qcRun(jid,fn){qcQ=qcQ.then(async()=>{const j=jobs.find(x=>x.id===jid);if(j)await fn(j);}).catch(()=>{});}
$("jvBody").addEventListener("change",e=>{const box=e.target.closest("input[data-qc]");if(!box||!box.checked)return;const k=box.dataset.qc;
  box.disabled=true;const label=box.nextElementSibling.innerHTML;
  qcRun(viewing,async j=>{const prev={date:j.m.date},c=qcChange(j,k,true);
    if(c&&await qcWrite(j,c)){if(qc.jid===j.id){qc.done.push({k,l:k==="pall"?"수금 완료 체크":label,prev:{...prev,idx:c.idx}});qc.err="";}render();}
    else{if(qc.jid===j.id)qc.err="저장하지 못했어요. 인터넷 연결을 확인하고 다시 체크해 주세요.";render();}});});
$("jvBody").addEventListener("click",e=>{const u=e.target.closest("[data-qu]");if(!u)return;const x=qc.done[+u.dataset.qu];if(!x)return;u.disabled=true;
  qcRun(viewing,async j=>{const c=qcChange(j,x.k,false,x.prev);
    if(c&&await qcWrite(j,c)){qc.done=qc.done.filter(y=>y!==x);qc.err="";}
    else qc.err="되돌리지 못했어요. 다시 눌러 주세요.";render();});});
/* 정산 보기 (관리자): 수금(입금 확인·수금 완료 체크) · 매입(바로 입력) · 이익 · 견적서 · 정산 종료 조건.
   수금 완료가 돼도 매입이 없으면 정산 종료로 넘어가지 않음. 현장 종료(시공)와는 따로 */
function renderMoneyView(j){const m=moneyOf(j.id),b=billTotal(m),u=unpaidOf(m),net=m.contract.amount,auto=autoCosts(j,m),cost=jobCost(j),labor=jobLabor(j),buy=cost-labor;
  const kv=(k,v)=>`<dt>${k}</dt><dd>${v}</dd>`,done=pre=>qc.done.map((x,i)=>x.k.startsWith(pre)?`<div class="qc-done"><span>✓ ${x.l}했어요</span><button type="button" class="linkish" data-qu="${i}">되돌리기</button></div>`:"").join("");
  $("jvTitle").innerHTML=`${esc(j.name)} ${settleTag(j)}`;
  let h=`<p class="sub" style="margin:0">${[sub(j),j.i.start?`시공 ${range(j)}`:"",`현장 ${JOB_STAGE[jobStage(j)]}`].filter(Boolean).join(" · ")}</p>`;
  // 수금
  const open=m.pays.map((p,n)=>({p,n})).filter(x=>!x.p.paid),gap=b-m.pays.reduce((a,p)=>a+p.amount,0);
  h+=`<div class="dsec ms-sec"><h3>수금 ${b?(u?`<span class="tag ${overdue(m).length?"late":"soon"}">미수 ${won(u)}</span>`:`<span class="tag ok">수금 완료</span>`):""}</h3>`;
  if(!b)h+=`<p class="ms-note">계약금액이 아직 없어요. <b>수정</b>에서 넣거나, 견적서를 계약으로 확정하면 들어가요.</p>`;
  else{h+=`<dl class="kv">${kv("계약금액",`${won(net)}${m.contract.vat?` <span class="hint">+ 부가세 ${won(b-net)}</span>`:""}`)}${kv("받은 돈",won(received(m)))}</dl><div class="ms-list">`;
    h+=m.pays.map((p,n)=>p.paid?`<div class="ms-row paid"><span class="ms-l">✓ ${esc(p.label)}</span><span class="hint">입금 ${p.paidOn?fmt(p.paidOn):"됨"}</span><b class="num">${won(p.amount)}</b></div>`
      :`<label class="qc"><input type="checkbox" data-qc="p${n}"><span class="ms-l">${esc(p.label)} 입금 확인</span>${open.length===1&&gap<=0?`<em class="ms-fin">→ 수금 완료</em>`:""}<span class="hint">${p.due?`${fmt(p.due)}까지`:"받을 날 없음"}</span>${p.due&&p.due<TODAY?`<span class="tag late">지남</span>`:""}<b class="num">${won(p.amount)}</b></label>`).join("");
    if(open.length>=2)h+=`<label class="qc ms-all"><input type="checkbox" data-qc="pall"><span class="ms-l"><b>수금 완료</b></span><span class="hint">남은 ${open.length}건 모두 입금 확인</span><b class="num">${won(open.reduce((a,x)=>a+x.p.amount,0))}</b></label>`;
    h+=`</div>${done("p")}`;
    if(!m.pays.length)h+=`<p class="ms-note">입금 일정이 없어요. <b>수정</b>에서 계약금·잔금 등을 넣어 주세요.</p>`;
    else if(gap>0)h+=`<p class="ms-note">입금 일정 합계가 받을 돈보다 ${won(gap)} 적어요. 다 받아도 수금 완료가 안 되니 <b>수정</b>에서 맞춰 주세요.</p>`;
    if(!u&&!costIn(m))h+=`<p class="ms-warn">수금은 끝났는데 매입이 입력되지 않아서 정산 종료로 넘어가지 않았어요. 아래에서 매입을 입력해 주세요.</p>`;}
  if(qc.err)h+=`<p class="err">${qc.err}</p>`;
  h+=`</div>`;
  // 매입
  h+=`<div class="dsec ms-sec ms-cost"><h3>매입 ${costIn(m)?`<span class="hint">${won(buy)}${labor?` · 시공비 ${won(labor)}`:""}</span>`:`<span class="tag late">매입 입력 안 됨</span>`}</h3><div class="ms-list">`;
  h+=m.costs.map((x,i)=>{const sig=esc(costSig(x)),vd=isVend(x),gw=!isLabor(x)&&x.due;
    return`<div class="ms-row"><span class="ms-l">${esc(x.cat)}</span>${x.v?`<b class="ms-v">${esc(x.v)}</b>`:""}${x.note?`<span class="hint">${esc(x.note)}</span>`:""}<b class="num">${won(x.amount)}</b>${gw||vd?`<div class="ms-st">${gw?`<label class="check"><input type="checkbox" data-cgot="${i}" data-sig="${sig}"${x.got?" checked":""}>${x.got?`입고 ${fmt(x.got)}`:`입고 확인 <span class="hint">예정 ${fmt(x.due)}</span>`}</label>${!x.got&&x.due<TODAY?`<span class="tag late">입고 늦음</span>`:""}`:""}${vd?`<label class="check"><input type="checkbox" data-cpaid="${i}" data-sig="${sig}"${x.paid?" checked":""}>${x.paid?`지급 ${x.paidOn?fmt(x.paidOn):"완료"}`:"거래처 지급"}</label>${x.paid?"":`<span class="tag wait">미지급</span>`}`:""}</div>`:""}</div>`;}).join("")
    +auto.map(x=>`<div class="ms-row"><span class="ms-l">${esc(x.cat)}</span><span class="hint">${esc(x.note)}</span><b class="num">${won(x.amount)}</b></div>`).join("");
  h+=`</div>${done("c")}`;
  if(!costIn(m))h+=`<p class="ms-note">자재비·외주 같은 매입을 입력해야 수금이 끝났을 때 정산 종료로 넘어가요.${auto.length?" 일당으로 자동 계산된 인건비는 매입 입력으로 치지 않아요.":""}</p>`;
  h+=msAdd?`<div class="ms-add"><label>항목<select id="ms-cat">${COST_CATS.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label><label>금액(원)<input class="won" inputmode="numeric" id="ms-amt" placeholder="0"></label><label>거래처<input id="ms-v" list="vendList" placeholder="예: OO목재"></label><label>입고 예정일<input type="date" id="ms-due"></label><label class="note">메모<input id="ms-note" placeholder="예: 도장 외주, 하드웨어"></label><p class="hint ms-add-h">거래처를 적으면 정산 › 거래처 정산에서 줄 돈으로 모여요. 입고 예정일을 적으면 들어올 때까지 확인할 일에 떠요.</p><div class="ms-add-btns"><button class="btn sm" type="button" id="ms-save">추가</button><button class="btn ghost sm" type="button" id="ms-cancel">취소</button></div></div>${msErr?`<p class="err">${msErr}</p>`:""}`
    :`<div class="jv-btns"><button type="button" class="btn sm ${costIn(m)?"ghost":"ms-red"}" data-msadd>${costIn(m)?"+ 매입 추가":"매입 입력"}</button></div>`;
  h+=`</div>`;
  // 이익
  if(net)h+=`<div class="dsec"><h3>이익</h3><dl class="kv">${kv("매출",won(net))}${kv("매입",won(buy))}${kv("시공비",won(labor))}${kv("이익",`<b class="${net-cost<0?"neg":""}">${won(net-cost)}</b> <span class="hint">${pct(net-cost,net)}</span>`)}</dl></div>`;
  // 견적서
  if(est10){const es=estOfJob(j.id);h+=`<div class="dsec"><h3>견적서</h3>${es.length?`<ul class="jv-list">${es.map(e=>`<li><button type="button" class="linkish" data-es="${esc(e.id)}"><span class="d">${fmtW(e.d.date)}</span>${e.d.ver>1?` ${e.d.ver}차`:""} · ${won(E.calc(e.d).total)}</button> ${estTag(e)}</li>`).join("")}</ul>`:""}<div class="jv-btns"><button class="btn ghost sm" type="button" data-esnew="${esc(j.id)}">+ 견적서 작성</button></div></div>`;}
  // 정산 종료
  if(settledM(m))h+=`<div class="dsec jv-stage"><h3>정산 종료</h3><p class="sub" style="margin:0">받을 돈을 다 받았고 매입도 입력돼서 정산이 끝났어요.</p></div>`;
  else{const cs=[[b>0&&!u,"받을 돈 다 받음",!b?"계약금액 없음":u?`미수 ${won(u)}`:""],[costIn(m),"매입 입력",costIn(m)?"":"아직 안 함"]];
    h+=`<div class="dsec jv-stage"><h3>정산 종료로 넘어가려면</h3><ul class="ms-conds">${cs.map(([ok,l,more])=>`<li class="${ok?"ok":"no"}">${ok?"✓":"○"} ${l}${more?` <span class="hint">${more}</span>`:""}</li>`).join("")}</ul><p class="sub" style="margin:0">두 가지가 되면 정산 종료로 넘어가요. 현장 종료(시공 마감)와는 따로예요.</p></div>`;}
  h+=`<div class="jv-btns"><button class="btn ghost sm" type="button" data-vmode="site">현장 내용 보기</button></div>`;
  // 매입 입력 중에 화면이 다시 그려져도 적던 값은 그대로
  const MSF=["ms-cat","ms-amt","ms-v","ms-due","ms-note"],keep=MSF.map(id=>$(id)?$(id).value:null),foc=document.activeElement&&document.activeElement.id;
  $("jvBody").innerHTML=h;
  MSF.forEach((id,i)=>{if($(id)&&keep[i]!==null)$(id).value=keep[i];});if(foc&&foc.startsWith("ms-")&&$(foc))$(foc).focus({preventScroll:true});}
$("jvBody").addEventListener("click",e=>{const vm=e.target.closest("[data-vmode]");if(vm){viewMode=vm.dataset.vmode;msAdd=false;renderView();$("jobSheet").querySelector(".sheet-card").scrollTop=0;return;}
  if(e.target.closest("[data-msadd]")){msAdd=true;msErr="";renderView();if($("ms-amt"))$("ms-amt").focus();return;}
  if(e.target.id==="ms-cancel"){msAdd=false;msErr="";renderView();return;}
  if(e.target.id!=="ms-save")return;const cat=$("ms-cat").value,amount=toNum($("ms-amt").value),note=$("ms-note").value.trim(),v=$("ms-v").value.trim(),due=$("ms-due").value;
  if(!amount&&!note){msErr="금액을 넣어 주세요.";renderView();$("ms-amt").focus();return;}
  e.target.disabled=true;
  qcRun(viewing,async j=>{const m=moneyOf(j.id),val={...m,costs:[...m.costs,normCost({cat,amount,note,v,d:TODAY,due})]};
    if(await qcWrite(j,{col:"money",val})){["ms-amt","ms-v","ms-due","ms-note"].forEach(id=>{if($(id))$(id).value=""});msAdd=false;msErr="";if(qc.jid===j.id)qc.done.push({k:"c",l:`매입 ${esc(cat)} ${won(amount)} 입력`,prev:{cost:{cat,amount,note}}});render();}
    else{msErr="저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";render();}});});
/* 정산 보기 · 거래처 정산: 매입 줄의 입고 확인 · 거래처 지급 체크 (풀면 되돌림) */
const gotPatch=on=>x=>({got:on?TODAY:""}),paidPatch=on=>x=>({paid:on,paidOn:on?TODAY:""});
document.addEventListener("change",e=>{const b=e.target.closest("input[data-cgot],input[data-cpaid]");if(!b)return;
  const got="cgot" in b.dataset,jid=b.dataset.jid||viewing,i=+(got?b.dataset.cgot:b.dataset.cpaid);b.disabled=true;
  costSet([{jid,i,sig:b.dataset.sig}],got?gotPatch(b.checked):paidPatch(b.checked)).then(ok=>{
    if(!ok){if(b.closest("#jvBody"))qc.err="저장하지 못했어요. 인터넷 연결을 확인하고 다시 체크해 주세요.";else vdErr="저장하지 못했어요. 인터넷 연결을 확인하고 다시 체크해 주세요.";}
    else{qc.err="";vdErr="";}render();});});
/* 지금 종료 처리(취소된 현장 등) · 다시 진행중으로(마감 완료 체크도 풀림) */
async function setClosed(j,close,btn){
  const f=close?{...j.f,closed:TODAY,closedBy:"manual"}:{...j.f,done:false,closed:"",closedBy:""};
  if(btn)btn.disabled=true;
  const {error}=await sb.from("jobs").update({f,updated_at:new Date().toISOString()}).eq("id",j.id);
  if(error){if(btn){btn.disabled=false;flash(btn,"저장 못 함 · 다시 눌러 주세요",false);}return;}
  j.f=f;render();}
/* 관리자 앱이 열릴 때: 시공일이 바뀐(직원이 고친 것 포함) 현장의 자동 받을 날을 맞춤. 종료 현장은 건드리지 않음 */
let duing=false;
async function autoDue(){if(!isAdmin||duing)return;const due=[];
  jobs.forEach(j=>{if(j.f.closed||!money[j.id])return;const m=fillDues(j,money[j.id]);if(m)due.push([j,m]);});if(!due.length)return;
  duing=true;try{for(const [j,m] of due){const {error}=await sb.from("job_money").upsert({job_id:j.id,data:m,updated_at:new Date().toISOString()});if(!error)money[j.id]=m;}}finally{duing=false;}render();}
/* 관리자 앱이 열릴 때: 계약금액이 있는데 현장에 계약일이 없으면 적어 둠 (직원도 '계약' 단계를 보게) */
let cting=false;
async function autoCt(){if(!isAdmin||cting)return;const due=jobs.filter(j=>!j.i.fl.ct&&billTotal(moneyOf(j.id))>0);if(!due.length)return;
  cting=true;try{for(const j of due){const i={...j.i,fl:{...j.i.fl,ct:moneyOf(j.id).contract.date||TODAY}};const {error}=await sb.from("jobs").update({i}).eq("id",j.id);if(!error)j.i=i;}}finally{cting=false;}render();}
const prLate=j=>{const fl=j.i.fl;return!fl.pr.ok&&!!fl.pr.due&&!!j.i.start&&j.i.start>TODAY&&fl.pr.due>j.i.start;};
$("jvClose").onclick=closeView;
$("jvEdit").onclick=()=>{const j=jobs.find(x=>x.id===viewing),money=viewMode==="money";closeView();if(j){tab("board");openForm(j);if(money)setTimeout(()=>$("sec-money").scrollIntoView({block:"start"}),300);}};
$("jobSheet").addEventListener("click",e=>{if(e.target===$("jobSheet"))closeView();
  const j=jobs.find(x=>x.id===viewing);if(!j)return;
  if(e.target.id==="jvEnd")setClosed(j,true,e.target);else if(e.target.id==="jvOpen")setClosed(j,false,e.target);});
document.addEventListener("click",e=>{const b=e.target.closest("[data-jv]");if(!b)return;const j=jobs.find(x=>x.id===b.dataset.jv);if(!j)return;
  if(!$("daySheet").hidden)closeDay();openView(j);});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("jobSheet").hidden){e.stopImmediatePropagation();closeView();}},true);

/* 시공자별 일정판 */
const mondayOf=d=>{const w=dow(d);return addDays(d,w===0?-6:1-w);};
let crewStart=mondayOf(TODAY);
const crewSpan=()=>window.matchMedia("(min-width:900px)").matches?14:7;
function renderCrew(){
  const n=crewSpan(),days=[...Array(n)].map((_,k)=>addDays(crewStart,k)),from=days[0],to=days[n-1];
  $("crewTitle").innerHTML=`${fmtW(from)} ~ ${fmtW(to)}`;
  const m=crewMap(from,to);
  const names=[...new Set([...CREW,...jobs.flatMap(crewAll),...jobs.flatMap(j=>j.f.as.map(a=>a.crew)).filter(Boolean)])];
  const rows=names.map(nm=>[nm,esc(nm)]);if(m[""])rows.push(["",`<span class="tag late">미배정</span>`]);
  if(!rows.length){$("crewgrid").innerHTML=`<div class="empty">등록된 시공자가 없어요. 현장 수정 화면의 '명단에 추가'로 시공자를 넣어 주세요.</div>`;$("crewNote").textContent="";return;}
  const cls=d=>[dow(d)%6===0?"we":"",d===TODAY?"today":""].join(" ");
  const chip=(x,named)=>x.t==="i"
    ?`<div class="ev i ${kc(x.j)} ${named?"":"none"}" title="${esc(x.j.name)} 시공">${short(x.j)}</div>`
    :`<div class="ev a ${x.a.done?"done":""}" title="${esc(x.j.name)} AS ${esc(x.a.note)}">AS ${short(x.j)}</div>`;
  let clashN=0;
  const body=rows.map(([key,label])=>{const r=m[key]||{};const busyDays=Object.keys(r).length;
    return`<tr><th class="nm" scope="row">${label}${key&&busyDays?`<small>${busyDays}일</small>`:""}</th>${days.map(d=>{const it=r[d]||[];const c=key&&clashAt(it);if(c)clashN++;
      return`<td class="${cls(d)} ${c?"clash":""}" ${it.length?`data-day="${d}" tabindex="0" role="button" aria-label="${esc(key||"미배정")} ${fmt(d)} 일정 ${it.length}건"`:""}>${it.map(x=>chip(x,!!key)).join("")}${c?`<span class="clash-tag">겹침</span>`:""}</td>`}).join("")}</tr>`}).join("");
  $("crewgrid").innerHTML=`<table><thead><tr><th class="nm">시공자</th>${days.map(d=>`<th class="${cls(d)}"><span class="d">${fmt(d)}</span> <span class="wk">${WD[dow(d)]}</span></th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  $("crewNote").innerHTML=clashN?`<span class="tag late">이 기간 겹침 ${clashN}칸</span> 같은 날 한 사람이 두 현장에 잡혀 있어요. 시공자는 현장 목록에서 그 현장을 눌러 바꿔 주세요.`:"이 기간에는 겹치는 일정이 없어요.";
}
$("crewPrev").onclick=()=>{crewStart=addDays(crewStart,-crewSpan());renderCrew()};
$("crewNext").onclick=()=>{crewStart=addDays(crewStart,crewSpan());renderCrew()};
$("crewToday").onclick=()=>{crewStart=mondayOf(TODAY);renderCrew()};
let rsT;window.addEventListener("resize",()=>{clearTimeout(rsT);rsT=setTimeout(()=>{if(curTab==="crew")renderCrew()},150)});

/* 수금 (관리자) */
function dueTag(p){if(!p.due)return`<span class="tag wait">날짜 미정</span>`;const n=dayDiff(TODAY,p.due);
  if(n<0)return`<span class="tag late">지연 ${-n}일</span>`;if(n===0)return`<span class="tag soon">오늘</span>`;
  return`<span class="tag ${n<=7?"soon":"wait"}">D-${n}</span>`;}
let payCat="open";
function renderPay(){
  const t=payTotals(),vat=jobs.reduce((s,j)=>{const m=moneyOf(j.id);return s+billTotal(m)-m.contract.amount;},0);
  // 받을 돈은 고객이 실제로 낼 돈(부가세 별도 계약은 부가세 포함), 기간 없이 전체. 결산 매출은 부가세 뺀 금액을 시공 시작 달로 나눔
  $("payTiles").innerHTML=`<div class="tile"><small>받을 돈 (전체)</small><b>${won(t.bill)}</b>${vat?`<small>부가세 ${won(vat)} 포함</small>`:""}</div>
    <div class="tile"><small>받은 돈</small><b>${won(t.recv)}</b></div>
    <div class="tile ${t.unpaid?"warn":""}"><small>미수금</small><b>${won(t.unpaid)}</b></div>
    <div class="tile ${t.lateN?"bad":""}"><small>입금 지연</small><b>${t.lateN}건</b>${t.lateN?`<small>${won(t.lateAmt)}</small>`:""}</div>`;
  const withM=jobs.map(j=>({j,m:moneyOf(j.id)})).filter(x=>hasMoney(x.m));
  $("payEmpty").hidden=withM.length>0;
  const todo=withM.flatMap(x=>x.m.pays.filter(p=>!p.paid).map(p=>({...x,p}))).sort((a,b)=>(a.p.due||"9999").localeCompare(b.p.due||"9999"));
  $("payTodo").innerHTML=todo.length?todo.map(x=>`<tr data-j="${esc(x.j.id)}" tabindex="0"><td><span class="d">${fmtW(x.p.due)}</span></td><td class="job"><b>${esc(x.j.name)}</b></td><td>${esc(x.p.label)}</td><td class="num push">${won(x.p.amount)}</td><td>${dueTag(x.p)}</td></tr>`).join("")
    :`<tr><td colspan="5" class="hint">받기로 한 입금 일정이 없어요.</td></tr>`;
  const done=withM.flatMap(x=>x.m.pays.filter(p=>p.paid&&p.paidOn&&p.paidOn>=addDays(TODAY,-30)).map(p=>({...x,p}))).sort((a,b)=>b.p.paidOn.localeCompare(a.p.paidOn));
  $("payDone").innerHTML=done.length?done.map(x=>`<tr data-j="${esc(x.j.id)}" tabindex="0"><td><span class="d">${fmtW(x.p.paidOn)}</span></td><td class="job"><b>${esc(x.j.name)}</b></td><td>${esc(x.p.label)}</td><td class="num push">${won(x.p.amount)}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">최근 30일 동안 들어온 입금이 없어요.</td></tr>`;
  // 현장별 수금: 정산 중 / 정산 종료(받을 돈 다 받고 매입 입력)로 나눔
  const perAll=withM.filter(x=>billTotal(x.m)>0),doneN=perAll.filter(x=>settledM(x.m)).length,lastIn=m=>m.pays.map(p=>p.paidOn||"").sort().pop()||"";
  $("payCats").innerHTML=perAll.length?[["open","정산 중",perAll.length-doneN],["done","정산 종료",doneN]].map(([k,l,n])=>`<button class="chip${k===payCat?" on":""}" type="button" data-paycat="${k}" aria-pressed="${k===payCat}">${l} <b>${n}</b></button>`).join(""):"";
  const perJob=perAll.filter(x=>settledM(x.m)===(payCat==="done")).sort((a,b)=>payCat==="done"?lastIn(b.m).localeCompare(lastIn(a.m)):unpaidOf(b.m)-unpaidOf(a.m)||a.j.name.localeCompare(b.j.name));
  $("payJobs").innerHTML=perJob.length?perJob.map(({j,m})=>{const u=unpaidOf(m),next=m.pays.filter(p=>!p.paid&&p.due).map(p=>p.due).sort()[0];
    const gap=billTotal(m)-m.pays.reduce((a,p)=>a+p.amount,0);
    return`<tr data-j="${esc(j.id)}" tabindex="0"><td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></td><td class="num" data-l="받을 돈">${won(billTotal(m))}</td><td class="num" data-l="받은 돈">${won(received(m))}</td><td class="num" data-l="미수금">${u?`<b>${won(u)}</b>`:"0원"}</td>
      <td class="full"><div class="cell">${settledM(m)?`<span class="tag st-end">정산 종료</span>`:payTag(j)}${!u&&!costIn(m)?`<span class="tag late">매입 입력</span>`:""}${next?`<span class="hint">다음 ${fmt(next)}</span>`:""}${gap>0&&u?`<span class="hint">일정 없는 금액 ${won(gap)}</span>`:""}</div></td></tr>`}).join("")
    :`<tr><td colspan="5" class="hint">${!perAll.length?"계약금액을 넣은 현장이 없어요.":payCat==="done"?"정산이 끝난 현장이 아직 없어요.":"정산 중인 현장이 없어요."}</td></tr>`;
}
document.addEventListener("click",e=>{const c=e.target.closest("[data-paycat]");if(!c)return;payCat=c.dataset.paycat;renderPay();});

/* 거래처 정산 (관리자): 현장 매입 중 거래처를 적은 것만 모아 거래처별 줄 돈(미지급)과 입고 대기를 봄. 지급·입고 체크는 그 현장 매입 줄에 저장 */
let vdErr="",vdUndo=null;const vdOpen=new Set();
function renderVend(){if(!isAdmin)return;
  const all=costList(),rows=all.filter(o=>isVend(o.x)),mon=TODAY.slice(0,7),sum=a=>a.reduce((t,o)=>t+o.x.amount,0);
  const unpaid=rows.filter(o=>!o.x.paid),wait=all.filter(o=>gotWait(o.x)).sort((a,b)=>a.x.due.localeCompare(b.x.due)),late=wait.filter(o=>o.x.due<TODAY);
  const names=[...new Set(rows.map(o=>o.x.v))];
  $("vdTiles").innerHTML=`<div class="tile ${unpaid.length?"warn":""}"><small>줄 돈 (미지급)</small><b>${won(sum(unpaid))}</b><small>거래처 ${new Set(unpaid.map(o=>o.x.v)).size}곳 · ${unpaid.length}건</small></div>
    <div class="tile"><small>${+mon.slice(5)}월 매입</small><b>${won(sum(rows.filter(o=>(o.x.d||"").startsWith(mon))))}</b><small>매입일 기준</small></div>
    <div class="tile"><small>${+mon.slice(5)}월 지급</small><b>${won(sum(rows.filter(o=>o.x.paid&&(o.x.paidOn||"").startsWith(mon))))}</b></div>
    <div class="tile ${late.length?"bad":""}"><small>입고 대기</small><b>${wait.length}건</b>${late.length?`<small>예정일 지남 ${late.length}건</small>`:""}</div>`;
  $("vdEmpty").hidden=rows.length>0||wait.length>0;
  const chk=(o,kind)=>`<input type="checkbox" data-c${kind}="${o.i}" data-jid="${esc(o.j.id)}" data-sig="${esc(costSig(o.x))}"`;
  const jb=j=>`<button type="button" class="wg-job" data-j="${esc(j.id)}">${esc(j.name)}</button>`;
  $("vdWaitBox").hidden=!wait.length;
  $("vdWait").innerHTML=wait.map(o=>`<tr><td><span class="d">${fmtW(o.x.due)}</span></td><td class="job">${jb(o.j)}${o.j.i.start?` <small class="hint">시공 ${fmt(o.j.i.start)}</small>`:""}</td><td>${o.x.v?`<b>${esc(o.x.v)}</b> · `:""}${esc(o.x.cat)}${o.x.note?` <span class="hint">${esc(o.x.note)}</span>`:""}</td><td class="num push">${won(o.x.amount)}</td>
    <td><div class="cell">${o.x.due<TODAY?`<span class="tag late">늦음</span>`:o.j.i.start&&o.x.due>o.j.i.start&&o.j.i.start>=TODAY?`<span class="tag late">시공보다 늦음</span>`:""}<label class="check">${chk(o,"got")}>입고 확인</label></div></td></tr>`).join("");
  const cards=names.map(n=>{const rs=rows.filter(o=>o.x.v===n),un=rs.filter(o=>!o.x.paid),old=un.map(o=>o.x.d||"").filter(Boolean).sort()[0];
    return{n,rs,un,due:sum(un),old};}).sort((a,b)=>b.due-a.due||a.n.localeCompare(b.n,"ko"));
  const since=addDays(TODAY,-90),rowLi=o=>`<li class="${o.x.paid?"paid":""}"><div class="vd-l"><span class="d">${o.x.d?fmt(o.x.d):"—"}</span>${jb(o.j)}<b class="num">${won(o.x.amount)}</b></div><div class="vd-l"><span class="hint">${esc(o.x.cat)}${o.x.note?` · ${esc(o.x.note)}`:""}</span><label class="check">${chk(o,"paid")}${o.x.paid?" checked":""}>${o.x.paid?`지급 ${o.x.paidOn?fmt(o.x.paidOn):"완료"}`:"지급"}</label></div></li>`;
  $("vdList").innerHTML=cards.map(c=>{const shown=c.rs.filter(o=>!o.x.paid||(o.x.paidOn||o.x.d||"")>=since).sort((a,b)=>(a.x.paid-b.x.paid)||(a.x.paid?(b.x.paidOn||"").localeCompare(a.x.paidOn||""):(a.x.d||"").localeCompare(b.x.d||""))),hid=c.rs.length-shown.length;
    const undo=vdUndo&&vdUndo.n===c.n;
    return`<div class="wg-card vd-card${c.un.length?"":" done"}"><div class="wg-head"><b class="wg-name">${esc(c.n)}</b>${c.un.length?"":`<span class="tag ok">다 지급</span>`}<b class="wg-sum">${c.un.length?won(c.due):"0원"}</b></div>
      <div class="wg-line">${c.un.length?`미지급 ${c.un.length}건${c.old?` · 가장 오래된 매입 ${fmt(c.old)}`:""}`:`매입 ${c.rs.length}건 모두 지급`} · 이번 달 매입 ${won(sum(c.rs.filter(o=>(o.x.d||"").startsWith(mon))))}</div>
      <details class="wg-more" data-vdd="${esc(c.n)}"${vdOpen.has(c.n)?" open":""}><summary>매입 내역 ${shown.length}건</summary><div class="wg-in"><ul class="vd-rows">${shown.map(rowLi).join("")||`<li class="hint">최근 90일 매입이 없어요.</li>`}</ul>${hid?`<p class="hint" style="margin:0">90일 전에 지급 끝난 ${hid}건은 엑셀 백업의 매입 시트에 있어요.</p>`:""}</div></details>
      ${undo?`<div class="qc-done"><span>✓ ${vdUndo.list.length}건 지급 완료했어요</span><button type="button" class="linkish" data-vdundo>되돌리기</button></div>`:c.un.length?`<div><button class="btn ghost sm" type="button" data-vdall="${esc(c.n)}">미지급 ${c.un.length}건 모두 지급 완료</button></div>`:""}</div>`;}).join("");
  $("vdErr").hidden=!vdErr;$("vdErr").textContent=vdErr;
  const noV=all.filter(o=>!o.x.v&&!isLabor(o.x));
  $("vdNote").innerHTML=`현장 정산 보기에서 매입을 넣을 때 거래처를 적으면 여기에 모여요. 지급·입고 체크는 그 현장 매입에도 똑같이 저장돼요. 시공 인건비는 시공자 정산에서 따로 봐요.${noV.length?` 거래처를 안 적은 매입 ${noV.length}건(${won(sum(noV))})은 여기 안 나와요.`:""}`;}
document.addEventListener("toggle",e=>{const d=e.target;if(d.dataset&&d.dataset.vdd!==undefined){if(d.open)vdOpen.add(d.dataset.vdd);else vdOpen.delete(d.dataset.vdd);}},true);
document.addEventListener("click",e=>{const a=e.target.closest("[data-vdall]");
  if(a){const n=a.dataset.vdall,list=costList().filter(o=>isVend(o.x)&&!o.x.paid&&o.x.v===n).map(o=>({jid:o.j.id,i:o.i,sig:costSig(o.x)}));if(!list.length)return;a.disabled=true;
    costSet(list,paidPatch(true)).then(ok=>{vdErr=ok?"":"일부를 저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";
      vdUndo={n,list:list.map(o=>{const m=moneyOf(o.jid),x=m.costs[o.i];return x&&x.paid?{jid:o.jid,i:o.i,sig:costSig(x)}:null;}).filter(Boolean)};if(!vdUndo.list.length)vdUndo=null;render();});return;}
  const u=e.target.closest("[data-vdundo]");if(u&&vdUndo){const x=vdUndo;u.disabled=true;
    costSet(x.list,paidPatch(false)).then(ok=>{vdUndo=null;vdErr=ok?"":"되돌리지 못했어요. 다시 눌러 주세요.";render();});}});

/* 시공자 정산 (관리자). 일당 × 시공일 + AS + 조정. 한 사람이 같은 날 두 현장이면 하루로 세고, 원가에는 그날 일당을 현장끼리 나눠 넣음 */
let wage={rates:{day:{},extra:0,as:0},months:{}},pay08=true,wageChan=null,laborCache=null,wgLater=false;
let wgY=now.getFullYear(),wgM=now.getMonth()+1;const wgOpen=new Set();
const ymKey=(y,m)=>`${y}-${pad(m)}`;
const sNum=v=>(String(v??"").trim().startsWith("-")?-1:1)*toNum(v);
const sComma=n=>n?(n<0?"-":"")+comma(Math.abs(n)):"";
const sWon=n=>(n>0?"+":"")+won(n);
function normRates(d){d=d||{};const day={};Object.entries(d.day||{}).forEach(([k,v])=>{const n=toNum(v);if(k&&n)day[k]=n;});return{day,extra:toNum(d.extra),as:toNum(d.as)};}
const normSnap=s=>s&&typeof s==="object"?s:null;
function normWm(d){d=d||{};const p={};Object.entries(d.p||{}).forEach(([k,v])=>{v=v||{};p[k]={adj:Math.round(+v.adj||0),note:String(v.note||""),paid:String(v.paid||""),snap:normSnap(v.snap)};});
  const x=d.x||{};return{p,x:{paid:String(x.paid||""),snap:normSnap(x.snap)}};}
const wmOf=k=>wage.months[k]||normWm();
const rateOf=n=>wage.rates.day[n]||0,asRateOf=n=>wage.rates.as||rateOf(n);
/* 사람별·날짜별 일: i = 그날 시공한 현장들, a = 그날 AS */
function workBook(from,to){const book={},at=(n,d)=>((book[n]??={})[d]??={i:[],a:[]});
  jobs.forEach(j=>{workDays(j).forEach(d=>{if(d>=from&&d<=to)[...new Set(crewOn(j,d).filter(Boolean))].forEach(c=>at(c,d).i.push(j));});
    j.f.as.forEach(a=>{if(a.crew&&a.date&&a.date>=from&&a.date<=to)at(a.crew,a.date).a.push({j,a});});});
  return book;}
/* 현장별 인건비 (일정 기준 자동): 시공·AS = 그날 일당을 현장끼리 나눔, 추가 투입 = 인원 × 1인 일당 */
function laborOf(j){
  if(!laborCache){laborCache={};const get=id=>(laborCache[id]??={crew:0,extra:0,miss:new Set()});
    if(isAdmin&&pay08){
      Object.entries(workBook("0000","9999")).forEach(([n,days])=>Object.values(days).forEach(u=>{
        if(u.i.length){const r=rateOf(n);u.i.forEach(x=>{const o=get(x.id);if(r)o.crew+=r/u.i.length;else o.miss.add(n);});}
        else{const r=asRateOf(n);u.a.forEach(x=>{const o=get(x.j.id);if(r)o.crew+=r/u.a.length;else o.miss.add(n);});}}));
      if(wage.rates.extra)jobs.forEach(j=>{const n=extraSum(j);if(n)get(j.id).extra=n*wage.rates.extra;});}}
  return laborCache[j.id]||{crew:0,extra:0,miss:new Set()};}
/* 직접 적은 같은 항목이 없을 때만 자동 인건비를 원가에 넣음 */
function autoCosts(j,m){if(!j)return[];const L=laborOf(j),has=c=>m.costs.some(x=>x.cat===c),out=[],c=Math.round(L.crew),x=Math.round(L.extra);
  if(c&&!has("시공 인건비"))out.push({cat:"시공 인건비",amount:c,note:"자동 · 일정 × 일당",auto:true});
  if(x&&!has("추가 투입 인건비"))out.push({cat:"추가 투입 인건비",amount:x,note:"자동 · 추가 인원 × 1인 일당",auto:true});
  return out;}
const jobCosts=j=>{const m=moneyOf(j.id);return m.costs.concat(autoCosts(j,m));};
const jobCost=j=>jobCosts(j).reduce((a,x)=>a+x.amount,0);
/* 결산에서 따로 보는 시공비 = 시공 인건비 + 추가 투입 인건비(직접 적은 것 또는 일당 자동). 나머지(자재·외주·운반)는 매입 */
const LABOR_CATS=["시공 인건비","추가 투입 인건비"],isLabor=x=>LABOR_CATS.includes(x.cat);
const jobLabor=j=>jobCosts(j).filter(isLabor).reduce((a,x)=>a+x.amount,0);
const jobBuy=j=>jobCost(j)-jobLabor(j);
/* 거래처 매입 = 거래처를 적은 자재·외주·운반 매입(시공 인건비는 시공자 정산에서). 입고 예정일을 적은 매입은 입고 확인까지 따라감 */
const isVend=x=>!!x.v&&!isLabor(x),gotWait=x=>!!x.due&&!x.got&&!isLabor(x);
const costSig=x=>[x.cat,x.amount,x.v||"",x.note].join("|");
const costList=()=>jobs.flatMap(j=>moneyOf(j.id).costs.map((x,i)=>({j,x,i})));
const vendDue=m=>m.costs.filter(x=>isVend(x)&&!x.paid).reduce((a,x)=>a+x.amount,0);
function vendNames(){const n=new Set();jobs.forEach(j=>{moneyOf(j.id).costs.forEach(x=>{if(x.v)n.add(x.v);});if(j.i.fl&&j.i.fl.pr.out)n.add(j.i.fl.pr.out);});
  return[...n].sort((a,b)=>a.localeCompare(b,"ko"));}
/* 매입 줄 고치기(입고·지급 체크). list = [{jid,i,sig}], sig가 다르면(그새 바뀐 줄) 건드리지 않음 */
function costSet(list,patch){const by={};list.forEach(o=>(by[o.jid]??=[]).push(o));
  return Promise.all(Object.entries(by).map(([jid,os])=>new Promise(res=>{qcQ=qcQ.then(async()=>{const j=jobs.find(x=>x.id===jid);if(!j)return res(false);
    const m=moneyOf(j.id);let hit=0;
    const costs=m.costs.map((x,i)=>{if(!os.some(o=>o.i===i&&o.sig===costSig(x)))return x;hit++;return normCost({...x,...patch(x)});});
    res(hit?await qcWrite(j,{col:"money",val:{...m,costs}}):false);}).catch(()=>res(false));}))).then(r=>r.every(Boolean));}
function wageMonth(y,m){const key=ymKey(y,m),from=key+"-01",to=key+"-31",book=workBook(from,to),rec=wmOf(key);
  const people=[...new Set([...Object.keys(book),...Object.keys(rec.p)])].map(n=>{
    const days=book[n]||{},ds=Object.keys(days).sort(),iD=ds.filter(d=>days[d].i.length),aD=ds.filter(d=>!days[d].i.length);
    const r=rec.p[n]||{adj:0,note:"",paid:"",snap:null},rate=rateOf(n),asRate=asRateOf(n);
    const miss=!!((iD.length&&!rate)||(aD.length&&!asRate));
    const byJob=new Map(),add=(j,d,t)=>{if(!byJob.has(j.id))byJob.set(j.id,{j,i:[],a:[]});byJob.get(j.id)[t].push(d);};
    iD.forEach(d=>days[d].i.forEach(j=>add(j,d,"i")));aD.forEach(d=>days[d].a.forEach(x=>add(x.j,d,"a")));
    return{n,days:iD.length,as:aD.length,rate,asRate,adj:r.adj,note:r.note,paid:r.paid,snap:r.snap,miss,
      total:miss?null:iD.length*rate+aD.length*asRate+r.adj,later:ds.filter(d=>d>TODAY).length,shared:iD.filter(d=>days[d].i.length>1).length,byJob:[...byJob.values()]};})
    .filter(p=>p.days||p.as||p.adj||p.paid).sort((a,b)=>(b.days+b.as)-(a.days+a.as)||a.n.localeCompare(b.n,"ko"));
  const list=[];jobs.forEach(j=>j.f.extra.forEach(x=>{if(x.date&&x.date>=from&&x.date<=to&&+x.people>0)list.push({j,x});}));
  list.sort((a,b)=>a.x.date.localeCompare(b.x.date));
  const xn=list.reduce((a,o)=>a+(+o.x.people||0),0),xr=wage.rates.extra;
  const extra={list,people:xn,rate:xr,total:!xn?0:xr?xn*xr:null,paid:rec.x.paid,snap:rec.x.snap};
  const none=jobs.map(j=>({j,n:noCrewDays(j).filter(d=>d>=from&&d<=to).length})).filter(o=>o.n);
  return{key,people,extra,none};}
const shownPay=p=>p.paid&&p.snap?+p.snap.total||0:p.total;
const md=d=>`${+d.slice(5,7)}/${+d.slice(8)}`;
function wageMsg(y,m,p){const L=[`[네스트퍼니처 ${y}년 ${m}월 정산] ${p.n}님`];
  if(p.days){L.push("",`시공 ${p.days}일 × ${won(p.rate)} = ${won(p.days*p.rate)}`);p.byJob.filter(b=>b.i.length).forEach(b=>L.push(`- ${b.j.name}: ${b.i.map(md).join(", ")} (${b.i.length}일)`));
    if(p.shared)L.push(`(같은 날 두 현장은 하루로 계산)`);}
  if(p.as){L.push("",`AS ${p.as}일 × ${won(p.asRate)} = ${won(p.as*p.asRate)}`);p.byJob.filter(b=>b.a.length).forEach(b=>L.push(`- ${b.j.name}: ${b.a.map(md).join(", ")}`));}
  if(p.adj)L.push("",`조정 ${sWon(p.adj)}${p.note?` (${p.note})`:""}`);
  L.push("",`합계 ${won(p.total)}`);return L.join("\n");}
const wgBusy=()=>{const a=document.activeElement;return!!(a&&a.tagName==="INPUT"&&a.type!=="checkbox"&&a.closest("#view-wage"));};
function renderWage(){if(!isAdmin)return;
  $("wgUpdate").hidden=pay08;$("wgBody").hidden=!pay08;if(!pay08)return;
  if(wgBusy()){wgLater=true;return;}wgLater=false;
  const W=wageMonth(wgY,wgM),x=W.extra,xv=x.paid&&x.snap?+x.snap.total||0:x.total,xOn=!!(x.people||x.paid);
  $("wgTitle").textContent=`${wgY}년 ${wgM}월`;
  const items=W.people.map(p=>({v:shownPay(p),paid:!!p.paid})).concat(xOn?[{v:xv,paid:!!x.paid}]:[]);
  const tot=items.reduce((a,o)=>a+(o.v||0),0),paid=items.filter(o=>o.paid).reduce((a,o)=>a+(o.v||0),0),miss=items.filter(o=>o.v===null).length;
  $("wgTiles").innerHTML=`<div class="tile ${miss?"warn":""}"><small>이달 줄 돈</small><b>${won(tot)}</b>${miss?`<small>일당 미입력 ${miss}건은 빠짐</small>`:""}</div>
    <div class="tile"><small>지급 완료</small><b>${won(paid)}</b></div>
    <div class="tile ${tot-paid>0?"warn":""}"><small>남은 돈</small><b>${won(tot-paid)}</b></div>
    <div class="tile"><small>시공 연인원</small><b>${W.people.reduce((a,p)=>a+p.days,0)+x.people}일</b>${x.people?`<small>추가 투입 ${x.people}명 포함</small>`:""}</div>`;
  const rt=(r,what="일당")=>r?won(r):`<span class="tag late">${what} 미입력</span>`;
  const head=(name,paidOn,v)=>`<div class="wg-head"><b class="wg-name">${name}</b>${paidOn?`<span class="tag ok">지급 ${fmt(paidOn)}</span>`:""}<b class="wg-sum">${v===null?"—":won(v)}</b></div>`;
  const jobBtn=j=>`<button type="button" class="wg-job" data-j="${esc(j.id)}">${esc(j.name)}</button>`;
  const card=p=>{const changed=p.paid&&p.snap&&p.total!==null&&p.total!==+p.snap.total,hints=[p.later&&`오늘 이후 예정 ${p.later}일 포함`,p.shared&&`같은 날 두 현장 ${p.shared}일은 하루로 계산`].filter(Boolean);
    return`<div class="wg-card${p.paid?" done":""}">${head(esc(p.n),p.paid,shownPay(p))}
      ${p.days?`<div class="wg-line">시공 ${p.days}일 × ${rt(p.rate)}</div>`:""}
      ${p.as?`<div class="wg-line">AS ${p.as}일 × ${rt(p.asRate)}</div>`:""}
      ${p.adj?`<div class="wg-line">조정 ${sWon(p.adj)}${p.note?` · ${esc(p.note)}`:""}</div>`:""}
      ${hints.length?`<div class="hint">${hints.join(" · ")}</div>`:""}
      ${changed?`<div class="hint wg-warn">지급한 뒤 일정이 바뀌었어요. 지금 계산하면 ${won(p.total)}이에요.</div>`:""}
      <details class="wg-more" data-wgd="${esc(p.n)}"${wgOpen.has(p.n)?" open":""}><summary>현장별 날짜 · 조정 · 문자</summary><div class="wg-in">
        <ul class="wg-jobs">${p.byJob.map(b=>`<li>${jobBtn(b.j)} <span class="hint">${[b.i.length&&`시공 ${b.i.map(fmtW).join(", ")}`,b.a.length&&`AS ${b.a.map(fmtW).join(", ")}`].filter(Boolean).join(" · ")}</span></li>`).join("")||`<li class="hint">이달 일정이 없어요.</li>`}</ul>
        <div class="wg-adj"><label>조정 금액(원)<input class="swon" data-wgadj="${esc(p.n)}" value="${sComma(p.adj)}" placeholder="예: -125,000"></label><label>메모<input data-wgnote="${esc(p.n)}" value="${esc(p.note)}" placeholder="예: 반일 1번, 유류비"></label></div>
        <div><button class="btn ghost sm" type="button" data-wgmsg="${esc(p.n)}"${p.total===null?" disabled":""}>정산 문자 복사</button></div></div></details>
      <label class="check wg-paid"><input type="checkbox" data-wgpaid="${esc(p.n)}"${p.paid?" checked":""}${!p.paid&&p.total===null?" disabled":""}>지급 완료</label></div>`;};
  const xcard=!xOn?"":`<div class="wg-card${x.paid?" done":""}">${head("마감 추가 투입",x.paid,xv)}
      <div class="wg-line">연인원 ${x.people}명 × ${rt(x.rate,"1인 일당")}</div>
      <div class="hint">현장에 '추가 인원'으로만 적은 인원이에요 (이름 없이 기록).</div>
      <details class="wg-more" data-wgd=" x"${wgOpen.has(" x")?" open":""}><summary>날짜별 보기</summary><div class="wg-in"><ul class="wg-jobs">${x.list.map(o=>`<li>${jobBtn(o.j)} <span class="hint">${fmtW(o.x.date)} · ${+o.x.people}명${o.x.note?` · ${esc(o.x.note)}`:""}</span></li>`).join("")}</ul></div></details>
      <label class="check wg-paid"><input type="checkbox" data-wgxpaid${x.paid?" checked":""}${!x.paid&&x.total===null?" disabled":""}>지급 완료</label></div>`;
  $("wgList").innerHTML=W.people.map(card).join("")+xcard||`<div class="empty">${wgM}월에는 시공자가 잡힌 시공·AS 일정이 없어요.</div>`;
  $("wgNote").innerHTML=W.none.length?`<span class="tag late">시공자 미배정</span> ${W.none.map(o=>`${esc(o.j.name)} ${o.n}일`).join(", ")}은 시공자가 정해지지 않은 날이라 정산에 안 들어가요.`:"";
  const roster=[...new Set([...CREW,...jobs.flatMap(crewAll),...jobs.flatMap(j=>j.f.as.map(a=>a.crew)),...Object.keys(wage.rates.day)].filter(Boolean))];
  $("wgRates").innerHTML=roster.map(n=>`<label>${esc(n)}<input class="won" inputmode="numeric" data-rate="${esc(n)}" value="${comma(rateOf(n))}" placeholder="일당(원)"></label>`).join("")+
    `<label>마감 추가 투입 1인<input class="won" inputmode="numeric" data-ratex value="${comma(wage.rates.extra)}" placeholder="1인 일당(원)"></label>
    <label>AS 하루<input class="won" inputmode="numeric" data-rateas value="${comma(wage.rates.as)}" placeholder="비우면 각자 일당"></label>`;}
async function saveWage(key,data){$("wgSaved").textContent="저장 중…";
  const {error}=await sb.from("crew_pay").upsert({key,data,updated_at:new Date().toISOString()});
  $("wgSaved").textContent=error?"저장 못 함 · 인터넷 확인 후 다시 고쳐 주세요":"저장됨";return!error;}
function wmEdit(n,fn){const key=ymKey(wgY,wgM),rec=normWm(JSON.parse(JSON.stringify(wmOf(key))));
  fn(n===null?rec.x:(rec.p[n]??={adj:0,note:"",paid:"",snap:null}));wage.months[key]=rec;saveWage(key,rec);renderWage();}
$("view-wage").addEventListener("change",e=>{const t=e.target,d=t.dataset||{};
  if("rate" in d||"ratex" in d||"rateas" in d){const box=$("wgRates"),day={...wage.rates.day};
    box.querySelectorAll("[data-rate]").forEach(i=>{const n=toNum(i.value);if(n)day[i.dataset.rate]=n;else delete day[i.dataset.rate];});
    wage.rates=normRates({day,extra:box.querySelector("[data-ratex]").value,as:box.querySelector("[data-rateas]").value});laborCache=null;saveWage("rates",wage.rates);render();return;}
  if("wgadj" in d){const v=Math.round(sNum(t.value));wmEdit(d.wgadj,o=>{o.adj=v;});return;}
  if("wgnote" in d){const v=t.value.trim();wmEdit(d.wgnote,o=>{o.note=v;});return;}
  if("wgpaid" in d||"wgxpaid" in d){const W=wageMonth(wgY,wgM),p="wgpaid" in d?W.people.find(x=>x.n===d.wgpaid):W.extra;
    wmEdit("wgpaid" in d?d.wgpaid:null,o=>{if(t.checked&&p&&p.total!==null){o.paid=TODAY;o.snap={total:p.total,days:p.days,as:p.as,rate:p.rate,asRate:p.asRate,adj:p.adj,people:p.people};}else{o.paid="";o.snap=null;}});}});
$("view-wage").addEventListener("focusout",()=>setTimeout(()=>{if(wgLater&&!wgBusy())renderWage();},0));
$("view-wage").addEventListener("toggle",e=>{const d=e.target;if(d.dataset&&"wgd" in d.dataset)(d.open?wgOpen.add(d.dataset.wgd):wgOpen.delete(d.dataset.wgd));},true);
document.addEventListener("click",async e=>{const b=e.target.closest("[data-wgmsg]");if(!b)return;
  const p=wageMonth(wgY,wgM).people.find(x=>x.n===b.dataset.wgmsg);if(!p||p.total===null)return;
  flash(b,await copyText(wageMsg(wgY,wgM,p))?"복사됨":"복사 안 됨",true);});
$("wgPrev").onclick=()=>{if(--wgM<1){wgM=12;wgY--}renderWage()};
$("wgNext").onclick=()=>{if(++wgM>12){wgM=1;wgY++}renderWage()};
$("wgNow").onclick=()=>{wgY=now.getFullYear();wgM=now.getMonth()+1;renderWage()};
async function loadWage(){if(!isAdmin)return;
  const {data,error}=await sb.from("crew_pay").select("*");
  pay08=!(error&&/crew_pay|42P01|PGRST20/i.test(`${error.code} ${error.message}`));
  if(!error){const w={rates:normRates(),months:{}};(data||[]).forEach(r=>{if(r.key==="rates")w.rates=normRates(r.data);else if(/^\d{4}-\d{2}$/.test(r.key))w.months[r.key]=normWm(r.data);});wage=w;}
  laborCache=null;
  if(pay08&&!error&&!wageChan)wageChan=sb.channel("nest-pay").on("postgres_changes",{event:"*",schema:"public",table:"crew_pay"},()=>loadWage().then(render)).subscribe();}

/* 결산 (관리자). 매출 = 계약금액(부가세 별도 계약은 부가세 뺀 금액), 매입 = 현장 원가(자재·인건비·외주 등), 지출 = 현장에 딸리지 않은 회사 비용.
   현장 매출·매입의 기준 달 = 시공 시작한 달(없으면 계약일), 지출은 쓴 날의 달. 매달 반복 지출은 시작한 달부터 이번 달까지(끝나는 달이 있으면 거기까지) */
let salesY=now.getFullYear(),salesM=0,expenses=[],pay09=true,expChan=null,expEdit=null;
const EXP_CATS=["임대료","차량·유류","공구·장비","소모품","식대·복리후생","광고·홍보","급여·4대보험","세금·공과금","통신·사무","수수료·기타"];
const jobMonth=j=>(j.i.start||moneyOf(j.id).contract.date||"").slice(0,7);
const bar=(v,max,cls="")=>!v?"":`<span class="bar ${cls}"><i style="width:${max>0?Math.max(0,Math.min(100,v/max*100)):0}%"></i></span>`;
const curYM=()=>TODAY.slice(0,7);
const expIn=(x,ym)=>x.repeat?x.day.slice(0,7)<=ym&&ym<=curYM()&&(!x.until||ym<=x.until):x.day.slice(0,7)===ym;
const expSum=yms=>expenses.reduce((a,x)=>a+x.amount*yms.filter(m=>expIn(x,m)).length,0);
const yearMonths=y=>[...Array(12)].map((_,k)=>`${y}-${pad(k+1)}`);
const normExp=r=>({id:r.id,day:String(r.day||"").slice(0,10),cat:r.cat||EXP_CATS[EXP_CATS.length-1],amount:+r.amount||0,note:r.note||"",repeat:!!r.repeat,until:r.until||""});
function renderSales(){
  const counted=jobs.filter(j=>moneyOf(j.id).contract.amount>0||jobCosts(j).length>0);
  const years=[...new Set([now.getFullYear(),...counted.map(j=>+jobMonth(j).slice(0,4)).filter(Boolean),...expenses.map(x=>+x.day.slice(0,4)).filter(Boolean)])].sort((a,b)=>b-a);
  if(!years.includes(salesY))salesY=years[0];
  ["sa","ex"].forEach(k=>{$(k+"-y").innerHTML=years.map(y=>`<option value="${y}" ${y===salesY?"selected":""}>${y}년</option>`).join("");$(k+"-m").value=String(salesM);});
  const yms=salesM?[`${salesY}-${pad(salesM)}`]:yearMonths(salesY),inPer=j=>yms.includes(jobMonth(j));
  const sel=counted.filter(inPer),undated=counted.filter(j=>!jobMonth(j)).length;
  const rev=a=>a.reduce((s,j)=>s+moneyOf(j.id).contract.amount,0),buy=a=>a.reduce((s,j)=>s+jobBuy(j),0),lab=a=>a.reduce((s,j)=>s+jobLabor(j),0);
  const cashIn=list=>jobs.reduce((s,j)=>s+moneyOf(j.id).pays.filter(p=>p.paid&&list.includes((p.paidOn||"").slice(0,7))).reduce((a,p)=>a+p.amount,0),0);
  const R=rev(sel),B=buy(sel),L=lab(sel),C=B+L,E=expSum(yms),P=R-C-E;
  $("saTiles").innerHTML=`<div class="tile"><small>매출</small><b>${won(R)}</b><small>현장 ${sel.length}곳 · 부가세 뺀 금액</small></div><div class="tile"><small>매입</small><b>${won(B)}</b><small>자재·외주·운반</small></div>
    <div class="tile"><small>시공비</small><b>${won(L)}</b><small>시공·추가 투입 인건비</small></div>
    <div class="tile"><small>지출 (회사 비용)</small><b>${won(E)}</b><small><button class="linkish" type="button" data-tab="exp">지출 내역 보기</button></small></div><div class="tile ${P<0?"bad":""}"><small>순이익</small><b>${won(P)}</b><small>이익률 ${pct(P,R)}</small></div>
    <div class="tile"><small>실제 들어온 돈 (입금)</small><b>${won(cashIn(yms))}</b></div>`;
  $("saYearsBox").hidden=!!salesM;$("saMonthsBox").hidden=!!salesM;
  const row=(label,attr,n,r,b,l,e,max)=>{const c=b+l,p=r-c-e,any=r||c||e;
    return`<tr ${attr} tabindex="0" class="${any?"":"zero"}"><td class="job"><b>${label}</b>${n?`<small class="m-only">${n}곳</small>`:""}</td><td class="num d-only">${n||""}</td><td class="num" data-l="매출">${r?won(r):"—"}</td><td class="num" data-l="매입">${b?won(b):"—"}</td><td class="num" data-l="시공비">${l?won(l):"—"}</td><td class="num" data-l="지출">${e?won(e):"—"}</td><td class="num ${p<0?"neg":""}" data-l="순이익">${any?won(p):"—"}</td><td class="num" data-l="이익률">${r?pct(p,r):"—"}</td><td class="barcell">${bar(r,max)}${bar(c+e,max,"cost")}</td></tr>`;};
  if(!salesM){
    const ys=[...years].sort((a,b)=>a-b).map(y=>{const ym=yearMonths(y),js=counted.filter(j=>ym.includes(jobMonth(j)));return{y,n:js.length,r:rev(js),b:buy(js),l:lab(js),e:expSum(ym)};});
    const ymax=Math.max(1,...ys.map(x=>Math.max(x.r,x.b+x.l+x.e)));
    $("saYears").innerHTML=ys.map(x=>row(`${x.y}년`,`data-year="${x.y}"`,x.n,x.r,x.b,x.l,x.e,ymax)).join("");
    const months=yearMonths(salesY).map((ym,k)=>{const js=counted.filter(j=>jobMonth(j)===ym);return{k:k+1,n:js.length,r:rev(js),b:buy(js),l:lab(js),e:expSum([ym])};});
    const max=Math.max(1,...months.map(x=>Math.max(x.r,x.b+x.l+x.e)));
    $("saMonths").innerHTML=months.map(x=>row(`${x.k}월`,`data-month="${x.k}"`,x.n,x.r,x.b,x.l,x.e,max)).join("");}
  $("saJobs").innerHTML=sel.length?[...sel].sort((a,b)=>jobMonth(a).localeCompare(jobMonth(b))).map(j=>{const m=moneyOf(j.id),r=m.contract.amount,b=jobBuy(j),l=jobLabor(j),c=b+l,auto=autoCosts(j,m).length;
    return`<tr data-j="${esc(j.id)}" tabindex="0"><td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small><small class="m-only">${sub(j)?" · ":""}${+jobMonth(j).slice(5)}월 기준</small></td><td class="d-only"><span class="d">${+jobMonth(j).slice(5)}월</span></td><td class="num" data-l="매출">${won(r)}</td><td class="num" data-l="매입">${won(b)}${!m.costs.some(x=>!isLabor(x))?` <span class="tag wait">미입력</span>`:""}</td><td class="num" data-l="시공비">${won(l)}${auto?` <span class="tag wait" title="시공 인건비를 일정 × 일당으로 자동 계산">자동</span>`:!l?` <span class="tag wait">미입력</span>`:""}</td><td class="num ${r-c<0?"neg":""}" data-l="현장 이익">${won(r-c)}</td><td class="num" data-l="이익률">${pct(r-c,r)}</td></tr>`}).join("")
    :`<tr><td colspan="7" class="hint">이 기간에 계약금액이나 매입·시공비를 넣은 현장이 없어요.</td></tr>`;
  const cats=COST_CATS.map(c=>({c,v:sel.reduce((s,j)=>s+jobCosts(j).filter(x=>x.cat===c).reduce((a,x)=>a+x.amount,0),0)})).filter(x=>x.v);
  const catRows=(list,tot,head)=>list.length?`<tr class="grp"><td><b>${head}</b></td><td class="num"><b>${won(tot)}</b></td><td class="num">${pct(tot,C)}</td><td></td></tr>`+list.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${won(x.v)}</td><td class="num">${pct(x.v,C)}</td><td class="barcell">${bar(x.v,C,"cost")}</td></tr>`).join(""):"";
  $("saCosts").innerHTML=cats.length?catRows(cats.filter(x=>!LABOR_CATS.includes(x.c)),B,"매입")+catRows(cats.filter(x=>LABOR_CATS.includes(x.c)),L,"시공비")
    :`<tr><td colspan="4" class="hint">매입·시공비 기록이 없어요.</td></tr>`;
  renderExpenses(yms,E);
  $("saNote").textContent=`매출은 계약금액이에요(부가세 별도 계약은 부가세를 뺀 금액). 매입은 자재비·외주·가공·운반 등이고, 시공비는 시공 인건비와 추가 투입 인건비예요. 현장 매출·매입·시공비의 기준 달은 시공을 시작한 달이고(10월 30일 시작이면 10월), 시공일이 없으면 계약일 기준이에요. 지출은 쓴 날의 달에 들어가고, 매달 반복 지출은 이번 달까지만 셉니다.${pay08&&Object.keys(wage.rates.day).length?" 시공 인건비를 직접 적지 않은 현장은 정산 › 시공자 정산의 일당 × 시공일로 자동 계산해요.":""}${undated?` 시공일·계약일이 모두 없는 현장 ${undated}곳은 빠져 있어요.`:""}`;
}
function renderExpenses(yms,E){
  $("exUpdate").hidden=pay09;$("exBody").hidden=!pay09;$("exFilt").hidden=!pay09;if(!pay09)return;
  const list=expenses.map(x=>({x,n:yms.filter(m=>expIn(x,m)).length})).filter(o=>o.n).sort((a,b)=>b.x.day.localeCompare(a.x.day));
  const monthly=expenses.filter(x=>x.repeat&&expIn(x,curYM())).reduce((a,x)=>a+x.amount,0);
  $("exTiles").innerHTML=`<div class="tile"><small>지출 합계 (${salesM?`${salesY}년 ${salesM}월`:`${salesY}년`})</small><b>${won(E)}</b><small>${list.length}건</small></div>
    <div class="tile"><small>매달 나가는 돈 (이번 달 기준)</small><b>${won(monthly)}</b><small>임대료처럼 매달 체크한 지출</small></div>`;
  const cats=EXP_CATS.map(c=>({c,v:list.filter(o=>o.x.cat===c).reduce((a,o)=>a+o.x.amount*o.n,0)})).filter(o=>o.v);
  $("exCats").innerHTML=cats.length?cats.map(o=>`<tr><td>${esc(o.c)}</td><td class="num">${won(o.v)}</td><td class="num">${pct(o.v,E)}</td><td class="barcell">${bar(o.v,E,"cost")}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">이 기간에 적은 지출이 없어요.</td></tr>`;
  $("exList").innerHTML=list.length?list.map(({x,n})=>`<tr data-ex="${esc(x.id)}" tabindex="0"><td><span class="d">${fmtW(x.day)}</span></td><td>${esc(x.cat)}</td><td class="num push">${won(x.amount*n)}${n>1?` <small class="hint">${won(x.amount)} × ${n}달</small>`:""}</td>
    <td class="full">${x.repeat?`<span class="tag soon">매달${x.until?` · ~${+x.until.slice(5)}월`:""}</span> `:""}${esc(x.note)}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">이 기간에 적은 지출이 없어요. 아래에서 추가해 주세요.</td></tr>`;}
function fillExpForm(x){expEdit=x?x.id:null;
  $("ex-day").value=x?x.day:TODAY;$("ex-cat").value=x?x.cat:EXP_CATS[0];$("ex-amt").value=x?comma(x.amount):"";$("ex-note").value=x?x.note:"";
  $("ex-rep").checked=!!(x&&x.repeat);$("ex-until").value=x?x.until:"";$("ex-untilBox").hidden=!$("ex-rep").checked;
  $("ex-save").textContent=x?"고치기":"지출 추가";$("ex-formTitle").textContent=x?"지출 고치기":"지출 적기";$("ex-del").hidden=!x;$("ex-cancel").hidden=!x;$("ex-err").hidden=true;}
async function saveExp(){const row={day:$("ex-day").value,cat:$("ex-cat").value,amount:toNum($("ex-amt").value),note:$("ex-note").value.trim(),repeat:$("ex-rep").checked,until:$("ex-rep").checked?$("ex-until").value:""};
  const err=t=>{$("ex-err").textContent=t;$("ex-err").hidden=false;};
  if(!row.day)return err("날짜를 넣어 주세요.");if(!row.amount)return err("금액을 넣어 주세요.");
  if(row.until&&row.until<row.day.slice(0,7))return err("반복이 끝나는 달이 시작한 달보다 빨라요.");
  $("ex-save").disabled=true;
  const {data,error}=expEdit?await sb.from("expenses").update(row).eq("id",expEdit).select():await sb.from("expenses").insert(row).select();
  $("ex-save").disabled=false;if(error)return err("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");
  const r=data&&data[0]?normExp(data[0]):null;if(r){expenses=expenses.filter(x=>x.id!==r.id);expenses.push(r);}
  fillExpForm(null);renderSales();}
async function delExp(){if(!expEdit)return;const {error}=await sb.from("expenses").delete().eq("id",expEdit);
  if(error){$("ex-err").textContent="지우지 못했어요. 다시 눌러 주세요.";$("ex-err").hidden=false;return;}
  expenses=expenses.filter(x=>x.id!==expEdit);fillExpForm(null);renderSales();}
async function loadExpenses(){if(!isAdmin){expenses=[];return;}
  const {data,error}=await sb.from("expenses").select("*").order("day");
  pay09=!(error&&/expenses|42P01|PGRST20/i.test(`${error.code} ${error.message}`));
  if(!error)expenses=(data||[]).map(normExp).filter(x=>x.day);
  if(pay09&&!error&&!expChan)expChan=sb.channel("nest-exp").on("postgres_changes",{event:"*",schema:"public",table:"expenses"},()=>loadExpenses().then(()=>{if(isAdmin)renderSales();})).subscribe();}
$("ex-cat").innerHTML=EXP_CATS.map(c=>`<option>${esc(c)}</option>`).join("");
$("ex-rep").onchange=e=>{$("ex-untilBox").hidden=!e.target.checked;};
$("ex-save").onclick=saveExp;$("ex-del").onclick=delExp;$("ex-cancel").onclick=()=>fillExpForm(null);
fillExpForm(null);
document.addEventListener("click",e=>{const r=e.target.closest("[data-ex]");if(!r)return;const x=expenses.find(o=>o.id===r.dataset.ex);if(x){fillExpForm(x);$("ex-form").scrollIntoView({behavior:"smooth",block:"center"});}});
document.addEventListener("click",e=>{const r=e.target.closest("[data-year]");if(r){salesY=+r.dataset.year;salesM=0;renderSales();}});
["sa","ex"].forEach(k=>{$(k+"-y").onchange=e=>{salesY=+e.target.value;renderSales()};$(k+"-m").onchange=e=>{salesM=+e.target.value;renderSales()};});
document.addEventListener("click",e=>{const r=e.target.closest("[data-month]");if(r){salesM=+r.dataset.month;renderSales();}});

/* 견적서 (관리자). 앱에서 품목을 넣어 작성 → 미리보기·인쇄(PDF) → 고객에게 링크(est.html?t=열쇠) → 계약으로 확정하면 계약금액·입금 일정이 수금·결산에 들어감.
   같은 견적의 2차·3차는 base(처음 견적 id)로 묶음. 회사 정보·도장과 단가표는 est_conf */
const E=window.NEST_EST;
(()=>{const st=document.createElement("style");st.textContent=E.css;document.head.appendChild(st);})();
let ests=[],estConf={company:E.normCompany(),items:[]},est10=true,estChan=null,estCat="",esCur=null,esSnap="",esPreview=false,esFrom=null,coStamp="",coFilled=false;
const EST_ST={draft:"작성중",sent:"보냄",won:"계약",lost:"안 됨"},EST_TONE={draft:"wait",sent:"soon",won:"ok",lost:"wait"};
const normEstRow=r=>({id:r.id,job_id:r.job_id||"",token:r.token||"",status:EST_ST[r.status]?r.status:"draft",d:E.norm(r.data),views:+r.views||0,first:r.first_seen||"",seen:r.seen_at||"",created:r.created_at||""});
const normLib=d=>(Array.isArray(d&&d.list)?d.list:[]).map(x=>({name:String(x.name||"").slice(0,120),spec:String(x.spec||"").slice(0,120),mat:String(x.mat||"").slice(0,160),hw:String(x.hw||"").slice(0,120),unit:String(x.unit||"").slice(0,10),price:toNum(x.price)})).filter(x=>x.name);
const estTag=e=>`<span class="tag ${EST_TONE[e.status]}">${EST_ST[e.status]}</span>`;
const estUrl=t=>new URL(`est.html?t=${t}`,location.href.split(/[?#]/)[0]).href;
const estMsg=e=>`[네스트퍼니처 견적서]\n\n${e.d.cust.name?`${e.d.cust.name.replace(/\s*(고객|고객님|님)$/,"")} 고객님, `:""}요청하신 견적서를 보내 드려요.\n아래 링크를 누르면 보실 수 있어요.\n${estUrl(e.token)}`;
const seenTxt=ts=>{if(!ts)return"";const d=new Date(ts);return`${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const estOfJob=id=>ests.filter(e=>e.job_id===id).sort((a,b)=>(a.d.date||"").localeCompare(b.d.date||"")||a.d.ver-b.d.ver);
async function loadEst(){if(!isAdmin){ests=[];return;}
  const [a,b]=await Promise.all([sb.from("estimates").select("*").order("created_at"),sb.from("est_conf").select("*")]);
  est10=!(a.error&&/estimates|42P01|PGRST20/i.test(`${a.error.code} ${a.error.message}`));
  if(!a.error)ests=(a.data||[]).map(normEstRow);
  if(!b.error){const rows=b.data||[],c=rows.find(r=>r.key==="company"),it=rows.find(r=>r.key==="items");estConf={company:E.normCompany(c&&c.data),items:normLib(it&&it.data)};}
  if(!coFilled||!$("esCoBox").open)fillCompany();
  if(est10&&!a.error&&!estChan)estChan=sb.channel("nest-est").on("postgres_changes",{event:"*",schema:"public",table:"estimates"},estRefresh).on("postgres_changes",{event:"*",schema:"public",table:"est_conf"},estRefresh).subscribe();}
function estRefresh(){loadEst().then(()=>{if(!isAdmin)return;renderEst();renderHome();if(viewing)renderView();if(esCur){const r=ests.find(x=>x.id===esCur.id);if(r){esCur={...esCur,status:r.status,views:r.views,seen:r.seen,first:r.first,job_id:esCur.job_id};renderEsMeta();}}});}
function renderEst(){
  $("esUpdate").hidden=est10;$("esBody").hidden=!est10;$("esNew").hidden=!est10;if(!est10)return;
  const cats=[["","전체",()=>true],...Object.keys(EST_ST).map(k=>[k,EST_ST[k],e=>e.status===k])];
  if(!cats.some(c=>c[0]===estCat))estCat="";
  $("esChips").innerHTML=cats.map(([k,l,fn])=>`<button class="chip${k===estCat?" on":""}" type="button" data-escat="${k}" aria-pressed="${k===estCat}">${l} <b>${ests.filter(fn).length}</b></button>`).join("");
  const list=ests.filter(cats.find(c=>c[0]===estCat)[2]).sort((a,b)=>(b.d.date||"").localeCompare(a.d.date||"")||b.created.localeCompare(a.created));
  $("esList").innerHTML=list.length?list.map(e=>{const t=E.calc(e.d),j=e.job_id&&jobs.find(x=>x.id===e.job_id);
    return`<tr data-es="${esc(e.id)}" tabindex="0"><td class="job"><b>${esc(e.d.cust.name||e.d.title||"(업체명 없음)")}</b>${e.d.ver>1?` <span class="tag soon">${e.d.ver}차</span>`:""}<small>${[e.d.cust.name?esc(e.d.title):"",j?`현장 ${esc(j.name)}`:""].filter(Boolean).join(" · ")}</small></td>
      <td data-l="견적일"><span class="d">${fmtW(e.d.date)}</span></td><td class="num" data-l="합계">${won(t.total)}</td><td data-l="상태">${estTag(e)}</td>
      <td data-l="고객 확인">${e.views?`${e.views}번 열어 봄 <small class="hint">${seenTxt(e.seen)}</small>`:e.status==="sent"?`<span class="hint">아직 안 열어 봄</span>`:"—"}</td></tr>`;}).join("")
    :`<tr><td colspan="5" class="hint">${ests.length?"이 분류에 해당하는 견적서가 없어요.":"아직 견적서가 없어요. 위의 <b>+ 새 견적서</b>를 눌러 시작해 보세요."}</td></tr>`;
  const co=estConf.company;
  $("esCoSum").textContent=co.name||co.tel||co.bizNo?`${co.name||"상호 없음"} · ${co.stamp?"도장 있음":"도장 없음"}`:"아직 안 넣었어요. 견적서에 들어갈 회사 정보를 넣어 주세요.";
  $("esLibSum").textContent=estConf.items.length?`${estConf.items.length}개`:"아직 없어요";
  $("libList").innerHTML=estConf.items.length?estConf.items.map((x,k)=>`<tr data-lib="${k}" tabindex="0"><td class="job"><b>${esc(x.name)}</b>${x.mat||x.hw?`<small>${esc([x.mat,x.hw].filter(Boolean).join(" · "))}</small>`:""}</td><td data-l="규격">${esc(x.spec)||"—"}</td><td data-l="단위">${esc(x.unit)||"—"}</td><td class="num" data-l="단가">${won(x.price)}</td><td class="push"><button class="btn del sm" type="button" data-libdel="${k}">빼기</button></td></tr>`).join("")
    :`<tr><td colspan="5" class="hint">자주 쓰는 품목과 단가를 넣어 두면 견적서를 쓸 때 골라 쓸 수 있어요.</td></tr>`;
  $("es-libnames").innerHTML=estConf.items.map(x=>`<option value="${esc(x.name)}">${esc([x.spec,x.mat,x.unit,x.price?won(x.price):""].filter(Boolean).join(" · "))}</option>`).join("");
  if(!$("es-spaces").children.length)$("es-spaces").innerHTML=E.SPACES.map(([n,en,ds])=>`<option value="${esc(n)}">${esc(`${en} · ${ds}`)}</option>`).join("");}
/* 회사 정보 · 도장 */
function fillCompany(){const co=estConf.company;coFilled=true;
  [["co-name","name"],["co-en","en"],["co-tag","tag"],["co-ceo","ceo"],["co-biz","bizNo"],["co-tel","tel"],["co-email","email"],["co-addr","addr"],["co-web","web"],["co-bank","bank"],["co-prefix","prefix"],["co-memo","memo"]].forEach(([id,k])=>$(id).value=co[k]);
  $("co-valid").value=co.valid||"";coStamp=co.stamp;showStamp();fillTerms("co-terms",co.terms);
  if(!co.name&&!co.tel&&!co.bizNo&&!$("esCoBox").dataset.seen){$("esCoBox").open=true;$("esCoBox").dataset.seen="1";}}
function showStamp(){$("co-stampBox").innerHTML=coStamp?`<img src="${esc(coStamp)}" alt="도장">`:"도장 없음";$("co-stampDel").hidden=!coStamp;}
async function stampData(file){const url=URL.createObjectURL(file);
  try{const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=url;});
    const s=Math.min(1,360/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);let d=c.toDataURL("image/png");if(d.length>350000)d=c.toDataURL("image/jpeg",.85);return d;}
  finally{URL.revokeObjectURL(url);}}
$("co-stamp").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  try{coStamp=await stampData(f);showStamp();$("co-err").hidden=true;}catch(err){$("co-err").textContent="이 사진은 열 수 없어요. 다른 사진(JPG·PNG)으로 올려 주세요.";$("co-err").hidden=false;}};
$("co-stampDel").onclick=()=>{coStamp="";showStamp();};
$("co-save").onclick=async()=>{const v=id=>$(id).value.trim();
  const co=E.normCompany({name:v("co-name"),en:v("co-en"),tag:v("co-tag"),ceo:v("co-ceo"),bizNo:v("co-biz"),tel:v("co-tel"),email:v("co-email"),addr:v("co-addr"),web:v("co-web"),bank:v("co-bank"),prefix:v("co-prefix"),stamp:coStamp,valid:v("co-valid")||0,terms:readTerms("co-terms"),memo:$("co-memo").value.trim(),fmt:2});
  const b=$("co-save");b.disabled=true;const {error}=await sb.from("est_conf").upsert({key:"company",data:co,updated_at:new Date().toISOString()});b.disabled=false;
  if(error){$("co-err").textContent="저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";$("co-err").hidden=false;return;}
  $("co-err").hidden=true;estConf.company=co;fillCompany();renderEst();flash(b,"저장됨",true);};
/* 결제 조건 줄 (회사 기본값·견적서 공용) */
function termRow(box,t){const div=document.createElement("div");div.className="es-term";
  div.innerHTML=`<input class="t-l" value="${esc(t.label)}" placeholder="계약금" aria-label="결제 구분"><input class="t-p" inputmode="decimal" value="${t.pct?E.qtyTxt(t.pct):""}" placeholder="0" aria-label="비율(%)"><span class="t-pc">%</span><input class="t-w" value="${esc(t.when||"")}" placeholder="언제 (예: 계약 체결 시)" aria-label="언제 내는지"><span class="t-a hint"></span><button class="btn del sm" type="button" data-tdel>빼기</button>`;
  $(box).appendChild(div);}
function fillTerms(box,terms){$(box).innerHTML="";terms.forEach(t=>termRow(box,t));}
function readTerms(box){return E.normTerms([...$(box).children].map(r=>({label:r.querySelector(".t-l").value.trim(),pct:r.querySelector(".t-p").value,when:r.querySelector(".t-w").value.trim()})));}
document.addEventListener("click",e=>{const a=e.target.closest("[data-addterm]");if(a){const box=a.dataset.addterm,cur=readTerms(box),used=cur.map(t=>t.label);
    const label=["계약금","중도금","잔금","추가금"].find(l=>!used.includes(l))||"추가금";termRow(box,{label,pct:Math.max(0,100-cur.reduce((s,t)=>s+t.pct,0)),when:E.WHEN[label]||""});if(box==="es-terms")esSum();return;}
  const d=e.target.closest("[data-tdel]");if(d){const box=d.closest(".es-terms");d.closest(".es-term").remove();if(box.id==="es-terms")esSum();}});
/* 단가표 */
async function saveLib(list,btn){const {error}=await sb.from("est_conf").upsert({key:"items",data:{list},updated_at:new Date().toISOString()});
  if(error){if(btn)flash(btn,"저장 못 함",false);return false;}estConf.items=list;renderEst();return true;}
function libPut(x){const list=estConf.items.filter(o=>o.name!==x.name);list.push(x);list.sort((a,b)=>a.name.localeCompare(b.name,"ko"));return list;}
const LIB_IN=[["lib-name","name"],["lib-spec","spec"],["lib-mat","mat"],["lib-hw","hw"],["lib-unit","unit"]];
$("lib-add").onclick=async()=>{const x={price:toNum($("lib-price").value)};LIB_IN.forEach(([id,k])=>x[k]=$(id).value.trim());
  if(!x.name){$("lib-err").textContent="품목 이름을 넣어 주세요.";$("lib-err").hidden=false;return;}
  $("lib-err").hidden=true;const b=$("lib-add");b.disabled=true;const ok=await saveLib(libPut(x),b);b.disabled=false;
  if(ok){[...LIB_IN.map(([id])=>id),"lib-price"].forEach(id=>$(id).value="");flash(b,"넣었어요",true);}};
document.addEventListener("click",async e=>{const d=e.target.closest("[data-libdel]");if(d){e.stopPropagation();const k=+d.dataset.libdel;d.disabled=true;await saveLib(estConf.items.filter((_,i)=>i!==k),d);return;}
  const r=e.target.closest("[data-lib]");if(r){const x=estConf.items[+r.dataset.lib];if(!x)return;LIB_IN.forEach(([id,k])=>$(id).value=x[k]);$("lib-price").value=comma(x.price);$("lib-name").focus();}});
/* 견적서 작성 화면 */
function newEstData(j){const co=estConf.company;
  return E.norm({date:TODAY,valid:co.valid,terms:co.terms,memo:co.memo,vat:"add",rows:[{t:"h",name:""},{t:"i",qty:1}],cust:j?{name:j.name,addr:j.addr,phone:j.i.tel}:{},title:j?j.item:""});}
function jobOpts(sel){const list=jobs.filter(j=>!j.f.closed||j.id===sel).sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  return`<option value="">— 연결 안 함 (계약으로 확정할 때 현장을 새로 만들어요) —</option>`+list.map(j=>`<option value="${esc(j.id)}" ${j.id===sel?"selected":""}>${esc(j.name)}${j.item?` · ${esc(j.item)}`:""}</option>`).join("");}
function esRowEl(r){const div=document.createElement("div");
  const tools=`<span class="es-tools">${r.t==="i"?`<button type="button" data-rt="star" title="단가표에 넣기" aria-label="단가표에 넣기">☆</button>`:""}<button type="button" data-rt="up" title="위로" aria-label="위로">↑</button><button type="button" data-rt="down" title="아래로" aria-label="아래로">↓</button><button type="button" data-rt="del" title="빼기" aria-label="빼기">✕</button></span>`;
  if(r.t==="h"){div.className="es-row head";div.dataset.t="h";div.innerHTML=`<input class="es-nm" list="es-spaces" value="${esc(r.name)}" placeholder="공간 (예: 주방)" aria-label="공간"><input class="es-en" value="${esc(r.en)}" placeholder="영문 (KITCHEN)" aria-label="공간 영문 이름"><input class="es-ds" value="${esc(r.desc)}" placeholder="주요 구성 (예: 하부장 · 상부장 · 아일랜드)" aria-label="주요 구성">${tools}`;return div;}
  div.className="es-row";div.dataset.t="i";
  div.innerHTML=`<input class="es-nm" list="es-libnames" value="${esc(r.name)}" placeholder="품목" aria-label="품목"><input class="es-sp" value="${esc(r.spec)}" placeholder="규격 W×D×H (예: 2400×600×2300)" aria-label="규격"><input class="es-mt" value="${esc(r.mat)}" placeholder="소재 · 마감 (예: 도어 무광 도장)" aria-label="소재 · 마감"><input class="es-hw" value="${esc(r.hw)}" placeholder="하드웨어 (예: Blum 힌지)" aria-label="하드웨어"><input class="es-q" inputmode="decimal" value="${r.qty?E.qtyTxt(r.qty):""}" placeholder="수량" aria-label="수량"><input class="es-u" list="es-units" value="${esc(r.unit)}" placeholder="단위" aria-label="단위"><input class="es-p won" inputmode="numeric" value="${comma(r.price)}" placeholder="단가" aria-label="단가"><span class="es-amt"></span><input class="es-nt" value="${esc(r.note)}" placeholder="비고" aria-label="비고">${tools}`;
  return div;}
function readEstRow(el){const v=c=>(el.querySelector(c)||{}).value||"";
  return el.dataset.t==="h"?{t:"h",name:v(".es-nm").trim(),en:v(".es-en").trim(),desc:v(".es-ds").trim()}:{t:"i",name:v(".es-nm").trim(),spec:v(".es-sp").trim(),mat:v(".es-mt").trim(),hw:v(".es-hw").trim(),qty:v(".es-q"),unit:v(".es-u").trim(),price:toNum(v(".es-p")),note:v(".es-nt").trim()};}
function fillEst(d,jobId){
  $("es-job").innerHTML=jobOpts(jobId);$("es-job").value=jobId||"";if($("es-job").value!==(jobId||""))$("es-job").value="";
  $("es-cname").value=d.cust.name;$("es-cphone").value=d.cust.phone;$("es-caddr").value=d.cust.addr;$("es-cmgr").value=d.cust.mgr;$("es-title").value=d.title;
  $("es-date").value=d.date;$("es-valid").value=d.valid||"";$("es-disc").value=comma(d.disc);$("es-adjs").value=d.adj>0?"+":"-";$("es-adj").value=comma(Math.abs(d.adj));$("es-vat").value=d.vat;$("es-memo").value=d.memo;
  $("es-rows").innerHTML="";d.rows.forEach(r=>$("es-rows").appendChild(esRowEl(r)));fillTerms("es-terms",d.terms);esSum();}
function readEst(){const b=esCur?esCur.d:{};
  return E.norm({no:b.no,ver:b.ver,base:b.base,sentAt:b.sentAt,date:$("es-date").value,valid:$("es-valid").value,
    cust:{name:$("es-cname").value.trim(),phone:$("es-cphone").value.trim(),addr:$("es-caddr").value.trim(),mgr:$("es-cmgr").value.trim()},title:$("es-title").value.trim(),
    rows:[...$("es-rows").children].map(readEstRow),disc:toNum($("es-disc").value),adj:($("es-adjs").value==="+"?1:-1)*toNum($("es-adj").value),vat:$("es-vat").value,terms:readTerms("es-terms"),memo:$("es-memo").value.trim()});}
const esState=()=>JSON.stringify([readEst(),$("es-job").value]);
const esDirty=()=>!$("estSheet").hidden&&esState()!==esSnap;
function esSum(){const d=readEst(),t=E.calc(d);
  [...$("es-rows").children].forEach((el,k)=>{const a=el.querySelector(".es-amt");if(a){const x=E.lineAmt(d.rows[k]||{});a.textContent=x?won(x):"";}});
  const plan=E.payPlan(d.terms,t.total);let n=0;
  [...$("es-terms").children].forEach(el=>{const p=E.normTerms([{label:"x",pct:el.querySelector(".t-p").value}]).length?plan[n++]:null;el.querySelector(".t-a").textContent=p&&t.total?won(p.amount):"";});
  let h=`<span>${d.vat==="incl"?"품목 합계":"공급가 합계"} <b>${won(t.supply)}</b></span>${t.disc?`<span>특별 할인 <b>-${won(t.disc)}</b></span>`:""}${t.adj?`<span>단수 조정 <b>${t.adj<0?"-":"+"}${won(Math.abs(t.adj))}</b></span>`:""}${d.vat==="add"?`<span>공급가액 <b>${won(t.net)}</b></span><span>부가세 <b>${won(t.vat)}</b></span>`:d.vat==="incl"?`<span>공급가액 <b>${won(t.base)}</b> <small>부가세 ${won(t.vat)} 포함</small></span>`:""}<span>총 견적금액 <b>${won(t.total)}</b></span>`;
  if(t.total)h+=`<span class="hint" style="flex-basis:100%">일금 ${E.hangul(t.total)}원정</span>`;
  const sum=d.terms.reduce((a,x)=>a+x.pct,0);
  if(d.terms.length&&Math.abs(sum-100)>0.001)h+=`<span class="neg" style="flex-basis:100%">결제 조건을 합하면 ${E.qtyTxt(sum)}%예요. 100%가 되게 맞춰 주세요.</span>`;
  $("es-sum").innerHTML=h;
  if(esPreview)$("esDoc").innerHTML=E.doc(d,estConf.company);}
function renderEsMeta(){const e=esCur;
  $("esTitle").innerHTML=e?`견적서${e.d.no?` <span class="hint">No. ${esc(e.d.no)}</span>`:""}${e.d.ver>1?` <span class="tag soon">${e.d.ver}차</span>`:""} ${estTag(e)}`:"새 견적서";
  const m=e?[e.views?`고객이 ${e.views}번 열어 봤어요 (처음 ${seenTxt(e.first)}, 마지막 ${seenTxt(e.seen)})`:e.status==="sent"?"고객에게 보냈고 아직 안 열어 봤어요":"",e.status==="won"&&e.job_id?"계약으로 확정한 견적서예요":""].filter(Boolean).join(" · "):"";
  $("esMeta").textContent=m;$("esMeta").hidden=!m;
  ["esCopy","esLost","esOpen","esDel"].forEach(id=>$(id).hidden=!e);
  if(e){$("esOpen").href=estUrl(e.token)+"#me";$("esLost").textContent=e.status==="lost"?"다시 진행으로":"안 됨으로 표시";$("esLost").hidden=e.status==="won";}
  $("esWin").textContent=e&&e.status==="won"?"계약 금액 다시 반영":"계약으로 확정";
  $("esView").textContent=esPreview?"고치기":"미리보기";$("esEdit").hidden=esPreview;$("esPrev").hidden=!esPreview;$("esPrint").hidden=!esPreview;}
function esErr(t){$("es-err").textContent=t;$("es-err").hidden=!t;}
function esAsk(html,bad){$("esAsk").innerHTML=html;$("esAsk").classList.toggle("bad",!!bad);$("esAsk").hidden=!html;if(html)$("esAsk").scrollIntoView({block:"nearest"});}
function openEst(rec,init){
  esCur=rec?{...rec}:null;esPreview=false;esErr("");esAsk("");
  fillEst(rec?rec.d:init.d,rec?rec.job_id:init.job_id||"");esSnap=esState();renderEsMeta();
  if($("estSheet").hidden){esFrom=document.activeElement;$("estSheet").hidden=false;document.body.style.overflow="hidden";}
  $("estSheet").querySelector(".es-card").scrollTop=0;
  if(!rec&&matchMedia("(pointer:fine)").matches)(init.job_id?$("es-title"):$("es-cname")).focus({preventScroll:true});}
function closeEst(force){
  if(!force&&esDirty()){esAsk(`<span>저장하지 않은 내용이 있어요.</span><button class="btn sm" type="button" id="esAskSave">저장하고 닫기</button><button class="btn ghost sm" type="button" id="esAskDrop">저장 안 하고 닫기</button><button class="btn ghost sm" type="button" id="esAskNo">계속 쓰기</button>`);return false;}
  $("estSheet").hidden=true;esCur=null;esAsk("");$("printArea").innerHTML="";
  if($("jobSheet").hidden&&$("daySheet").hidden)document.body.style.overflow="";
  if(esFrom&&esFrom.isConnected&&esFrom.focus)esFrom.focus({preventScroll:true});esFrom=null;return true;}
/* 견적번호 = 앞글자-견적일 (엑셀과 같음, 예: NF-20261014). 같은 날 두 번째부터 -2, -3 */
function nextNo(date){const pre=estConf.company.prefix,p=`${pre?`${pre}-`:""}${date.replace(/-/g,"")}`;
  const n=ests.map(e=>e.d.no).filter(no=>no===p||no.startsWith(p+"-")).map(no=>no===p?1:+no.slice(p.length+1)||1);return n.length?`${p}-${Math.max(...n)+1}`:p;}
async function saveEst(){
  const d=readEst();d.rows=d.rows.filter(r=>r.t==="h"?r.name:(r.name||r.spec||r.price));
  if(!d.cust.name&&!d.title){esErr("업체나 프로젝트를 넣어 주세요.");return false;}
  if(!d.date)d.date=TODAY;if(!d.no)d.no=nextNo(d.date);
  const job_id=$("es-job").value||null,b=$("esSave");b.disabled=true;esErr("");
  const q=esCur?sb.from("estimates").update({data:d,job_id,updated_at:new Date().toISOString()}).eq("id",esCur.id).select()
    :sb.from("estimates").insert({data:d,job_id,token:b64uRand(18),status:"draft"}).select();
  const {data,error}=await q;b.disabled=false;
  if(error||!data||!data[0]){esErr("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");return false;}
  const r=normEstRow(data[0]);ests=ests.filter(x=>x.id!==r.id);ests.push(r);esCur=r;
  fillEst(r.d,r.job_id);esSnap=esState();renderEsMeta();renderEst();if(viewing)renderView();flash(b,"저장됨",true);return true;}
const esReady=async()=>esCur&&!esDirty()?true:await saveEst();
async function setEstStatus(st,extra){const e=esCur;if(!e)return false;const d={...e.d,...(extra||{})};
  const {data,error}=await sb.from("estimates").update({status:st,data:d,updated_at:new Date().toISOString()}).eq("id",e.id).select();
  if(error||!data||!data[0]){esErr("바꾸지 못했어요. 다시 눌러 주세요.");return false;}
  const r=normEstRow(data[0]);ests=ests.filter(x=>x.id!==r.id);ests.push(r);esCur={...r};esSnap=esState();renderEsMeta();renderEst();if(viewing)renderView();return true;}
$("esSave").onclick=saveEst;
$("esNew").onclick=()=>openEst(null,{d:newEstData(null),job_id:""});
$("esClose").onclick=()=>closeEst();
$("esView").onclick=()=>{esPreview=!esPreview;if(esPreview)$("esDoc").innerHTML=E.doc(readEst(),estConf.company);renderEsMeta();$("estSheet").querySelector(".es-card").scrollTop=0;};
$("esPrint").onclick=()=>{$("printArea").innerHTML=E.doc(readEst(),estConf.company);document.body.classList.add("printing");window.print();};
window.addEventListener("afterprint",()=>{document.body.classList.remove("printing");});
$("esLink").onclick=async()=>{const b=$("esLink");if(!await esReady())return;const ok=await copyText(estMsg(esCur));flash(b,ok?"복사됨 · 문자나 카톡에 붙여넣기":"복사 안 됨",ok);
  if(ok&&esCur.status==="draft")await setEstStatus("sent",{sentAt:new Date().toISOString()});};
$("esLost").onclick=async()=>{if(!esCur)return;if(esDirty()&&!await saveEst())return;await setEstStatus(esCur.status==="lost"?(esCur.d.sentAt||esCur.views?"sent":"draft"):"lost");};
$("esCopy").onclick=async()=>{if(!await esReady())return;const e=esCur,base=e.d.base||e.id,grp=ests.filter(x=>x.id===base||x.d.base===base);
  const d={...e.d,ver:Math.max(e.d.ver,...grp.map(x=>x.d.ver))+1,base,date:TODAY,sentAt:""},b=$("esCopy");b.disabled=true;
  const {data,error}=await sb.from("estimates").insert({data:d,job_id:e.job_id||null,token:b64uRand(18),status:"draft"}).select();b.disabled=false;
  if(error||!data||!data[0]){esErr("복사하지 못했어요. 다시 눌러 주세요.");return;}
  const r=normEstRow(data[0]);ests.push(r);renderEst();openEst(r);flash($("esSave"),`${r.d.ver}차를 만들었어요`,true);};
$("esDel").onclick=()=>esAsk(`<span>이 견적서를 지울까요? 고객에게 보낸 링크도 더 이상 안 열려요. 되돌릴 수 없어요.</span><button class="btn del sm" type="button" id="esDelYes">삭제</button><button class="btn ghost sm" type="button" id="esAskNo">취소</button>`,true);
$("esWin").onclick=async()=>{if(!await esReady())return;const e=esCur,t=E.calc(e.d);
  if(!t.total){esErr("품목 금액을 넣은 뒤 확정해 주세요.");return;}
  const j=e.job_id&&jobs.find(x=>x.id===e.job_id),m=j?moneyOf(j.id):null,plan=E.payPlan(e.d.terms,t.total),keep=m&&m.pays.length;
  esAsk(`<span>합계 <b>${won(t.total)}</b>으로 계약을 확정할까요? ${j?`‘${esc(j.name)}’ 현장에`:`새 현장 ‘${esc(e.d.cust.name||e.d.title)}’을 만들고`} 계약금액 ${won(t.net)}${e.d.vat==="add"?"(부가세 별도)":""}을 넣${keep?"고, 이미 적힌 입금 일정은 그대로 둬요":plan.length?`고 입금 일정 ${plan.map(p=>`${esc(p.label)} ${won(p.amount)}`).join(", ")}을 만들어요`:"어요"}.${m&&m.contract.amount&&m.contract.amount!==t.net?` 지금 적힌 계약금액 ${won(m.contract.amount)}은 바뀌어요.`:""}</span><button class="btn sm" type="button" id="esWinYes">확정</button><button class="btn ghost sm" type="button" id="esAskNo">취소</button>`);};
async function doWin(btn){const e=esCur,t=E.calc(e.d),plan=E.payPlan(e.d.terms,t.total);btn.disabled=true;esErr("");
  try{let jid=e.job_id&&jobs.find(x=>x.id===e.job_id)?e.job_id:"";
    if(!jid){const {data,error}=await sb.from("jobs").insert({name:e.d.cust.name||e.d.title||"새 현장",item:e.d.title,addr:e.d.cust.addr,m:{date:"",done:false},i:{start:"",end:"",crew:[],tel:fmtTel(e.d.cust.phone)},f:{done:false,extra:[],as:[]},updated_at:new Date().toISOString()}).select();
      if(error||!data||!data[0])throw error||new Error("job");jobs.push(norm(data[0].id,data[0]));jid=data[0].id;}
    const m=normMoney(JSON.parse(JSON.stringify(moneyOf(jid))));
    m.contract={date:m.contract.date||TODAY,amount:t.net,vat:e.d.vat==="add"};
    if(!m.pays.length)m.pays=plan.map(p=>({label:p.label,amount:p.amount,due:"",paid:false,paidOn:""}));
    const fd=fillDues(jobs.find(x=>x.id===jid),m);if(fd)m.pays=fd.pays;
    const {error:me}=await sb.from("job_money").upsert({job_id:jid,data:m,updated_at:new Date().toISOString()});if(me)throw me;money[jid]=m;laborCache=null;
    const jj=jobs.find(x=>x.id===jid);if(jj&&jj.i.fl.ct!==m.contract.date)await qcWrite(jj,{col:"i",val:{...jj.i,fl:{...jj.i.fl,ct:m.contract.date}}});
    const {data:ed,error:ee}=await sb.from("estimates").update({status:"won",job_id:jid,updated_at:new Date().toISOString()}).eq("id",e.id).select();if(ee||!ed||!ed[0])throw ee||new Error("est");
    const r=normEstRow(ed[0]);ests=ests.filter(x=>x.id!==r.id);ests.push(r);esCur={...r};
    $("es-job").innerHTML=jobOpts(jid);$("es-job").value=jid;esSnap=esState();render();renderEsMeta();
    esAsk(`<span>계약으로 확정했어요. 계약금액과 입금 일정이 수금·결산에 들어갔어요. 받을 날은 계약금은 계약일, 중도금은 시공 시작일, 잔금은 시공 끝나는 날로 자동으로 들어가요(시공일을 정하면 채워져요).</span><button class="btn sm" type="button" data-jv="${esc(jid)}">현장 보기</button>`);
  }catch(err){esErr("확정하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");btn.disabled=false;}}
$("estSheet").addEventListener("click",async e=>{const t=e.target;
  if(t===$("estSheet")){closeEst();return;}
  if(t.closest("[data-jv]")){closeEst(true);return;}
  if(t.id==="esAskNo"){esAsk("");return;}
  if(t.id==="esAskDrop"){closeEst(true);return;}
  if(t.id==="esAskSave"){if(await saveEst())closeEst(true);return;}
  if(t.id==="esWinYes"){doWin(t);return;}
  if(t.id==="esDelYes"){t.disabled=true;const {error}=await sb.from("estimates").delete().eq("id",esCur.id);
    if(error){t.disabled=false;esErr("지우지 못했어요. 다시 눌러 주세요.");return;}
    ests=ests.filter(x=>x.id!==esCur.id);closeEst(true);renderEst();if(viewing)renderView();return;}
  const rt=t.closest("[data-rt]");if(!rt)return;const row=rt.closest(".es-row"),box=$("es-rows");
  if(rt.dataset.rt==="del"){row.remove();if(!box.children.length)box.appendChild(esRowEl({t:"i",qty:1}));}
  else if(rt.dataset.rt==="up"&&row.previousElementSibling)box.insertBefore(row,row.previousElementSibling);
  else if(rt.dataset.rt==="down"&&row.nextElementSibling)box.insertBefore(row.nextElementSibling,row);
  else if(rt.dataset.rt==="star"){const x=readEstRow(row);if(!x.name){flash(rt,"?",false);row.querySelector(".es-nm").focus();return;}
    rt.disabled=true;const ok=await saveLib(libPut({name:x.name,spec:x.spec,mat:x.mat,hw:x.hw,unit:x.unit,price:x.price}),rt);rt.disabled=false;if(ok)flash(rt,"★",true);return;}
  esSum();});
$("es-addItem").onclick=()=>{const el=esRowEl({t:"i",qty:1});$("es-rows").appendChild(el);esSum();el.querySelector(".es-nm").focus();};
$("es-addHead").onclick=()=>{const el=esRowEl({t:"h",name:""});$("es-rows").appendChild(el);$("es-rows").appendChild(esRowEl({t:"i",qty:1}));esSum();el.querySelector(".es-nm").focus();};
/* 공간 이름을 고르면 영문·주요 구성, 단가표 품목을 고르면 규격·소재·하드웨어·단위·단가를 빈 칸에만 채움 */
$("es-rows").addEventListener("change",e=>{const el=e.target;if(!el.classList.contains("es-nm"))return;const row=el.closest(".es-row");
  const set=(c,v)=>{const i=row.querySelector(c);if(i&&!i.value.trim()&&v)i.value=v;};
  if(row.dataset.t==="h"){const sp=E.SPACES.find(o=>o[0]===el.value.trim());if(sp){set(".es-en",sp[1]);set(".es-ds",sp[2]);esSum();}return;}
  const x=estConf.items.find(o=>o.name===el.value.trim());if(!x)return;
  set(".es-sp",x.spec);set(".es-mt",x.mat);set(".es-hw",x.hw);set(".es-u",x.unit);const p=row.querySelector(".es-p");if(!toNum(p.value)&&x.price)p.value=comma(x.price);set(".es-q","1");esSum();});
$("es-job").onchange=()=>{const j=jobs.find(x=>x.id===$("es-job").value);if(!j)return;
  if(!$("es-cname").value.trim())$("es-cname").value=j.name;if(!$("es-cphone").value.trim())$("es-cphone").value=j.i.tel;if(!$("es-caddr").value.trim())$("es-caddr").value=j.addr;if(!$("es-title").value.trim())$("es-title").value=j.item;};
$("esEdit").addEventListener("input",esSum);$("esEdit").addEventListener("change",esSum);
document.addEventListener("click",e=>{const c=e.target.closest("[data-escat]");if(c){estCat=estCat===c.dataset.escat?"":c.dataset.escat;renderEst();return;}
  const n=e.target.closest("[data-esnew]");if(n){const j=jobs.find(x=>x.id===n.dataset.esnew);if(!$("jobSheet").hidden)closeView();openEst(null,{d:newEstData(j),job_id:j?j.id:""});return;}
  const r=e.target.closest("[data-es]");if(r){const x=ests.find(o=>o.id===r.dataset.es);if(!x)return;if(!$("jobSheet").hidden)closeView();openEst(x);}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest&&e.target.closest("tr[data-es],tr[data-lib]");if(r)r.click();}
  if(e.key==="Escape"&&!$("estSheet").hidden){e.stopImmediatePropagation();if(!$("esAsk").hidden&&$("esAskNo")){esAsk("");return;}closeEst();}},true);
window.addEventListener("beforeunload",e=>{if(esDirty()){e.preventDefault();e.returnValue="";}});

/* form */
function renderCrewPick(selected){
  $("f-crew").innerHTML=CREW.map((c,n)=>`<label><input type="checkbox" id="f-c${n}" value="${esc(c)}" ${selected.includes(c)?"checked":""}>${esc(c)}</label>`).join("");}
const pickedCrew=()=>[...$("f-crew").querySelectorAll("input:checked")].map(x=>x.value);
/* 날짜별 시공자: 기본 시공자와 다르게 들어가는 날(days), 작업이 없는 날(off) */
let dayPick={days:{},off:new Set()};
const formSpan=()=>{const s=$("f-istart").value;return s?spanDays({start:s,end:$("f-iend").value||s,sat:$("f-sat").checked,sun:$("f-sun").checked}):[]};
const formDays=()=>formSpan().filter(d=>!dayPick.off.has(d));
const formCrewOn=d=>Array.isArray(dayPick.days[d])?dayPick.days[d]:pickedCrew();
const sameSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
function renderDayPick(){const span=formSpan(),def=pickedCrew(),names=[...new Set([...CREW,...def,...Object.values(dayPick.days).flat()])];
  const own=Object.keys(dayPick.days).filter(d=>span.includes(d)).length,off=[...dayPick.off].filter(d=>span.includes(d)).length;
  $("f-daysSum").textContent=[own&&`${own}일 바꿈`,off&&`${off}일 쉼`].filter(Boolean).join(" · ");
  $("f-days").innerHTML=!span.length?`<p class="hint" style="margin:0">시공 시작일을 먼저 넣어 주세요.</p>`:span.map(d=>{const o=dayPick.off.has(d),mine=Array.isArray(dayPick.days[d]),list=mine?dayPick.days[d]:def;
    return`<div class="dp-row${o?" off":""}" data-dp="${d}"><div class="dp-date"><span class="d">${fmtW(d)}</span>${o?`<span class="tag wait">쉬는 날</span>`:mine?`<span class="tag soon">바꿈</span>`:`<span class="hint">기본</span>`}</div>
      ${o?"":`<div class="crewpick dp-crew">${names.map(n=>`<label><input type="checkbox" value="${esc(n)}"${list.includes(n)?" checked":""}>${esc(n)}</label>`).join("")||`<span class="hint">명단에 시공자가 없어요.</span>`}</div>`}
      <div class="dp-act"><label class="check"><input type="checkbox" class="dp-off"${o?" checked":""}>쉬는 날</label>${mine&&!o?`<button type="button" class="btn ghost sm dp-reset">기본으로</button>`:""}</div></div>`;}).join("");}
$("f-days").addEventListener("change",e=>{const row=e.target.closest("[data-dp]");if(!row)return;const d=row.dataset.dp;
  if(e.target.classList.contains("dp-off")){if(e.target.checked)dayPick.off.add(d);else dayPick.off.delete(d);}
  else{const picked=[...row.querySelectorAll(".dp-crew input:checked")].map(x=>x.value);if(sameSet(picked,pickedCrew()))delete dayPick.days[d];else dayPick.days[d]=picked;}
  renderDayPick();checkClash();updateMsg();});
$("f-days").addEventListener("click",e=>{const b=e.target.closest(".dp-reset");if(!b)return;delete dayPick.days[b.closest("[data-dp]").dataset.dp];renderDayPick();checkClash();});
/* 고른 시공자가 같은 날 다른 현장(시공·AS)에 잡혀 있으면 알려줌 (날짜별로 바꾼 날도 봄). 저장은 막지 않음 */
function checkClash(){
  const hits={};
  formDays().forEach(d=>formCrewOn(d).forEach(c=>jobs.forEach(o=>{if(editing&&o.id===editing.id)return;
    const busy=(crewOn(o,d).includes(c)&&workDays(o).includes(d))||o.f.as.some(a=>!a.done&&a.crew===c&&a.date===d);
    if(busy)(hits[c+"\u0000"+o.id]??={c,o,ds:[]}).ds.push(d);})));
  const lines=Object.values(hits).map(h=>`<li><b>${esc(h.c)}</b> · ${h.ds.sort().map(fmtW).join(", ")} · ${esc(h.o.name)}</li>`);
  $("f-clash").innerHTML=lines.length?`같은 날 다른 현장에도 잡혀 있어요. 그래도 저장은 돼요.<ul>${lines.join("")}</ul>`:"";
  $("f-clash").hidden=!lines.length;}
/* 시공 색: 새 현장은 날짜가 겹치는 다른 현장과 안 겹치는 색을 자동 선택 */
let colorTouched=false;
const getColor=()=>(document.querySelector('input[name="f-color"]:checked')||{}).value||"orange";
function setColor(c){document.querySelectorAll('input[name="f-color"]').forEach(r=>r.checked=r.value===c);}
function autoColor(){if(colorTouched)return;const mine=formDays();if(!mine.length)return;
  const used=jobs.filter(o=>o!==editing&&workDays(o).some(d=>mine.includes(d))).map(o=>o.i.color);
  setColor(COLORS.find(c=>!used.includes(c))||COLORS[used.length%COLORS.length]);}
["f-istart","f-iend","f-sat","f-sun"].forEach(id=>$(id).addEventListener("change",()=>{autoColor();renderDayPick();checkClash();}));
$("f-crew").addEventListener("change",()=>{renderDayPick();checkClash();});
document.querySelectorAll('input[name="f-color"]').forEach(r=>r.addEventListener("change",()=>{colorTouched=true;}));
let asSeq=0;
function asRow(a={date:"",crew:"",note:"",done:false}){const n=asSeq++;const div=document.createElement("div");div.className="as-row";
  const opts=["",...CREW,...(a.crew&&!CREW.includes(a.crew)?[a.crew]:[])].map(c=>`<option value="${esc(c)}" ${c===a.crew?"selected":""}>${c?esc(c):"담당 미정"}</option>`).join("");
  div.innerHTML=`<label>AS 날짜<input type="date" id="a-d${n}" value="${esc(a.date)}"></label><label>담당<select id="a-c${n}">${opts}</select></label><label class="note">내용<input id="a-n${n}" value="${esc(a.note)}" placeholder="예: 도어 경첩 조정"></label><label class="check"><input type="checkbox" id="a-x${n}" ${a.done?"checked":""}>완료</label><button class="btn del sm" type="button">삭제</button>`;
  div.querySelector("button").onclick=()=>div.remove();$("f-as").appendChild(div);}
let extraSeq=0;
function extraRow(x={date:"",people:1,note:""}){const n=extraSeq++;const div=document.createElement("div");div.className="extra-row";
  div.innerHTML=`<label>날짜<input type="date" id="x-d${n}" value="${esc(x.date)}"></label><label>추가 인원<input type="number" min="1" id="x-p${n}" value="${+x.people||1}"></label><label class="note">사유<input id="x-n${n}" value="${esc(x.note)}" placeholder="예: 도어 재조정"></label><button class="btn del sm" type="button">삭제</button>`;
  div.querySelector("button").onclick=()=>div.remove();$("f-extras").appendChild(div);}

/* 수금 · 원가 입력칸 (관리자) */
let mSeq=0;
const opt=(list,v)=>list.concat(v&&!list.includes(v)?[v]:[]).map(x=>`<option ${x===v?"selected":""}>${esc(x)}</option>`).join("");
function payRow(p){const n=mSeq++;const div=document.createElement("div");div.className="pay-row";
  if(!p){const cur=readMoney(),used=$("mo-pays").children.length,left=billTotal(cur)-cur.pays.reduce((a,x)=>a+x.amount,0);
    p={label:used===0?"계약금":"잔금",amount:used>0&&left>0?left:0,due:"",paid:false,paidOn:""};}
  if(p.auto)div.dataset.auto=p.auto;
  div.innerHTML=`<label>구분<select id="p-l${n}">${opt(PAY_LABELS,p.label)}</select></label><label>금액(원)<input class="won" inputmode="numeric" id="p-a${n}" value="${comma(p.amount)}" placeholder="0"></label><label><span>받을 날 <small class="hint auto-h"${p.auto&&!p.paid?"":" hidden"}>자동 · ${AUTO_TXT[p.auto]||""}</small></span><input type="date" class="due" id="p-d${n}" value="${esc(p.due)}"></label><label class="check"><input type="checkbox" class="paid" id="p-x${n}" ${p.paid?"checked":""}>입금됨</label><label>입금일<input type="date" class="paidOn" id="p-o${n}" value="${esc(p.paidOn)}"></label><button class="btn del sm" type="button">삭제</button>`;
  div.querySelector("button").onclick=()=>{div.remove();moneySummary();};
  div.querySelector(".paid").onchange=e=>{if(e.target.checked&&!div.querySelector(".paidOn").value)div.querySelector(".paidOn").value=TODAY;moneySummary();};
  div.querySelector(".paidOn").onchange=e=>{if(e.target.value)div.querySelector(".paid").checked=true;moneySummary();};
  const manual=()=>{delete div.dataset.auto;div.querySelector(".auto-h").hidden=true;};
  div.querySelector(".due").addEventListener("change",manual);
  div.querySelector("select").addEventListener("change",()=>{if(div.dataset.auto){manual();div.querySelector(".due").value="";}});
  $("mo-pays").appendChild(div);}
function costRow(x={cat:COST_CATS[0],amount:0,note:"",d:TODAY}){const n=mSeq++;const div=document.createElement("div");div.className="cost-row";
  if(x.got)div.dataset.got=x.got;
  div.innerHTML=`<label>항목<select id="c-c${n}">${opt(COST_CATS,x.cat)}</select></label><label>거래처<input class="vend" id="c-v${n}" list="vendList" value="${esc(x.v||"")}" placeholder="예: OO목재"></label><label>금액(원)<input class="won" inputmode="numeric" id="c-a${n}" value="${comma(x.amount)}" placeholder="0"></label><label class="note">메모<input id="c-n${n}" value="${esc(x.note)}" placeholder="예: 도장 외주, 하드웨어"></label><button class="btn del sm" type="button">삭제</button>
    <div class="cost-more"><label>매입일<input type="date" class="cd" id="c-d${n}" value="${esc(x.d||"")}"></label><label>입고 예정일<input type="date" class="cdue" id="c-e${n}" value="${esc(x.due||"")}"></label><label class="check"><input type="checkbox" class="cgot" id="c-g${n}"${x.got?" checked":""}>입고됨</label><label class="check"><input type="checkbox" class="cpaid" id="c-p${n}"${x.paid?" checked":""}>거래처 지급함</label><label>지급일<input type="date" class="cpaidOn" id="c-o${n}" value="${esc(x.paidOn||"")}"></label></div>`;
  div.querySelector(".del").onclick=()=>{div.remove();moneySummary();};
  const lab=()=>div.classList.toggle("labor",LABOR_CATS.includes(div.querySelector("select").value));lab();div.querySelector("select").addEventListener("change",lab);
  div.querySelector(".cpaid").onchange=e=>{if(e.target.checked&&!div.querySelector(".cpaidOn").value)div.querySelector(".cpaidOn").value=TODAY;};
  div.querySelector(".cpaidOn").onchange=e=>{if(e.target.value)div.querySelector(".cpaid").checked=true;};
  $("mo-costs").appendChild(div);}
function readMoney(){
  return normMoney({contract:{date:$("mo-date").value,amount:toNum($("mo-amount").value),vat:$("mo-vat").checked},
    pays:[...$("mo-pays").children].map(r=>({label:r.querySelector("select").value,amount:toNum(r.querySelector(".won").value),due:r.querySelector(".due").value,paid:r.querySelector(".paid").checked,paidOn:r.querySelector(".paidOn").value,auto:r.dataset.auto||""})).filter(p=>p.amount>0||p.due),
    costs:[...$("mo-costs").children].map(r=>{const q=c=>r.querySelector(c);
      return{cat:q("select").value,amount:toNum(q(".won").value),note:q(".note input").value.trim(),v:q(".vend").value,d:q(".cd").value,due:q(".cdue").value,
        got:q(".cgot").checked?(r.dataset.got||TODAY):"",paid:q(".cpaid").checked,paidOn:q(".cpaidOn").value};}).filter(x=>x.amount>0||x.note)});}
function moneySummary(){if(!isAdmin)return;const m=readMoney(),auto=autoCosts(editing,m),t=billTotal(m),r=received(m),c=costSum(m)+auto.reduce((a,x)=>a+x.amount,0),p=m.contract.amount-c;
  moneyHint(m,auto);
  const sched=m.pays.reduce((a,x)=>a+x.amount,0);
  let h=`<span>받을 돈 <b>${won(t)}</b>${m.contract.vat?` <small>부가세 ${won(t-m.contract.amount)} 포함</small>`:""}</span><span>받은 돈 <b>${won(r)}</b></span><span>미수금 <b>${won(Math.max(0,t-r))}</b></span><span>매입 <b>${won(c)}</b></span><span>이익 <b class="${p<0?"neg":""}">${won(p)}</b> <small>${pct(p,m.contract.amount)}</small></span>`;
  if(t&&sched!==t)h+=`<span class="hint" style="flex-basis:100%">입금 일정 합계가 받을 돈보다 ${won(Math.abs(t-sched))} ${sched<t?"적어요":"많아요"}.</span>`;
  $("mo-sum").innerHTML=h;}
function fillMoney(j){if(!isAdmin)return;const m=j?moneyOf(j.id):normMoney();
  $("mo-date").value=m.contract.date;$("mo-amount").value=comma(m.contract.amount);$("mo-vat").checked=m.contract.vat;
  $("mo-pays").innerHTML="";m.pays.forEach(p=>payRow(p));$("mo-costs").innerHTML="";m.costs.forEach(x=>costRow(x));
  moneySummary();}
/* 원가 아래 안내: 마감 추가 투입 인원, 일정 × 일당으로 자동 계산한 인건비 */
function moneyHint(m,auto){const j=editing,out=[];
  if(j&&extraSum(j))out.push(`이 현장 마감 추가 투입: ${extraSum(j)}명 (${j.f.extra.length}회)`);
  if(j&&pay08){const L=laborOf(j),c=Math.round(L.crew);
    auto.forEach(x=>out.push(`${x.cat} ${won(x.amount)} 자동 반영 (시공자 정산 일당 기준)`));
    if(c&&m.costs.some(x=>x.cat==="시공 인건비"))out.push(`일정 × 일당으로는 시공 인건비 ${won(c)}인데, 직접 적은 금액을 써요`);
    if(L.miss.size)out.push(`일당 미입력: ${[...L.miss].join(", ")}`);}
  $("mo-extra-hint").textContent=out.join(" · ");}
$("addPay").onclick=()=>{payRow();moneySummary();};
$("addCost").onclick=()=>costRow();
document.addEventListener("input",e=>{const el=e.target;if(el.classList&&el.classList.contains("won")){const n=toNum(el.value);el.value=comma(n);}
  if(el.classList&&el.classList.contains("swon")){const n=toNum(el.value);el.value=(el.value.trim().startsWith("-")?"-":"")+comma(n);}
  if(el.closest&&el.closest("#sec-money"))moneySummary();});
$("sec-money").addEventListener("change",moneySummary);

/* 현장 출입 정보 · 담당자 번호 · 시공자에게 보낼 문자 */
const fmtPhone=v=>v.replace(/\d{9,11}/g,d=>d.length===11?`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`:d.startsWith("02")?(d.length===10?`02-${d.slice(2,6)}-${d.slice(6)}`:`02-${d.slice(2,5)}-${d.slice(5)}`):d.length===10?`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`:d);
/* 한 번 입력한 담당자 번호는 다른 현장에서 체크만 하면 되게, 모든 현장에서 모아 목록으로 */
let MGRS=[];
function renderMgrPick(selected){
  MGRS=[...new Set([...[...jobs].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).flatMap(j=>j.i.mgr),...selected,...MGRS])].filter(Boolean);
  $("f-mgr").innerHTML=MGRS.length?MGRS.map((c,n)=>`<label><input type="checkbox" id="f-m${n}" value="${esc(c)}" ${selected.includes(c)?"checked":""}>${esc(c)}</label>`).join("")
    :`<span class="hint">아직 입력한 번호가 없어요. 아래 칸에 넣고 추가를 누르세요.</span>`;}
const pickedMgr=()=>[...$("f-mgr").querySelectorAll("input:checked")].map(x=>x.value);
function addMgr(){const v=fmtPhone($("f-newmgr").value.trim());if(!v)return;
  const sel=pickedMgr();if(!sel.includes(v))sel.push(v);MGRS=[v,...MGRS.filter(x=>x!==v)];renderMgrPick(sel);$("f-newmgr").value="";updateMsg();}
$("addMgr").onclick=addMgr;
$("f-newmgr").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addMgr();}});
const dKo=d=>`${+d.slice(5,7)}월 ${+d.slice(8)}일(${WD[dow(d)]})`;
function workText(j){const wd=workDays(j);if(!wd.length)return"";if(wd.length===1)return dKo(wd[0]);
  const skip=new Set(),off=[];for(let d=wd[0];d<=wd[wd.length-1];d=addDays(d,1))if(!wd.includes(d)){if(dow(d)%6===0)skip.add(WD[dow(d)]);else off.push(d);}
  const notes=[skip.size&&`${[..."토일"].filter(x=>skip.has(x)).join("·")} 제외`,off.length&&`${off.map(d=>`${+d.slice(5,7)}/${+d.slice(8)}`).join("·")} 쉼`].filter(Boolean);
  return`${dKo(wd[0])} ~ ${dKo(wd[wd.length-1])}`+(notes.length?` (${notes.join(", ")}, 작업 ${wd.length}일)`:"");}
const msgText=o=>`[네스트퍼니처 현장 주소]\n\n시공일 : ${o.when}\n현장 주소 : ${o.addr}\n공동현관 비밀번호 : ${o.gate}\n세대현관 비밀번호 : ${o.door}\n현장 담당자 전화번호 : ${o.mgr}`;
const jobMsg=j=>msgText({when:workText(j),addr:j.addr,gate:j.i.gate,door:j.i.door,mgr:j.i.mgr.join(", ")});
const formMsg=()=>msgText({when:workText({i:{start:$("f-istart").value,end:$("f-iend").value||$("f-istart").value,sat:$("f-sat").checked,sun:$("f-sun").checked,off:[...dayPick.off]}}),
  addr:$("f-addr").value.trim(),gate:$("f-gate").value.trim(),door:$("f-door").value.trim(),mgr:pickedMgr().join(", ")});
function updateMsg(){$("f-msg").textContent=formMsg();}
["f-addr","f-gate","f-door","f-istart","f-iend","f-sat","f-sun"].forEach(id=>{$(id).addEventListener("input",updateMsg);$(id).addEventListener("change",updateMsg);});
$("f-mgr").addEventListener("change",updateMsg);
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true;}catch(e){}
  const ta=document.createElement("textarea");ta.value=t;ta.setAttribute("readonly","");ta.style.cssText="position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,t.length);let ok=false;try{ok=document.execCommand("copy");}catch(e){}ta.remove();return ok;}
function flash(btn,text,good){if(!btn.dataset.label)btn.dataset.label=btn.textContent;btn.textContent=text;btn.classList.toggle("copied",good);
  clearTimeout(btn._t);btn._t=setTimeout(()=>{btn.textContent=btn.dataset.label;btn.classList.remove("copied");},1600);}
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-cp],[data-msg],[data-clmsg],#copyMsg");if(!b)return;
  let t="";
  if(b.id==="copyMsg")t=formMsg();
  else if(b.dataset.clmsg){const j=jobs.find(x=>x.id===b.dataset.clmsg),c=clOf(b.dataset.clmsg);if(j&&c)t=clMsg(j,c);}
  else if(b.dataset.msg){const j=jobs.find(x=>x.id===b.dataset.msg);if(j)t=jobMsg(j);}
  else t=b.dataset.cp==="f-mgr"?pickedMgr().join(", "):$(b.dataset.cp).value.trim();
  if(!t){flash(b,"비어 있어요",false);return;}
  flash(b,await copyText(t)?"복사됨":"복사 안 됨",true);});

function openForm(j){editing=j||null;dayPick={days:JSON.parse(JSON.stringify((j&&j.i.days)||{})),off:new Set((j&&j.i.off)||[])};$("formTitle").textContent=j?`${j.name} 수정`:"새 현장 등록";$("delBtn").hidden=!j;$("f-err").hidden=true;$("delConfirm").hidden=true;
  const v=j||norm("",{});
  $("f-name").value=v.name;$("f-tel").value=v.i.tel;$("f-item").value=v.item;$("f-addr").value=v.addr;
  $("f-gate").value=v.i.gate;$("f-door").value=v.i.door;$("f-newmgr").value="";renderMgrPick(v.i.mgr);
  $("f-mdate").value=v.m.date;$("f-mdone").checked=v.m.done;
  const fl=v.i.fl;$("f-dwby").value=fl.dw.by;$("f-dwdue").value=fl.dw.due;$("f-dwok").value=fl.dw.ok;$("f-prhow").value=fl.pr.how;$("f-prout").value=fl.pr.out;$("f-prdue").value=fl.pr.due;$("f-prok").value=fl.pr.ok;
  $("dwByList").innerHTML=[...new Set(jobs.map(x=>x.i.fl.dw.by).filter(Boolean))].map(n=>`<option value="${esc(n)}">`).join("");$("f-istart").value=v.i.start;$("f-iend").value=v.i.end;$("f-sat").checked=v.i.sat;$("f-sun").checked=v.i.sun;
  setColor(v.i.color||"orange");colorTouched=!!(j&&j.i.start);
  [...v.i.crew,...Object.values(v.i.days||{}).flat()].forEach(c=>{if(c&&!CREW.includes(c))CREW.push(c)});renderCrewPick(v.i.crew);$("f-newcrew").value="";
  renderDayPick();$("f-daysBox").open=dayCustom(v);checkClash();prForm();
  $("f-fdone").checked=v.f.done;$("f-extras").innerHTML="";v.f.extra.forEach(extraRow);
  $("f-as").innerHTML="";v.f.as.forEach(asRow);
  $("ph-stage").value=guessStage(v);
  $("f-apps").innerHTML="";v.i.apps.forEach(appRow);$("f-chk").value=v.i.chk.join("\n");
  pending=[];renderFiles();renderPhotos();renderCl();fillMoney(j);updateMsg();
  $("form").hidden=false;$("form").scrollIntoView({behavior:"smooth",block:"start"});
  // 새 현장을 PC에서 만들 때만 이름 칸에 커서 (휴대폰은 키패드가 화면을 가려서 안 함)
  if(!j&&matchMedia("(pointer:fine)").matches)$("f-name").focus({preventScroll:true});}
const showErr=m=>{$("f-err").textContent=m;$("f-err").hidden=false};
/* 수정 화면의 도면 · 생산: 외주일 때만 외주처, 납기가 시공 시작보다 늦으면 경고 */
function prForm(){const how=$("f-prhow").value,due=$("f-prdue").value,s=$("f-istart").value,late=!$("f-prok").value&&due&&s&&due>s;
  $("f-prout-l").hidden=!(how==="out"||how==="both");
  $("f-prwarn").hidden=!late;if(late)$("f-prwarn").textContent=`납기(${fmt(due)})가 시공 시작일(${fmt(s)})보다 늦어요. 납기나 시공일을 다시 확인해 주세요.`;}
["f-prhow","f-prdue","f-prok","f-istart"].forEach(id=>$(id).addEventListener("change",prForm));
$("addExtra").onclick=()=>extraRow();
$("addAs").onclick=()=>asRow();
$("addBtn").onclick=()=>openQuick();
/* 빠른 등록: 새 문의는 고객명·전화·주소·실측일만 받아 바로 저장. 나머지는 '자세히 입력'(전체 입력 화면)이나 나중에 수정에서 */
let quickFrom=null;
function openQuick(){["qa-name","qa-tel","qa-addr","qa-mdate"].forEach(id=>$(id).value="");$("qa-err").hidden=true;$("qa-dup").hidden=true;
  quickFrom=document.activeElement;$("quickSheet").hidden=false;document.body.style.overflow="hidden";$("qa-name").focus();}
function closeQuick(){$("quickSheet").hidden=true;if($("jobSheet").hidden)document.body.style.overflow="";if(quickFrom&&quickFrom.isConnected&&quickFrom.focus)quickFrom.focus({preventScroll:true});quickFrom=null;}
function quickDup(){const n=telNum($("qa-tel").value),same=n?jobs.filter(j=>telNum(j.i.tel)===n):[];
  $("qa-dup").innerHTML=same.length?`같은 전화번호로 등록된 현장이 있어요: ${same.map(j=>`<b>${esc(j.name)}</b>${j.item?` (${esc(j.item)})`:""}`).join(", ")}`:"";$("qa-dup").hidden=!same.length;}
$("quickClose").onclick=closeQuick;
$("quickSheet").addEventListener("click",e=>{if(e.target===$("quickSheet"))closeQuick();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("quickSheet").hidden)closeQuick();});
$("qa-tel").addEventListener("input",quickDup);
["qa-tel","f-tel"].forEach(id=>$(id).addEventListener("change",()=>{$(id).value=fmtTel($(id).value);if(id==="qa-tel")quickDup();}));
$("qa-more").onclick=()=>{const v={name:$("qa-name").value.trim(),tel:fmtTel($("qa-tel").value),addr:$("qa-addr").value.trim(),mdate:$("qa-mdate").value};
  closeQuick();tab("board");openForm(null);$("f-name").value=v.name;$("f-tel").value=v.tel;$("f-addr").value=v.addr;$("f-mdate").value=v.mdate;updateMsg();};
$("quickForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("qa-name").value.trim();
  if(!name){$("qa-err").textContent="고객명을 넣어 주세요.";$("qa-err").hidden=false;$("qa-name").focus();return;}
  const data={name,item:"",addr:$("qa-addr").value.trim(),m:{date:$("qa-mdate").value,done:false},i:{start:"",end:"",crew:[],tel:fmtTel($("qa-tel").value)},f:{done:false,extra:[],as:[]},updated_at:new Date().toISOString()};
  $("qa-save").disabled=true;$("qa-err").hidden=true;
  const {data:rows,error}=await sb.from("jobs").insert(data).select();$("qa-save").disabled=false;
  if(error||!rows||!rows[0]){$("qa-err").textContent="저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";$("qa-err").hidden=false;return;}
  const j=norm(rows[0].id,rows[0]);jobs=jobs.filter(x=>x.id!==j.id);jobs.push(j);closeQuick();tab("board");render();openView(j);});
$("cancelBtn").onclick=()=>{$("form").hidden=true};
$("addCrew").onclick=async()=>{const nm=$("f-newcrew").value.trim();if(!nm)return;
  const sel=pickedCrew();if(!CREW.includes(nm))CREW.push(nm);sel.push(nm);renderCrewPick(sel);$("f-newcrew").value="";renderDayPick();checkClash();
  try{await sb.from("crew").upsert({name:nm})}catch(e){}};
$("delBtn").onclick=()=>{$("delConfirm").hidden=false};
$("delNo").onclick=()=>{$("delConfirm").hidden=true};
$("delYes").onclick=async()=>{const j=editing;if(!j)return;
  try{const paths=filesOf(j.id).flatMap(f=>[f.path,f.thumb]).filter(Boolean);
    if(paths.length){const {error:se}=await sb.storage.from(BUCKET).remove(paths);if(se)throw se;}
    const {error}=await sb.from("jobs").delete().eq("id",j.id);if(error)throw error;
    files=files.filter(f=>f.job_id!==j.id);delete money[j.id];jobs=jobs.filter(x=>x!==j);render();$("form").hidden=true;}
  catch(e){showErr("삭제하지 못했어요. 잠시 후 다시 눌러 주세요.")}};
$("saveBtn").onclick=async()=>{const name=$("f-name").value.trim();
  if(!name)return showErr("고객명을 입력해 주세요.");
  const s=$("f-istart").value,e=$("f-iend").value;
  if(s&&e&&e<s)return showErr("시공 종료일이 시작일보다 빠릅니다.");
  const sat=$("f-sat").checked,sun=$("f-sun").checked;
  if($("f-newmgr").value.trim())addMgr();
  const span=s?spanDays({start:s,end:e||s,sat,sun}):[],crew=pickedCrew();
  if(s&&!span.length)return showErr("고른 기간이 모두 주말이에요. 토·일 작업을 체크하거나 날짜를 바꿔 주세요.");
  const days={};span.forEach(d=>{const x=dayPick.days[d];if(Array.isArray(x)&&!sameSet(x,crew))days[d]=x;});
  const off=span.filter(d=>dayPick.off.has(d));
  if(span.length&&off.length===span.length)return showErr("모든 날이 '쉬는 날'이에요. 작업하는 날을 하루 이상 남겨 주세요.");
  const extra=[...$("f-extras").children].map(r=>{const [d,p,n]=r.querySelectorAll("input");return{date:d.value,people:+p.value||0,note:n.value.trim()}}).filter(x=>x.date&&x.people>0);
  const as=[...$("f-as").children].map(r=>({date:r.querySelector("input[type=date]").value,crew:r.querySelector("select").value,note:r.querySelector(".note input").value.trim(),done:r.querySelector("input[type=checkbox]").checked})).filter(a=>a.date||a.note);
  const data={name,item:$("f-item").value.trim(),addr:$("f-addr").value.trim(),
    m:{date:$("f-mdate").value,done:$("f-mdone").checked},i:{start:s,end:e||s,crew,days,off,sat,sun,color:getColor(),tel:fmtTel($("f-tel").value),gate:$("f-gate").value.trim(),door:$("f-door").value.trim(),mgr:pickedMgr(),
      apps:readApps(),chk:$("f-chk").value.split("\n").map(x=>x.trim()).filter(Boolean),
      fl:{ct:editing?editing.i.fl.ct:"",dw:{by:$("f-dwby").value.trim(),due:$("f-dwdue").value,ok:$("f-dwok").value},pr:{how:$("f-prhow").value,out:$("f-prout").value.trim(),due:$("f-prdue").value,ok:$("f-prok").value}}},
    f:{...(editing&&!(editing.f.done&&!$("f-fdone").checked)?{closed:editing.f.closed,closedBy:editing.f.closedBy}:{}),done:$("f-fdone").checked,extra,as},updated_at:new Date().toISOString()};
  let mo=isAdmin?readMoney():null;
  if(mo&&billTotal(mo)>0)data.i.fl.ct=mo.contract.date||data.i.fl.ct||TODAY;
  $("saveBtn").disabled=true;$("f-err").hidden=true;
  try{
    const q=editing?sb.from("jobs").update(data).eq("id",editing.id).select():sb.from("jobs").insert(data).select();
    const {data:rows,error}=await q;if(error)throw error;
    const row=rows&&rows[0];
    if(row){jobs=jobs.filter(x=>x.id!==row.id);jobs.push(norm(row.id,row));editing=jobs.find(x=>x.id===row.id);$("formTitle").textContent=`${editing.name} 수정`;$("delBtn").hidden=false;}
    if(row&&mo){const fd=fillDues(editing,mo);if(fd)mo=fd;}
    if(row&&mo&&(hasMoney(mo)||money[row.id])){
      const {error:me}=await sb.from("job_money").upsert({job_id:row.id,data:mo,updated_at:new Date().toISOString()});
      if(me){render();showErr("현장은 저장됐는데 수금·매입을 저장하지 못했어요. 저장을 한 번 더 눌러 주세요.");return;}
      money[row.id]=mo;fillMoney(editing);}
    render();
    // 처음 보는 가전 모델과 '붙여서 설치' 묶음은 시방서 찾기 시작 (기다리지 않음)
    if(row&&editing.i.apps.some(a=>NEST_CL.modelKey(a.model).length>=3))findSpecs({job:row.id},[...new Set(editing.i.apps.map(a=>NEST_CL.modelKey(a.model)).filter(k=>k.length>=3&&!specLib[k]))]);
    if(row)await dropOrphanSpecs(editing);
    if(row&&pending.length){
      $("saveBtn").textContent="파일 올리는 중…";
      const queue=pending;pending=[];renderFiles();renderPhotos();
      const appIds=new Set(editing.i.apps.map(a=>a.id));
      for(const p of queue){if(p.kind==="photo")await uploadPhoto(row.id,p.file,p.stage);
        else if(p.kind!=="spec"||appIds.has(p.stage))await uploadOne(row.id,p.kind,p.file,p.stage);}
      if(!$("f-err").hidden)return;
    }
    $("form").hidden=true;
  }catch(err){showErr("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.")}
  finally{$("saveBtn").disabled=false;$("saveBtn").textContent="저장"}};
document.addEventListener("click",e=>{const c=e.target.closest("[data-cat]");if(c){boardCat=boardCat===c.dataset.cat?"":c.dataset.cat;if(curTab!=="board")tab("board");render();return;}
  const t=e.target.closest("[data-tab]");if(t){tab(t.dataset.tab);return;}
  const r=e.target.closest("[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openView(j,r.dataset.mode);}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest&&e.target.closest("tr[data-j],li[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openView(j);}}});
/* 오늘 할 일 (홈): 앱을 열면 먼저 보이는 화면. 오늘·내일·앞으로 7일 일정, 확인할 일 */
const locDay=ts=>{const d=new Date(ts);return isNaN(d)?"":`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const jBtn=j=>`<button type="button" class="linkish" data-j="${esc(j.id)}">${esc(j.name)}</button>`;
const dayLabel=ds=>`${+ds.slice(5,7)}월 ${+ds.slice(8)}일 (${WD[dow(ds)]})`;
const homeOrder={i:0,m:1,a:2,x:3};
function homeItem(x,ds){const j=x.j;
  if(x.t==="i"){const wd=workDays(j),k=wd.indexOf(ds)+1,cr=crewOn(j,ds);
    return`<li><i class="dot k ${kc(j)}"></i><div><span class="hm-k">시공</span> ${jBtn(j)}<div class="dmeta">${cr.length?`<span>${esc(cr.join(", "))}</span>`:`<span class="tag late">시공자 미배정</span>`}<span class="hint">${wd.length>1?`${wd.length}일 중 ${k}일째`:"하루 작업"}</span></div></div></li>`;}
  if(x.t==="m")return`<li><i class="dot" style="background:var(--c-measure)"></i><div><span class="hm-k">실측</span> ${jBtn(j)}<div class="dmeta">${sub(j)?`<span class="hint">${sub(j)}</span>`:""}${j.m.done?`<span class="tag ok">완료</span>`:""}</div></div></li>`;
  if(x.t==="a")return`<li><i class="dot" style="background:var(--c-as)"></i><div><span class="hm-k">AS</span> ${jBtn(j)}<div class="dmeta"><span>담당 ${esc(x.a.crew||"미정")}</span>${x.a.note?`<span class="hint">${esc(x.a.note)}</span>`:""}${x.a.done?`<span class="tag ok">완료</span>`:""}</div></div></li>`;
  return`<li><i class="dot ring ${kc(j)}"></i><div><span class="hm-k">추가 투입</span> ${jBtn(j)}<div class="dmeta"><span>+${+x.x.people}명</span>${x.x.note?`<span class="hint">${esc(x.x.note)}</span>`:""}</div></div></li>`;}
const homeDay=ds=>dayItems(ds).sort((a,b)=>homeOrder[a.t]-homeOrder[b.t]);
function homeAlerts(){const A=[],live=jobs.filter(j=>!ended(j)),it=(j,more,mode)=>`<span>${mode?jBtn(j).replace("<button ",`<button data-mode="${mode}" `):jBtn(j)}${more?` <span class="hint">${more}</span>`:""}</span>`;
  const add=(tone,title,list,unit,go)=>{if(list.length)A.push({tone,title,list,unit,go});};
  const wk=addDays(TODAY,7);
  add("late","시공자 미배정 (7일 안)",live.filter(noCrewSoon).map(j=>it(j,noCrewDays(j).filter(d=>d>=TODAY&&d<=wk).map(fmt).join(", "))),"곳");
  add("late","시공자 겹침",clashList(TODAY,addDays(TODAY,60)).sort((a,b)=>a.d.localeCompare(b.d)).map(c=>`<span><button type="button" class="linkish" data-day="${c.d}">${esc(c.n)} ${fmt(c.d)}</button></span>`),"건",["crew","시공자별 보기"]);
  const fs=flowStage;
  add("late","납기 지남, 생산 완료 체크 안 함",live.filter(j=>fs(j)==="prd"&&j.i.fl.pr.due&&j.i.fl.pr.due<TODAY).map(j=>it(j,`납기 ${fmt(j.i.fl.pr.due)}`)),"곳",["flow","진행 흐름 보기"]);
  add("late","시공 7일 안, 생산 완료 전",live.filter(j=>["dwg","prd"].includes(fs(j))&&j.i.start&&j.i.start<=wk).map(j=>it(j,`시공 ${fmt(j.i.start)} · 지금 ${FLOW_NAME[fs(j)]}`)),"곳",["flow","진행 흐름 보기"]);
  add("late","납기가 시공 시작보다 늦음",live.filter(prLate).map(j=>it(j,`납기 ${fmt(j.i.fl.pr.due)} · 시공 ${fmt(j.i.start)}`)),"곳");
  if(isAdmin)add("late","입금 지연",jobs.flatMap(j=>overdue(moneyOf(j.id)).map(p=>({j,p}))).sort((a,b)=>a.p.due.localeCompare(b.p.due)).map(x=>it(x.j,`${esc(x.p.label)} ${won(x.p.amount)} · ${dayDiff(x.p.due,TODAY)}일 지남`,"money")),"건",["pay","고객 수금 보기"]);
  if(isAdmin){const cw=costList().filter(o=>gotWait(o.x)),lbl=o=>`${o.x.v?esc(o.x.v):esc(o.x.cat)}${o.x.note?` ${esc(o.x.note)}`:""}`;
    add("late","입고 예정일 지남 (입고 확인 안 함)",cw.filter(o=>o.x.due<TODAY).sort((a,b)=>a.x.due.localeCompare(b.x.due)).map(o=>it(o.j,`${lbl(o)} · 예정 ${fmt(o.x.due)}`,"money")),"건",["vend","거래처 정산 보기"]);
    add("late","입고 예정이 시공 시작보다 늦음",cw.filter(o=>o.x.due>=TODAY&&o.j.i.start&&o.j.i.start>=TODAY&&o.x.due>o.j.i.start).map(o=>it(o.j,`${lbl(o)} · 입고 ${fmt(o.x.due)} · 시공 ${fmt(o.j.i.start)}`,"money")),"건",["vend","거래처 정산 보기"]);}
  if(isAdmin)add("late","수금 끝, 매입 입력 안 함 (정산 종료 안 됨)",jobs.filter(j=>{const m=moneyOf(j.id);return billTotal(m)>0&&!unpaidOf(m)&&!costIn(m);}).map(j=>it(j,"","money")),"곳",["pay","고객 수금 보기"]);
  add("late","체크리스트 문제 (조치 전)",jobs.filter(j=>clNeeds(j)==="bad").map(j=>it(j,`문제 ${clSum(j).bad.length}개`)),"곳");
  add("late","AS 날짜 지남 (완료 체크 안 함)",jobs.flatMap(j=>asOpen(j).filter(a=>a.date&&a.date<TODAY).map(a=>it(j,`${fmt(a.date)}${a.crew?` · ${esc(a.crew)}`:""}`))),"건");
  add("soon","도면 확정 목표일 지남",live.filter(j=>fs(j)==="dwg"&&j.i.fl.dw.due&&j.i.fl.dw.due<TODAY).map(j=>it(j,`${fmt(j.i.fl.dw.due)}${j.i.fl.dw.by?` · ${esc(j.i.fl.dw.by)}`:""}`)),"곳",["flow","진행 흐름 보기"]);
  add("soon","체크리스트 미제출",jobs.filter(j=>clNeeds(j)==="late").map(j=>it(j,`시공 끝 ${fmt(lastWork(j))}`)),"곳");
  add("soon","실측 완료 체크 안 함",live.filter(j=>j.m.date&&j.m.date<TODAY&&!j.m.done).map(j=>it(j,fmt(j.m.date))),"곳");
  add("soon","시공 끝, 마감 완료 체크 안 함",live.filter(j=>!j.f.done&&lastWork(j)&&lastWork(j)<TODAY).map(j=>it(j,`시공 끝 ${fmt(lastWork(j))}`)),"곳");
  if(isAdmin&&est10)add("soon","보낸 견적서를 고객이 안 열어 봄 (2일 넘음)",ests.filter(e=>e.status==="sent"&&!e.views&&e.d.sentAt&&locDay(e.d.sentAt)&&locDay(e.d.sentAt)<=addDays(TODAY,-2))
    .map(e=>`<span><button type="button" class="linkish" data-es="${esc(e.id)}">${esc([e.d.cust.name,e.d.title].filter(Boolean).join(" · ")||"견적서")}</button> <span class="hint">${fmt(locDay(e.d.sentAt))} 보냄</span></span>`),"건",["est","견적서 보기"]);
  if(isAdmin&&pay08&&Object.keys(wage.rates.day).length){const pm=addDays(TODAY.slice(0,8)+"01",-1),m=+pm.slice(5,7),w=wageMonth(+pm.slice(0,4),m);
    add("soon",`${m}월 시공자 정산 지급 전`,w.people.filter(p=>!p.paid&&(p.days||p.as)).map(p=>`<span>${esc(p.n)} <span class="hint">${p.total==null?"일당 미입력":won(p.total)}</span></span>`),"명",[`wage:${pm.slice(0,7)}`,"시공자 정산 보기"]);}
  if(isAdmin){const m1=TODAY.slice(0,8)+"01",by={};costList().filter(o=>isVend(o.x)&&!o.x.paid&&o.x.d&&o.x.d<m1).forEach(o=>{by[o.x.v]=(by[o.x.v]||0)+o.x.amount;});
    add("soon","지난달까지 거래처 매입 지급 전",Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([n,v])=>`<span>${esc(n)} <span class="hint">${won(v)}</span></span>`),"곳",["vend","거래처 정산 보기"]);}
  add("wait","실측일·시공일 없는 현장",live.filter(j=>!j.m.date&&!j.i.start).map(j=>it(j)),"곳");
  return A;}
function renderHome(){if(!loaded)return;
  const tmr=addDays(TODAY,1),none=t=>`<li class="none">${t}</li>`;
  $("hmDate").textContent=dayLabel(TODAY);
  const run=jobs.filter(j=>jobStage(j)==="run").length,wait=jobs.filter(j=>jobStage(j)==="wait").length,wk=jobs.filter(j=>!ended(j)&&thisWeek(j)).length;
  const tile=(go,label,v,more)=>`<button type="button" class="tile" data-go="${go}"><small>${label}</small><b>${v}</b>${more?`<small>${more}</small>`:""}</button>`;
  let tiles=tile("board:run","진행중인 현장",`${run}곳`)+tile("cal","7일 안 시공",`${wk}곳`);
  if(isAdmin){const t=payTotals(),ym=TODAY.slice(0,7),inM=jobs.reduce((s,j)=>s+moneyOf(j.id).pays.filter(p=>p.paid&&(p.paidOn||"").slice(0,7)===ym).reduce((a,p)=>a+p.amount,0),0);
    tiles+=tile("pay","미수금",won(t.unpaid),t.lateN?`입금 지연 ${t.lateN}건`:"")+tile("pay",`${+ym.slice(5)}월 들어온 돈`,won(inM));}
  else tiles+=tile("board:wait","대기중인 현장",`${wait}곳`);
  $("hmTiles").innerHTML=tiles;
  const t0=homeDay(TODAY),t1=homeDay(tmr);
  $("hmTodayH").innerHTML=`<button type="button" class="linkish" data-day="${TODAY}">오늘 일정</button> <span class="hint">${dayLabel(TODAY)} · ${t0.length}건</span>`;
  $("hmToday").innerHTML=t0.length?t0.map(x=>homeItem(x,TODAY)).join(""):none("오늘은 잡힌 일정이 없어요.");
  $("hmTmrH").innerHTML=`<button type="button" class="linkish" data-day="${tmr}">내일 일정</button> <span class="hint">${dayLabel(tmr)} · ${t1.length}건</span>`;
  $("hmTmr").innerHTML=t1.length?t1.map(x=>homeItem(x,tmr)).join(""):none("내일은 잡힌 일정이 없어요.");
  const week=[];for(let k=2;k<=7;k++){const ds=addDays(TODAY,k),its=homeDay(ds);if(!its.length)continue;
    const by=(t,l)=>{const n=[...new Set(its.filter(x=>x.t===t).map(x=>short(x.j)))];return n.length?`<span class="hm-k">${l}</span> ${n.join(", ")}`:"";};
    week.push(`<li data-day="${ds}" role="button" tabindex="0"><span class="d">${fmtW(ds)}</span><span>${[by("i","시공"),by("m","실측"),by("a","AS"),by("x","추가 투입")].filter(Boolean).join(" · ")}</span></li>`);}
  $("hmWeek").innerHTML=week.join("")||none("모레부터 7일 동안 잡힌 일정이 없어요.");
  const al=homeAlerts(),red=al.filter(a=>a.tone==="late").reduce((n,a)=>n+a.list.length,0);
  $("hmSum").textContent=`오늘 일정 ${t0.length}건`+(red?` · 급한 일 ${red}건`:al.length?" · 급한 일 없음":" · 확인할 일 없음");
  $("hmAlerts").innerHTML=al.length?al.map(a=>`<div class="hm-al ${a.tone}"><div class="hm-al-h"><b>${a.title}</b>${a.unit?`<span class="n">${a.list.length}${a.unit}</span>`:""}${a.go?`<button type="button" class="btn ghost sm" data-go="${a.go[0]}">${a.go[1]}</button>`:""}</div><div class="hm-al-b">${a.list.slice(0,8).join("")}${a.list.length>8?`<span class="hint">외 ${a.list.length-8}${a.unit}</span>`:""}</div></div>`).join("")
    :`<p class="hm-none">지금 확인할 일이 없어요.</p>`;
  $("homeBadge").textContent=red>99?"99+":String(red);$("homeBadge").hidden=!red;$("nav-home").setAttribute("aria-label",red?`오늘, 급한 일 ${red}건`:"오늘");}
document.addEventListener("click",e=>{const g=e.target.closest("[data-go]");if(!g)return;const [v,arg]=g.dataset.go.split(":");
  if(v==="wage"&&arg){wgY=+arg.slice(0,4);wgM=+arg.slice(5,7);}
  if(v==="board"){boardCat=arg||"";}
  tab(v);if(v==="board")render();if(v==="wage")renderWage();window.scrollTo({top:0});});

/* 메뉴: 큰 묶음(오늘 · 현장 · 견적 · 정산 · 결산) 안에 세부 화면. 묶음마다 마지막에 본 화면을 기억함. 관리자가 아니면 오늘 · 현장만 */
const GROUPS={home:["home"],site:["board","flow","cal","crew"],est:["est"],money:["pay","wage","vend"],fin:["sales","exp"]};
const VIEW_TITLE={board:"현장 목록",flow:"진행 흐름",cal:"달력",crew:"시공자별",est:"견적서",pay:"고객 수금",wage:"시공자 정산",vend:"거래처 정산",sales:"손익",exp:"회사 지출"};
const VIEWS=Object.values(GROUPS).flat(),ADMIN_VIEWS=VIEWS.filter(v=>!GROUPS.site.includes(v)&&v!=="home");
const groupOf=v=>Object.keys(GROUPS).find(g=>GROUPS[g].includes(v));
let lastSub={};try{lastSub=JSON.parse(localStorage.getItem("nest-sub")||"{}")||{}}catch(e){}
function tab(which){if(!VIEWS.includes(which)||(!isAdmin&&ADMIN_VIEWS.includes(which)))which="board";curTab=which;
  const g=groupOf(which);lastSub[g]=which;
  VIEWS.forEach(v=>{$("tab-"+v).setAttribute("aria-selected",v===which);$("view-"+v).hidden=v!==which;});
  Object.keys(GROUPS).forEach(k=>{$("sub-"+k).hidden=k!==g;if(k===g)$("nav-"+k).setAttribute("aria-current","page");else $("nav-"+k).removeAttribute("aria-current");});
  $("app").dataset.g=g;$("app").dataset.v=which;$("gnav").hidden=false;document.body.classList.add("gnav-on");
  $("pgTitle").textContent=VIEW_TITLE[which]||"";
  if(which==="crew")renderCrew();
  if(which==="flow")renderFlow();
  if(which==="est"&&isAdmin)renderEst();
  if(which==="home")renderHome();
  try{localStorage.setItem("nest-sub",JSON.stringify(lastSub));sessionStorage.setItem("nest-cur",which)}catch(e){}}
VIEWS.forEach(v=>$("tab-"+v).onclick=()=>tab(v));
Object.keys(GROUPS).forEach(g=>$("nav-"+g).onclick=()=>{const same=$("app").dataset.g===g,v=lastSub[g];
  if(!same)tab(GROUPS[g].includes(v)?v:GROUPS[g][0]);window.scrollTo({top:0,behavior:same?"smooth":"auto"});});
/* 휴대폰에서 글자를 입력하는 동안은 아래 메뉴 막대를 숨김 (자판 위로 떠서 화면을 가리지 않게) */
const typingEl=t=>t&&t.matches&&t.matches("textarea,input:not([type]),input[type=text],input[type=search],input[type=email],input[type=tel],input[type=url],input[type=password],input[type=number]");
let typT;document.addEventListener("focusin",e=>{if(typingEl(e.target)){clearTimeout(typT);document.body.classList.add("typing");}});
document.addEventListener("focusout",()=>{clearTimeout(typT);typT=setTimeout(()=>{if(!typingEl(document.activeElement))document.body.classList.remove("typing");},250);});
$("prev").onclick=()=>{calM--;if(calM<0){calM=11;calY--}renderCal()};
$("next").onclick=()=>{calM++;if(calM>11){calM=0;calY++}renderCal()};


/* 도면 · 견적서 파일 */
let userEmail="",userName="";
function renderFiles(){
  for(const kind of Object.keys(KINDS)){
    const saved=editing?filesOf(editing.id,kind):[];
    const wait=pending.filter(p=>p.kind===kind);
    let h=saved.map(f=>`<li><button type="button" class="fname" data-fid="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</button><span class="fmeta">${fsize(+f.size||0)} · ${fmt((f.created_at||"").slice(0,10))}</span><button type="button" class="fdel" data-fdel="${esc(f.id)}">삭제</button></li>`).join("");
    h+=wait.map(p=>`<li><span class="fname" style="color:var(--muted)">${esc(p.file.name)}</span><span class="fmeta">${p.busy?"올리는 중…":"저장하면 올라가요"}</span>${p.busy?"":`<button type="button" class="fdel" data-pdel="${pending.indexOf(p)}">빼기</button>`}</li>`).join("");
    if(!h)h=`<li class="none">${kind==="drawing"?"아직 올린 도면이 없어요.":"아직 올린 견적서가 없어요."}</li>`;
    $("fl-"+kind).innerHTML=h;}
  renderSpecs();
}
function safeExt(name){const m=/\.([A-Za-z0-9]{1,8})$/.exec(name||"");return m?m[1].toLowerCase():"bin";}
const rid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
async function uploadOne(jobId,kind,file,stage=""){
  const tmp={kind,file,stage,busy:true};pending.push(tmp);renderFiles();
  try{
    const path=`${jobId}/${kind}/${rid()}.${safeExt(file.name)}`;
    const {error:ue}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
    if(ue)throw ue;
    const {data,error}=await sb.from("files").insert({job_id:jobId,kind,...(stage?{stage}:{}),name:file.name||"이름 없는 파일",path,size:file.size||0,mime:file.type||"",uploaded_by:userEmail}).select();
    if(error){await sb.storage.from(BUCKET).remove([path]);throw error;}
    if(data&&data[0]&&!files.find(f=>f.id===data[0].id))files.push(data[0]);
  }catch(e){showErr(kind==="spec"&&!cl04?"시방서를 올리려면 Supabase 업데이트 4가 먼저 필요해요. 시공 체크리스트 칸의 안내를 봐 주세요.":`"${file.name}" 파일을 올리지 못했어요. 인터넷 연결을 확인하고 다시 올려 주세요.`);}
  finally{pending=pending.filter(p=>p!==tmp);renderFiles();render();}
}
document.addEventListener("change",async e=>{const inp=e.target;if(!inp.classList||!inp.classList.contains("fpick"))return;
  const kind=inp.dataset.kind,list=[...inp.files];inp.value="";$("f-err").hidden=true;
  for(const file of list){
    if(file.size>MAX_BYTES){showErr(`"${file.name}"은(는) 50MB가 넘어서 올릴 수 없어요.`);continue;}
    if(editing)await uploadOne(editing.id,kind,file);else{pending.push({kind,file});renderFiles();}
  }});
document.addEventListener("click",async e=>{
  const open=e.target.closest("[data-fid]");
  if(open){const f=files.find(x=>x.id===open.dataset.fid);if(!f)return;
    const viewable=/^(image\/|application\/pdf)/.test(f.mime)||/\.(pdf|jpe?g|png|gif|webp|heic)$/i.test(f.name);
    const w=window.open("","_blank");
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(f.path,600,viewable?{}:{download:f.name});
    if(error||!data){if(w)w.close();showErr("파일을 열지 못했어요. 잠시 후 다시 눌러 주세요.");return;}
    if(w)w.location.href=data.signedUrl;else location.href=data.signedUrl;return;}
  const pd=e.target.closest("[data-pdel]");
  if(pd){pending.splice(+pd.dataset.pdel,1);renderFiles();renderPhotos();return;}
  const del=e.target.closest("[data-fdel]");
  if(del){if(del.dataset.armed!=="1"){del.dataset.armed="1";del.textContent="정말 삭제";setTimeout(()=>{if(del.isConnected){del.dataset.armed="";del.textContent="삭제";}},4000);return;}
    const f=files.find(x=>x.id===del.dataset.fdel);if(!f)return;del.disabled=true;
    const ok=await removeFile(f);
    if(!ok){showErr("파일을 삭제하지 못했어요. 잠시 후 다시 눌러 주세요.");del.disabled=false;return;}
    renderFiles();render();}
});
async function removeFile(f){
  const {error:se}=await sb.storage.from(BUCKET).remove([f.path,f.thumb].filter(Boolean));
  const {error}=se?{error:se}:await sb.from("files").delete().eq("id",f.id);
  if(error)return false;files=files.filter(x=>x!==f);return true;}

/* 가전 · 시방서: 가전마다 종류·모델명(+ 이 현장만 다른 치수).
   모델명을 적고 저장하면 알림 서버(notify)가 시방서를 찾아 보관함(app_specs)에 모델별로 저장함. 제조사 공식 자료를 먼저 찾고,
   없으면 다른 출처에서라도 찾아 출처를 함께 보여 줌. 냉장고·김치냉장고·와인셀러는 기본으로 '붙여서 설치' 묶음이 되어 묶음 시방서도 찾음.
   한 번 찾은 것은 다시 찾지 않고 같은 모델(묶음)을 쓰는 모든 현장의 시공 체크리스트에 자동으로 붙음.
   그래도 없으면 이 현장에만 파일을 직접 올릴 수 있음 */
let specLib={},lib05=true,specAuto=null,specVer=0,specAt=0,specChan=null,specPoll=null,specAutoRan=false;
NEST_CL.useLib(k=>{const l=specLib[k];return l&&l.status==="found"?l:null;});
const libRow=model=>specLib[NEST_CL.modelKey(model)]||null;
const libOf=model=>{const l=libRow(model);return l&&l.status==="found"?l:null;};
const specStale=l=>l.status==="searching"&&Date.now()-new Date(l.searched_at||0).getTime()>15*60e3;
async function loadLib(){
  const {data,error}=await sb.from("app_specs").select("*");
  if(error){lib05=!/app_specs|42P01|PGRST20/i.test(`${error.code} ${error.message}`);return;}
  lib05=true;specLib={};(data||[]).forEach(r=>{specLib[r.model_key]=r});
  if(!specChan){specChan=sb.channel("nest-specs").on("postgres_changes",{event:"*",schema:"public",table:"app_specs"},()=>libChanged()).subscribe();}
  // 찾는 중인 것이 있으면 실시간 연결이 끊겨도 바뀌도록 15초마다 다시 확인
  clearTimeout(specPoll);if(Object.values(specLib).some(l=>l.status==="searching"&&!specStale(l)))specPoll=setTimeout(libChanged,15e3);}
async function libChanged(){await loadLib();if(loaded)render();if(!$("form").hidden)renderSpecs();shootSoon();}
// 자동 찾기가 켜져 있는지 (Anthropic 키를 Supabase Secrets에 넣었는지), 찾는 방식 버전은 몇인지 알림 서버에 물어봄
async function specStatus(){
  if(specAuto===true||Date.now()-specAt<300e3){autoSpecs();return;}specAt=Date.now();
  try{const {data,error}=await sb.functions.invoke("notify",{body:{action:"spec_status"}});specAuto=!error&&!!(data&&data.auto);specVer=+(data&&data.v)||1;}catch(e){specAuto=false;}
  if(!$("form").hidden)renderSpecs();
  autoSpecs();}
// 종류를 아직 찾는 중인 가전이 있는 현장 (묶음은 다 찾은 뒤에 정함)
// 묶음에 들어갈 수 있는 가전(종류 모름·냉장고류·체크한 가전)을 아직 찾는 중이면 묶음은 기다림 (알림 서버 comboWork와 같은 규칙)
const typePending=j=>j.i.apps.some(a=>(a.join===true||a.join!==false&&(!a.type||NEST_CL.joinable(a)))&&(specLib[NEST_CL.modelKey(a.model)]||{}).status==="searching");
// 새 방식(v2)이 켜진 뒤 한 번: 예전 방식으로 못 찾은 모델은 다시 찾고, 진행 중인 현장의 '붙여서 설치' 묶음 중 아직 안 찾은 것도 찾기 시작
async function autoSpecs(){
  if(specAutoRan||!specAuto||specVer<2||!lib05||!loaded)return;specAutoRan=true;
  const old=Object.values(specLib).filter(l=>"ver" in l&&(+l.ver||1)<2&&(l.status==="notfound"||l.status==="error")&&!String(l.model_key).includes("+"));
  if(old.length)await findSpecs({models:old.slice(0,10).map(l=>({model:l.model||l.model_key,type:l.type||""})),force:true},old.slice(0,10).map(l=>l.model_key));
  const combos=[];
  for(const j of jobs){const last=lastWork(j);if(last&&last<addDays(TODAY,-14)||typePending(j))continue;
    const c=NEST_CL.combo(j);if(c&&!specLib[c.key]&&!combos.some(x=>x.key===c.key))combos.push(c);}
  if(combos.length)await findSpecs({combos:combos.slice(0,3).map(c=>c.models)},combos.slice(0,3).map(c=>c.key));
  mediaWork();}
// 그림 정리 전(v3 전)에 찾은 시방서: 서버에 치수도 그림을 보관함으로 옮겨 달라고 한 번 (Claude로 다시 찾지는 않음)
let mediaRan=false;
async function mediaWork(){
  if(mediaRan||!specAuto||specVer<3||!lib05)return;mediaRan=true;
  const old=Object.values(specLib).filter(l=>l.status==="found"&&"ver" in l&&(+l.ver||1)<3).slice(0,5).map(l=>l.model_key);
  if(old.length)await specCall({action:"spec_store",keys:old});
  shootSoon();}
/* 설명서 PDF의 치수 쪽을 그림으로 캡처: 사무실 앱이 PDF를 열어 치수 쪽(찾을 때 알려 준 쪽 + 글자로 찾은 쪽)을 그림으로 만들어 서버에 보냄.
   서버가 그림을 보고 설치 치수도만 보관함에 남김. PDF마다 한 번만 (scanned) */
const PDFJS="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/";
let shooting=false,shootTimer=null;const shotTried=new Set();
const shootSoon=()=>{clearTimeout(shootTimer);shootTimer=setTimeout(shootPdfs,3000);};
async function shootPdfs(){
  if(shooting||!specAuto||specVer<3||!lib05)return;
  const todo=[];Object.values(specLib).filter(l=>l.status==="found").forEach(l=>(Array.isArray(l.files)?l.files:[]).forEach(f=>{
    if(f&&/^lib\/spec\/[\w-]+\.pdf$/.test(f.path||"")&&!f.scanned&&!shotTried.has(f.path))todo.push([l.model_key,f]);}));
  if(!todo.length)return;shooting=true;
  try{const pdfjs=await import(PDFJS+"build/pdf.min.mjs");pdfjs.GlobalWorkerOptions.workerSrc=PDFJS+"build/pdf.worker.min.mjs";
    for(const [key,f] of todo.slice(0,3)){shotTried.add(f.path);
      try{await shootOne(pdfjs,key,f);}catch(e){console.warn("pdf shot",f.path,e);}}}
  catch(e){console.warn("pdf.js",e);}finally{shooting=false;}}
async function shootOne(pdfjs,key,f){
  const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(f.path,600);if(error||!data)return;
  const doc=await pdfjs.getDocument({url:data.signedUrl,cMapUrl:PDFJS+"cmaps/",cMapPacked:true,standardFontDataUrl:PDFJS+"standard_fonts/"}).promise;
  const pages=await pdfPages(doc,Array.isArray(f.pages)?f.pages:[]);
  for(const p of pages){const jpg=await pageJpeg(doc,p);if(!jpg)continue;
    const r=await specCall({action:"spec_shot",key,file:f.path,page:p,data:jpg});if(r.error){doc.destroy();return;}} // 서버가 못 골랐으면 다음에 다시
  await specCall({action:"spec_shot",key,file:f.path,done:true});doc.destroy();}
// 치수 그림이 있을 만한 쪽: 찾을 때 알려 준 쪽 + 설치 공간·치수·걸레받이 같은 말이 많은 쪽 (최대 4쪽)
async function pdfPages(doc,hint){
  const score=new Map();hint.forEach(p=>{if(p>=1&&p<=doc.numPages)score.set(p,1000);});
  const RX=/설치 ?공간|설치 ?치수|제품 ?치수|외형 ?치수|설치 ?도면|타공|컷아웃|걸레받이|이격 ?거리|cut.?out|plinth|niche|installation dimension/gi;
  for(let p=1;p<=Math.min(doc.numPages,150);p++){let t="";
    try{t=(await (await doc.getPage(p)).getTextContent()).items.map(i=>i.str).join(" ");}catch(e){continue;}
    if(p<=4&&/목차|차례|contents/i.test(t))continue;
    const m=(t.match(RX)||[]).length;if(m)score.set(p,(score.get(p)||0)+m*10+Math.min((t.match(/\d{3,4}/g)||[]).length,20));}
  return[...score].sort((a,b)=>b[1]-a[1]).slice(0,4).map(x=>x[0]).sort((a,b)=>a-b);}
async function pageJpeg(doc,p){
  const pg=await doc.getPage(p),v1=pg.getViewport({scale:1}),vp=pg.getViewport({scale:Math.min(3,1600/v1.width)});
  const c=document.createElement("canvas");c.width=Math.round(vp.width);c.height=Math.round(vp.height);
  const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  await pg.render({canvasContext:ctx,viewport:vp}).promise;
  for(const q of [0.82,0.65,0.5]){const d=c.toDataURL("image/jpeg",q).split(",")[1];if(d.length<4.5e6)return d;}
  return null;}
async function specCall(body){
  try{const {data,error}=await sb.functions.invoke("notify",{body});if(!error)return{data:data||{}};
    let msg="";try{msg=(await error.context.json()).error||"";}catch(e){}return{error:msg||"server",status:error.context&&error.context.status};}
  catch(e){return{error:"offline"};}}
function specErr(m){if(!$("form").hidden){showErr(m);return;}
  const st=$("status");st.textContent=m;st.hidden=false;setTimeout(()=>{if(st.textContent===m)st.hidden=true;},10e3);}
// 찾기 시작: body = {job} (저장한 현장의 새 모델·묶음) 또는 {models|combos, force} ('지금 찾기'·'다시 찾기'). keys = 화면에 바로 '찾는 중'으로 보일 것
// 답을 기다리지 않아도 됨: 다 찾으면 화면이 저절로 바뀜
async function findSpecs(body,keys){
  if(!lib05||!specAuto)return;
  const now=new Date().toISOString();
  keys.forEach(k=>{specLib[k]={...(specLib[k]||{model_key:k,model:k}),status:"searching",searched_at:now,note:""};});
  if(keys.length&&!$("form").hidden)renderSpecs();
  const r=await specCall({action:"spec_find",...body});
  if(r.error){
    if(r.error==="no key")specAuto=false;
    specErr(r.error==="limit"?"시방서는 하루에 정해 둔 개수까지만 찾아요. 내일 다시 찾아 주세요.":r.error==="no key"?"시방서 자동 찾기가 아직 꺼져 있어요. README의 \"업데이트 5\"를 봐 주세요.":
      r.error==="offline"?"인터넷 연결을 확인하고 다시 찾아 주세요.":"시방서를 찾기 시작하지 못했어요. 잠시 후 '다시 찾기'를 눌러 주세요.");}
  await libChanged();}
const appId=()=>Math.random().toString(36).slice(2,9);
function appRow(a){a=a||{id:appId(),type:"",model:"",spec:""};
  const r=document.createElement("div");r.className="app-row";r.dataset.app=a.id;r.dataset.join=a.join===true?"1":a.join===false?"0":"";
  r.innerHTML=`<div class="app-top"><select aria-label="가전 종류"><option value="" ${a.type?"":"selected"}>종류 자동</option>${NEST_CL.TYPES.map(([k,n])=>`<option value="${k}" ${k===a.type?"selected":""}>${n}</option>`).join("")}</select>
    <input class="app-model" placeholder="모델명 (예: DUE6BGH)" aria-label="모델명" value="${esc(a.model)}" autocapitalize="characters" spellcheck="false">
    <button class="btn ghost sm app-del" type="button">빼기</button></div>
    <div class="app-lib" data-lib="${esc(a.id)}"></div>
    <label class="check app-join" hidden><input type="checkbox">옆 냉장고·김치냉장고와 붙여서 설치</label>
    <input class="app-spec" aria-label="이 현장만 다른 확인 치수" value="${esc(a.spec)}">
    <div class="app-files"><ul class="flist" data-spec="${esc(a.id)}"></ul><span class="fg-btns"><label class="btn ghost sm">파일 직접 올리기<input type="file" multiple accept="image/*,application/pdf" class="specpick" data-app="${esc(a.id)}"></label></span></div>`;
  r.querySelector(".app-del").onclick=()=>{pending=pending.filter(p=>!(p.kind==="spec"&&p.stage===a.id));r.remove();renderSpecs();};
  r.querySelector(".app-model").addEventListener("input",()=>renderSpecs());
  r.querySelector("select").addEventListener("change",()=>renderSpecs());
  r.querySelector(".app-join input").addEventListener("change",e=>{r.dataset.join=e.target.checked?"1":"0";renderSpecs();});
  $("f-apps").appendChild(r);renderSpecs();}
$("addApp").onclick=()=>{appRow();const rows=$("f-apps").children;rows[rows.length-1].querySelector(".app-model").focus();};
const readApps=()=>[...$("f-apps").children].map(r=>({id:r.dataset.app,type:r.querySelector("select").value,model:r.querySelector(".app-model").value.trim(),spec:r.querySelector(".app-spec").value.trim(),
  ...(r.dataset.join?{join:r.dataset.join==="1"}:{})}));
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,"")}catch(e){return""}};
const badImg=new Set();
const okHttps=u=>/^https:\/\/[^\s"'<>]+$/.test(u||"");
const againBtn=(k,label="다시 찾기")=>specAuto?`<button type="button" class="lib-again" data-again="${esc(k)}">${label}</button>`:"";
// 가전(또는 붙여서 설치 묶음) 아래: 찾는 중 / 찾은 종류·치수·치수도·설명서·링크·출처 / 못 찾음
function libHtml(k,combo){
  const what=combo?"이 묶음의 연결 설치 시방서":"시방서";
  if(!k)return specAuto&&lib05?`<div class="lib-msg">모델명을 적고 저장하면 시방서를 찾아 붙여요.</div>`:"";
  const l=specLib[k];
  if(!l||(l.status==="searching"&&specStale(l))||l.status==="error"||!l.status){
    if(!lib05||!specAuto)return`<div class="lib-msg">아직 ${what}를 찾지 않았어요.</div>`;
    if(!l||!l.status)return k.length<3?"":`<div class="lib-msg">저장하면 ${what}를 찾아요. ${againBtn(k,"지금 찾기")}</div>`;
    return`<div class="lib-msg warn">${what}를 찾다가 멈췄어요. ${againBtn(k)}${l.status==="error"&&l.note&&!/찾다가 멈췄/.test(l.note)?`<div class="hint">${esc(l.note)}</div>`:""}</div>`;}
  if(l.status==="searching")return`<div class="lib-msg"><span class="spin" aria-hidden="true"></span>${what}를 찾는 중이에요 (몇 분 걸려요). 다른 일을 하셔도 돼요.</div>`;
  if(l.status==="notfound")return`<div class="lib-msg warn">${combo?"이 묶음의 연결 설치 치수를":"이 모델의 치수를"} 어디에서도 찾지 못했어요. ${combo?"":"모델명이 맞는지 확인해 주세요. "}${againBtn(k)}${l.note?`<div class="hint">${esc(l.note)}</div>`:""}</div>`;
  const links=(Array.isArray(l.links)?l.links:[]).filter(x=>x&&okHttps(x.url)).slice(0,4);
  const pdfs=(Array.isArray(l.files)?l.files:[]).filter(f=>f&&/^lib\/spec\//.test(f.path||"")).slice(0,2);
  const head=[l.brand,combo?"":NEST_CL.TYPES.find(t=>t[0]===l.type)?.[1]].filter(Boolean).join(" · ");
  const off=l.official===false,figs=libFigs(l),wait=!figs.length&&"ver" in l&&(+l.ver||1)<3;
  const text=`${l.spec?`<div class="lib-spec">${esc(l.spec)}</div>`:""}
    ${pdfs.length||links.length?`<div class="lib-links">${pdfs.map(f=>`<button type="button" class="fname" data-lpath="${esc(f.path)}">${esc(f.name||"설명서 PDF")}</button><span class="fmeta">보관본</span>`).join("")}${
      links.map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title||"자료")}</a><span class="fmeta">${esc(host(x.url))}</span>`).join("")}</div>`:""}
    ${l.note?`<div class="hint">${esc(l.note)}</div>`:""}`;
  return`<div class="lib-box${off?" unofficial":""}"><div class="lib-head">${head?esc(head):""} <span class="tag ${off?"soon":"ok"}">${off?"공식 자료 아님":"시방서 있음"}</span>${againBtn(k)}</div>
    ${l.source?`<div class="lib-src">출처: ${esc(l.source)}${off?" · 현장에서 실측으로 꼭 확인해 주세요":""}</div>`:""}
    ${figs.length?`${figHtml(figs)}<details class="lib-more"><summary>글자·원본 자료 보기</summary>${text}</details>`:`${wait?`<div class="hint"><span class="spin" aria-hidden="true"></span>치수도 그림을 정리하고 있어요.</div>`:""}${text}`}</div>`;}
// 시방서 그림: 보관함에 옮겨 둔 것(서명 주소로 열기), 아직이면 찾을 때 나온 원래 주소
const LIB_IMG=/^lib\/spec\/[\w.-]+\.(jpg|png|webp|gif)$/;
const libUrls=new Map();
function libFigs(l){const list=(Array.isArray(l.images)?l.images:[]).filter(Boolean);
  const kept=list.filter(x=>LIB_IMG.test(x.path||"")).slice(0,8).map(x=>({path:x.path,title:x.title||"치수도"}));
  return kept.length?kept:list.filter(x=>!x.skip&&!x.path&&okHttps(x.url)&&!badImg.has(x.url)).slice(0,4).map(x=>({url:x.url,title:x.title||"치수도"}));}
function figHtml(figs){
  return`<div class="lib-figs">${figs.map(f=>{const c=f.path&&libUrls.get(f.path),u=f.url||(c&&c.t>Date.now()?c.u:"");
    return`<figure><a ${u?`href="${esc(u)}"`:""} target="_blank" rel="noopener noreferrer"><img ${u?`src="${esc(u)}"`:""} ${f.path?`data-limg="${esc(f.path)}"`:`referrerpolicy="no-referrer"`} alt="${esc(f.title)}" loading="lazy"></a><figcaption>${esc(f.title)}</figcaption></figure>`;}).join("")}</div>`;}
async function fillLibImgs(){
  const els=[...document.querySelectorAll("img[data-limg]:not([src])")];if(!els.length)return;
  const need=[...new Set(els.map(e=>e.dataset.limg))].filter(p=>!(libUrls.get(p)&&libUrls.get(p).t>Date.now()));
  if(need.length){try{const {data}=await sb.storage.from(BUCKET).createSignedUrls(need,3600);(data||[]).forEach(x=>{if(x&&x.signedUrl)libUrls.set(x.path,{u:x.signedUrl,t:Date.now()+50*60e3});});}catch(e){}}
  els.forEach(e=>{const v=libUrls.get(e.dataset.limg);if(v&&e.isConnected){e.src=v.u;const a=e.closest("a");if(a)a.href=v.u;}});}
function renderSpecs(){
  const su=$("specSetup");
  su.innerHTML=!lib05?`시방서를 자동으로 찾으려면 Supabase 업데이트 5가 필요해요. <a href="https://github.com/nestfurniture/nest-schedule#업데이트-5-시방서-자동-찾기-적용" target="_blank" rel="noopener">설정 방법 보기</a>`:
    specAuto===false?`시방서 자동 찾기가 아직 꺼져 있어요. <a href="https://github.com/nestfurniture/nest-schedule#업데이트-5-시방서-자동-찾기-적용" target="_blank" rel="noopener">설정 방법 보기</a>`:"";
  su.hidden=!su.innerHTML;
  $("f-apps").querySelectorAll(".app-row").forEach(r=>{const id=r.dataset.app,model=r.querySelector(".app-model").value,l=libOf(model);
    r.querySelector("[data-lib]").innerHTML=libHtml(NEST_CL.modelKey(model),null);
    const jn=r.querySelector(".app-join"),can=NEST_CL.joinable({type:r.querySelector("select").value,model})&&NEST_CL.modelKey(model).length>=3;
    jn.hidden=!can&&r.dataset.join!=="1";jn.querySelector("input").checked=r.dataset.join?r.dataset.join==="1":can;
    r.querySelector(".app-spec").placeholder=l&&l.spec?"이 현장만 다른 치수 (비우면 위 치수)":"확인 치수 직접 적기 (예: 폭 600~602 · 높이 815~875)";
    const ul=r.querySelector("[data-spec]");
    const saved=editing?filesOf(editing.id,"spec").filter(f=>f.stage===id):[],wait=pending.filter(p=>p.kind==="spec"&&p.stage===id);
    ul.innerHTML=saved.map(f=>`<li><button type="button" class="fname" data-fid="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</button><span class="fmeta">${fsize(+f.size||0)}</span><button type="button" class="fdel" data-fdel="${esc(f.id)}">삭제</button></li>`).join("")+
      wait.map(p=>`<li><span class="fname" style="color:var(--muted)">${esc(p.file.name)}</span><span class="fmeta">${p.busy?"올리는 중…":"저장하면 올라가요"}</span>${p.busy?"":`<button type="button" class="fdel" data-pdel="${pending.indexOf(p)}">빼기</button>`}</li>`).join("");
    ul.hidden=!ul.innerHTML;});
  // 붙여서 설치하는 묶음 (2대 이상일 때)
  const c=NEST_CL.combo({i:{apps:readApps()}}),box=$("f-combo");
  box.hidden=!c;box.innerHTML=c?`<div class="combo-head">붙여서 설치 · ${esc(c.models.join(" + "))}</div>${libHtml(c.key,c.models)}`:"";
  fillLibImgs();}
// 제조사 주소가 바뀌어 안 열리는 치수도 그림은 숨김
document.addEventListener("error",e=>{const t=e.target;if(t&&t.tagName==="IMG"&&t.closest(".lib-figs")&&!t.dataset.limg){badImg.add(t.getAttribute("src"));t.closest("figure").remove();}},true);
document.addEventListener("click",async e=>{
  const ag=e.target.closest("[data-again]");
  if(ag){const k=ag.dataset.again,l=specLib[k],row=ag.closest(".app-row"),inCombo=ag.closest("#f-combo");if(!row&&!inCombo)return;
    if(l&&l.status==="found"&&ag.dataset.armed!=="1"){ag.dataset.armed="1";ag.textContent="한 번 더 누르면 다시 찾아요";setTimeout(()=>{if(ag.isConnected){ag.dataset.armed="";ag.textContent="다시 찾기";}},4000);return;}
    ag.disabled=true;$("f-err").hidden=true;const force=!!(l&&l.status);
    if(inCombo){const c=NEST_CL.combo({i:{apps:readApps()}});if(c)await findSpecs({combos:[c.models],force},[c.key]);return;}
    await findSpecs({models:[{model:row.querySelector(".app-model").value.trim(),type:row.querySelector("select").value}],force},[k]);return;}
  const lp=e.target.closest("[data-lpath]");
  if(lp){const w=window.open("","_blank");
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(lp.dataset.lpath,600);
    if(error||!data){if(w)w.close();showErr("설명서를 열지 못했어요. 잠시 후 다시 눌러 주세요.");return;}
    if(w)w.location.href=data.signedUrl;else location.href=data.signedUrl;}});
document.addEventListener("change",async e=>{const inp=e.target;if(!inp.classList||!inp.classList.contains("specpick"))return;
  const app=inp.dataset.app,list=[...inp.files];inp.value="";$("f-err").hidden=true;
  const saved=editing&&editing.i.apps.some(a=>a.id===app);
  for(const file of list){
    if(file.size>MAX_BYTES){showErr(`"${file.name}"은(는) 50MB가 넘어서 올릴 수 없어요.`);continue;}
    if(saved)await uploadOne(editing.id,"spec",file,app);else{pending.push({kind:"spec",file,stage:app});renderSpecs();}}});
// 뺀 가전의 시방서 파일은 저장할 때 같이 지움
async function dropOrphanSpecs(j){const ids=new Set(j.i.apps.map(a=>a.id));
  for(const f of filesOf(j.id,"spec").filter(f=>!ids.has(f.stage)))await removeFile(f);}

/* 시공 체크리스트: 현장마다 링크 하나 (check.html?t=열쇠). 시공자는 로그인 없이 작성·제출 */
let checks={},cl04=true;
const clOf=id=>checks[id]||null;
const clUrl=t=>new URL(`check.html?t=${t}`,location.href.split(/[?#]/)[0]).href;
const clMsg=(j,c)=>`[네스트퍼니처 시공 체크리스트]\n\n현장 : ${j.name}\n시공이 끝나면 아래 링크를 열어 체크리스트를 작성해 주세요.\n${clUrl(c.token)}`;
const clSum=j=>{const c=clOf(j.id);return c?NEST_CL.summary(j,c.data):null;};
const lastWork=j=>{const wd=workDays(j);return wd[wd.length-1]||"";};
// bad = 제출됐는데 문제가 있고 아직 조치 안 함, late = 시공 끝난 지 14일 안인데 제출 안 됨
function clNeeds(j){const c=clOf(j.id);
  if(c&&c.status==="submitted")return clSum(j).bad.length&&!(c.data||{}).fixed?"bad":"";
  const last=lastWork(j);return last&&last<TODAY&&last>=addDays(TODAY,-14)?"late":"";}
function clTag(j){const c=clOf(j.id),need=clNeeds(j);
  if(c&&c.status==="submitted"){const n=clSum(j).bad.length;
    return need==="bad"?`<span class="tag late">체크 문제 ${n}</span>`:`<span class="tag ok">체크 완료${n?" · 조치함":""}</span>`;}
  return need==="late"?`<span class="tag soon">체크 미제출</span>`:"";}
const RES=NEST_CL.RESULT;
const whenKo=ts=>{if(!ts)return"";const d=new Date(ts);return`${d.getMonth()+1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;};
function clDetailHtml(j,c){const d=c.data||{},it=d.items||{},dims=d.dims||{},photos=d.photos||[];
  return NEST_CL.sections(j).map(s=>`<div class="cl-sec"><h4>${esc(s.title)}</h4>${s.dims&&NEST_CL.dimsText(dims[s.key])?`<div class="hint">잰 치수: ${esc(NEST_CL.dimsText(dims[s.key]))}</div>`:""}${
    s.items.map(x=>{const r=it[x.key]||{};return`<div class="cl-it"><span class="r tag ${r.v==="bad"?"late":r.v==="ok"?"ok":"wait"}">${RES[r.v]||"안 함"}</span><div>${esc(x.label)}${r.note?`<div class="note">${esc(r.note)}</div>`:""}</div></div>`;}).join("")}${
    s.photo?`<div class="hint">사진 ${photos.filter(p=>p.key===s.key).length}장</div>`:""}</div>`).join("")+
    (d.memo?`<div class="cl-sec"><h4>남은 작업 · 특이사항</h4><div class="note" style="white-space:pre-wrap">${esc(d.memo)}</div></div>`:"")+
    `<p class="hint">체크리스트 사진은 아래 현장 사진의 '시공 후'에 함께 들어 있어요.</p>`;}
function renderCl(){const box=$("cl-box");
  if(!cl04){box.innerHTML=`<div class="update">시공 체크리스트를 쓰려면 Supabase 업데이트 4가 필요해요. <a href="https://github.com/nestfurniture/nest-schedule/blob/main/supabase/update-04.sql" target="_blank" rel="noopener">업데이트 SQL 열기</a>에서 내용을 복사해 SQL Editor에서 Run 해 주세요.</div>`;return;}
  if(!editing){box.innerHTML=`<p class="hint" style="margin:0">현장을 저장하면 체크리스트 링크를 만들 수 있어요.</p>`;return;}
  const j=editing,c=clOf(j.id);
  if(!c){box.innerHTML=`<div class="cl-row"><span class="tag wait">링크 없음</span><button class="btn sm" type="button" id="clMake">체크리스트 링크 만들기</button></div>`;return;}
  const s=NEST_CL.summary(j,c.data);
  if(c.status!=="submitted"){
    box.innerHTML=`<div class="cl-row"><span class="tag wait">${s.done?`작성 중 ${s.done}/${s.total}`:"작성 전"}</span><button class="btn sm" type="button" data-clmsg="${esc(j.id)}">체크리스트 문자 복사</button><a class="btn ghost sm" href="${esc(clUrl(c.token))}" target="_blank" rel="noopener">열어 보기</a></div>
      <p class="hint" style="margin:6px 0 0">시공자에게 문자를 보내면, 시공이 끝난 뒤 링크에서 체크하고 제출해요. 제출되면 알림이 와요.</p>
      <p class="hint" style="margin:4px 0 0">링크가 다른 사람에게 잘못 갔다면 <button class="cl-renew" type="button" id="clRenew">링크 새로 만들기</button> (예전 링크는 바로 막혀요)</p>`;return;}
  const fixed=(c.data||{}).fixed;
  box.innerHTML=`<div class="cl-row"><span class="tag ${s.bad.length&&!fixed?"late":"ok"}">${s.bad.length?`문제 ${s.bad.length}건`:"문제 없음"}</span><span>${whenKo(c.submitted_at)} 제출${c.submitted_by?` · ${esc(c.submitted_by)}`:""}</span><button class="btn ghost sm" type="button" id="clReopen">다시 작성하게 열기</button></div>`+
    (s.bad.length?`<ul class="cl-bad">${s.bad.map(b=>`<li><b>${esc(b.sec)}</b> · ${esc(b.label)}${b.note?`<div class="note">${esc(b.note)}</div>`:""}</li>`).join("")}</ul>
      <label class="check cl-fixed"><input type="checkbox" id="clFixed" ${fixed?"checked":""}>문제 조치 완료${fixed?` <span class="hint">(${fmt(fixed)})</span>`:""}</label>`:"")+
    `<details class="cl-detail"><summary>전체 결과 보기</summary>${clDetailHtml(j,c)}</details>`;}
function b64uRand(n){const a=crypto.getRandomValues(new Uint8Array(n));return btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function clUpdate(jobId,patch){const {data,error}=await sb.from("checklists").update(patch).eq("job_id",jobId).select();
  if(error||!data||!data[0])return false;checks[jobId]=data[0];renderCl();render();return true;}
document.addEventListener("click",async e=>{
  if(e.target.closest("#clMake")){const b=e.target.closest("#clMake"),j=editing;if(!j)return;b.disabled=true;
    const {data,error}=await sb.from("checklists").insert({job_id:j.id,token:b64uRand(18)}).select();b.disabled=false;
    if(error||!data||!data[0]){showErr("체크리스트 링크를 만들지 못했어요. 잠시 후 다시 눌러 주세요.");return;}
    checks[j.id]=data[0];renderCl();render();return;}
  const rn=e.target.closest("#clRenew");
  if(rn&&editing){if(rn.dataset.armed!=="1"){rn.dataset.armed="1";rn.textContent="한 번 더 누르면 바뀌어요";setTimeout(()=>{if(rn.isConnected){rn.dataset.armed="";rn.textContent="링크 새로 만들기";}},4000);return;}
    rn.disabled=true;if(!await clUpdate(editing.id,{token:b64uRand(18)}))showErr("링크를 바꾸지 못했어요. 잠시 후 다시 눌러 주세요.");return;}
  const ro=e.target.closest("#clReopen");
  if(ro&&editing){if(ro.dataset.armed!=="1"){ro.dataset.armed="1";ro.textContent="정말 다시 열기";setTimeout(()=>{if(ro.isConnected){ro.dataset.armed="";ro.textContent="다시 작성하게 열기";}},4000);return;}
    ro.disabled=true;const c=clOf(editing.id),d={...(c.data||{})};delete d.fixed;
    if(!await clUpdate(editing.id,{status:"open",submitted_at:null,data:d}))showErr("다시 열지 못했어요. 잠시 후 다시 눌러 주세요.");}});
document.addEventListener("change",async e=>{if(e.target.id!=="clFixed"||!editing)return;const c=clOf(editing.id);if(!c)return;
  const d={...(c.data||{})};if(e.target.checked)d.fixed=TODAY;else delete d.fixed;
  if(!await clUpdate(editing.id,{data:d})){e.target.checked=!e.target.checked;showErr("저장하지 못했어요. 다시 눌러 주세요.");}});

/* 현장 사진: 단계별로 묶어 보관. 휴대폰 사진은 줄여서(긴 변 2000px) 올리고 작은 미리보기도 함께 저장 */
const urlCache=new Map();
async function signed(paths){
  const need=[...new Set(paths.filter(p=>{const c=urlCache.get(p);return!c||c.exp<Date.now()}))];
  if(need.length){const {data}=await sb.storage.from(BUCKET).createSignedUrls(need,3600);
    (data||[]).forEach(d=>{if(d&&d.signedUrl)urlCache.set(d.path,{url:d.signedUrl,exp:Date.now()+3300e3})});}
  return paths.map(p=>urlCache.get(p)?.url||"");}
const stageOf=f=>STAGES.includes(f.stage)?f.stage:"기타";
const photosOf=jobId=>STAGES.flatMap(s=>filesOf(jobId,"photo").filter(f=>stageOf(f)===s).sort((a,b)=>(a.created_at||"").localeCompare(b.created_at||"")));
function guessStage(j){if(j.f.done)return"AS";if(!j.i.start||j.i.start>TODAY)return"실측";return"시공 후";}
const previews=new Map();
function renderPhotos(){
  const saved=editing?photosOf(editing.id):[];
  const wait=pending.filter(p=>p.kind==="photo");
  previews.forEach((u,f)=>{if(!wait.some(p=>p.file===f)){URL.revokeObjectURL(u);previews.delete(f);}});
  const thumbUrl=f=>urlCache.get(f.thumb||f.path)?.url||"";
  const h=STAGES.map(s=>{const a=saved.filter(f=>stageOf(f)===s),b=wait.filter(p=>p.stage===s);if(!a.length&&!b.length)return"";
    return`<div class="ph-grp"><div class="ph-head"><b>${s}</b> <span class="hint">${a.length+b.length}장</span></div><div class="ph-grid">${
      a.map(f=>{const u=thumbUrl(f);return`<button type="button" class="ph" data-ph="${esc(f.id)}" aria-label="${s} 사진 ${fmt((f.created_at||"").slice(0,10))}"><img alt="" loading="lazy" data-path="${esc(f.thumb||f.path)}" ${u?`src="${esc(u)}"`:""}></button>`}).join("")+
      b.map(p=>{if(!previews.has(p.file))previews.set(p.file,URL.createObjectURL(p.file));return`<div class="ph wait"><img alt="" src="${previews.get(p.file)}"><span>${p.busy?"올리는 중…":"저장하면 올라가요"}</span>${p.busy?"":`<button type="button" class="ph-x" data-pdel="${pending.indexOf(p)}">빼기</button>`}</div>`}).join("")
    }</div></div>`}).join("");
  $("ph-list").innerHTML=h||`<div class="ph-none">아직 올린 사진이 없어요. 실측, 시공 전후, 마감 사진을 남겨 두면 AS 때 도움이 돼요.</div>`;
  const imgs=[...$("ph-list").querySelectorAll("img[data-path]:not([src])")];
  if(imgs.length)signed(imgs.map(i=>i.dataset.path)).then(us=>imgs.forEach((i,k)=>{if(us[k])i.src=us[k]}));
}
function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("decode"))};i.src=u;});}
function toJpeg(img,max,q){const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  return new Promise(res=>c.toBlob(res,"image/jpeg",q));}
async function uploadPhoto(jobId,file,stage){
  const tmp={kind:"photo",file,stage,busy:true};pending.push(tmp);renderPhotos();
  const up=(p,b)=>sb.storage.from(BUCKET).upload(p,b,{contentType:b.type||"image/jpeg",upsert:false});
  let path="",thumb="",stored=false;
  try{
    let big=null,small=null;
    try{const img=await loadImg(file);big=await toJpeg(img,2000,.82);small=await toJpeg(img,480,.72);}catch(e){}
    const body=big&&(big.size<file.size||!/jpe?g/i.test(file.type))?big:file;
    if(body.size>MAX_BYTES)throw new Error("too big");
    const base=`${jobId}/photo/${rid()}`;path=`${base}.${body===file?safeExt(file.name):"jpg"}`;
    const {error:ue}=await up(path,body);if(ue)throw ue;stored=true;
    if(small){const {error:te}=await up(`${base}-t.jpg`,small);if(!te)thumb=`${base}-t.jpg`;}
    const {data,error}=await sb.from("files").insert({job_id:jobId,kind:"photo",stage,thumb,name:file.name||"사진.jpg",path,size:body.size||0,mime:body.type||file.type||"image/jpeg",uploaded_by:userEmail}).select();
    if(error)throw error;
    if(data&&data[0]&&!files.find(f=>f.id===data[0].id))files.push(data[0]);
  }catch(e){
    if(stored)await sb.storage.from(BUCKET).remove([path,thumb].filter(Boolean));
    showErr(!migrated?"사진을 올리려면 Supabase 업데이트가 먼저 필요해요. 위쪽 안내를 봐 주세요.":`"${file.name||"사진"}"을 올리지 못했어요. 인터넷 연결을 확인하고 다시 올려 주세요.`);}
  finally{pending=pending.filter(p=>p!==tmp);renderPhotos();render();}
}
document.addEventListener("change",async e=>{const inp=e.target;if(!inp.classList||!inp.classList.contains("phpick"))return;
  const list=[...inp.files].filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));inp.value="";$("f-err").hidden=true;
  const stage=$("ph-stage").value;
  if(editing){for(const f of list)await uploadPhoto(editing.id,f,stage);}
  else{list.forEach(file=>pending.push({kind:"photo",file,stage}));renderPhotos();}});
/* 사진 크게 보기 */
let vList=[],vIdx=0;
async function showV(){const f=vList[vIdx];if(!f){closeV();return;}
  $("v-cap").textContent=`${fmt((f.created_at||"").slice(0,10))} · ${vIdx+1}/${vList.length}${f.uploaded_by?` · ${f.uploaded_by.split("@")[0]}`:""}`;
  $("v-stage").value=stageOf(f);$("v-del").dataset.armed="";$("v-del").textContent="삭제";
  $("v-img").removeAttribute("src");$("v-open").removeAttribute("href");
  $("v-prev").disabled=vIdx===0;$("v-next").disabled=vIdx===vList.length-1;
  const [u]=await signed([f.path]);if(vList[vIdx]===f&&u){$("v-img").src=u;$("v-open").href=u;}}
function openV(id){const f=files.find(x=>x.id===id);if(!f)return;vList=photosOf(f.job_id);vIdx=Math.max(0,vList.indexOf(f));
  $("viewer").hidden=false;document.body.style.overflow="hidden";showV();$("v-close").focus();}
function closeV(){$("viewer").hidden=true;document.body.style.overflow="";}
const stepV=d=>{const n=vIdx+d;if(n>=0&&n<vList.length){vIdx=n;showV();}};
document.addEventListener("click",e=>{const t=e.target.closest("[data-ph]");if(t)openV(t.dataset.ph);});
$("v-close").onclick=closeV;$("v-prev").onclick=()=>stepV(-1);$("v-next").onclick=()=>stepV(1);
$("viewer").addEventListener("click",e=>{if(e.target===$("viewer")||e.target.classList.contains("v-img"))closeV();});
document.addEventListener("keydown",e=>{if($("viewer").hidden)return;if(e.key==="Escape")closeV();if(e.key==="ArrowLeft")stepV(-1);if(e.key==="ArrowRight")stepV(1);});
let tx=null;$("viewer").addEventListener("touchstart",e=>{tx=e.touches[0].clientX},{passive:true});
$("viewer").addEventListener("touchend",e=>{if(tx==null)return;const dx=e.changedTouches[0].clientX-tx;tx=null;if(Math.abs(dx)>50)stepV(dx<0?1:-1);});
$("v-stage").onchange=async e=>{const f=vList[vIdx];if(!f)return;const stage=e.target.value;
  const {error}=await sb.from("files").update({stage}).eq("id",f.id);
  if(error){e.target.value=stageOf(f);return;}f.stage=stage;vList=photosOf(f.job_id);vIdx=vList.indexOf(f);showV();renderPhotos();};
$("v-del").onclick=async()=>{const b=$("v-del");if(b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent="정말 삭제";return;}
  const f=vList[vIdx];if(!f)return;b.disabled=true;const ok=await removeFile(f);b.disabled=false;
  if(!ok){b.textContent="삭제 실패";return;}
  vList=photosOf(f.job_id);if(vIdx>=vList.length)vIdx=vList.length-1;renderPhotos();render();vList.length?showV():closeV();};

/* 엑셀 백업: 지금 앱에 있는 기록을 .xlsx 파일 하나로 (관리자는 수금·원가 시트까지) */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function zipStore(files){const enc=new TextEncoder(),head=[],cen=[];let off=0;
  for(const f of files){const nm=enc.encode(f.name),d=typeof f.data==="string"?enc.encode(f.data):f.data,crc=crc32(d);
    const h=new DataView(new ArrayBuffer(30));
    [[0,0x04034b50,4],[4,20,2],[6,0x0800,2],[12,0x21,2],[14,crc,4],[18,d.length,4],[22,d.length,4],[26,nm.length,2]].forEach(([o,v,s])=>s===4?h.setUint32(o,v,true):h.setUint16(o,v,true));
    head.push(new Uint8Array(h.buffer),nm,d);
    const c=new DataView(new ArrayBuffer(46));
    [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x0800,2],[14,0x21,2],[16,crc,4],[20,d.length,4],[24,d.length,4],[28,nm.length,2],[42,off,4]].forEach(([o,v,s])=>s===4?c.setUint32(o,v,true):c.setUint16(o,v,true));
    cen.push(new Uint8Array(c.buffer),nm);off+=30+nm.length+d.length;}
  const size=cen.reduce((a,b)=>a+b.length,0),e=new DataView(new ArrayBuffer(22));
  [[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,size,4],[16,off,4]].forEach(([o,v,s])=>s===4?e.setUint32(o,v,true):e.setUint16(o,v,true));
  return new Blob([...head,...cen,new Uint8Array(e.buffer)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});}
const xesc=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const colName=i=>{let s="";i++;while(i){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=(i-m-1)/26;}return s;};
const xlDate=ds=>{const [y,m,d]=ds.split("-").map(Number);return(Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/864e5;};
/* 시트 하나: cols=[[제목,너비,종류]] 종류 s=글자 d=날짜 w=금액 n=숫자 */
function sheetXml(cols,rows){
  const cell=(v,t,r,c)=>{const ref=colName(c)+r;
    if(v===""||v==null)return"";
    if(t==="d"&&/^\d{4}-\d{2}-\d{2}$/.test(v))return`<c r="${ref}" s="2"><v>${xlDate(v)}</v></c>`;
    if((t==="w"||t==="n")&&typeof v==="number")return`<c r="${ref}"${t==="w"?' s="3"':""}><v>${v}</v></c>`;
    return`<c r="${ref}" t="inlineStr"${/\n/.test(v)?' s="4"':""}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;};
  const head=`<row r="1">${cols.map((c,i)=>`<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xesc(c[0])}</t></is></c>`).join("")}</row>`;
  const body=rows.map((row,ri)=>`<row r="${ri+2}">${row.map((v,ci)=>cell(v,cols[ci][2],ri+2,ci)).join("")}</row>`).join("");
  const last=`${colName(cols.length-1)}${rows.length+1}`;
  return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols>${cols.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${c[1]}" customWidth="1"/>`).join("")}</cols><sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;}
function xlsxBlob(sheets){
  const ns='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',R="http://schemas.openxmlformats.org/officeDocument/2006/relationships",X='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files=[
    {name:"[Content_Types].xml",data:`${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`},
    {name:"_rels/.rels",data:`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml",data:`${X}<workbook ${ns} xmlns:r="${R}"><sheets>${sheets.map((s,i)=>`<sheet name="${xesc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets><definedNames>${sheets.map((s,i)=>`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xesc(s.name)}'!$A$1:$${colName(s.cols.length-1)}$${s.rows.length+1}</definedName>`).join("")}</definedNames></workbook>`},
    {name:"xl/_rels/workbook.xml.rels",data:`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${R}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`},
    {name:"xl/styles.xml",data:`${X}<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1E3D8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`},
    ...sheets.map((s,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s.cols,s.rows)}))];
  return zipStore(files);}
const OX=b=>b?"O":"";
function backupSheets(){
  const list=[...jobs].sort((a,b)=>(a.i.start||a.m.date||"9999").localeCompare(b.i.start||b.m.date||"9999")||a.name.localeCompare(b.name,"ko"));
  const sheets=[
    {name:"현장",cols:[["현장",18,"s"],["상태",8,"s"],["품목",14,"s"],["주소",30,"s"],["고객 전화",15,"s"],["실측일",12,"d"],["실측 완료",9,"s"],["시공 시작",12,"d"],["시공 끝",12,"d"],["작업일",7,"n"],["시공자",16,"s"],["날짜별 시공자",30,"s"],["주말 작업",10,"s"],["공동현관 비밀번호",16,"s"],["세대현관 비밀번호",16,"s"],["현장 담당자",22,"s"],["마감 완료",9,"s"],["추가 투입",9,"n"],["AS",6,"n"],["사진·파일",9,"n"],["진행 단계",10,"s"],["계약일",12,"d"],["설계 담당",12,"s"],["도면 확정 목표",12,"d"],["도면 확정일",12,"d"],["생산",11,"s"],["외주처",14,"s"],["납기",12,"d"],["생산 완료일",12,"d"]],
      rows:list.map(j=>[j.name,JOB_STAGE[jobStage(j)],j.item,j.addr,j.i.tel,j.m.date,OX(j.m.done),j.i.start,j.i.end,j.i.start?workDays(j).length:"",crewAll(j).join(", "),dayCustom(j)?spanDays(j.i).map(d=>`${md(d)} ${(j.i.off||[]).includes(d)?"쉼":crewOn(j,d).join("·")||"미배정"}`).join(", "):"",[j.i.sat&&"토",j.i.sun&&"일"].filter(Boolean).join("·"),j.i.gate,j.i.door,j.i.mgr.join(", "),OX(j.f.done),j.f.extra.reduce((a,x)=>a+(+x.people||0),0)||"",j.f.as.length||"",files.filter(f=>f.job_id===j.id).length||"",FLOW_NAME[flowStage(j)],j.i.fl.ct,j.i.fl.dw.by,j.i.fl.dw.due,j.i.fl.dw.ok,PR_HOW[j.i.fl.pr.how]||"",j.i.fl.pr.out,j.i.fl.pr.due,j.i.fl.pr.ok])},
    {name:"마감 추가 투입",cols:[["현장",18,"s"],["날짜",12,"d"],["인원",7,"n"],["메모",36,"s"]],
      rows:list.flatMap(j=>j.f.extra.map(x=>[j.name,x.date||"",+x.people||"",x.note||""]))},
    {name:"AS",cols:[["현장",18,"s"],["날짜",12,"d"],["담당",12,"s"],["내용",40,"s"],["완료",7,"s"]],
      rows:list.flatMap(j=>j.f.as.map(a=>[j.name,a.date||"",a.crew||"",a.note||"",OX(a.done)]))}];
  if(isAdmin){
    sheets.push({name:"수금",cols:[["현장",18,"s"],["계약일",12,"d"],["계약금액",14,"w"],["VAT 별도",9,"s"],["청구 합계",14,"w"],["받은 돈",14,"w"],["미수금",14,"w"]],
      rows:list.filter(j=>hasMoney(moneyOf(j.id))).map(j=>{const m=moneyOf(j.id);return[j.name,m.contract.date,m.contract.amount,OX(m.contract.vat),billTotal(m),received(m),unpaidOf(m)];})});
    sheets.push({name:"입금 내역",cols:[["현장",18,"s"],["구분",9,"s"],["금액",14,"w"],["받을 날",12,"d"],["입금",7,"s"],["입금일",12,"d"]],
      rows:list.flatMap(j=>moneyOf(j.id).pays.map(p=>[j.name,p.label,p.amount,p.due,OX(p.paid),p.paidOn]))});
    sheets.push({name:"매입",cols:[["현장",18,"s"],["항목",16,"s"],["거래처",16,"s"],["금액",14,"w"],["메모",36,"s"],["매입일",12,"d"],["입고 예정",12,"d"],["입고일",12,"d"],["거래처 지급",9,"s"],["지급일",12,"d"]],
      rows:list.flatMap(j=>jobCosts(j).map(x=>[j.name,x.cat,x.v||"",x.amount,x.note,x.d||"",x.due||"",x.got||"",isVend(x)?OX(x.paid):"",x.paidOn||""]))});
    if(pay08)sheets.push(...wageSheets());
    if(expenses.length)sheets.push({name:"지출",cols:[["날짜",12,"d"],["항목",14,"s"],["금액",14,"w"],["메모",30,"s"],["매달 반복",9,"s"],["반복 끝",9,"s"]],
      rows:[...expenses].sort((a,b)=>a.day.localeCompare(b.day)).map(x=>[x.day,x.cat,x.amount,x.note,OX(x.repeat),x.until])});
    const ys=[...new Set([...jobs.map(j=>jobMonth(j).slice(0,4)),...expenses.map(x=>x.day.slice(0,4))].filter(Boolean))].sort(),fin=[];
    ys.forEach(y=>yearMonths(y).forEach(ym=>{const js=jobs.filter(j=>jobMonth(j)===ym),r=js.reduce((a,j)=>a+moneyOf(j.id).contract.amount,0),b=js.reduce((a,j)=>a+jobBuy(j),0),l=js.reduce((a,j)=>a+jobLabor(j),0),e=expSum([ym]);
      if(r||b||l||e)fin.push([ym,js.length||"",r,b,l,e,r-b-l-e]);}));
    if(ests.length){const list2=[...ests].sort((x,y)=>(x.d.date||"").localeCompare(y.d.date||"")||x.d.ver-y.d.ver),jn=id=>(jobs.find(j=>j.id===id)||{}).name||"";
      sheets.push({name:"견적",cols:[["견적번호",14,"s"],["차수",6,"n"],["견적일",12,"d"],["업체",16,"s"],["연락처",14,"s"],["담당",10,"s"],["프로젝트",24,"s"],["현장",20,"s"],["연결된 현장",16,"s"],["부가세",10,"s"],["공급가 합계",14,"w"],["특별 할인",12,"w"],["단수 조정",12,"w"],["부가세 금액",12,"w"],["총 견적금액",14,"w"],["상태",8,"s"],["고객이 연 횟수",8,"n"]],
        rows:list2.map(e=>{const t=E.calc(e.d);return[e.d.no,e.d.ver,e.d.date,e.d.cust.name,e.d.cust.phone,e.d.cust.mgr,e.d.title,e.d.cust.addr,jn(e.job_id),E.VAT[e.d.vat],t.supply,t.disc,t.adj,t.vat,t.total,EST_ST[e.status],e.views||""];})});
      sheets.push({name:"견적 품목",cols:[["견적번호",14,"s"],["차수",6,"n"],["업체",16,"s"],["공간",14,"s"],["품목",24,"s"],["규격",22,"s"],["소재 · 마감",26,"s"],["하드웨어",18,"s"],["수량",7,"n"],["단위",6,"s"],["단가",13,"w"],["금액",14,"w"],["비고",20,"s"]],
        rows:list2.flatMap(e=>{let sec="";return e.d.rows.flatMap(r=>{if(r.t==="h"){sec=r.name;return[];}return[[e.d.no,e.d.ver,e.d.cust.name,sec,r.name,r.spec,r.mat,r.hw,r.qty||"",r.unit,r.price,E.lineAmt(r),r.note]];});})});}
    if(fin.length)sheets.push({name:"월별 결산",cols:[["월",9,"s"],["현장",7,"n"],["매출",14,"w"],["매입",14,"w"],["시공비",14,"w"],["지출",14,"w"],["순이익",14,"w"]],rows:fin});}
  const clRows=[];
  list.forEach(j=>{const c=clOf(j.id);if(!c)return;const d=c.data||{},it=d.items||{},dims=d.dims||{},day=(c.submitted_at||"").slice(0,10),st=c.status==="submitted"?"제출":"작성 중";
    NEST_CL.sections(j).forEach(sec=>{
      if(sec.dims&&NEST_CL.dimsText(dims[sec.key]))clRows.push([j.name,st,sec.title,"잰 치수",NEST_CL.dimsText(dims[sec.key]),"",c.submitted_by||"",day]);
      sec.items.forEach(x=>{const r=it[x.key]||{};clRows.push([j.name,st,sec.title,x.label,NEST_CL.RESULT[r.v]||"",r.note||"",c.submitted_by||"",day]);});});
    if(d.memo)clRows.push([j.name,st,"남은 작업 · 특이사항","",d.memo,"",c.submitted_by||"",day]);});
  if(clRows.length)sheets.push({name:"체크리스트",cols:[["현장",18,"s"],["상태",8,"s"],["구분",22,"s"],["항목",36,"s"],["결과",10,"s"],["메모",30,"s"],["작성자",10,"s"],["제출일",12,"d"]],rows:clRows});
  const KIND={drawing:"도면",estimate:"견적서",photo:"사진",spec:"시방서"},nameOf=id=>(jobs.find(j=>j.id===id)||{}).name||"",
    appOf=f=>{const a=(((jobs.find(j=>j.id===f.job_id)||{}).i||{}).apps||[]).find(a=>a.id===f.stage);return a?NEST_CL.typeName(NEST_CL.appType(a))+(a.model?` ${a.model}`:""):"";};
  sheets.push({name:"사진·파일 목록",cols:[["현장",18,"s"],["종류",8,"s"],["단계·가전",14,"s"],["파일 이름",32,"s"],["올린 사람",22,"s"],["올린 날",12,"d"]],
    rows:files.map(f=>[nameOf(f.job_id),KIND[f.kind]||f.kind,f.kind==="photo"?(f.stage||""):f.kind==="spec"?appOf(f):"",f.name||"",f.uploaded_by||"",(f.created_at||"").slice(0,10)])});
  sheets.push({name:"시공자 명단",cols:[["시공자",16,"s"]],rows:CREW.map(c=>[c])});
  return sheets;}
/* 엑셀 백업: 일당 설정과 달마다 정산 (일정이나 기록이 있는 달, 최근 3년) */
function wageSheets(){const R=wage.rates,out=[];
  const rates=[...Object.entries(R.day).map(([n,v])=>[n,v]),...(R.extra?[["마감 추가 투입 1인",R.extra]]:[]),...(R.as?[["AS 하루",R.as]]:[])];
  if(rates.length)out.push({name:"시공자 일당",cols:[["시공자",22,"s"],["일당",14,"w"]],rows:rates});
  const ks=new Set(Object.keys(wage.months)),lo=ymKey(now.getFullYear()-3,1),hi=ymKey(now.getFullYear()+1,12);
  jobs.forEach(j=>{workDays(j).forEach(d=>{if(crewOn(j,d).length)ks.add(d.slice(0,7))});j.f.as.forEach(a=>{if(a.crew&&a.date)ks.add(a.date.slice(0,7))});j.f.extra.forEach(x=>{if(x.date)ks.add(x.date.slice(0,7))});});
  const rows=[];[...ks].filter(k=>/^\d{4}-\d{2}$/.test(k)&&k>=lo&&k<=hi).sort().forEach(k=>{const W=wageMonth(+k.slice(0,4),+k.slice(5)),x=W.extra;
    W.people.forEach(p=>rows.push([k,p.n,p.days||"",p.as||"",p.rate||"",p.adj||"",p.note,shownPay(p)??"",p.paid]));
    if(x.people||x.paid)rows.push([k,"마감 추가 투입 (인원)",x.people||"","",x.rate||"","","",(x.paid&&x.snap?+x.snap.total||0:x.total)??"",x.paid]);});
  if(rows.length)out.push({name:"시공자 정산",cols:[["월",9,"s"],["시공자",16,"s"],["시공일",8,"n"],["AS",6,"n"],["일당",12,"w"],["조정",12,"w"],["메모",24,"s"],["합계",14,"w"],["지급일",12,"d"]],rows});
  return out;}
const XLS_KEY="nest-backup-day";
function renderBackup(){let last="";try{last=localStorage.getItem(XLS_KEY)||""}catch(e){}
  const what=isAdmin?"현장·AS·수금·매입·지출·정산·견적":"현장·일정·AS";
  const old=!last||(new Date(TODAY)-new Date(last))/864e5>30;
  $("xlsNote").innerHTML=`${what} 기록을 엑셀 파일 하나로 받아 보관해요.`+(last?` 이 기기에서 마지막으로 받은 날: ${+last.slice(5,7)}월 ${+last.slice(8)}일`:"")+(jobs.length&&old?` <span class="tag soon">${last?"한 달 넘게 안 받았어요":"아직 한 번도 안 받았어요"}</span>`:"");}
function downloadBackup(){
  if(!loaded)return;
  const blob=xlsxBlob(backupSheets()),fname=`NEST_backup_${TODAY}.xlsx`;
  const done=()=>{try{localStorage.setItem(XLS_KEY,TODAY)}catch(e){}renderBackup();renderHome();const b=$("xlsBtn"),t=b.textContent;b.textContent="받았어요";setTimeout(()=>b.textContent=t,1600);};
  // 아이폰 홈 화면 앱은 바로 내려받기가 잘 안 돼서, 공유 창(파일에 저장·카톡 보내기)으로 엶
  if(IOS&&navigator.canShare){const file=new File([blob],fname,{type:blob.type});
    if(navigator.canShare({files:[file]})){navigator.share({files:[file],title:fname}).then(done).catch(()=>{});return;}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=fname;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);done();}
$("xlsBtn").onclick=downloadBackup;

/* 휴대폰 알림: 기기마다 켜고 끔. 보내는 일은 Supabase의 notify 서버가 매일 아침·저녁에 함 */
const IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const standalone=()=>(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
const pushOk=()=>"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
const b64uBytes=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");s+="===".slice((s.length+3)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
const sameKey=(a,b)=>{if(!a)return true;a=new Uint8Array(a);return a.length===b.length&&a.every((x,i)=>x===b[i]);};
function deviceName(){const u=navigator.userAgent;
  return /iPhone/.test(u)?"iPhone":IOS?"iPad":/Android/.test(u)?"안드로이드":/Mac/.test(u)?"Mac":/Windows/.test(u)?"Windows PC":"기기";}
function pushErr(kind){const e=new Error(kind);e.kind=kind;return e;}
const PUSH_MSG={
  server:"알림 서버를 찾지 못했어요. Supabase → Edge Functions에 이름이 정확히 notify인 서버가 있는지 확인해 주세요.",
  sql:"Supabase 업데이트 3(SQL)이 아직 안 됐어요. README의 \"업데이트 3\" 2단계를 먼저 해 주세요.",
  offline:"인터넷 연결을 확인하고 다시 눌러 주세요.",
  sw:"앱을 새로고침한 뒤 다시 눌러 주세요.",
  fail:"알림을 켜지 못했어요. 잠시 후 다시 눌러 주세요."};
async function fnCall(body){
  if(!navigator.onLine)throw pushErr("offline");
  const {data,error}=await sb.functions.invoke("notify",{body});
  if(error){const res=error.context,st=res&&res.status;let msg="";
    try{msg=(await res.json()).error||"";}catch(e){}
    if(/push_keys|push_subs|push_log/.test(msg))throw pushErr("sql");
    throw pushErr(st===401?"fail":"server");}
  return data||{};}
async function swReg(){
  let r=await navigator.serviceWorker.getRegistration();
  if(!r)r=await navigator.serviceWorker.register("sw.js");
  if(r.active)return r;
  return Promise.race([navigator.serviceWorker.ready,new Promise((_,no)=>setTimeout(()=>no(pushErr("sw")),8000))]);}
async function curSub(){if(!pushOk())return null;const r=await navigator.serviceWorker.getRegistration();return r?r.pushManager.getSubscription():null;}
const readPrefs=()=>{const p={};document.querySelectorAll("#pushPrefs [data-pref]").forEach(c=>p[c.dataset.pref]=c.checked);return p;};
function pushMsg(t){$("pushMsg").textContent=t||"";$("pushMsg").hidden=!t;}
function pushHelp(t){$("pushHelp").innerHTML=t||"";$("pushHelp").hidden=!t;}
let pushOn=false;
async function renderPush(){
  const st=$("pushState"),show=(id,v)=>$(id).hidden=!v;
  st.className="push-state";pushHelp("");
  ["pushOn","pushOff","pushTest","pushPrefs"].forEach(id=>show(id,false));
  if(IOS&&!standalone()){st.textContent="iPhone은 홈 화면 앱에서 켤 수 있어요.";
    pushHelp("Safari 아래쪽 <b>공유 버튼(네모 위 화살표)</b> → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면에 생긴 네스트 아이콘으로 앱을 열어서 여기서 알림을 켜 주세요.");return;}
  if(!pushOk()){st.textContent="이 화면에서는 알림을 켤 수 없어요.";
    pushHelp(IOS?"iPhone을 iOS 16.4 이상으로 업데이트해 주세요.":"안드로이드는 Chrome, 컴퓨터는 Chrome·Edge·Safari에서 열어 주세요.");return;}
  if(Notification.permission==="denied"){st.textContent="이 기기에서 알림이 차단돼 있어요.";
    pushHelp(IOS?"iPhone <b>설정 → 알림 → 네스트</b>에서 알림 허용을 켠 뒤 앱을 다시 열어 주세요.":"휴대폰 <b>설정 → 알림</b>(또는 주소창 왼쪽 자물쇠 → 권한)에서 이 사이트 알림을 허용한 뒤 다시 열어 주세요.");return;}
  let sub=null,row=null;
  try{sub=await curSub();
    if(sub){const {data,error}=await sb.from("push_subs").select("prefs").eq("endpoint",sub.endpoint);if(!error&&data&&data[0])row=data[0];}}catch(e){}
  pushOn=!!(sub&&row&&Notification.permission==="granted");
  if(pushOn){const p=row.prefs||{};document.querySelectorAll("#pushPrefs [data-pref]").forEach(c=>c.checked=p[c.dataset.pref]!==false);}
  st.textContent=pushOn?"이 기기에서 알림을 받고 있어요.":"이 기기는 알림이 꺼져 있어요.";
  if(pushOn)st.classList.add("on");
  show("pushOn",!pushOn);show("pushOff",pushOn);show("pushTest",pushOn);show("pushPrefs",true);}
async function openPush(){pushMsg("");$("pushState").textContent="확인하는 중…";
  if($("pushSheet").hidden){pushFrom=document.activeElement;$("pushSheet").hidden=false;document.body.style.overflow="hidden";$("pushClose").focus();}
  await renderPush();}
let pushFrom=null;
function closePush(){$("pushSheet").hidden=true;document.body.style.overflow="";if(pushFrom&&pushFrom.focus)pushFrom.focus({preventScroll:true});pushFrom=null;}
async function busy(id,label,fn){const b=$(id),t=b.textContent;b.disabled=true;b.textContent=label;try{await fn();}finally{b.disabled=false;b.textContent=t;}}
async function enablePush(){pushMsg("");
  // 허용 질문은 버튼을 누른 바로 그때 해야 iPhone에서도 떠요
  const perm=await Notification.requestPermission();
  if(perm!=="granted"){await renderPush();if(perm!=="denied")pushMsg("알림 허용을 눌러야 켜져요.");return;}
  try{
    const {publicKey}=await fnCall({action:"key"});if(!publicKey)throw pushErr("server");
    const key=b64uBytes(publicKey),reg=await swReg();
    let sub=await reg.pushManager.getSubscription();
    if(sub&&!sameKey(sub.options&&sub.options.applicationServerKey,key)){await sub.unsubscribe();sub=null;}
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    const j=sub.toJSON();
    const {error}=await sb.rpc("save_push_sub",{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth,p_prefs:readPrefs(),p_device:deviceName()});
    if(error)throw pushErr(/save_push_sub|PGRST202|42883|push_subs/i.test(`${error.code} ${error.message}`)?"sql":"fail");
    await renderPush();pushMsg("알림을 켰어요. 테스트 알림으로 잘 오는지 확인해 보세요.");
  }catch(e){await renderPush();pushMsg(PUSH_MSG[e.kind]||PUSH_MSG.fail);}}
async function disablePush(){pushMsg("");
  try{const sub=await curSub();if(sub){await sb.from("push_subs").delete().eq("endpoint",sub.endpoint);await sub.unsubscribe();}}catch(e){}
  await renderPush();pushMsg("이 기기 알림을 껐어요.");}
async function testPush(){pushMsg("");
  try{const r=await fnCall({action:"test"});
    pushMsg(r.sent?"테스트 알림을 보냈어요. 잠시 뒤 이 기기에 알림이 와요.":"알림을 켠 기기를 찾지 못했어요. 알림을 껐다가 다시 켜 주세요.");}
  catch(e){pushMsg(PUSH_MSG[e.kind]||"테스트 알림을 보내지 못했어요. 잠시 후 다시 눌러 주세요.");}}
async function savePrefs(){if(!pushOn)return;pushMsg("");
  try{const sub=await curSub();if(!sub)return;
    const {error}=await sb.from("push_subs").update({prefs:readPrefs()}).eq("endpoint",sub.endpoint);
    pushMsg(error?"설정을 저장하지 못했어요. 다시 눌러 주세요.":"저장했어요.");}catch(e){}}
// 로그아웃하면 이 기기 알림도 끔 (다른 사람이 쓰는 기기에 일정이 뜨지 않게)
async function forgetPush(){try{const sub=await Promise.race([curSub(),new Promise(r=>setTimeout(()=>r(null),3000))]);
  if(sub){await sb.from("push_subs").delete().eq("endpoint",sub.endpoint);await sub.unsubscribe();}}catch(e){}}
/* 화면 위에는 계정(이메일) 대신 'ㅇㅇㅇ님'. 이름은 로그인 계정 정보(user_metadata)에 저장돼서 어느 기기에서든 같음 */
const metaName=u=>String((u&&u.user_metadata&&u.user_metadata.name)||"").trim();
function showWho(){const b=$("who");b.textContent=userName?`${userName}님`:"이름 넣기";b.classList.toggle("empty",!userName);
  b.setAttribute("aria-label",userName?`${userName}님, 이름 바꾸기`:"내 이름 넣기");}
let nameFrom=null;
function openName(){$("nm-in").value=userName;$("nm-err").hidden=true;
  $("nmAcct").textContent=`로그인 계정: ${userEmail} · ${isAdmin?"관리자 계정이라 돈 관련 내용(수금·매입·결산)이 보여요.":"직원 계정이라 돈 관련 내용은 안 보여요."}`;
  nameFrom=document.activeElement;$("nameSheet").hidden=false;document.body.style.overflow="hidden";$("nm-in").focus();}
function closeName(){$("nameSheet").hidden=true;document.body.style.overflow="";if(nameFrom&&nameFrom.focus)nameFrom.focus({preventScroll:true});nameFrom=null;}
$("who").onclick=openName;$("nameClose").onclick=closeName;
$("nameSheet").addEventListener("click",e=>{if(e.target===$("nameSheet"))closeName();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("nameSheet").hidden)closeName();});
$("nameForm").addEventListener("submit",async e=>{e.preventDefault();const name=$("nm-in").value.trim().replace(/님$/,"").slice(0,20);
  if(!name){$("nm-err").textContent="이름을 적어 주세요.";$("nm-err").hidden=false;$("nm-in").focus();return;}
  $("nm-save").disabled=true;$("nm-err").hidden=true;
  const {error}=await sb.auth.updateUser({data:{name}});$("nm-save").disabled=false;
  if(error){$("nm-err").textContent="저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";$("nm-err").hidden=false;return;}
  userName=name;showWho();closeName();});
$("pushBtn").onclick=openPush;$("pushClose").onclick=closePush;
$("pushSheet").addEventListener("click",e=>{if(e.target===$("pushSheet"))closePush();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("pushSheet").hidden)closePush();});
$("pushOn").onclick=()=>busy("pushOn","켜는 중…",enablePush);
$("pushOff").onclick=()=>busy("pushOff","끄는 중…",disablePush);
$("pushTest").onclick=()=>busy("pushTest","보내는 중…",testPush);
document.querySelectorAll("#pushPrefs [data-pref]").forEach(c=>c.onchange=savePrefs);

/* 알림을 눌러 열었을 때: ?day=날짜 → 달력에서 그날, ?tab=pay → 정산 › 고객 수금 */
let pendingLink=location.search;
function applyLink(q){
  const p=new URLSearchParams(q.includes("?")?q.slice(q.indexOf("?")):q),day=p.get("day"),t=p.get("tab"),jid=p.get("job");
  const jj=jid&&jobs.find(x=>x.id===jid);
  if(jj){if(!$("pushSheet").hidden)closePush();if(!$("daySheet").hidden)closeDay();tab("board");openForm(jj);setTimeout(()=>$("sec-cl").scrollIntoView({block:"start"}),400);}
  else if(day&&/^\d{4}-\d{2}-\d{2}$/.test(day)){if(!$("pushSheet").hidden)closePush();tab("cal");openDay(day);}
  else if(t&&VIEWS.includes(t)){if(!$("daySheet").hidden)closeDay();tab(t);}
  if(location.search)history.replaceState(null,"",location.pathname+location.hash);}
if("serviceWorker" in navigator)navigator.serviceWorker.addEventListener("message",e=>{
  if(!e.data||e.data.type!=="open")return;if(loaded)applyLink(e.data.url||"");else pendingLink=e.data.url||"";});

/* Supabase: 로그인, 불러오기, 실시간 반영 */
async function checkAdmin(){
  const {data,error}=await sb.from("admins").select("user_id").eq("user_id",uid);
  migrated=!(error&&/admins|42P01|PGRST20/i.test(`${error.code} ${error.message}`));
  isAdmin=!error&&!!(data&&data.length);
  $("updNote").hidden=migrated;
  document.querySelectorAll(".admin-only").forEach(el=>el.hidden=!isAdmin);
  showWho();
}
async function loadAll(){
  const [{data:j,error:e1},{data:c},{data:fl},mo,ck]=await Promise.all([sb.from("jobs").select("*"),sb.from("crew").select("name").order("created_at"),sb.from("files").select("*").order("created_at"),
    isAdmin?sb.from("job_money").select("*"):Promise.resolve({data:[]}),sb.from("checklists").select("*"),loadLib(),loadWage(),loadExpenses(),loadEst()]);
  if(e1){$("status").textContent="현장을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";$("status").hidden=false;return;}
  $("status").hidden=true;
  jobs=(j||[]).map(r=>norm(r.id,r));CREW=(c||[]).map(r=>r.name);files=fl||[];laborCache=null;
  if(!mo.error){money={};(mo.data||[]).forEach(r=>{money[r.job_id]=normMoney(r.data)});}
  cl04=!(ck.error&&/checklists|42P01|PGRST20/i.test(`${ck.error.code} ${ck.error.message}`));
  if(!ck.error){checks={};(ck.data||[]).forEach(r=>{checks[r.job_id]=r});}
  loaded=true;render();renderBackup();specStatus();autoDue();autoCt();
  if(!$("form").hidden&&editing){renderFiles();renderPhotos();renderCl();}
  if(pendingLink){const q=pendingLink;pendingLink="";applyLink(q);}
}
let channel=null;
/* 앱을 처음 켰을 때만 '오늘'부터. 로그인 확인은 앱으로 돌아올 때마다 다시 오므로(SIGNED_IN) 이미 켜져 있으면 화면을 그대로 둠.
   휴대폰이 앱을 잠깐 내렸다가 다시 띄우는(새로 읽는) 경우에도 같은 실행 중이면(sessionStorage) 보던 화면으로 돌아감 */
let startedFor="";
async function startApp(session){const id=session.user.id||"";
  if(startedFor===id&&!$("app").hidden)return;startedFor=id;
  $("login").hidden=true;$("app").hidden=false;userEmail=session.user.email||"";uid=id;userName=metaName(session.user);showWho();
  sb.auth.getUser().then(({data})=>{if(data&&data.user&&uid===data.user.id){userName=metaName(data.user);showWho();}}).catch(()=>{});
  await checkAdmin();
  let cur="";try{cur=sessionStorage.getItem("nest-cur")||""}catch(e){}
  tab(VIEWS.includes(cur)?cur:"home");
  loadAll();
  if(!channel){channel=sb.channel("nest");["jobs","crew","files","job_money","checklists"].forEach(tb=>channel.on("postgres_changes",{event:"*",schema:"public",table:tb},loadAll));channel.subscribe();}
}
function showLogin(){startedFor="";userName="";$("nameSheet").hidden=true;document.body.style.overflow="";try{sessionStorage.removeItem("nest-cur")}catch(e){}$("app").hidden=true;$("pushSheet").hidden=true;$("login").hidden=false;isAdmin=false;$("gnav").hidden=true;document.body.classList.remove("gnav-on");money={};wage={rates:normRates(),months:{}};pay08=true;laborCache=null;if(wageChan){sb.removeChannel(wageChan);wageChan=null;}expenses=[];pay09=true;if(expChan){sb.removeChannel(expChan);expChan=null;}ests=[];est10=true;coFilled=false;if(estChan){sb.removeChannel(estChan);estChan=null;}if(!$("estSheet").hidden)closeEst(true);if(channel){sb.removeChannel(channel);channel=null;}if(specChan){sb.removeChannel(specChan);specChan=null;}clearTimeout(specPoll);specLib={};specAuto=null;specAt=0;specAutoRan=false;mediaRan=false;}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("l-err").hidden=true;$("l-btn").disabled=true;
  const {error}=await sb.auth.signInWithPassword({email:$("l-email").value.trim(),password:$("l-pw").value});
  $("l-btn").disabled=false;
  if(error){$("l-err").textContent="이메일이나 비밀번호가 맞지 않아요.";$("l-err").hidden=false;}});
$("logoutBtn").onclick=async()=>{$("logoutBtn").disabled=true;await forgetPush();$("logoutBtn").disabled=false;sb.auth.signOut();};
/* 앱으로 돌아오면 새 내용을 불러옴. 날짜가 바뀌었으면(밤새 켜 둔 경우) 오늘 날짜만 바꾸고 보던 화면·입력하던 내용은 그대로 */
const dayNow=()=>{const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
document.addEventListener("visibilitychange",()=>{if(document.hidden||$("app").hidden)return;
  const d=dayNow();if(d!==TODAY){TODAY=d;laborCache=null;}loadAll();});

(function boot(){
  const cfg=window.NEST_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){$("setup").hidden=false;return;}
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  sb.auth.getSession().then(({data})=>data.session?startApp(data.session):showLogin());
  sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_IN"&&session)startApp(session);if(ev==="SIGNED_OUT")showLogin();});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
