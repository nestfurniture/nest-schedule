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
const now=new Date();const TODAY=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
calY=now.getFullYear();calM=now.getMonth();
const fmt=d=>d?d.slice(5).replace("-","/"):"—";
const addDays=(d,n)=>{const t=new Date(d+"T12:00:00");t.setDate(t.getDate()+n);return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`};
const dayDiff=(a,b)=>Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5);
const sub=j=>[j.item,j.addr].filter(Boolean).map(esc).join(" · ");
const WD="일월화수목금토";
const dow=d=>new Date(d+"T12:00:00").getDay();
const fmtW=d=>d?`${fmt(d)}<span class="wk">(${WD[dow(d)]})</span>`:"—";
const short=j=>esc(j.name.replace(" 고객",""));
/* 시공 작업일: 시작~종료 중 토·일은 따로 체크한 경우에만 포함 */
function workDays(j){const out=[];if(!j.i.start)return out;const end=j.i.end&&j.i.end>=j.i.start?j.i.end:j.i.start;
  for(let d=j.i.start,n=0;d<=end&&n<370;d=addDays(d,1),n++){const w=dow(d);if((w===6&&!j.i.sat)||(w===0&&!j.i.sun))continue;out.push(d);}return out;}
const range=j=>{if(!j.i.start)return"";const one=!j.i.end||j.i.end===j.i.start;const n=workDays(j).length;
  return (one?fmtW(j.i.start):`${fmtW(j.i.start)}~${fmtW(j.i.end)}`)+(one?"":` <span class="wk">· 작업 ${n}일</span>`);};
const COLORS=["orange","banana","avocado"];
const kc=j=>"k-"+(COLORS.includes(j.i.color)?j.i.color:"orange");
const asOpen=j=>j.f.as.filter(a=>!a.done);
const extraSum=j=>j.f.extra.reduce((a,e)=>a+(+e.people||0),0);
const noCrewSoon=j=>!j.f.done&&j.i.start&&!j.i.crew.length&&j.i.start<=addDays(TODAY,7);
const thisWeek=j=>workDays(j).some(d=>d>=TODAY&&d<=addDays(TODAY,6));
function norm(id,d){d=d||{};return{id,name:d.name||"",item:d.item||"",addr:d.addr||"",
  m:{date:d.m?.date||"",done:!!d.m?.done},i:{start:d.i?.start||"",end:d.i?.end||"",crew:Array.isArray(d.i?.crew)?d.i.crew:[],sat:!!d.i?.sat,sun:!!d.i?.sun,color:COLORS.includes(d.i?.color)?d.i.color:"orange",
    gate:d.i?.gate||"",door:d.i?.door||"",mgr:Array.isArray(d.i?.mgr)?d.i.mgr:[]},
  f:{done:!!d.f?.done,extra:Array.isArray(d.f?.extra)?d.f.extra:[],as:Array.isArray(d.f?.as)?d.f.as:[]},createdAt:d.created_at||""};}

/* 돈: 계약금액·입금·원가 (관리자만) */
const toNum=v=>+String(v??"").replace(/[^\d]/g,"")||0;
const comma=n=>n?n.toLocaleString("ko-KR"):"";
const won=n=>`${(n<0?"-":"")+Math.abs(n).toLocaleString("ko-KR")}원`;
const man=n=>Math.abs(n)>=10000?`${n<0?"-":""}${Math.round(Math.abs(n)/10000).toLocaleString("ko-KR")}만원`:won(n);
const pct=(a,b)=>b?`${Math.round(a/b*100)}%`:"—";
function normMoney(d){d=d||{};const c=d.contract||{};
  return{contract:{date:c.date||"",amount:toNum(c.amount),vat:!!c.vat},
    pays:(Array.isArray(d.pays)?d.pays:[]).map(p=>({label:p.label||"계약금",amount:toNum(p.amount),due:p.due||"",paid:!!p.paid,paidOn:p.paidOn||""})),
    costs:(Array.isArray(d.costs)?d.costs:[]).map(x=>({cat:x.cat||COST_CATS[0],amount:toNum(x.amount),note:x.note||""}))};}
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
  return overdue(m).length?`<span class="tag late">지연 · 미수 ${man(u)}</span>`:`<span class="tag soon">미수 ${man(u)}</span>`;}

/* 시공자별: 사람 → 날짜 → 그날 들어가는 현장/AS */
function crewMap(from,to){const map={};const add=(n,d,it)=>{(map[n]??={});(map[n][d]??=[]).push(it)};
  jobs.forEach(j=>{workDays(j).forEach(d=>{if(d<from||d>to)return;if(j.i.crew.length)j.i.crew.forEach(c=>add(c,d,{t:"i",j}));else add("",d,{t:"i",j});});
    j.f.as.forEach(a=>{if(a.date&&a.date>=from&&a.date<=to)add(a.crew||"",a.date,{t:"a",j,a});});});
  return map;}
const clashAt=items=>new Set(items.filter(x=>!(x.t==="a"&&x.a.done)).map(x=>x.j.id)).size>=2;
function clashList(from,to){const m=crewMap(from,to),out=[];
  for(const n in m){if(!n)continue;for(const d in m[n])if(clashAt(m[n][d]))out.push({n,d});}return out;}

function measureTag(j){if(!j.m.date)return`<span class="tag wait">날짜 미정</span>`;
  if(j.m.done)return`<span class="tag ok">완료</span>`;
  return j.m.date<TODAY?`<span class="tag late">지남·미완료</span>`:`<span class="tag wait">예정</span>`;}
function crewHtml(j){if(!j.i.start)return`<span class="tag wait">시공일 미정</span>`;
  if(!j.i.crew.length)return`<span class="tag ${noCrewSoon(j)?"late":"soon"}">미배정</span>`;
  return`<span class="tag ok">배정</span><span class="crew">${j.i.crew.map(esc).join(", ")}</span>`;}
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

function render(){
  const active=jobs.filter(j=>!j.f.done);
  const clashes=clashList(TODAY,addDays(TODAY,60));
  let chips=`<span class="chip">진행 중 현장 <b>${active.length}</b></span>
    <span class="chip late">시공자 미배정 (7일 내) <b>${jobs.filter(noCrewSoon).length}</b></span>
    <span class="chip">이번 주 시공 <b>${jobs.filter(j=>!j.f.done&&thisWeek(j)).length}</b></span>
    <span class="chip soon">마감 추가 투입 <b>${jobs.reduce((a,j)=>a+extraSum(j),0)}명</b></span>
    <span class="chip">AS 예정 <b>${jobs.reduce((a,j)=>a+asOpen(j).length,0)}</b></span>`;
  if(clashes.length)chips+=`<button class="chip late" type="button" data-tab="crew">시공자 겹침 <b>${clashes.length}</b></button>`;
  if(isAdmin){const t=payTotals();chips+=`<button class="chip" type="button" data-tab="pay">미수금 <b>${man(t.unpaid)}</b></button>`;
    if(t.lateN)chips+=`<button class="chip late" type="button" data-tab="pay">입금 지연 <b>${t.lateN}</b></button>`;}
  $("summary").innerHTML=chips;
  const key=j=>(noCrewSoon(j)?"0":"1")+(j.f.done?"1":"0")+(j.i.start||j.m.date||"9");
  const sorted=[...jobs].sort((a,b)=>key(a).localeCompare(key(b)));
  const empty=loaded&&!jobs.length;
  $("empty").hidden=!empty;
  $("thead").innerHTML=`<tr><th>현장</th><th>실측일</th><th>시공 기간</th><th>시공자</th><th>마감</th><th>추가 투입</th><th>파일 · 사진</th>${isAdmin?"<th>수금</th>":""}</tr>`;
  $("tbody").innerHTML=sorted.map(j=>`<tr data-j="${esc(j.id)}" tabindex="0">
    <td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></td>
    <td><div class="cell"><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</div></td>
    <td><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></td>
    <td><div class="cell">${crewHtml(j)}</div></td>
    <td><div class="cell">${finishTag(j)}${asTag(j)}</div></td>
    <td>${extraHtml(j)}</td>
    <td>${fileCount(j)}</td>${isAdmin?`<td>${payTag(j)}</td>`:""}</tr>`).join("");
  $("cards").innerHTML=sorted.map(j=>`<button class="card ${noCrewSoon(j)?"flag":""}" data-j="${esc(j.id)}">
    <div class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></div>
    <dl class="kv">
      <dt>실측</dt><dd><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</dd>
      <dt>시공</dt><dd><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></dd>
      <dt>시공자</dt><dd>${crewHtml(j)}</dd>
      <dt>마감</dt><dd>${finishTag(j)}${extraSum(j)?extraHtml(j):""}${asTag(j)}</dd>
      <dt>파일</dt><dd>${fileCount(j)}</dd>${isAdmin?`<dt>수금</dt><dd>${payTag(j)}</dd>`:""}
    </dl></button>`).join("");
  renderCal();renderCrew();
  if(isAdmin){renderPay();renderSales();}
}
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
      if(x.t==="i"){const who=j.i.crew.length?j.i.crew.join("·"):"미배정";return`<div class="ev i ${kc(j)} ${j.i.crew.length?"":"none"}">${short(j)}<span class="evc"> · ${esc(who)}</span></div>`;}
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
      return`<li><i class="dot k ${kc(x.j)}"></i><div><b>${esc(x.j.name)}</b>${place(x.j)}<div class="dmeta">${x.j.i.crew.length?`시공자 ${x.j.i.crew.map(esc).join(", ")}`:`<span class="tag late">시공자 미배정</span>`}<span class="hint">${wd.length>1?`작업 ${wd.length}일 중 ${k}일째`:"하루 작업"}</span></div><button class="btn ghost sm cp-msg" type="button" data-msg="${esc(x.j.id)}">시공자 문자 복사</button></div></li>`})+
    sec("실측",by("m"),x=>`<li><i class="dot" style="background:var(--c-measure)"></i><div><b>${esc(x.j.name)}</b>${place(x.j)}<div class="dmeta">${x.j.m.done?`<span class="tag ok">실측 완료</span>`:`<span class="tag wait">실측 예정</span>`}</div></div></li>`)+
    sec("AS",by("a"),x=>`<li><i class="dot" style="background:var(--c-as)"></i><div><b>${esc(x.j.name)}</b>${place(x.j)}<div class="dmeta">담당 ${esc(x.a.crew||"미정")}${x.a.note?` · ${esc(x.a.note)}`:""}${x.a.done?` <span class="tag ok">완료</span>`:""}</div></div></li>`)+
    sec("마감 추가 투입",by("x"),x=>`<li><i class="dot ring ${kc(x.j)}"></i><div><b>${esc(x.j.name)}</b>${place(x.j)}<div class="dmeta">추가 ${+x.x.people}명${x.x.note?` · ${esc(x.x.note)}`:""}</div></div></li>`)
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

/* 시공자별 일정판 */
const mondayOf=d=>{const w=dow(d);return addDays(d,w===0?-6:1-w);};
let crewStart=mondayOf(TODAY);
const crewSpan=()=>window.matchMedia("(min-width:900px)").matches?14:7;
function renderCrew(){
  const n=crewSpan(),days=[...Array(n)].map((_,k)=>addDays(crewStart,k)),from=days[0],to=days[n-1];
  $("crewTitle").innerHTML=`${fmtW(from)} ~ ${fmtW(to)}`;
  const m=crewMap(from,to);
  const names=[...new Set([...CREW,...jobs.flatMap(j=>j.i.crew),...jobs.flatMap(j=>j.f.as.map(a=>a.crew)).filter(Boolean)])];
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
function renderPay(){
  const t=payTotals();
  $("payTiles").innerHTML=`<div class="tile"><small>받을 돈 (전체)</small><b>${man(t.bill)}</b></div>
    <div class="tile"><small>받은 돈</small><b>${man(t.recv)}</b></div>
    <div class="tile ${t.unpaid?"warn":""}"><small>미수금</small><b>${man(t.unpaid)}</b></div>
    <div class="tile ${t.lateN?"bad":""}"><small>입금 지연</small><b>${t.lateN}건</b>${t.lateN?`<small>${man(t.lateAmt)}</small>`:""}</div>`;
  const withM=jobs.map(j=>({j,m:moneyOf(j.id)})).filter(x=>hasMoney(x.m));
  $("payEmpty").hidden=withM.length>0;
  const todo=withM.flatMap(x=>x.m.pays.filter(p=>!p.paid).map(p=>({...x,p}))).sort((a,b)=>(a.p.due||"9999").localeCompare(b.p.due||"9999"));
  $("payTodo").innerHTML=todo.length?todo.map(x=>`<tr data-j="${esc(x.j.id)}" tabindex="0"><td><span class="d">${fmtW(x.p.due)}</span></td><td class="job"><b>${esc(x.j.name)}</b></td><td>${esc(x.p.label)}</td><td class="num push">${won(x.p.amount)}</td><td>${dueTag(x.p)}</td></tr>`).join("")
    :`<tr><td colspan="5" class="hint">받기로 한 입금 일정이 없어요.</td></tr>`;
  const done=withM.flatMap(x=>x.m.pays.filter(p=>p.paid&&p.paidOn&&p.paidOn>=addDays(TODAY,-30)).map(p=>({...x,p}))).sort((a,b)=>b.p.paidOn.localeCompare(a.p.paidOn));
  $("payDone").innerHTML=done.length?done.map(x=>`<tr data-j="${esc(x.j.id)}" tabindex="0"><td><span class="d">${fmtW(x.p.paidOn)}</span></td><td class="job"><b>${esc(x.j.name)}</b></td><td>${esc(x.p.label)}</td><td class="num push">${won(x.p.amount)}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">최근 30일 동안 들어온 입금이 없어요.</td></tr>`;
  const perJob=withM.filter(x=>billTotal(x.m)>0).sort((a,b)=>unpaidOf(b.m)-unpaidOf(a.m)||a.j.name.localeCompare(b.j.name));
  $("payJobs").innerHTML=perJob.length?perJob.map(({j,m})=>{const u=unpaidOf(m),next=m.pays.filter(p=>!p.paid&&p.due).map(p=>p.due).sort()[0];
    const gap=billTotal(m)-m.pays.reduce((a,p)=>a+p.amount,0);
    return`<tr data-j="${esc(j.id)}" tabindex="0"><td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></td><td class="num" data-l="받을 돈">${won(billTotal(m))}</td><td class="num" data-l="받은 돈">${won(received(m))}</td><td class="num" data-l="미수금">${u?`<b>${won(u)}</b>`:"0원"}</td>
      <td class="full"><div class="cell">${payTag(j)}${next?`<span class="hint">다음 ${fmt(next)}</span>`:""}${gap>0&&u?`<span class="hint">일정 없는 금액 ${man(gap)}</span>`:""}</div></td></tr>`}).join("")
    :`<tr><td colspan="5" class="hint">계약금액을 넣은 현장이 없어요.</td></tr>`;
}

/* 원가 · 매출 (관리자). 기준 달 = 시공 끝나는 달, 시공일 없으면 계약일 */
let salesY=now.getFullYear(),salesM=0;
const jobMonth=j=>(j.i.end||j.i.start||moneyOf(j.id).contract.date||"").slice(0,7);
const bar=(v,max,cls="")=>!v?"":`<span class="bar ${cls}"><i style="width:${max>0?Math.max(0,Math.min(100,v/max*100)):0}%"></i></span>`;
function renderSales(){
  const counted=jobs.filter(j=>{const m=moneyOf(j.id);return m.contract.amount>0||m.costs.length>0;});
  const years=[...new Set([now.getFullYear(),...counted.map(j=>+jobMonth(j).slice(0,4)).filter(Boolean)])].sort((a,b)=>b-a);
  if(!years.includes(salesY))salesY=years[0];
  $("sa-y").innerHTML=years.map(y=>`<option value="${y}" ${y===salesY?"selected":""}>${y}년</option>`).join("");
  $("sa-m").value=String(salesM);
  const inYear=counted.filter(j=>jobMonth(j).startsWith(salesY+"-"));
  const sel=salesM?inYear.filter(j=>jobMonth(j)===`${salesY}-${pad(salesM)}`):inYear;
  const undated=counted.filter(j=>!jobMonth(j)).length;
  const rev=a=>a.reduce((s,j)=>s+moneyOf(j.id).contract.amount,0),cost=a=>a.reduce((s,j)=>s+costSum(moneyOf(j.id)),0);
  const R=rev(sel),C=cost(sel),P=R-C;
  $("saTiles").innerHTML=`<div class="tile"><small>매출 (${sel.length}곳)</small><b>${man(R)}</b></div><div class="tile"><small>원가</small><b>${man(C)}</b></div>
    <div class="tile ${P<0?"bad":""}"><small>이익</small><b>${man(P)}</b></div><div class="tile"><small>이익률</small><b>${pct(P,R)}</b></div>`;
  $("saMonthsBox").hidden=!!salesM;
  if(!salesM){const months=[...Array(12)].map((_,k)=>{const js=inYear.filter(j=>jobMonth(j)===`${salesY}-${pad(k+1)}`);return{k:k+1,n:js.length,r:rev(js),c:cost(js)}});
    const max=Math.max(1,...months.map(x=>Math.max(x.r,x.c)));
    $("saMonths").innerHTML=months.map(x=>`<tr data-month="${x.k}" tabindex="0" class="${x.r||x.c?"":"zero"}"><td class="job"><b>${x.k}월</b>${x.n?`<small class="m-only">${x.n}곳</small>`:""}</td><td class="num d-only">${x.n||""}</td><td class="num" data-l="매출">${x.r?won(x.r):"—"}</td><td class="num" data-l="원가">${x.c?won(x.c):"—"}</td><td class="num ${x.r-x.c<0?"neg":""}" data-l="이익">${x.r||x.c?won(x.r-x.c):"—"}</td><td class="num" data-l="이익률">${x.r?pct(x.r-x.c,x.r):"—"}</td><td class="barcell">${bar(x.r,max)}${bar(x.c,max,"cost")}</td></tr>`).join("");}
  $("saJobs").innerHTML=sel.length?[...sel].sort((a,b)=>jobMonth(a).localeCompare(jobMonth(b))).map(j=>{const m=moneyOf(j.id),r=m.contract.amount,c=costSum(m);
    return`<tr data-j="${esc(j.id)}" tabindex="0"><td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small><small class="m-only">${sub(j)?" · ":""}${+jobMonth(j).slice(5)}월 기준</small></td><td class="d-only"><span class="d">${+jobMonth(j).slice(5)}월</span></td><td class="num" data-l="매출">${won(r)}</td><td class="num" data-l="원가">${won(c)}${!m.costs.length?` <span class="tag wait">미입력</span>`:""}</td><td class="num ${r-c<0?"neg":""}" data-l="이익">${won(r-c)}</td><td class="num" data-l="이익률">${pct(r-c,r)}</td></tr>`}).join("")
    :`<tr><td colspan="6" class="hint">이 기간에 계약금액이나 원가를 넣은 현장이 없어요.</td></tr>`;
  const cats=COST_CATS.map(c=>({c,v:sel.reduce((s,j)=>s+moneyOf(j.id).costs.filter(x=>x.cat===c).reduce((a,x)=>a+x.amount,0),0)})).filter(x=>x.v);
  $("saCosts").innerHTML=cats.length?cats.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${won(x.v)}</td><td class="num">${pct(x.v,C)}</td><td class="barcell">${bar(x.v,C,"cost")}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">원가 기록이 없어요.</td></tr>`;
  $("saNote").textContent=`매출은 계약금액이에요(부가세 별도 계약은 부가세를 뺀 금액). 기준 달은 시공이 끝나는 달이고, 시공일이 없으면 계약일 기준이에요.${undated?` 시공일·계약일이 모두 없는 현장 ${undated}곳은 빠져 있어요.`:""}`;
}
$("sa-y").onchange=e=>{salesY=+e.target.value;renderSales()};
$("sa-m").onchange=e=>{salesM=+e.target.value;renderSales()};
document.addEventListener("click",e=>{const r=e.target.closest("[data-month]");if(r){salesM=+r.dataset.month;renderSales();}});

/* form */
function renderCrewPick(selected){
  $("f-crew").innerHTML=CREW.map((c,n)=>`<label><input type="checkbox" id="f-c${n}" value="${esc(c)}" ${selected.includes(c)?"checked":""}>${esc(c)}</label>`).join("");}
const pickedCrew=()=>[...$("f-crew").querySelectorAll("input:checked")].map(x=>x.value);
const formDays=()=>{const s=$("f-istart").value;return s?workDays({i:{start:s,end:$("f-iend").value||s,sat:$("f-sat").checked,sun:$("f-sun").checked}}):[]};
/* 고른 시공자가 같은 날 다른 현장(시공·AS)에 잡혀 있으면 알려줌. 저장은 막지 않음 */
function checkClash(){
  const mine=formDays(),lines=[];
  pickedCrew().forEach(c=>jobs.forEach(o=>{if(editing&&o.id===editing.id)return;
    const ds=new Set();if(o.i.crew.includes(c))workDays(o).forEach(d=>{if(mine.includes(d))ds.add(d)});
    o.f.as.forEach(a=>{if(!a.done&&a.crew===c&&mine.includes(a.date))ds.add(a.date)});
    if(ds.size)lines.push(`<li><b>${esc(c)}</b> · ${[...ds].sort().map(fmtW).join(", ")} · ${esc(o.name)}</li>`);}));
  $("f-clash").innerHTML=lines.length?`같은 날 다른 현장에도 잡혀 있어요. 그래도 저장은 돼요.<ul>${lines.join("")}</ul>`:"";
  $("f-clash").hidden=!lines.length;}
/* 시공 색: 새 현장은 날짜가 겹치는 다른 현장과 안 겹치는 색을 자동 선택 */
let colorTouched=false;
const getColor=()=>(document.querySelector('input[name="f-color"]:checked')||{}).value||"orange";
function setColor(c){document.querySelectorAll('input[name="f-color"]').forEach(r=>r.checked=r.value===c);}
function autoColor(){if(colorTouched)return;const mine=formDays();if(!mine.length)return;
  const used=jobs.filter(o=>o!==editing&&workDays(o).some(d=>mine.includes(d))).map(o=>o.i.color);
  setColor(COLORS.find(c=>!used.includes(c))||COLORS[used.length%COLORS.length]);}
["f-istart","f-iend","f-sat","f-sun"].forEach(id=>$(id).addEventListener("change",()=>{autoColor();checkClash();}));
$("f-crew").addEventListener("change",checkClash);
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
  div.innerHTML=`<label>구분<select id="p-l${n}">${opt(PAY_LABELS,p.label)}</select></label><label>금액(원)<input class="won" inputmode="numeric" id="p-a${n}" value="${comma(p.amount)}" placeholder="0"></label><label>받을 날<input type="date" class="due" id="p-d${n}" value="${esc(p.due)}"></label><label class="check"><input type="checkbox" class="paid" id="p-x${n}" ${p.paid?"checked":""}>입금됨</label><label>입금일<input type="date" class="paidOn" id="p-o${n}" value="${esc(p.paidOn)}"></label><button class="btn del sm" type="button">삭제</button>`;
  div.querySelector("button").onclick=()=>{div.remove();moneySummary();};
  div.querySelector(".paid").onchange=e=>{if(e.target.checked&&!div.querySelector(".paidOn").value)div.querySelector(".paidOn").value=TODAY;moneySummary();};
  div.querySelector(".paidOn").onchange=e=>{if(e.target.value)div.querySelector(".paid").checked=true;moneySummary();};
  $("mo-pays").appendChild(div);}
function costRow(x={cat:COST_CATS[0],amount:0,note:""}){const n=mSeq++;const div=document.createElement("div");div.className="cost-row";
  div.innerHTML=`<label>항목<select id="c-c${n}">${opt(COST_CATS,x.cat)}</select></label><label>금액(원)<input class="won" inputmode="numeric" id="c-a${n}" value="${comma(x.amount)}" placeholder="0"></label><label class="note">메모<input id="c-n${n}" value="${esc(x.note)}" placeholder="예: 도장 외주, 하드웨어"></label><button class="btn del sm" type="button">삭제</button>`;
  div.querySelector("button").onclick=()=>{div.remove();moneySummary();};$("mo-costs").appendChild(div);}
function readMoney(){
  return normMoney({contract:{date:$("mo-date").value,amount:toNum($("mo-amount").value),vat:$("mo-vat").checked},
    pays:[...$("mo-pays").children].map(r=>({label:r.querySelector("select").value,amount:toNum(r.querySelector(".won").value),due:r.querySelector(".due").value,paid:r.querySelector(".paid").checked,paidOn:r.querySelector(".paidOn").value})).filter(p=>p.amount>0||p.due),
    costs:[...$("mo-costs").children].map(r=>({cat:r.querySelector("select").value,amount:toNum(r.querySelector(".won").value),note:r.querySelector(".note input").value.trim()})).filter(x=>x.amount>0||x.note)});}
function moneySummary(){if(!isAdmin)return;const m=readMoney(),t=billTotal(m),r=received(m),c=costSum(m),p=m.contract.amount-c;
  const sched=m.pays.reduce((a,x)=>a+x.amount,0);
  let h=`<span>받을 돈 <b>${won(t)}</b>${m.contract.vat?` <small>부가세 ${won(t-m.contract.amount)} 포함</small>`:""}</span><span>받은 돈 <b>${won(r)}</b></span><span>미수금 <b>${won(Math.max(0,t-r))}</b></span><span>원가 <b>${won(c)}</b></span><span>이익 <b class="${p<0?"neg":""}">${won(p)}</b> <small>${pct(p,m.contract.amount)}</small></span>`;
  if(t&&sched!==t)h+=`<span class="hint" style="flex-basis:100%">입금 일정 합계가 받을 돈보다 ${won(Math.abs(t-sched))} ${sched<t?"적어요":"많아요"}.</span>`;
  $("mo-sum").innerHTML=h;}
function fillMoney(j){if(!isAdmin)return;const m=j?moneyOf(j.id):normMoney();
  $("mo-date").value=m.contract.date;$("mo-amount").value=comma(m.contract.amount);$("mo-vat").checked=m.contract.vat;
  $("mo-pays").innerHTML="";m.pays.forEach(p=>payRow(p));$("mo-costs").innerHTML="";m.costs.forEach(x=>costRow(x));
  const ex=j?extraSum(j):0;$("mo-extra-hint").textContent=ex?`이 현장 마감 추가 투입: ${ex}명 (${j.f.extra.length}회)`:"";
  moneySummary();}
$("addPay").onclick=()=>{payRow();moneySummary();};
$("addCost").onclick=()=>costRow();
document.addEventListener("input",e=>{const el=e.target;if(el.classList&&el.classList.contains("won")){const n=toNum(el.value);el.value=comma(n);}
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
  const skip=new Set();for(let d=wd[0];d<=wd[wd.length-1];d=addDays(d,1))if(!wd.includes(d))skip.add(WD[dow(d)]);
  return`${dKo(wd[0])} ~ ${dKo(wd[wd.length-1])}`+(skip.size?` (${[..."토일"].filter(x=>skip.has(x)).join("·")} 제외, 작업 ${wd.length}일)`:"");}
const msgText=o=>`[네스트퍼니처 현장 주소]\n\n시공일 : ${o.when}\n현장 주소 : ${o.addr}\n공동현관 비밀번호 : ${o.gate}\n세대현관 비밀번호 : ${o.door}\n현장 담당자 전화번호 : ${o.mgr}`;
const jobMsg=j=>msgText({when:workText(j),addr:j.addr,gate:j.i.gate,door:j.i.door,mgr:j.i.mgr.join(", ")});
const formMsg=()=>msgText({when:workText({i:{start:$("f-istart").value,end:$("f-iend").value||$("f-istart").value,sat:$("f-sat").checked,sun:$("f-sun").checked}}),
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
  const b=e.target.closest("[data-cp],[data-msg],#copyMsg");if(!b)return;
  let t="";
  if(b.id==="copyMsg")t=formMsg();
  else if(b.dataset.msg){const j=jobs.find(x=>x.id===b.dataset.msg);if(j)t=jobMsg(j);}
  else t=b.dataset.cp==="f-mgr"?pickedMgr().join(", "):$(b.dataset.cp).value.trim();
  if(!t){flash(b,"비어 있어요",false);return;}
  flash(b,await copyText(t)?"복사됨":"복사 안 됨",true);});

function openForm(j){editing=j||null;$("formTitle").textContent=j?`${j.name} 수정`:"새 현장 등록";$("delBtn").hidden=!j;$("f-err").hidden=true;$("delConfirm").hidden=true;
  const v=j||norm("",{});
  $("f-name").value=v.name;$("f-item").value=v.item;$("f-addr").value=v.addr;
  $("f-gate").value=v.i.gate;$("f-door").value=v.i.door;$("f-newmgr").value="";renderMgrPick(v.i.mgr);
  $("f-mdate").value=v.m.date;$("f-mdone").checked=v.m.done;$("f-istart").value=v.i.start;$("f-iend").value=v.i.end;$("f-sat").checked=v.i.sat;$("f-sun").checked=v.i.sun;
  setColor(v.i.color||"orange");colorTouched=!!j;
  v.i.crew.forEach(c=>{if(!CREW.includes(c))CREW.push(c)});renderCrewPick(v.i.crew);$("f-newcrew").value="";checkClash();
  $("f-fdone").checked=v.f.done;$("f-extras").innerHTML="";v.f.extra.forEach(extraRow);
  $("f-as").innerHTML="";v.f.as.forEach(asRow);
  $("ph-stage").value=guessStage(v);
  pending=[];renderFiles();renderPhotos();fillMoney(j);updateMsg();
  $("form").hidden=false;$("form").scrollIntoView({behavior:"smooth",block:"start"});$("f-name").focus({preventScroll:true});}
const showErr=m=>{$("f-err").textContent=m;$("f-err").hidden=false};
$("addExtra").onclick=()=>extraRow();
$("addAs").onclick=()=>asRow();
$("addBtn").onclick=()=>openForm(null);
$("cancelBtn").onclick=()=>{$("form").hidden=true};
$("addCrew").onclick=async()=>{const nm=$("f-newcrew").value.trim();if(!nm)return;
  const sel=pickedCrew();if(!CREW.includes(nm))CREW.push(nm);sel.push(nm);renderCrewPick(sel);$("f-newcrew").value="";checkClash();
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
  if(s&&!workDays({i:{start:s,end:e||s,sat,sun}}).length)return showErr("고른 기간이 모두 주말이에요. 토·일 작업을 체크하거나 날짜를 바꿔 주세요.");
  const extra=[...$("f-extras").children].map(r=>{const [d,p,n]=r.querySelectorAll("input");return{date:d.value,people:+p.value||0,note:n.value.trim()}}).filter(x=>x.date&&x.people>0);
  const as=[...$("f-as").children].map(r=>({date:r.querySelector("input[type=date]").value,crew:r.querySelector("select").value,note:r.querySelector(".note input").value.trim(),done:r.querySelector("input[type=checkbox]").checked})).filter(a=>a.date||a.note);
  const data={name,item:$("f-item").value.trim(),addr:$("f-addr").value.trim(),
    m:{date:$("f-mdate").value,done:$("f-mdone").checked},i:{start:s,end:e||s,crew:pickedCrew(),sat,sun,color:getColor(),gate:$("f-gate").value.trim(),door:$("f-door").value.trim(),mgr:pickedMgr()},
    f:{done:$("f-fdone").checked,extra,as},updated_at:new Date().toISOString()};
  const mo=isAdmin?readMoney():null;
  $("saveBtn").disabled=true;$("f-err").hidden=true;
  try{
    const q=editing?sb.from("jobs").update(data).eq("id",editing.id).select():sb.from("jobs").insert(data).select();
    const {data:rows,error}=await q;if(error)throw error;
    const row=rows&&rows[0];
    if(row){jobs=jobs.filter(x=>x.id!==row.id);jobs.push(norm(row.id,row));editing=jobs.find(x=>x.id===row.id);$("formTitle").textContent=`${editing.name} 수정`;$("delBtn").hidden=false;}
    if(row&&mo&&(hasMoney(mo)||money[row.id])){
      const {error:me}=await sb.from("job_money").upsert({job_id:row.id,data:mo,updated_at:new Date().toISOString()});
      if(me){render();showErr("현장은 저장됐는데 수금·원가를 저장하지 못했어요. 저장을 한 번 더 눌러 주세요.");return;}
      money[row.id]=mo;}
    render();
    if(row&&pending.length){
      $("saveBtn").textContent="파일 올리는 중…";
      const queue=pending;pending=[];renderFiles();renderPhotos();
      for(const p of queue)p.kind==="photo"?await uploadPhoto(row.id,p.file,p.stage):await uploadOne(row.id,p.kind,p.file);
      if(!$("f-err").hidden)return;
    }
    $("form").hidden=true;
  }catch(err){showErr("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.")}
  finally{$("saveBtn").disabled=false;$("saveBtn").textContent="저장"}};
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){tab(t.dataset.tab);return;}
  const r=e.target.closest("[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest&&e.target.closest("tr[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}}});
const VIEWS=["board","cal","crew","pay","sales"];
function tab(which){if(!isAdmin&&(which==="pay"||which==="sales"))which="board";curTab=which;
  VIEWS.forEach(v=>{$("tab-"+v).setAttribute("aria-selected",v===which);$("view-"+v).hidden=v!==which;});
  if(which==="crew")renderCrew();
  try{localStorage.setItem("nest-tab",which)}catch(e){}}
VIEWS.forEach(v=>$("tab-"+v).onclick=()=>tab(v));
$("prev").onclick=()=>{calM--;if(calM<0){calM=11;calY--}renderCal()};
$("next").onclick=()=>{calM++;if(calM>11){calM=0;calY++}renderCal()};


/* 도면 · 견적서 파일 */
let userEmail="";
function renderFiles(){
  for(const kind of Object.keys(KINDS)){
    const saved=editing?filesOf(editing.id,kind):[];
    const wait=pending.filter(p=>p.kind===kind);
    let h=saved.map(f=>`<li><button type="button" class="fname" data-fid="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</button><span class="fmeta">${fsize(+f.size||0)} · ${fmt((f.created_at||"").slice(0,10))}</span><button type="button" class="fdel" data-fdel="${esc(f.id)}">삭제</button></li>`).join("");
    h+=wait.map(p=>`<li><span class="fname" style="color:var(--muted)">${esc(p.file.name)}</span><span class="fmeta">${p.busy?"올리는 중…":"저장하면 올라가요"}</span>${p.busy?"":`<button type="button" class="fdel" data-pdel="${pending.indexOf(p)}">빼기</button>`}</li>`).join("");
    if(!h)h=`<li class="none">${kind==="drawing"?"아직 올린 도면이 없어요.":"아직 올린 견적서가 없어요."}</li>`;
    $("fl-"+kind).innerHTML=h;}
}
function safeExt(name){const m=/\.([A-Za-z0-9]{1,8})$/.exec(name||"");return m?m[1].toLowerCase():"bin";}
const rid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
async function uploadOne(jobId,kind,file){
  const tmp={kind,file,busy:true};pending.push(tmp);renderFiles();
  try{
    const path=`${jobId}/${kind}/${rid()}.${safeExt(file.name)}`;
    const {error:ue}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
    if(ue)throw ue;
    const {data,error}=await sb.from("files").insert({job_id:jobId,kind,name:file.name||"이름 없는 파일",path,size:file.size||0,mime:file.type||"",uploaded_by:userEmail}).select();
    if(error){await sb.storage.from(BUCKET).remove([path]);throw error;}
    if(data&&data[0]&&!files.find(f=>f.id===data[0].id))files.push(data[0]);
  }catch(e){showErr(`"${file.name}" 파일을 올리지 못했어요. 인터넷 연결을 확인하고 다시 올려 주세요.`);}
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
$("pushBtn").onclick=openPush;$("pushClose").onclick=closePush;
$("pushSheet").addEventListener("click",e=>{if(e.target===$("pushSheet"))closePush();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("pushSheet").hidden)closePush();});
$("pushOn").onclick=()=>busy("pushOn","켜는 중…",enablePush);
$("pushOff").onclick=()=>busy("pushOff","끄는 중…",disablePush);
$("pushTest").onclick=()=>busy("pushTest","보내는 중…",testPush);
document.querySelectorAll("#pushPrefs [data-pref]").forEach(c=>c.onchange=savePrefs);

/* 알림을 눌러 열었을 때: ?day=날짜 → 달력에서 그날, ?tab=pay → 수금 */
let pendingLink=location.search;
function applyLink(q){
  const p=new URLSearchParams(q.includes("?")?q.slice(q.indexOf("?")):q),day=p.get("day"),t=p.get("tab");
  if(day&&/^\d{4}-\d{2}-\d{2}$/.test(day)){if(!$("pushSheet").hidden)closePush();tab("cal");openDay(day);}
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
  $("who").textContent=userEmail+(isAdmin?" · 관리자":"");
}
async function loadAll(){
  const [{data:j,error:e1},{data:c},{data:fl},mo]=await Promise.all([sb.from("jobs").select("*"),sb.from("crew").select("name").order("created_at"),sb.from("files").select("*").order("created_at"),
    isAdmin?sb.from("job_money").select("*"):Promise.resolve({data:[]})]);
  if(e1){$("status").textContent="현장을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";$("status").hidden=false;return;}
  $("status").hidden=true;
  jobs=(j||[]).map(r=>norm(r.id,r));CREW=(c||[]).map(r=>r.name);files=fl||[];
  if(!mo.error){money={};(mo.data||[]).forEach(r=>{money[r.job_id]=normMoney(r.data)});}
  loaded=true;render();
  if(!$("form").hidden&&editing){renderFiles();renderPhotos();}
  if(pendingLink){const q=pendingLink;pendingLink="";applyLink(q);}
}
let channel=null;
async function startApp(session){
  $("login").hidden=true;$("app").hidden=false;userEmail=session.user.email||"";uid=session.user.id||"";$("who").textContent=userEmail;
  await checkAdmin();
  let t="board";try{t=localStorage.getItem("nest-tab")||"board"}catch(e){}
  tab(VIEWS.includes(t)?t:"board");
  loadAll();
  if(!channel){channel=sb.channel("nest");["jobs","crew","files","job_money"].forEach(tb=>channel.on("postgres_changes",{event:"*",schema:"public",table:tb},loadAll));channel.subscribe();}
}
function showLogin(){$("app").hidden=true;$("pushSheet").hidden=true;$("login").hidden=false;isAdmin=false;money={};if(channel){sb.removeChannel(channel);channel=null;}}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("l-err").hidden=true;$("l-btn").disabled=true;
  const {error}=await sb.auth.signInWithPassword({email:$("l-email").value.trim(),password:$("l-pw").value});
  $("l-btn").disabled=false;
  if(error){$("l-err").textContent="이메일이나 비밀번호가 맞지 않아요.";$("l-err").hidden=false;}});
$("logoutBtn").onclick=async()=>{$("logoutBtn").disabled=true;await forgetPush();$("logoutBtn").disabled=false;sb.auth.signOut();};
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!$("app").hidden)loadAll();});

(function boot(){
  const cfg=window.NEST_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){$("setup").hidden=false;return;}
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  sb.auth.getSession().then(({data})=>data.session?startApp(data.session):showLogin());
  sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_IN"&&session)startApp(session);if(ev==="SIGNED_OUT")showLogin();});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
