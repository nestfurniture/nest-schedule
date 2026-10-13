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
    gate:d.i?.gate||"",door:d.i?.door||"",mgr:Array.isArray(d.i?.mgr)?d.i.mgr:[],
    apps:(Array.isArray(d.i?.apps)?d.i.apps:[]).filter(a=>a&&a.id).map(a=>({id:String(a.id),type:a.type||"",model:a.model||"",spec:a.spec||"",...(typeof a.join==="boolean"?{join:a.join}:{})})),
    chk:Array.isArray(d.i?.chk)?d.i.chk.map(String).filter(Boolean):[]},
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
  const clBad=jobs.filter(j=>clNeeds(j)==="bad").length,clLate=jobs.filter(j=>clNeeds(j)==="late").length;
  if(clBad)chips+=`<span class="chip late">체크리스트 문제 <b>${clBad}</b></span>`;
  if(clLate)chips+=`<span class="chip soon">체크리스트 미제출 <b>${clLate}</b></span>`;
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
    <td><div class="cell">${finishTag(j)}${asTag(j)}${clTag(j)}</div></td>
    <td>${extraHtml(j)}</td>
    <td>${fileCount(j)}</td>${isAdmin?`<td>${payTag(j)}</td>`:""}</tr>`).join("");
  $("cards").innerHTML=sorted.map(j=>`<button class="card ${noCrewSoon(j)?"flag":""}" data-j="${esc(j.id)}">
    <div class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></div>
    <dl class="kv">
      <dt>실측</dt><dd><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</dd>
      <dt>시공</dt><dd><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></dd>
      <dt>시공자</dt><dd>${crewHtml(j)}</dd>
      <dt>마감</dt><dd>${finishTag(j)}${extraSum(j)?extraHtml(j):""}${asTag(j)}${clTag(j)}</dd>
      <dt>파일</dt><dd>${fileCount(j)}</dd>${isAdmin?`<dt>수금</dt><dd>${payTag(j)}</dd>`:""}
    </dl></button>`).join("");
  renderCal();renderCrew();
  if(isAdmin){renderPay();renderSales();renderWage();}
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
      return`<li><i class="dot k ${kc(x.j)}"></i><div><b>${esc(x.j.name)}</b>${place(x.j)}<div class="dmeta">${x.j.i.crew.length?`시공자 ${x.j.i.crew.map(esc).join(", ")}`:`<span class="tag late">시공자 미배정</span>`}<span class="hint">${wd.length>1?`작업 ${wd.length}일 중 ${k}일째`:"하루 작업"}</span></div><button class="btn ghost sm cp-msg" type="button" data-msg="${esc(x.j.id)}">시공자 문자 복사</button>${clOf(x.j.id)?` <button class="btn ghost sm cp-msg" type="button" data-clmsg="${esc(x.j.id)}">체크리스트 문자 복사</button>`:""}</div></li>`})+
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
  jobs.forEach(j=>{const crew=[...new Set(j.i.crew.filter(Boolean))];workDays(j).forEach(d=>{if(d>=from&&d<=to)crew.forEach(c=>at(c,d).i.push(j));});
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
  const none=jobs.filter(j=>!j.i.crew.length).map(j=>({j,n:workDays(j).filter(d=>d>=from&&d<=to).length})).filter(o=>o.n);
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
  $("wgNote").innerHTML=W.none.length?`<span class="tag late">시공자 미배정</span> ${W.none.map(o=>`${esc(o.j.name)} ${o.n}일`).join(", ")}은 시공자가 정해지지 않아 정산에 안 들어가요.`:"";
  const roster=[...new Set([...CREW,...jobs.flatMap(j=>j.i.crew),...jobs.flatMap(j=>j.f.as.map(a=>a.crew)),...Object.keys(wage.rates.day)].filter(Boolean))];
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

/* 원가 · 매출 (관리자). 기준 달 = 시공 끝나는 달, 시공일 없으면 계약일 */
let salesY=now.getFullYear(),salesM=0;
const jobMonth=j=>(j.i.end||j.i.start||moneyOf(j.id).contract.date||"").slice(0,7);
const bar=(v,max,cls="")=>!v?"":`<span class="bar ${cls}"><i style="width:${max>0?Math.max(0,Math.min(100,v/max*100)):0}%"></i></span>`;
function renderSales(){
  const counted=jobs.filter(j=>moneyOf(j.id).contract.amount>0||jobCosts(j).length>0);
  const years=[...new Set([now.getFullYear(),...counted.map(j=>+jobMonth(j).slice(0,4)).filter(Boolean)])].sort((a,b)=>b-a);
  if(!years.includes(salesY))salesY=years[0];
  $("sa-y").innerHTML=years.map(y=>`<option value="${y}" ${y===salesY?"selected":""}>${y}년</option>`).join("");
  $("sa-m").value=String(salesM);
  const inYear=counted.filter(j=>jobMonth(j).startsWith(salesY+"-"));
  const sel=salesM?inYear.filter(j=>jobMonth(j)===`${salesY}-${pad(salesM)}`):inYear;
  const undated=counted.filter(j=>!jobMonth(j)).length;
  const rev=a=>a.reduce((s,j)=>s+moneyOf(j.id).contract.amount,0),cost=a=>a.reduce((s,j)=>s+jobCost(j),0);
  const R=rev(sel),C=cost(sel),P=R-C;
  $("saTiles").innerHTML=`<div class="tile"><small>매출 (${sel.length}곳)</small><b>${man(R)}</b></div><div class="tile"><small>원가</small><b>${man(C)}</b></div>
    <div class="tile ${P<0?"bad":""}"><small>이익</small><b>${man(P)}</b></div><div class="tile"><small>이익률</small><b>${pct(P,R)}</b></div>`;
  $("saMonthsBox").hidden=!!salesM;
  if(!salesM){const months=[...Array(12)].map((_,k)=>{const js=inYear.filter(j=>jobMonth(j)===`${salesY}-${pad(k+1)}`);return{k:k+1,n:js.length,r:rev(js),c:cost(js)}});
    const max=Math.max(1,...months.map(x=>Math.max(x.r,x.c)));
    $("saMonths").innerHTML=months.map(x=>`<tr data-month="${x.k}" tabindex="0" class="${x.r||x.c?"":"zero"}"><td class="job"><b>${x.k}월</b>${x.n?`<small class="m-only">${x.n}곳</small>`:""}</td><td class="num d-only">${x.n||""}</td><td class="num" data-l="매출">${x.r?won(x.r):"—"}</td><td class="num" data-l="원가">${x.c?won(x.c):"—"}</td><td class="num ${x.r-x.c<0?"neg":""}" data-l="이익">${x.r||x.c?won(x.r-x.c):"—"}</td><td class="num" data-l="이익률">${x.r?pct(x.r-x.c,x.r):"—"}</td><td class="barcell">${bar(x.r,max)}${bar(x.c,max,"cost")}</td></tr>`).join("");}
  $("saJobs").innerHTML=sel.length?[...sel].sort((a,b)=>jobMonth(a).localeCompare(jobMonth(b))).map(j=>{const m=moneyOf(j.id),r=m.contract.amount,c=jobCost(j),auto=autoCosts(j,m).length;
    return`<tr data-j="${esc(j.id)}" tabindex="0"><td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small><small class="m-only">${sub(j)?" · ":""}${+jobMonth(j).slice(5)}월 기준</small></td><td class="d-only"><span class="d">${+jobMonth(j).slice(5)}월</span></td><td class="num" data-l="매출">${won(r)}</td><td class="num" data-l="원가">${won(c)}${!m.costs.length&&!auto?` <span class="tag wait">미입력</span>`:auto?` <span class="tag wait" title="시공 인건비를 일정 × 일당으로 자동 계산">인건비 자동</span>`:""}</td><td class="num ${r-c<0?"neg":""}" data-l="이익">${won(r-c)}</td><td class="num" data-l="이익률">${pct(r-c,r)}</td></tr>`}).join("")
    :`<tr><td colspan="6" class="hint">이 기간에 계약금액이나 원가를 넣은 현장이 없어요.</td></tr>`;
  const cats=COST_CATS.map(c=>({c,v:sel.reduce((s,j)=>s+jobCosts(j).filter(x=>x.cat===c).reduce((a,x)=>a+x.amount,0),0)})).filter(x=>x.v);
  $("saCosts").innerHTML=cats.length?cats.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${won(x.v)}</td><td class="num">${pct(x.v,C)}</td><td class="barcell">${bar(x.v,C,"cost")}</td></tr>`).join("")
    :`<tr><td colspan="4" class="hint">원가 기록이 없어요.</td></tr>`;
  $("saNote").textContent=`매출은 계약금액이에요(부가세 별도 계약은 부가세를 뺀 금액). 기준 달은 시공이 끝나는 달이고, 시공일이 없으면 계약일 기준이에요.${pay08&&Object.keys(wage.rates.day).length?" 시공 인건비를 직접 적지 않은 현장은 정산 탭의 일당 × 시공일로 자동 계산해요.":""}${undated?` 시공일·계약일이 모두 없는 현장 ${undated}곳은 빠져 있어요.`:""}`;
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
function moneySummary(){if(!isAdmin)return;const m=readMoney(),auto=autoCosts(editing,m),t=billTotal(m),r=received(m),c=costSum(m)+auto.reduce((a,x)=>a+x.amount,0),p=m.contract.amount-c;
  moneyHint(m,auto);
  const sched=m.pays.reduce((a,x)=>a+x.amount,0);
  let h=`<span>받을 돈 <b>${won(t)}</b>${m.contract.vat?` <small>부가세 ${won(t-m.contract.amount)} 포함</small>`:""}</span><span>받은 돈 <b>${won(r)}</b></span><span>미수금 <b>${won(Math.max(0,t-r))}</b></span><span>원가 <b>${won(c)}</b></span><span>이익 <b class="${p<0?"neg":""}">${won(p)}</b> <small>${pct(p,m.contract.amount)}</small></span>`;
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
    auto.forEach(x=>out.push(`${x.cat} ${won(x.amount)} 자동 반영 (정산 탭 일당 기준)`));
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
  const b=e.target.closest("[data-cp],[data-msg],[data-clmsg],#copyMsg");if(!b)return;
  let t="";
  if(b.id==="copyMsg")t=formMsg();
  else if(b.dataset.clmsg){const j=jobs.find(x=>x.id===b.dataset.clmsg),c=clOf(b.dataset.clmsg);if(j&&c)t=clMsg(j,c);}
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
  $("f-apps").innerHTML="";v.i.apps.forEach(appRow);$("f-chk").value=v.i.chk.join("\n");
  pending=[];renderFiles();renderPhotos();renderCl();fillMoney(j);updateMsg();
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
    m:{date:$("f-mdate").value,done:$("f-mdone").checked},i:{start:s,end:e||s,crew:pickedCrew(),sat,sun,color:getColor(),gate:$("f-gate").value.trim(),door:$("f-door").value.trim(),mgr:pickedMgr(),
      apps:readApps(),chk:$("f-chk").value.split("\n").map(x=>x.trim()).filter(Boolean)},
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
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab]");if(t){tab(t.dataset.tab);return;}
  const r=e.target.closest("[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest&&e.target.closest("tr[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}}});
const VIEWS=["board","cal","crew","pay","sales","wage"];
function tab(which){if(!isAdmin&&["pay","sales","wage"].includes(which))which="board";curTab=which;
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
    {name:"현장",cols:[["현장",18,"s"],["품목",14,"s"],["주소",30,"s"],["실측일",12,"d"],["실측 완료",9,"s"],["시공 시작",12,"d"],["시공 끝",12,"d"],["작업일",7,"n"],["시공자",16,"s"],["주말 작업",10,"s"],["공동현관 비밀번호",16,"s"],["세대현관 비밀번호",16,"s"],["현장 담당자",22,"s"],["마감 완료",9,"s"],["추가 투입",9,"n"],["AS",6,"n"],["사진·파일",9,"n"]],
      rows:list.map(j=>[j.name,j.item,j.addr,j.m.date,OX(j.m.done),j.i.start,j.i.end,j.i.start?workDays(j).length:"",j.i.crew.join(", "),[j.i.sat&&"토",j.i.sun&&"일"].filter(Boolean).join("·"),j.i.gate,j.i.door,j.i.mgr.join(", "),OX(j.f.done),j.f.extra.reduce((a,x)=>a+(+x.people||0),0)||"",j.f.as.length||"",files.filter(f=>f.job_id===j.id).length||""])},
    {name:"마감 추가 투입",cols:[["현장",18,"s"],["날짜",12,"d"],["인원",7,"n"],["메모",36,"s"]],
      rows:list.flatMap(j=>j.f.extra.map(x=>[j.name,x.date||"",+x.people||"",x.note||""]))},
    {name:"AS",cols:[["현장",18,"s"],["날짜",12,"d"],["담당",12,"s"],["내용",40,"s"],["완료",7,"s"]],
      rows:list.flatMap(j=>j.f.as.map(a=>[j.name,a.date||"",a.crew||"",a.note||"",OX(a.done)]))}];
  if(isAdmin){
    sheets.push({name:"수금",cols:[["현장",18,"s"],["계약일",12,"d"],["계약금액",14,"w"],["VAT 별도",9,"s"],["청구 합계",14,"w"],["받은 돈",14,"w"],["미수금",14,"w"]],
      rows:list.filter(j=>hasMoney(moneyOf(j.id))).map(j=>{const m=moneyOf(j.id);return[j.name,m.contract.date,m.contract.amount,OX(m.contract.vat),billTotal(m),received(m),unpaidOf(m)];})});
    sheets.push({name:"입금 내역",cols:[["현장",18,"s"],["구분",9,"s"],["금액",14,"w"],["받을 날",12,"d"],["입금",7,"s"],["입금일",12,"d"]],
      rows:list.flatMap(j=>moneyOf(j.id).pays.map(p=>[j.name,p.label,p.amount,p.due,OX(p.paid),p.paidOn]))});
    sheets.push({name:"원가",cols:[["현장",18,"s"],["항목",16,"s"],["금액",14,"w"],["메모",36,"s"]],
      rows:list.flatMap(j=>jobCosts(j).map(x=>[j.name,x.cat,x.amount,x.note]))});
    if(pay08)sheets.push(...wageSheets());}
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
  jobs.forEach(j=>{if(j.i.crew.length)workDays(j).forEach(d=>ks.add(d.slice(0,7)));j.f.as.forEach(a=>{if(a.crew&&a.date)ks.add(a.date.slice(0,7))});j.f.extra.forEach(x=>{if(x.date)ks.add(x.date.slice(0,7))});});
  const rows=[];[...ks].filter(k=>/^\d{4}-\d{2}$/.test(k)&&k>=lo&&k<=hi).sort().forEach(k=>{const W=wageMonth(+k.slice(0,4),+k.slice(5)),x=W.extra;
    W.people.forEach(p=>rows.push([k,p.n,p.days||"",p.as||"",p.rate||"",p.adj||"",p.note,shownPay(p)??"",p.paid]));
    if(x.people||x.paid)rows.push([k,"마감 추가 투입 (인원)",x.people||"","",x.rate||"","","",(x.paid&&x.snap?+x.snap.total||0:x.total)??"",x.paid]);});
  if(rows.length)out.push({name:"시공자 정산",cols:[["월",9,"s"],["시공자",16,"s"],["시공일",8,"n"],["AS",6,"n"],["일당",12,"w"],["조정",12,"w"],["메모",24,"s"],["합계",14,"w"],["지급일",12,"d"]],rows});
  return out;}
const XLS_KEY="nest-backup-day";
function renderBackup(){let last="";try{last=localStorage.getItem(XLS_KEY)||""}catch(e){}
  const what=isAdmin?"현장·AS·수금·원가·정산":"현장·일정·AS";
  const old=!last||(new Date(TODAY)-new Date(last))/864e5>30;
  $("xlsNote").innerHTML=`${what} 기록을 엑셀 파일 하나로 받아 보관해요.`+(last?` 이 기기에서 마지막으로 받은 날: ${+last.slice(5,7)}월 ${+last.slice(8)}일`:"")+(jobs.length&&old?` <span class="tag soon">${last?"한 달 넘게 안 받았어요":"아직 한 번도 안 받았어요"}</span>`:"");}
function downloadBackup(){
  if(!loaded)return;
  const blob=xlsxBlob(backupSheets()),fname=`NEST_backup_${TODAY}.xlsx`;
  const done=()=>{try{localStorage.setItem(XLS_KEY,TODAY)}catch(e){}renderBackup();const b=$("xlsBtn"),t=b.textContent;b.textContent="받았어요";setTimeout(()=>b.textContent=t,1600);};
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
  $("who").textContent=userEmail+(isAdmin?" · 관리자":"");
}
async function loadAll(){
  const [{data:j,error:e1},{data:c},{data:fl},mo,ck]=await Promise.all([sb.from("jobs").select("*"),sb.from("crew").select("name").order("created_at"),sb.from("files").select("*").order("created_at"),
    isAdmin?sb.from("job_money").select("*"):Promise.resolve({data:[]}),sb.from("checklists").select("*"),loadLib(),loadWage()]);
  if(e1){$("status").textContent="현장을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";$("status").hidden=false;return;}
  $("status").hidden=true;
  jobs=(j||[]).map(r=>norm(r.id,r));CREW=(c||[]).map(r=>r.name);files=fl||[];laborCache=null;
  if(!mo.error){money={};(mo.data||[]).forEach(r=>{money[r.job_id]=normMoney(r.data)});}
  cl04=!(ck.error&&/checklists|42P01|PGRST20/i.test(`${ck.error.code} ${ck.error.message}`));
  if(!ck.error){checks={};(ck.data||[]).forEach(r=>{checks[r.job_id]=r});}
  loaded=true;render();renderBackup();specStatus();
  if(!$("form").hidden&&editing){renderFiles();renderPhotos();renderCl();}
  if(pendingLink){const q=pendingLink;pendingLink="";applyLink(q);}
}
let channel=null;
async function startApp(session){
  $("login").hidden=true;$("app").hidden=false;userEmail=session.user.email||"";uid=session.user.id||"";$("who").textContent=userEmail;
  await checkAdmin();
  let t="board";try{t=localStorage.getItem("nest-tab")||"board"}catch(e){}
  tab(VIEWS.includes(t)?t:"board");
  loadAll();
  if(!channel){channel=sb.channel("nest");["jobs","crew","files","job_money","checklists"].forEach(tb=>channel.on("postgres_changes",{event:"*",schema:"public",table:tb},loadAll));channel.subscribe();}
}
function showLogin(){$("app").hidden=true;$("pushSheet").hidden=true;$("login").hidden=false;isAdmin=false;money={};wage={rates:normRates(),months:{}};pay08=true;laborCache=null;if(wageChan){sb.removeChannel(wageChan);wageChan=null;}if(channel){sb.removeChannel(channel);channel=null;}if(specChan){sb.removeChannel(specChan);specChan=null;}clearTimeout(specPoll);specLib={};specAuto=null;specAt=0;specAutoRan=false;mediaRan=false;}
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
