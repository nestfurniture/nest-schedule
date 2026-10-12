let CREW=[];
let jobs=[],files=[],pending=[],sb=null,calY,calM,editing=null,loaded=false;
const BUCKET="job-files",MAX_BYTES=50*1024*1024,KINDS={drawing:"도면",estimate:"견적서"};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const now=new Date();const TODAY=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
calY=now.getFullYear();calM=now.getMonth();
const fmt=d=>d?d.slice(5).replace("-","/"):"—";
const addDays=(d,n)=>{const t=new Date(d+"T12:00:00");t.setDate(t.getDate()+n);return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`};
const sub=j=>[j.item,j.addr].filter(Boolean).map(esc).join(" · ");
const WD="일월화수목금토";
const dow=d=>new Date(d+"T12:00:00").getDay();
const fmtW=d=>d?`${fmt(d)}<span class="wk">(${WD[dow(d)]})</span>`:"—";
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
  m:{date:d.m?.date||"",done:!!d.m?.done},i:{start:d.i?.start||"",end:d.i?.end||"",crew:Array.isArray(d.i?.crew)?d.i.crew:[],sat:!!d.i?.sat,sun:!!d.i?.sun,color:COLORS.includes(d.i?.color)?d.i.color:"orange"},
  f:{done:!!d.f?.done,extra:Array.isArray(d.f?.extra)?d.f.extra:[],as:Array.isArray(d.f?.as)?d.f.as:[]},createdAt:d.created_at||""};}

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
function fileCount(j){const d=filesOf(j.id,"drawing").length,e=filesOf(j.id,"estimate").length;
  if(!d&&!e)return`<span class="hint">없음</span>`;
  return`<span class="fcount">${d?`도면 ${d}`:""}${d&&e?" · ":""}${e?`견적 ${e}`:""}</span>`;}
const fsize=b=>b>=1048576?(b/1048576).toFixed(1)+"MB":Math.max(1,Math.round(b/1024))+"KB";

function render(){
  const active=jobs.filter(j=>!j.f.done);
  $("summary").innerHTML=`<span class="chip">진행 중 현장 <b>${active.length}</b></span>
    <span class="chip late">시공자 미배정 (7일 내) <b>${jobs.filter(noCrewSoon).length}</b></span>
    <span class="chip">이번 주 시공 <b>${jobs.filter(j=>!j.f.done&&thisWeek(j)).length}</b></span>
    <span class="chip soon">마감 추가 투입 <b>${jobs.reduce((a,j)=>a+extraSum(j),0)}명</b></span>
    <span class="chip">AS 예정 <b>${jobs.reduce((a,j)=>a+asOpen(j).length,0)}</b></span>`;
  const key=j=>(noCrewSoon(j)?"0":"1")+(j.f.done?"1":"0")+(j.i.start||j.m.date||"9");
  const sorted=[...jobs].sort((a,b)=>key(a).localeCompare(key(b)));
  const empty=loaded&&!jobs.length;
  $("empty").hidden=!empty;
  $("tbody").innerHTML=sorted.map(j=>`<tr data-j="${esc(j.id)}" tabindex="0">
    <td class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></td>
    <td><div class="cell"><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</div></td>
    <td><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></td>
    <td><div class="cell">${crewHtml(j)}</div></td>
    <td><div class="cell">${finishTag(j)}${asTag(j)}</div></td>
    <td>${extraHtml(j)}</td>
    <td>${fileCount(j)}</td></tr>`).join("");
  $("cards").innerHTML=sorted.map(j=>`<button class="card ${noCrewSoon(j)?"flag":""}" data-j="${esc(j.id)}">
    <div class="job"><b>${esc(j.name)}</b><small>${sub(j)}</small></div>
    <dl class="kv">
      <dt>실측</dt><dd><span class="d">${fmtW(j.m.date)}</span>${measureTag(j)}</dd>
      <dt>시공</dt><dd><span class="d">${j.i.start?`<i class="dot k ${kc(j)}"></i> `:""}${range(j)||"—"}</span></dd>
      <dt>시공자</dt><dd>${crewHtml(j)}</dd>
      <dt>마감</dt><dd>${finishTag(j)}${extraSum(j)?extraHtml(j):""}${asTag(j)}</dd>
      <dt>파일</dt><dd>${fileCount(j)}</dd>
    </dl></button>`).join("");
  renderCal();
}
function renderCal(){
  $("calTitle").textContent=`${calY}년 ${calM+1}월`;
  const first=new Date(calY,calM,1),start=new Date(first);start.setDate(1-first.getDay());
  let h="일월화수목금토".split("").map(d=>`<div class="dow">${d}</div>`).join("");
  for(let k=0;k<42;k++){const d=new Date(start);d.setDate(start.getDate()+k);
    const ds=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const short=j=>esc(j.name.replace(" 고객",""));
    let ev="";
    jobs.forEach(j=>{
      if(j.m.date===ds)ev+=`<div class="ev m" title="${esc(j.name)} 실측">실측 ${short(j)}</div>`;
      if(workDays(j).includes(ds)){const who=j.i.crew.length?j.i.crew.join("·"):"미배정";
        ev+=`<div class="ev i ${kc(j)} ${j.i.crew.length?"":"none"}" title="${esc(j.name)} 시공 · ${esc(who)}">${short(j)} · ${esc(who)}</div>`;}
      j.f.as.forEach(a=>{if(a.date===ds)ev+=`<div class="ev a ${a.done?"done":""}" title="${esc(j.name)} AS · ${esc(a.crew||"담당 미정")} ${esc(a.note)}">AS ${short(j)}${a.crew?` · ${esc(a.crew)}`:""}</div>`;});
      j.f.extra.forEach(x=>{if(x.date===ds)ev+=`<div class="ev x ${kc(j)}" title="${esc(j.name)} 마감 추가 ${+x.people}명 ${esc(x.note)}">+${+x.people}명 ${short(j)}</div>`;});
    });
    const we=d.getDay()===0||d.getDay()===6;
    h+=`<div class="day ${d.getMonth()!==calM?"other":""} ${ds===TODAY?"today":""} ${we?"we":""}"><span class="n">${d.getDate()}</span>${ev}</div>`;}
  $("cal").innerHTML=h;
}

/* form */
function renderCrewPick(selected){
  $("f-crew").innerHTML=CREW.map((c,n)=>`<label><input type="checkbox" id="f-c${n}" value="${esc(c)}" ${selected.includes(c)?"checked":""}>${esc(c)}</label>`).join("");}
const pickedCrew=()=>[...$("f-crew").querySelectorAll("input:checked")].map(x=>x.value);
/* 시공 색: 새 현장은 날짜가 겹치는 다른 현장과 안 겹치는 색을 자동 선택 */
let colorTouched=false;
const getColor=()=>(document.querySelector('input[name="f-color"]:checked')||{}).value||"orange";
function setColor(c){document.querySelectorAll('input[name="f-color"]').forEach(r=>r.checked=r.value===c);}
function autoColor(){if(colorTouched)return;const s=$("f-istart").value;if(!s)return;
  const mine=workDays({i:{start:s,end:$("f-iend").value||s,sat:$("f-sat").checked,sun:$("f-sun").checked}});
  const used=jobs.filter(o=>o!==editing&&workDays(o).some(d=>mine.includes(d))).map(o=>o.i.color);
  setColor(COLORS.find(c=>!used.includes(c))||COLORS[used.length%COLORS.length]);}
["f-istart","f-iend","f-sat","f-sun"].forEach(id=>$(id).addEventListener("change",autoColor));
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
function openForm(j){editing=j||null;$("formTitle").textContent=j?`${j.name} 수정`:"새 현장 등록";$("delBtn").hidden=!j;$("f-err").hidden=true;$("delConfirm").hidden=true;
  const v=j||norm("",{});
  $("f-name").value=v.name;$("f-item").value=v.item;$("f-addr").value=v.addr;
  $("f-mdate").value=v.m.date;$("f-mdone").checked=v.m.done;$("f-istart").value=v.i.start;$("f-iend").value=v.i.end;$("f-sat").checked=v.i.sat;$("f-sun").checked=v.i.sun;
  setColor(v.i.color||"orange");colorTouched=!!j;
  v.i.crew.forEach(c=>{if(!CREW.includes(c))CREW.push(c)});renderCrewPick(v.i.crew);$("f-newcrew").value="";
  $("f-fdone").checked=v.f.done;$("f-extras").innerHTML="";v.f.extra.forEach(extraRow);
  $("f-as").innerHTML="";v.f.as.forEach(asRow);
  pending=[];renderFiles();
  $("form").hidden=false;$("form").scrollIntoView({behavior:"smooth",block:"start"});$("f-name").focus({preventScroll:true});}
const showErr=m=>{$("f-err").textContent=m;$("f-err").hidden=false};
$("addExtra").onclick=()=>extraRow();
$("addAs").onclick=()=>asRow();
$("addBtn").onclick=()=>openForm(null);
$("cancelBtn").onclick=()=>{$("form").hidden=true};
$("addCrew").onclick=async()=>{const nm=$("f-newcrew").value.trim();if(!nm)return;
  const sel=pickedCrew();if(!CREW.includes(nm))CREW.push(nm);sel.push(nm);renderCrewPick(sel);$("f-newcrew").value="";
  try{await sb.from("crew").upsert({name:nm})}catch(e){}};
$("delBtn").onclick=()=>{$("delConfirm").hidden=false};
$("delNo").onclick=()=>{$("delConfirm").hidden=true};
$("delYes").onclick=async()=>{const j=editing;if(!j)return;
  try{const paths=filesOf(j.id).map(f=>f.path);
    if(paths.length){const {error:se}=await sb.storage.from(BUCKET).remove(paths);if(se)throw se;}
    const {error}=await sb.from("jobs").delete().eq("id",j.id);if(error)throw error;
    files=files.filter(f=>f.job_id!==j.id);jobs=jobs.filter(x=>x!==j);render();$("form").hidden=true;}
  catch(e){showErr("삭제하지 못했어요. 잠시 후 다시 눌러 주세요.")}};
$("saveBtn").onclick=async()=>{const name=$("f-name").value.trim();
  if(!name)return showErr("고객명을 입력해 주세요.");
  const s=$("f-istart").value,e=$("f-iend").value;
  if(s&&e&&e<s)return showErr("시공 종료일이 시작일보다 빠릅니다.");
  const sat=$("f-sat").checked,sun=$("f-sun").checked;
  if(s&&!workDays({i:{start:s,end:e||s,sat,sun}}).length)return showErr("고른 기간이 모두 주말이에요. 토·일 작업을 체크하거나 날짜를 바꿔 주세요.");
  const extra=[...$("f-extras").children].map(r=>{const [d,p,n]=r.querySelectorAll("input");return{date:d.value,people:+p.value||0,note:n.value.trim()}}).filter(x=>x.date&&x.people>0);
  const as=[...$("f-as").children].map(r=>({date:r.querySelector("input[type=date]").value,crew:r.querySelector("select").value,note:r.querySelector(".note input").value.trim(),done:r.querySelector("input[type=checkbox]").checked})).filter(a=>a.date||a.note);
  const data={name,item:$("f-item").value.trim(),addr:$("f-addr").value.trim(),
    m:{date:$("f-mdate").value,done:$("f-mdone").checked},i:{start:s,end:e||s,crew:pickedCrew(),sat,sun,color:getColor()},
    f:{done:$("f-fdone").checked,extra,as},updated_at:new Date().toISOString()};
  $("saveBtn").disabled=true;
  try{
    const q=editing?sb.from("jobs").update(data).eq("id",editing.id).select():sb.from("jobs").insert(data).select();
    const {data:rows,error}=await q;if(error)throw error;
    const row=rows&&rows[0];if(row){jobs=jobs.filter(x=>x.id!==row.id);jobs.push(norm(row.id,row));render();}
    if(row&&pending.length){
      editing=jobs.find(x=>x.id===row.id);$("formTitle").textContent=`${editing.name} 수정`;$("delBtn").hidden=false;
      $("saveBtn").textContent="파일 올리는 중…";
      const queue=pending;pending=[];renderFiles();
      for(const p of queue)await uploadOne(row.id,p.kind,p.file);
      if(!$("f-err").hidden){$("saveBtn").textContent="저장";return;}
    }
    $("form").hidden=true;
  }catch(err){showErr("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.")}
  finally{$("saveBtn").disabled=false;$("saveBtn").textContent="저장"}};
document.addEventListener("click",e=>{const r=e.target.closest("[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"){const r=e.target.closest&&e.target.closest("tr[data-j]");if(r){const j=jobs.find(x=>x.id===r.dataset.j);if(j)openForm(j);}}});
function tab(which){const board=which==="board";$("tab-board").setAttribute("aria-selected",board);$("tab-cal").setAttribute("aria-selected",!board);$("view-board").hidden=!board;$("view-cal").hidden=board;}
$("tab-board").onclick=()=>tab("board");$("tab-cal").onclick=()=>tab("cal");
$("prev").onclick=()=>{calM--;if(calM<0){calM=11;calY--}renderCal()};
$("next").onclick=()=>{calM++;if(calM>11){calM=0;calY++}renderCal()};


/* 도면 · 견적서 파일 */
let userEmail="";
function renderFiles(){
  for(const kind of Object.keys(KINDS)){
    const saved=editing?filesOf(editing.id,kind):[];
    const wait=pending.filter(p=>p.kind===kind);
    let h=saved.map(f=>`<li><button type="button" class="fname" data-fid="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</button><span class="fmeta">${fsize(+f.size||0)} · ${fmt((f.created_at||"").slice(0,10))}</span><button type="button" class="fdel" data-fdel="${esc(f.id)}">삭제</button></li>`).join("");
    h+=wait.map((p,n)=>`<li><span class="fname" style="color:var(--muted)">${esc(p.file.name)}</span><span class="fmeta">${p.busy?"올리는 중…":"저장하면 올라가요"}</span>${p.busy?"":`<button type="button" class="fdel" data-pdel="${pending.indexOf(p)}">빼기</button>`}</li>`).join("");
    if(!h)h=`<li class="none">${kind==="drawing"?"아직 올린 도면이 없어요.":"아직 올린 견적서가 없어요."}</li>`;
    $("fl-"+kind).innerHTML=h;}
}
function safeExt(name){const m=/\.([A-Za-z0-9]{1,8})$/.exec(name||"");return m?m[1].toLowerCase():"bin";}
async function uploadOne(jobId,kind,file){
  const tmp={kind,file,busy:true};pending.push(tmp);renderFiles();
  try{
    const path=`${jobId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${safeExt(file.name)}`;
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
  if(pd){pending.splice(+pd.dataset.pdel,1);renderFiles();return;}
  const del=e.target.closest("[data-fdel]");
  if(del){if(del.dataset.armed!=="1"){del.dataset.armed="1";del.textContent="정말 삭제";setTimeout(()=>{if(del.isConnected){del.dataset.armed="";del.textContent="삭제";}},4000);return;}
    const f=files.find(x=>x.id===del.dataset.fdel);if(!f)return;del.disabled=true;
    const {error:se}=await sb.storage.from(BUCKET).remove([f.path]);
    const {error}=se?{error:se}:await sb.from("files").delete().eq("id",f.id);
    if(error){showErr("파일을 삭제하지 못했어요. 잠시 후 다시 눌러 주세요.");del.disabled=false;return;}
    files=files.filter(x=>x!==f);renderFiles();render();}
});

/* Supabase: 로그인, 불러오기, 실시간 반영 */
async function loadAll(){
  const [{data:j,error:e1},{data:c},{data:fl}]=await Promise.all([sb.from("jobs").select("*"),sb.from("crew").select("name").order("created_at"),sb.from("files").select("*").order("created_at")]);
  if(e1){$("status").textContent="현장을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.";$("status").hidden=false;return;}
  $("status").hidden=true;
  jobs=(j||[]).map(r=>norm(r.id,r));CREW=(c||[]).map(r=>r.name);files=fl||[];loaded=true;render();
  if(!$("form").hidden&&editing)renderFiles();
}
let channel=null;
function startApp(session){
  $("login").hidden=true;$("app").hidden=false;userEmail=session.user.email||"";$("who").textContent=userEmail;
  loadAll();
  if(!channel){channel=sb.channel("nest").on("postgres_changes",{event:"*",schema:"public",table:"jobs"},loadAll)
    .on("postgres_changes",{event:"*",schema:"public",table:"crew"},loadAll)
    .on("postgres_changes",{event:"*",schema:"public",table:"files"},loadAll).subscribe();}
}
function showLogin(){$("app").hidden=true;$("login").hidden=false;if(channel){sb.removeChannel(channel);channel=null;}}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("l-err").hidden=true;$("l-btn").disabled=true;
  const {error}=await sb.auth.signInWithPassword({email:$("l-email").value.trim(),password:$("l-pw").value});
  $("l-btn").disabled=false;
  if(error){$("l-err").textContent="이메일이나 비밀번호가 맞지 않아요.";$("l-err").hidden=false;}});
$("logoutBtn").onclick=()=>sb.auth.signOut();
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!$("app").hidden)loadAll();});

(function boot(){
  const cfg=window.NEST_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase){$("setup").hidden=false;return;}
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  sb.auth.getSession().then(({data})=>data.session?startApp(data.session):showLogin());
  sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_IN"&&session)startApp(session);if(ev==="SIGNED_OUT")showLogin();});
  if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
