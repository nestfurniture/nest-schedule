/* 시공자용 체크리스트 화면. 로그인 없이 링크 속 열쇠(t)로 알림 서버(notify)를 거쳐 읽고 저장합니다. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WD = "일월화수목금토";
const TOKEN = new URLSearchParams(location.search).get("t") || "";
const cfg = window.NEST_CONFIG || {};
const sb = window.supabase && cfg.SUPABASE_URL ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const CL = window.NEST_CL;
let job = null, data = { items: {}, dims: {}, photos: [], memo: "", name: "" }, urls = {}, specs = [], busy = new Map(), saveTimer = null, saving = false, dirty = false, submitted = false;

function fail(title, text) { $("state").innerHTML = `<b>${esc(title)}</b>${esc(text || "")}`; $("state").hidden = false; $("main").hidden = true; $("bar").hidden = true; }
async function call(body) {
  if (!sb) throw Object.assign(new Error("setup"), { kind: "setup" });
  const { data: d, error } = await sb.functions.invoke("notify", { body: { ...body, token: TOKEN } });
  if (error) {
    const st = error.context && error.context.status;
    throw Object.assign(new Error(String(st || "net")), { kind: st === 404 ? "gone" : st === 409 ? "submitted" : "net" });
  }
  return d || {};
}
const dKo = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8)}일(${WD[new Date(d + "T12:00:00").getDay()]})`;
function when(i) { if (!i.start) return ""; const e = i.end && i.end >= i.start ? i.end : i.start; return e === i.start ? dKo(i.start) : `${dKo(i.start)} ~ ${dKo(e)}`; }

/* ---------- 그리기 ---------- */
function renderJob() {
  $("job").innerHTML = `<h1>${esc(job.name)}</h1><div class="meta">${job.item ? `<span>${esc(job.item)}</span>` : ""}${job.addr ? `<span>${esc(job.addr)}</span>` : ""}${when(job.i) ? `<span>시공 ${esc(when(job.i))}</span>` : ""}${job.i.crew.length ? `<span>시공자 ${esc(job.i.crew.join(", "))}</span>` : ""}</div>`;
}
function itemHtml(x) {
  const r = data.items[x.key] || {};
  const b = (v, l) => `<button type="button" class="${v}" data-k="${esc(x.key)}" data-v="${v}" aria-pressed="${r.v === v}">${l}</button>`;
  return `<div class="item" data-item="${esc(x.key)}"><div class="q">${esc(x.label)}</div><div class="seg" role="group" aria-label="${esc(x.label)}">${b("ok", "확인")}${b("bad", "문제")}${b("na", "해당 없음")}</div>
    <input class="note" data-note="${esc(x.key)}" value="${esc(r.note || "")}" placeholder="${r.v === "bad" ? "무엇이 문제인지 적어 주세요 (꼭)" : "메모 (선택)"}" aria-label="${esc(x.label)} 메모" ${r.v === "bad" || r.note ? "" : "hidden"}></div>`;
}
function photosHtml(s) {
  const mine = data.photos.filter((p) => p.key === s.key), wait = [...busy.values()].filter((b) => b.key === s.key);
  return `<div class="photos" data-photos="${esc(s.key)}"><div class="lbl">${esc(s.photo)} <span class="req">필수</span></div>
    ${mine.length || wait.length ? `<div class="ph-grid">${mine.map((p) => `<div class="ph"><img alt="" src="${esc(urls[p.path] || "")}"><button type="button" class="x" data-del="${esc(p.path)}">빼기</button></div>`).join("")}${wait.map((b) => `<div class="ph"><img alt="" src="${esc(b.preview)}"><span class="busy">올리는 중…</span></div>`).join("")}</div>` : ""}
    <div class="ph-btns"><label class="btn ghost sm">사진 찍기<input type="file" accept="image/*" capture="environment" data-up="${esc(s.key)}" aria-label="${esc(s.title)} 사진 찍기"></label><label class="btn ghost sm">앨범에서 고르기<input type="file" accept="image/*" multiple data-up="${esc(s.key)}" aria-label="${esc(s.title)} 사진 고르기"></label></div></div>`;
}
function sectionHtml(s) {
  const d = data.dims[s.key] || {};
  const mySpecs = s.app ? specs.filter((f) => f.app === s.app.id && f.url) : [];
  return `<section class="card" data-sec="${esc(s.key)}"><h2>${esc(s.title)}</h2>
    ${s.spec ? `<div class="spec"><b>시방서 확인 치수</b>${esc(s.spec)}</div>` : ""}
    ${mySpecs.length ? `<div class="specs">${mySpecs.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${f.link ? "공식 자료" : "시방서 보기"} · ${esc(f.name)}</a>`).join("")}</div>` : ""}
    ${s.dims ? `<div><div class="lbl">실제로 잰 설치 공간 (mm)</div><div class="dims">${[["w", "폭"], ["h", "높이"], ["d", "깊이"]].map(([k, l]) => `<label>${l}<input inputmode="numeric" data-dim="${esc(s.key)}" data-dk="${k}" value="${esc(d[k] || "")}" aria-label="${esc(s.title)} ${l}"></label>`).join("")}</div></div>` : ""}
    ${s.items.map(itemHtml).join("")}
    ${s.photo ? photosHtml(s) : ""}</section>`;
}
function renderSecs() { $("secs").innerHTML = CL.sections(job).map(sectionHtml).join(""); }
function rerenderPhotos(key) {
  const el = document.querySelector(`[data-photos="${CSS.escape(key)}"]`);
  const s = CL.sections(job).find((x) => x.key === key);
  if (el && s) el.outerHTML = photosHtml(s);
}
function progress() {
  const s = CL.summary(job, data);
  $("prog").textContent = `${s.done}/${s.total} 항목 확인${s.bad.length ? ` · 문제 ${s.bad.length}` : ""}`;
  return s;
}

/* ---------- 저장: 손을 멈추면 1초 뒤 자동 저장, 휴대폰에도 같이 보관 ---------- */
const LKEY = `nest-cl-${TOKEN}`;
function keepLocal() { try { localStorage.setItem(LKEY, JSON.stringify({ at: Date.now(), data })); } catch (e) {} }
function queueSave() { dirty = true; keepLocal(); progress(); $("saved").textContent = "저장 중…"; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1000); }
async function save() {
  if (saving) { saveTimer = setTimeout(save, 600); return; }
  if (!dirty || submitted) return;
  saving = true; dirty = false;
  try { await call({ action: "cl_save", data }); $("saved").textContent = "자동 저장됨"; if (!dirty) try { localStorage.removeItem(LKEY); } catch (e) {} }
  catch (e) {
    if (e.kind === "submitted") { location.reload(); return; }
    dirty = true; $("saved").textContent = "저장 못 함 · 인터넷 확인";
  } finally { saving = false; }
}

/* ---------- 사진: 줄여서(긴 변 2000px) 올리고 작은 미리보기도 함께 ---------- */
function loadImg(file) { return new Promise((res, rej) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; i.src = u; }); }
function toJpeg(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", q));
}
async function addPhoto(key, file) {
  const id = Math.random().toString(36).slice(2), preview = URL.createObjectURL(file);
  busy.set(id, { key, preview }); rerenderPhotos(key);
  try {
    const img = await loadImg(file);
    const [big, small] = [await toJpeg(img, 2000, 0.82), await toJpeg(img, 480, 0.72)];
    if (!big) throw new Error("decode");
    const up = await call({ action: "cl_upload" });
    const st = sb.storage.from("job-files");
    const { error: e1 } = await st.uploadToSignedUrl(up.path, up.token, big, { contentType: "image/jpeg" });
    if (e1) throw e1;
    let thumb = "";
    if (small) { const { error: e2 } = await st.uploadToSignedUrl(up.thumb, up.thumbToken, small, { contentType: "image/jpeg" }); if (!e2) thumb = up.thumb; }
    const sec = CL.sections(job).find((x) => x.key === key);
    const reg = await call({ action: "cl_photo", path: up.path, thumb, size: big.size, name: `체크리스트-${sec ? sec.title : "사진"}.jpg`, by: $("name").value.trim() });
    urls[up.path] = reg.url || preview;
    data.photos.push({ key, path: up.path, thumb });
    queueSave();
  } catch (e) {
    showErr(e.kind === "submitted" ? "이미 제출된 체크리스트예요." : "사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 올려 주세요.");
  } finally { busy.delete(id); rerenderPhotos(key); }
}
async function delPhoto(path, btn) {
  btn.disabled = true;
  try { await call({ action: "cl_remove", path }); data.photos = data.photos.filter((p) => p.path !== path); queueSave(); }
  catch (e) { btn.disabled = false; showErr("사진을 빼지 못했어요. 다시 눌러 주세요."); return; }
  CL.sections(job).forEach((s) => s.photo && rerenderPhotos(s.key));
}
function showErr(t) { $("err").textContent = t; $("err").hidden = !t; if (t) $("err").scrollIntoView({ block: "center", behavior: "smooth" }); }

/* ---------- 입력 ---------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (b) {
    const k = b.dataset.k, v = b.dataset.v, r = data.items[k] || {};
    data.items[k] = { ...r, v };
    const item = b.closest(".item");
    item.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v));
    item.classList.remove("need");
    const note = item.querySelector("[data-note]");
    note.hidden = v !== "bad" && !note.value; note.placeholder = v === "bad" ? "무엇이 문제인지 적어 주세요 (꼭)" : "메모 (선택)";
    note.classList.toggle("need", v === "bad" && !note.value.trim());
    if (v === "bad" && !note.value) note.focus();
    queueSave(); return;
  }
  const d = e.target.closest("[data-del]");
  if (d) { if (d.dataset.armed !== "1") { d.dataset.armed = "1"; d.textContent = "정말 빼기"; setTimeout(() => { if (d.isConnected) { d.dataset.armed = ""; d.textContent = "빼기"; } }, 4000); return; } delPhoto(d.dataset.del, d); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.note) { const k = t.dataset.note; data.items[k] = { ...(data.items[k] || {}), note: t.value }; t.classList.remove("need"); queueSave(); }
  else if (t.dataset.dim) { const v = t.value.replace(/[^\d.]/g, ""); if (v !== t.value) t.value = v; data.dims[t.dataset.dim] = { ...(data.dims[t.dataset.dim] || {}), [t.dataset.dk]: v }; queueSave(); }
  else if (t.id === "memo") { data.memo = t.value; queueSave(); }
  else if (t.id === "name") { data.name = t.value; try { localStorage.setItem("nest-cl-name", t.value); } catch (e2) {} queueSave(); }
});
document.addEventListener("change", (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.up) return;
  const list = [...t.files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)); t.value = ""; showErr("");
  list.reduce((p, f) => p.then(() => addPhoto(t.dataset.up, f)), Promise.resolve());
});
window.addEventListener("pagehide", () => { if (dirty) save(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && dirty) save(); });

/* ---------- 제출 ---------- */
$("submit").onclick = async () => {
  showErr("");
  const s = progress(), name = $("name").value.trim();
  document.querySelectorAll(".item.need,.photos.need,[data-note].need,#name.need").forEach((x) => x.classList.remove("need"));
  s.missing.forEach((m) => { const el = document.querySelector(`[data-item="${CSS.escape(m.key)}"]`); if (el) el.classList.add("need"); });
  s.badNote.forEach((m) => { const el = document.querySelector(`[data-note="${CSS.escape(m.key)}"]`); if (el) { el.hidden = false; el.classList.add("need"); } });
  s.noPhoto.forEach((m) => { const el = document.querySelector(`[data-photos="${CSS.escape(m.key)}"]`); if (el) el.classList.add("need"); });
  if (!name) $("name").classList.add("need");
  if (busy.size) { showErr("사진이 아직 올라가는 중이에요. 다 올라간 뒤 제출해 주세요."); return; }
  const first = document.querySelector(".item.need,[data-note].need,.photos.need") || (!name ? $("name") : null);
  if (first) {
    const why = [s.missing.length && `안 고른 항목 ${s.missing.length}개`, s.badNote.length && `문제 내용을 안 적은 항목 ${s.badNote.length}개`, s.noPhoto.length && `사진이 없는 곳 ${s.noPhoto.length}곳`, !name && "작성자 이름"].filter(Boolean).join(", ");
    $("err").textContent = `아직 제출할 수 없어요: ${why}. 빨갛게 표시된 곳을 채워 주세요.`; $("err").hidden = false;
    first.scrollIntoView({ block: "center", behavior: "smooth" }); return;
  }
  const btn = $("submit"); btn.disabled = true; btn.textContent = "제출하는 중…"; clearTimeout(saveTimer);
  data.name = name;
  try {
    await call({ action: "cl_save", data, submit: true, name, summary: { badCount: s.bad.length, bad: s.bad.map((b) => `${b.sec.split(" · ")[0]}: ${b.note || b.label}`) } });
    submitted = true; dirty = false; try { localStorage.removeItem(LKEY); } catch (e) {}
    showDone(name, new Date().toISOString(), true);
  } catch (e) {
    if (e.kind === "submitted") { location.reload(); return; }
    btn.disabled = false; btn.textContent = "제출하기"; showErr("제출하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");
  }
};
function showDone(by, at, fresh) {
  const s = CL.summary(job, data), d = at ? new Date(at) : null;
  $("main").hidden = true; $("bar").hidden = true; $("state").hidden = true; $("state").textContent = ""; $("done").hidden = false;
  $("done").innerHTML = `<section class="card job"><h1>${esc(job.name)}</h1><div class="meta"><span>${fresh ? "제출했어요. 수고하셨어요!" : "이미 제출된 체크리스트예요."}</span>${d ? `<span>${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${by ? ` · ${esc(by)}` : ""}</span>` : ""}</div></section>
    ${s.bad.length ? `<section class="card"><h2>문제로 적은 항목 ${s.bad.length}개</h2><ul class="done-list">${s.bad.map((b) => `<li><span class="tag bad">문제</span><span><b>${esc(b.sec)}</b> · ${esc(b.label)}<br>${esc(b.note)}</span></li>`).join("")}</ul></section>` : `<section class="card"><h2>문제 없음</h2><p class="intro">모든 항목을 확인했어요.</p></section>`}
    <p class="intro">고칠 내용이 있으면 사무실에 다시 열어 달라고 말해 주세요.</p>`;
  window.scrollTo(0, 0);
}

/* ---------- 시방서 보관함(specs.json): 모델명으로 찾아 둔 종류·치수·공식 링크를 붙임 ---------- */
async function loadSpecs() {
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000);
    const res = await fetch("specs.json", { cache: "no-cache", signal: ac.signal }); clearTimeout(t);
    const lib = res.ok ? ((await res.json()) || {}).models || {} : {};
    CL.useLib((k) => lib[k] || null);
    (job.i.apps || []).forEach((a) => {
      const l = lib[CL.modelKey(a.model)];
      if (!l || l.found === false) return;
      (Array.isArray(l.links) ? l.links : []).filter((x) => x && /^https:\/\//.test(x.url || "")).slice(0, 4)
        .forEach((x) => specs.push({ app: a.id, name: x.title || "공식 자료", url: x.url, link: true }));
    });
  } catch (e) {}
}

/* ---------- 시작 ---------- */
(async function start() {
  if (!TOKEN) { fail("링크가 올바르지 않아요", "사무실에서 받은 링크를 다시 눌러 주세요."); return; }
  let r;
  try { r = await call({ action: "cl_open" }); }
  catch (e) {
    if (e.kind === "gone") fail("링크를 찾을 수 없어요", "링크가 바뀌었거나 현장이 지워졌어요. 사무실에 새 링크를 받아 주세요.");
    else fail("체크리스트를 열지 못했어요", "인터넷 연결을 확인하고 잠시 후 다시 열어 주세요.");
    return;
  }
  job = r.job; specs = r.specs || []; urls = r.urls || {};
  await loadSpecs();
  const d = r.data || {};
  data = { items: d.items || {}, dims: d.dims || {}, photos: Array.isArray(d.photos) ? d.photos : [], memo: d.memo || "", name: d.name || "" };
  document.title = `시공 체크리스트 · ${job.name}`;
  if (r.status === "submitted") { submitted = true; showDone(r.submitted_by, r.submitted_at, false); return; }
  // 서버에 못 올라간 입력이 휴대폰에 남아 있으면 이어서
  try {
    const loc = JSON.parse(localStorage.getItem(LKEY) || "null");
    if (loc && loc.data && loc.data.items) {
      const ld = loc.data;
      data.items = { ...data.items, ...ld.items }; data.dims = { ...data.dims, ...(ld.dims || {}) };
      if (ld.memo && !data.memo) data.memo = ld.memo;
      if (ld.name && !data.name) data.name = ld.name;
      dirty = JSON.stringify(ld.items) !== JSON.stringify(d.items || {});
    }
  } catch (e) {}
  if (!data.name) try { data.name = localStorage.getItem("nest-cl-name") || ""; } catch (e) {}
  renderJob(); renderSecs();
  $("memo").value = data.memo; $("name").value = data.name;
  $("state").hidden = true; $("state").textContent = ""; $("main").hidden = false; $("bar").hidden = false;
  progress(); $("saved").textContent = data.photos.length || Object.keys(data.items).length ? "이어서 작성해요" : "";
  if (dirty) queueSave();
})();
