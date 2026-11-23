/* AS 관리 — 현장 › AS (업데이트 14)
   AS 건: jobs.f.asc [{id, at 접수일, src 받은 곳, sym 증상, note 메모, parts{what 무엇, eta 도착 예정, got 도착한 날}, done 끝난 날, in 접수함 id, by 등록한 사람}]
   방문: jobs.f.as [{date, crew, note(=증상), done, cid}] — 예전 AS처럼 달력·시공자별·시공자 정산·알림·시공자 화면에 그대로 나옴. cid 로 AS 건과 이어짐.
         cid 없는 예전 AS 방문도 현장 보기에 그대로 보여 줌.
   접수함: as_inbox (업데이트 14). 사장님 갤럭시의 MacroDroid → 서버(notify as_in)가 카톡 AS 요청과 고객 통화를 넣음.
         여기서 'AS로 등록'(AS 건 만들기·기존 건에 붙이기) 또는 'AS 아님'. 업데이트 14 전에도 AS 건 등록·관리는 됨.
   app.js보다 먼저 읽고, 단추는 app.js가 asInit()으로 연결 */
let asInbox=[],asDone=[],as14=true,asChan=null,asKvData={ignore:{},ping:{}},asF="open",asRT=null,asEd=null,asFromEl=null,
  asKey="",asKeyErr="",asSetupOpen=false,asSetupMsg="",asInBusy="";
const AS_SRC={kakao:"카톡",call:"전화",sms:"문자",site:"현장에서",etc:"기타"};
const asStr=(v,n)=>typeof v==="string"?v.slice(0,n):"";
function normCase(c){const p=c.parts&&typeof c.parts==="object"?c.parts:{},d=v=>isDate(v)?v:"";
  return{id:String(c.id),at:d(c.at),src:AS_SRC[c.src]?c.src:"",sym:asStr(c.sym,200),note:asStr(c.note,4000),
    parts:{what:asStr(p.what,100),eta:d(p.eta),got:d(p.got)},done:d(c.done),in:asStr(c.in,64),by:asStr(c.by,40)};}
const asId=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const asVis=(j,c)=>j.f.as.filter(a=>a&&a.cid===c.id);
const asWaitP=c=>!!((c.parts.what||c.parts.eta)&&!c.parts.got);
/* 상태: 끝남 · 방문 예정(가장 빠른 안 간 방문) · 부품 기다림 · 다녀옴(방문은 다 했는데 끝남 체크 전) · 방문일 미정 */
function asSt(j,c){const vs=asVis(j,c);
  if(c.done)return{k:"done",l:"끝남",t:"ok"};
  const nx=vs.filter(a=>!a.done&&a.date).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(nx)return{k:"visit",l:nx.date<TODAY?"방문일 지남":nx.date===TODAY?"오늘 방문":"방문 예정",t:nx.date<TODAY?"late":"soon",d:nx.date,v:nx};
  if(asWaitP(c)){const late=c.parts.eta&&c.parts.eta<TODAY;return{k:"parts",l:late?"부품 예정일 지남":"부품 기다림",t:late?"late":"wait"};}
  if(vs.length&&vs.every(a=>a.done))return{k:"check",l:"다녀옴 · 끝났는지 확인",t:"soon"};
  return{k:"new",l:"방문일 미정",t:"late"};}
const asAll=()=>jobs.flatMap(j=>j.f.asc.map(c=>({j,c,s:asSt(j,c)})));
const asDay=iso=>{const d=new Date(iso);return isNaN(d)?TODAY:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
function asWhen(iso){const d=new Date(iso);if(isNaN(d))return"";const ds=asDay(iso),hm=`${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return ds===TODAY?`오늘 ${hm}`:ds===addDays(TODAY,-1)?`어제 ${hm}`:`${fmt(ds)} ${hm}`;}
const asAgo=iso=>{const m=Math.round((Date.now()-new Date(iso))/6e4);return!(m>=0)?"":m<1?"방금":m<60?`${m}분 전`:m<1440?`${Math.round(m/60)}시간 전`:`${Math.round(m/1440)}일 전`;};
const asLive=()=>{const p=asKvData.ping||{};return[p.kakao,p.call].some(t=>t&&Date.now()-new Date(t)<3*864e5);};
const asLines=b=>String(b||"").split("\n").map(x=>x.trim()).filter(Boolean);
const asJobOf=r=>r&&r.job_id?jobs.find(x=>x.id===r.job_id):null;
const asWho=r=>{const j=asJobOf(r);return r.src==="call"&&j?j.name:r.who||"이름 없음";};
const asCut=(s,n)=>{s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s;};

/* ---------- 불러오기 ---------- */
async function loadAs(){if(!sb){asInbox=[];asDone=[];return;}
  const [a,b,kv]=await Promise.all([sb.from("as_inbox").select("*").eq("status","new").order("created_at",{ascending:false}).limit(300),
    sb.from("as_inbox").select("*").neq("status","new").order("updated_at",{ascending:false}).limit(30),sb.from("as_kv").select("*")]);
  as14=!(a.error&&/as_inbox|42P01|PGRST20/i.test(`${a.error.code} ${a.error.message}`));
  if(!a.error)asInbox=a.data||[];if(!b.error)asDone=b.data||[];
  if(!kv.error){const g=k=>{const d=((kv.data||[]).find(r=>r.key===k)||{}).data;return d&&typeof d==="object"?d:{};};asKvData={ignore:g("ignore"),ping:g("ping")};}
  if(as14&&!a.error&&!asChan)asChan=sb.channel("nest-as").on("postgres_changes",{event:"*",schema:"public",table:"as_inbox"},asReload)
    .on("postgres_changes",{event:"*",schema:"public",table:"as_kv"},asReload).subscribe();}
function asReload(){clearTimeout(asRT);asRT=setTimeout(()=>loadAs().then(()=>{renderAs();renderHome();if(asEd&&asEd.inId)asFromRender();}),400);}
function asReset(){asInbox=[];asDone=[];as14=true;asKvData={ignore:{},ping:{}};asKey="";asKeyErr="";asSetupMsg="";asEd=null;$("asSheet").hidden=true;
  if(asChan){sb.removeChannel(asChan);asChan=null;}}

/* ---------- 현장 › AS 화면 ---------- */
function renderAs(){if(!loaded)return;
  $("asUpdate").hidden=as14;
  // 설정 칸은 입력하는 중이면 다시 그리지 않음 (서버가 받을 때마다 마지막 시각이 바뀌어 다시 그려짐)
  if(!(document.activeElement&&$("asSetup").contains(document.activeElement)))$("asSetup").innerHTML=isAdmin&&as14?asSetupHtml():"";
  const inb=asInbox;
  $("asInbox").innerHTML=as14?`<div class="as-h"><h3>접수함</h3>${inb.length?`<span class="n">확인 안 한 것 ${inb.length}건</span>`:""}</div>
    <ul class="bk-list as-inl">${inb.length?inb.map(asInRow).join(""):`<li class="none">새로 들어온 AS가 없어요.${asLive()?"":" 갤럭시 자동 접수를 켜면 고객 카톡·통화가 여기로 들어와요."}</li>`}</ul>
    ${asDone.length?`<details class="bk-rules as-old"><summary>처리한 접수 ${asDone.length}건</summary><ul class="bk-list">${asDone.map(asInRow).join("")}</ul></details>`:""}`:"";
  const all=asAll(),cnt=k=>all.filter(x=>k==="open"?x.s.k!=="done":x.s.k===k).length;
  const cats=[["open","할 일"],["new","방문일 미정"],["visit","방문 예정"],["parts","부품 기다림"],["check","다녀옴"],["done","끝난 AS"]];
  $("asChips").innerHTML=cats.filter(([k])=>k==="open"||k==="done"||cnt(k)).map(([k,l])=>`<button type="button" class="chip${asF===k?" on":""}${k==="new"&&cnt(k)?" late":""}" data-asf="${k}">${l} <b>${cnt(k)}</b></button>`).join("");
  const order={new:0,parts:1,visit:2,check:3,done:4};
  let list=all.filter(x=>asF==="open"?x.s.k!=="done":x.s.k===asF);
  if(asF==="done")list=list.sort((a,b)=>(b.c.done||"").localeCompare(a.c.done||"")).slice(0,100);
  else list.sort((a,b)=>order[a.s.k]-order[b.s.k]||(a.s.k==="visit"?a.s.d.localeCompare(b.s.d):(a.c.at||"").localeCompare(b.c.at||"")));
  $("asList").innerHTML=list.length?list.map(asCaseRow).join(""):`<li class="none">${asF==="open"?"진행 중인 AS가 없어요.":"해당하는 AS가 없어요."}</li>`;}
function asCaseRow({j,c,s}){const vs=asVis(j,c),age=c.at?dayDiff(c.at,TODAY):0;
  const meta=[c.at?`${fmt(c.at)} 접수${s.k!=="done"&&age>0?` · ${age}일째`:""}`:"",c.src&&AS_SRC[c.src],
    s.v?`${fmtW(s.v.date)} 방문${s.v.crew?` ${esc(s.v.crew)}`:""}`:"",
    c.parts.what||c.parts.eta?`부품${c.parts.what?` ${esc(c.parts.what)}`:""}${c.parts.got?` · ${fmt(c.parts.got)} 도착`:c.parts.eta?` · ${fmt(c.parts.eta)} 도착 예정`:""}`:"",
    vs.length&&!s.v?`방문 ${vs.length}번`:"",c.done?`${fmt(c.done)} 끝남`:""].filter(Boolean);
  return`<li class="bk-row as-case ${s.k}" data-asopen="${esc(j.id)}|${esc(c.id)}" role="button" tabindex="0"><div class="bk-top"><b class="as-sym">${esc(c.sym||"증상 미입력")}</b><span class="tag ${s.t}">${s.l}</span></div>
    <div class="as-meta"><button type="button" class="linkish" data-j="${esc(j.id)}">${esc(j.name)}</button>${meta.map(x=>`<span>${x}</span>`).join("")}</div></li>`;}
function asInRow(r){const j=asJobOf(r),call=r.src==="call",ls=asLines(r.body);
  let h=`<li class="bk-row as-in ${esc(r.status)}"><div class="bk-top"><span class="tag ${call?"wait":"soon"}">${call?"통화":"카톡"}</span><b class="as-who">${esc(asWho(r))}</b>${call&&r.tel?`<span class="d">${esc(fmtTel(r.tel))}</span>`:""}<span class="d as-at">${asWhen(r.created_at)}</span></div>`;
  if(call)h+=`<div class="bk-who">${esc(ls.join(" · "))}</div>`;
  else h+=`<div class="bk-who">${esc(r.sum||ls[ls.length-1]||"")}</div>${ls.length?`<details class="as-raw"><summary>받은 카톡 ${ls.length}줄</summary><p>${ls.map(esc).join("<br>")}</p></details>`:""}`;
  if(r.status==="new"){const busy=asInBusy===r.id?" disabled":"";
    h+=`<div class="as-injob">${j?`현장 <button type="button" class="linkish" data-j="${esc(j.id)}">${esc(j.name)}</button>`:`<span class="hint">현장을 못 찾았어요. 등록할 때 골라 주세요.</span>`}</div>
      <div class="as-inbtns"><button type="button" class="btn sm" data-inreg="${esc(r.id)}"${busy}>AS로 등록</button><button type="button" class="btn ghost sm" data-inskip="${esc(r.id)}"${busy}>AS 아님</button>
      ${call?"":`<button type="button" class="linkish as-ign" data-inign="${esc(r.id)}"${busy}>'${esc(asCut(r.who,12))}' 카톡은 앞으로 안 받기</button>`}</div>`;}
  else{const c=r.status==="done"&&j&&j.f.asc.find(x=>x.id===r.case_id);
    h+=`<div class="bk-done"><span>${r.status==="done"?`AS로 등록함${c?` · <button type="button" class="linkish" data-asopen="${esc(j.id)}|${esc(c.id)}">${esc(asCut(c.sym,24))}</button>`:""}`:"AS 아님"}${r.done_by?` <span class="hint">· ${esc(r.done_by)}</span>`:""}</span>
      ${r.status==="skip"?`<button type="button" class="btn ghost sm" data-inundo="${esc(r.id)}">되돌리기</button>`:""}</div>`;}
  return h+"</li>";}
/* 관리자: 갤럭시 자동 접수 상태 · MacroDroid에 넣을 주소 · 빼고 볼 카톡 이름 */
function asSetupHtml(){const p=asKvData.ping||{},live=asLive(),used=p.day===TODAY?+p.ai||0:0,cfg=window.NEST_CONFIG||{};
  const url=k=>`${cfg.SUPABASE_URL}/functions/v1/notify?action=as_in&kind=${k}&key=${asKey}`;
  const copy=(l,v)=>`<label class="as-copy">${l}<span><input readonly value="${esc(v)}"><button type="button" class="btn ghost sm" data-ascopy>복사</button></span></label>`;
  const seen=[p.kakao&&`카톡 ${asAgo(p.kakao)}`,p.call&&`통화 ${asAgo(p.call)}`].filter(Boolean).join(" · ");
  return`<details class="bk-conn as-setup${live?"":" bad"}"${asSetupOpen?" open":""}><summary><b>갤럭시 자동 접수</b><span class="tag ${live?"ok":"wait"}">${live?"켜짐":"연결 전"}</span>
    <span class="hint">${seen?`마지막으로 받은 것: ${seen}`:"아직 휴대폰에서 받은 게 없어요"}</span><span class="bk-more">설정</span></summary>
    <p class="hint">사장님 갤럭시의 MacroDroid 앱이 카톡 알림과 통화 끝을 서버로 보내면, 서버가 고객의 AS 요청만 골라 접수함에 넣고 휴대폰 알림을 보내요. AS가 아닌 카톡은 저장하지 않아요. 설정 순서는 <a href="https://github.com/nestfurniture/nest-schedule#업데이트-14-as-자동-접수-적용" target="_blank" rel="noopener">README 업데이트 14</a>에 있어요.</p>
    ${asKey?`<div class="as-keys">${copy("카톡 알림 받을 때 주소",url("kakao"))}${copy("통화 끝날 때 주소",url("call"))}${copy("헤더 Authorization 값",`Bearer ${cfg.SUPABASE_ANON_KEY||""}`)}
      <p class="hint">주소 끝의 key는 비밀번호 같은 거예요. 다른 사람에게 보내지 마세요. 새어 나갔으면 <button type="button" class="linkish" data-askey="reset">열쇠 새로 만들기</button>를 누르고 MacroDroid 주소도 바꿔 주세요(은행 알림 매크로까지 모두).</p></div>`
      :`<div><button type="button" class="btn ghost sm" data-askey="">MacroDroid에 넣을 주소 보기</button></div>`}
    ${asKeyErr?`<p class="err">${esc(asKeyErr)}</p>`:""}
    <label class="as-ignl">빼고 볼 카톡 이름 <small class="hint">한 줄에 하나 · 가족, 직원, 거래처 단톡방처럼 AS가 올 일 없는 이름</small><textarea id="as-ign" rows="3">${esc((Array.isArray(asKvData.ignore.names)?asKvData.ignore.names:[]).join("\n"))}</textarea></label>
    <div class="bk-btns"><button type="button" class="btn ghost sm" data-asignsave>이름 저장</button><span class="hint">${asSetupMsg?esc(asSetupMsg)+" · ":""}오늘 AI 판단 ${used}번</span></div></details>`;}

/* ---------- 오늘 할 일 · 현장 보기 ---------- */
function asAlerts(add){const row=(x,more)=>`<span><button type="button" class="linkish" data-asopen="${esc(x.j.id)}|${esc(x.c.id)}">${short(x.j)}</button> <span class="hint">${esc(asCut(x.c.sym,18))}${more?` · ${more}`:""}</span></span>`;
  if(as14&&asInbox.length)add("late","AS 접수함 확인 안 함",asInbox.map(r=>`<span><button type="button" class="linkish" data-go="as">${esc(asCut(asWho(r),14))}</button> <span class="hint">${r.src==="call"?"통화":"카톡"} ${asWhen(r.created_at)}</span></span>`),"건",["as","AS 접수함 보기"]);
  const all=asAll();
  add("late","방문일 안 잡은 AS",all.filter(x=>x.s.k==="new").sort((a,b)=>(a.c.at||"").localeCompare(b.c.at||"")).map(x=>row(x,x.c.at?`${fmt(x.c.at)} 접수`:"")),"건",["as","AS 보기"]);
  add("late","부품 도착 예정 지남",all.filter(x=>x.s.k!=="done"&&asWaitP(x.c)&&x.c.parts.eta&&x.c.parts.eta<TODAY).map(x=>row(x,`${fmt(x.c.parts.eta)} 예정`)),"건",["as","AS 보기"]);
  add("soon","다녀온 AS · 끝났는지 체크 안 함",all.filter(x=>x.s.k==="check").map(x=>row(x,"")),"건",["as","AS 보기"]);}
function asJobHtml(j){
  const cs=j.f.asc.map(c=>({c,s:asSt(j,c)})).sort((a,b)=>(a.s.k==="done")-(b.s.k==="done")||(b.c.at||"").localeCompare(a.c.at||"")),old=j.f.as.filter(a=>!a.cid);
  if(!cs.length&&!old.length&&!ended(j)&&!(j.i.start&&j.i.start<=TODAY))return"";
  const li=[...cs.map(({c,s})=>`<button type="button" class="linkish" data-asopen="${esc(j.id)}|${esc(c.id)}">${esc(c.sym||"증상 미입력")}</button> <span class="tag ${s.t}">${s.l}</span><span class="hint">${c.at?` ${fmt(c.at)} 접수`:""}${s.v?` · ${fmt(s.v.date)} 방문${s.v.crew?` ${esc(s.v.crew)}`:""}`:""}${c.done?` · ${fmt(c.done)} 끝남`:""}</span>`),
    ...old.map(a=>`<span class="d">${fmtW(a.date)}</span> 담당 ${esc(a.crew||"미정")}${a.note?` · ${esc(a.note)}`:""} ${a.done?`<span class="tag ok">완료</span>`:`<span class="tag soon">예정</span>`}`)];
  return`<div class="dsec"><h3>AS</h3>${li.length?`<ul class="jv-list">${li.map(x=>`<li>${x}</li>`).join("")}</ul>`:""}
    <div class="jv-btns"><button class="btn ghost sm" type="button" data-asnew="${esc(j.id)}">+ AS 접수</button></div></div>`;}

/* ---------- AS 접수 · 고치기 창 ---------- */
function openAs(o){const j=o.jid?jobs.find(x=>x.id===o.jid):null,c=j&&o.cid?j.f.asc.find(x=>x.id===o.cid):null,r=o.inId?asInbox.find(x=>x.id===o.inId):null;
  if(o.cid&&!c)return;
  asEd={jid:j?j.id:"",cid:c?c.id:"",inId:r?r.id:"",q:r&&!j?r.who:"",del:false,busy:false,pmsg:""};
  $("asTitle").textContent=c?"AS 건":"AS 접수";
  $("as-at").value=c?c.at:r?asDay(r.created_at):TODAY;
  $("as-src").value=c?c.src:r?r.src:"";
  const ls=r?asLines(r.body):[];
  $("as-sym").value=c?c.sym:r?(r.sum||(r.src==="kakao"?asCut(ls[ls.length-1],80):"")):"";
  $("as-note").value=c?c.note:r&&r.src==="kakao"?ls.join("\n"):"";
  $("as-pw").value=c?c.parts.what:"";$("as-pe").value=c?c.parts.eta:"";$("as-pg").value=c?c.parts.got:"";
  $("as-done").checked=!!(c&&c.done);
  $("as-vis").innerHTML="";(c?asVis(j,c):[]).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).forEach(asVisRow);
  $("as-err").hidden=true;$("as-save").disabled=false;$("as-del").hidden=!c;$("as-del").textContent="이 AS 지우기";
  asFromRender();asJobRender();
  asFromEl=document.activeElement;$("asSheet").hidden=false;document.body.style.overflow="hidden";
  if(!asEd.jid&&$("as-q"))$("as-q").focus({preventScroll:true});}
function closeAs(){$("asSheet").hidden=true;asEd=null;if($("jobSheet").hidden&&$("daySheet").hidden)document.body.style.overflow="";
  if(asFromEl&&asFromEl.isConnected&&asFromEl.focus)asFromEl.focus({preventScroll:true});asFromEl=null;}
function asFromRender(){const e=asEd;if(!e)return;const r=e.inId?(asInbox.find(x=>x.id===e.inId)||asDone.find(x=>x.id===e.inId)):null,j=e.jid&&jobs.find(x=>x.id===e.jid);
  let h="";
  if(r){const ls=asLines(r.body);
    h+=`<div class="as-quote"><div><b>${r.src==="call"?"통화":"받은 카톡"} · ${esc(asWho(r))}</b> <span class="hint">${asWhen(r.created_at)}${r.src==="call"&&r.tel?` · ${esc(fmtTel(r.tel))}`:""}</span></div><p>${ls.map(esc).join("<br>")}</p></div>`;
    const open=j&&!e.cid?j.f.asc.filter(c=>!c.done):[];
    if(open.length)h+=`<div class="as-attach"><span class="hint">이 현장에 아직 안 끝난 AS가 있어요. 같은 건이면 새로 만들지 말고 붙여요.</span>${open.map(c=>`<button type="button" class="btn ghost sm" data-asatt="${esc(c.id)}">'${esc(asCut(c.sym,20))}'에 붙이기</button>`).join("")}</div>`;}
  else if(!e.cid)h+=`<details class="as-paste"${e.pmsg?" open":""}><summary>카톡 글 붙여넣어 채우기</summary><textarea id="as-paste" rows="4" placeholder="고객이 보낸 카톡을 길게 눌러 복사한 뒤 여기에 붙여넣으세요"></textarea>
    <div class="bk-btns"><button type="button" class="btn ghost sm" id="as-parse">증상 정리하기</button><span class="hint" id="as-pmsg">${esc(e.pmsg)}</span></div></details>`;
  $("asFrom").innerHTML=h;}
function asJobRender(){const e=asEd,j=e.jid&&jobs.find(x=>x.id===e.jid);
  if(j){$("asJob").innerHTML=`<div class="as-jobsel"><span class="lbl">현장</span><b>${esc(j.name)}</b><span class="hint">${[j.addr&&esc(j.addr),j.i.start&&`시공 ${fmt(j.i.start)}`].filter(Boolean).join(" · ")}</span>${e.cid?"":`<button type="button" class="btn ghost sm" data-asjob="">바꾸기</button>`}</div>`;return;}
  $("asJob").innerHTML=`<label>현장 <small class="hint">고객 이름, 주소, 전화번호로 찾기</small><input id="as-q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(e.q)}"></label><div class="as-hits" id="as-hits"></div>`;
  asHits();}
/* 현장 찾기: 낱말(글자 묶음·숫자 묶음)마다 이름·주소·품목·전화에 있는지 세서 많이 맞는 순. 다 맞는 게 없으면 비슷한 현장(part) */
function asFind(q){const st=j=>ended(j)||(j.i.start&&j.i.start<=TODAY)?0:1,rec=(a,b)=>st(a)-st(b)||String(b.i.start||b.createdAt).localeCompare(String(a.i.start||a.createdAt));
  const tk=(String(q||"").toLowerCase().match(/[a-z가-힣]+|\d+/g)||[]).filter(t=>!/^(고객|님|고객님)$/.test(t)&&(t.length>=2||/\d/.test(t)));
  if(!tk.length)return{list:jobs.filter(j=>st(j)===0).sort(rec).slice(0,8),part:false};
  const sc=jobs.map(j=>{const hay=[j.name,j.addr,j.item].join("").toLowerCase().replace(/\s/g,""),tel=String(j.i.tel).replace(/\D/g,"");
    return{j,n:tk.filter(t=>hay.includes(t)||(/^\d{3,}$/.test(t)&&tel.includes(t))).length};}).filter(x=>x.n);
  const top=sc.reduce((m,x)=>Math.max(m,x.n),0);
  return{list:sc.sort((a,b)=>b.n-a.n||rec(a.j,b.j)).slice(0,8).map(x=>x.j),part:top>0&&top<tk.length};}
function asHits(){if(!$("as-q"))return;asEd.q=$("as-q").value;const f=asFind(asEd.q),h=f.list;
  $("as-hits").innerHTML=(h.length?f.part?`<p class="hint">딱 맞는 현장이 없어서 비슷한 현장을 보여 드려요.</p>`:"":`<p class="hint">${asEd.q?"맞는 현장이 없어요. 다른 낱말로 찾아보세요.":"시공한 현장이 아직 없어요."}</p>`)
    +h.map(j=>`<button type="button" class="as-hit" data-asjob="${esc(j.id)}"><b>${esc(j.name)}</b><span class="hint">${[j.addr&&esc(j.addr),j.i.tel&&esc(j.i.tel),j.i.start?`시공 ${fmt(j.i.start)}`:"시공 전"].filter(Boolean).join(" · ")}</span></button>`).join("");}
function asVisRow(v={date:"",crew:"",done:false}){const div=document.createElement("div");div.className="as-vrow";
  const opts=["",...CREW,...(v.crew&&!CREW.includes(v.crew)?[v.crew]:[])].map(c=>`<option value="${esc(c)}"${c===v.crew?" selected":""}>${c?esc(c):"담당 미정"}</option>`).join("");
  div.innerHTML=`<label>방문 날짜<input type="date" value="${esc(v.date||"")}"></label><label>담당<select>${opts}</select></label><label class="check"><input type="checkbox"${v.done?" checked":""}>다녀옴</label><button class="btn del sm" type="button" data-asvdel>빼기</button>`;
  $("as-vis").appendChild(div);}
const asErr=m=>{$("as-err").textContent=m;$("as-err").hidden=!m;};
const asBy=()=>String(userName||userEmail||"").slice(0,40);
async function asInMark(id,patch){if(!id)return true;
  const {error}=await sb.from("as_inbox").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);if(error)return false;
  const r=asInbox.find(x=>x.id===id)||asDone.find(x=>x.id===id);
  if(r){Object.assign(r,patch);asInbox=asInbox.filter(x=>x!==r);asDone=asDone.filter(x=>x!==r);(r.status==="new"?asInbox:asDone).unshift(r);}
  return true;}
function asSave(){const e=asEd;if(!e||e.busy)return;
  if(!e.jid){asErr("현장을 골라 주세요.");if($("as-q"))$("as-q").focus();return;}
  const sym=$("as-sym").value.trim();if(!sym){asErr("증상을 적어 주세요. 예: 상부장 문 경첩 처짐");$("as-sym").focus();return;}
  const at=$("as-at").value||TODAY,eta=$("as-pe").value,got=$("as-pg").value;
  const vis=[...$("as-vis").children].map(r=>({date:r.querySelector("input[type=date]").value,crew:r.querySelector("select").value,done:r.querySelector("input[type=checkbox]").checked})).filter(v=>v.date);
  const done=$("as-done").checked,cid=e.cid||asId();
  e.busy=true;$("as-save").disabled=true;asErr("");
  qcRun(e.jid,async j=>{const old=j.f.asc.find(x=>x.id===cid);
    const c=normCase({...(old||{}),id:cid,at,src:$("as-src").value,sym,note:$("as-note").value.trim(),parts:{what:$("as-pw").value.trim(),eta,got},
      done:done?((old&&old.done)||(vis.length?vis.map(v=>v.date).sort().pop():"")||TODAY):"",in:(old&&old.in)||e.inId||"",by:(old&&old.by)||asBy()});
    if(c.done&&c.done>TODAY)c.done=TODAY;
    const asc=old?j.f.asc.map(x=>x.id===cid?c:x):[...j.f.asc,c];
    const as=[...j.f.as.filter(a=>a.cid!==cid),...vis.map(v=>({date:v.date,crew:v.crew,note:sym,done:v.done,cid}))];
    const ok=await jobWrite(j,{f:{...j.f,asc,as}});
    if(ok&&e.inId)await asInMark(e.inId,{status:"done",case_id:cid,job_id:j.id,done_by:asBy()});
    e.busy=false;
    if(!ok){$("as-save").disabled=false;asErr("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");return;}
    if(asEd===e)closeAs();render();});}
/* 접수함 건을 이미 있는 AS 건에 붙임: 받은 글을 메모 끝에 이어 붙이고 접수함은 처리함으로 */
function asAttach(cid,btn){const e=asEd;if(!e||e.busy||!e.jid)return;const r=asInbox.find(x=>x.id===e.inId);
  e.busy=true;btn.disabled=true;
  qcRun(e.jid,async j=>{const c=j.f.asc.find(x=>x.id===cid);let ok=!!c;
    if(c&&r){const add=`[${asWhen(r.created_at)} ${r.src==="call"?"통화":"카톡"}] ${asLines(r.body).join(" / ")}`;
      ok=await jobWrite(j,{f:{...j.f,asc:j.f.asc.map(x=>x.id===cid?{...x,note:(x.note?x.note+"\n":"")+add}:x)}});}
    if(ok)ok=await asInMark(e.inId,{status:"done",case_id:cid,job_id:j.id,done_by:asBy()});
    e.busy=false;
    if(!ok){btn.disabled=false;asErr("붙이지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");return;}
    if(asEd===e)closeAs();render();});}
function asDelete(){const e=asEd;if(!e||!e.cid||e.busy)return;
  if(!e.del){e.del=true;$("as-del").textContent="정말 지울까요? 한 번 더 누르면 지워져요 (방문 일정도 같이)";return;}
  e.busy=true;$("as-del").disabled=true;
  qcRun(e.jid,async j=>{const ok=await jobWrite(j,{f:{...j.f,asc:j.f.asc.filter(x=>x.id!==e.cid),as:j.f.as.filter(a=>a.cid!==e.cid)}});
    e.busy=false;$("as-del").disabled=false;
    if(!ok){asErr("지우지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");return;}
    if(asEd===e)closeAs();render();});}
/* 붙여넣은 카톡 글을 서버 AI가 한 줄 증상으로 정리 (서버가 옛 버전이거나 안 되면 마지막 줄을 그대로) */
async function asParse(btn){const e=asEd,t=$("as-paste")?$("as-paste").value.trim():"";if(!e)return;
  if(!t){e.pmsg="먼저 카톡 글을 붙여넣어 주세요.";$("as-pmsg").textContent=e.pmsg;return;}
  btn.disabled=true;$("as-pmsg").textContent="정리하는 중…";
  let r=null;try{const {data,error}=await sb.functions.invoke("notify",{body:{action:"as_parse",text:t}});if(!error&&data&&"is_as" in data)r=data;}catch(x){}
  btn.disabled=false;if(asEd!==e)return;
  const ls=asLines(t);
  if(!$("as-note").value.trim())$("as-note").value=ls.join("\n");
  if(!$("as-src").value)$("as-src").value="kakao";
  if(r&&r.sym)$("as-sym").value=r.sym;else if(!$("as-sym").value.trim())$("as-sym").value=asCut(ls[ls.length-1],80);
  e.pmsg=!r?"자동 정리를 못 해서 마지막 줄을 넣었어요. 증상을 다듬어 주세요.":r.is_as?"증상을 채웠어요. 맞는지 보고 저장하세요.":"AS 요청이 아닌 것 같아요. 그래도 AS면 증상을 다듬어 저장하세요.";
  $("as-pmsg").textContent=e.pmsg;
  if(!e.jid&&r&&r.hint&&$("as-q")&&!$("as-q").value.trim()){$("as-q").value=r.hint;asHits();}}

/* ---------- 접수함 단추 ---------- */
async function asInAct(id,patch){asInBusy=id;renderAs();const ok=await asInMark(id,patch);asInBusy="";
  if(!ok)alertAs("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");renderAs();renderHome();}
function alertAs(m){const p=$("asInbox").querySelector(".as-h");if(p&&!p.querySelector(".err"))p.insertAdjacentHTML("beforeend",`<span class="err">${esc(m)}</span>`);}
async function asIgnore(id){const r=asInbox.find(x=>x.id===id);if(!r)return;
  const names=[...new Set([...(Array.isArray(asKvData.ignore.names)?asKvData.ignore.names:[]),r.who].filter(Boolean))].slice(0,200);
  asInBusy=id;renderAs();
  const {error}=await sb.from("as_kv").upsert({key:"ignore",data:{...asKvData.ignore,names},updated_at:new Date().toISOString()});
  if(!error){asKvData.ignore={...asKvData.ignore,names};const same=asInbox.filter(x=>x.src==="kakao"&&x.who===r.who);for(const x of same)await asInMark(x.id,{status:"skip",done_by:asBy()});}
  asInBusy="";if(error)alertAs("저장하지 못했어요. 다시 눌러 주세요.");renderAs();renderHome();}
async function asKeyGet(reset){asKeyErr="";const {data,error}=await sb.rpc("as_key",{p_reset:!!reset});
  if(error||typeof data!=="string")asKeyErr=/admin only/.test(error&&error.message||"")?"관리자만 볼 수 있어요.":"열쇠를 불러오지 못했어요. 업데이트 14를 실행했는지 확인해 주세요.";else asKey=data;
  asSetupOpen=true;$("asSetup").innerHTML=asSetupHtml();}
async function asIgnSave(){const names=[...new Set($("as-ign").value.split("\n").map(x=>x.trim()).filter(Boolean))].slice(0,200);
  const {error}=await sb.from("as_kv").upsert({key:"ignore",data:{...asKvData.ignore,names},updated_at:new Date().toISOString()});
  if(!error)asKvData.ignore={...asKvData.ignore,names};asSetupMsg=error?"저장하지 못했어요":"저장했어요";
  if(document.activeElement)document.activeElement.blur();$("asSetup").innerHTML=asSetupHtml();}

function asInit(){
  $("view-as").addEventListener("click",e=>{if(e.target.closest("[data-j]"))return;const b=e.target.closest("button");const d=b?b.dataset:{};
    if(b&&d.asf){asF=d.asf;renderAs();return;}
    if(b&&d.inreg){const r=asInbox.find(x=>x.id===d.inreg);if(r)openAs({jid:asJobOf(r)?r.job_id:"",inId:r.id});return;}
    if(b&&d.inskip){asInAct(d.inskip,{status:"skip",done_by:asBy()});return;}
    if(b&&d.inundo){asInAct(d.inundo,{status:"new",done_by:""});return;}
    if(b&&d.inign){asIgnore(d.inign);return;}
    if(b&&"askey" in d){if(d.askey==="reset"&&!d.sure){d.sure="1";b.textContent="정말 새로 만들까요? 한 번 더 누르면 지금 주소는 더 안 돼요";return;}asKeyGet(d.askey==="reset");return;}
    if(b&&"ascopy" in d){const i=b.parentElement.querySelector("input");i.select();try{navigator.clipboard.writeText(i.value).then(()=>{b.textContent="복사됨";setTimeout(()=>{b.textContent="복사"},1500);},()=>document.execCommand("copy"));}catch(x){document.execCommand("copy");}return;}
    if(b&&"asignsave" in d){asIgnSave();return;}});
  $("asSetup").addEventListener("toggle",e=>{if(e.target.matches("details.as-setup"))asSetupOpen=e.target.open;},true);
  $("asAdd").onclick=()=>openAs({});
  document.addEventListener("click",e=>{const o=e.target.closest("[data-asopen]");
    if(o&&!e.target.closest("[data-j]")){const [jid,cid]=o.dataset.asopen.split("|");openAs({jid,cid});return;}
    const n=e.target.closest("[data-asnew]");if(n){openAs({jid:n.dataset.asnew});}});
  document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches&&e.target.matches("li[data-asopen]")){const [jid,cid]=e.target.dataset.asopen.split("|");openAs({jid,cid});}});
  $("asClose").onclick=closeAs;
  $("asSheet").addEventListener("click",e=>{if(e.target===$("asSheet")){closeAs();return;}
    const b=e.target.closest("button");if(!b)return;const d=b.dataset;
    if("asjob" in d){asEd.jid=d.asjob;if(!d.asjob)asEd.q="";asJobRender();asFromRender();if(d.asjob&&!$("as-sym").value.trim())$("as-sym").focus({preventScroll:true});return;}
    if(d.asatt){asAttach(d.asatt,b);return;}
    if("asvdel" in d){b.closest(".as-vrow").remove();return;}
    if(b.id==="as-parse"){asParse(b);return;}});
  $("asSheet").addEventListener("input",e=>{if(e.target.id==="as-q")asHits();});
  $("as-addv").onclick=()=>{asVisRow({date:"",crew:"",done:false});const l=$("as-vis").lastElementChild;if(l)l.querySelector("input").focus();};
  $("as-pg").addEventListener("change",()=>{if($("as-pg").value&&!$("as-pw").value.trim())$("as-pw").placeholder="무엇이 왔는지 적어 두면 좋아요";});
  $("asForm").addEventListener("submit",e=>{e.preventDefault();asSave();});
  $("as-del").onclick=asDelete;
  // 현장 보기 위에 열릴 수 있어서 window 에서 먼저 받음 (현장 보기의 Esc 처리보다 앞)
  window.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("asSheet").hidden){e.stopImmediatePropagation();closeAs();}},true);}
