// @ts-nocheck
// 네스트퍼니처 알림 보내기 (Supabase Edge Function, 이름: notify)
// - 매일 아침/저녁 정해진 시간에 Supabase Cron이 불러서 휴대폰으로 일정 알림을 보냅니다.
// - 앱이 알림용 공개키를 받아갈 때, 사용자가 "테스트 알림"을 누를 때도 불립니다.
// - 시공자 체크리스트 화면(check.html)도 이 서버를 거쳐 현장 정보를 읽고, 사진을 올리고, 제출합니다.
// - 가전 모델명으로 제조사 공식 홈페이지에서 시방서를 찾아 보관함에 저장합니다 (Secrets에 ANTHROPIC_API_KEY가 있을 때만).
// 웹 푸시(VAPID + aes128gcm 암호화)를 외부 라이브러리 없이 직접 처리합니다. 알림용 키는 처음 실행할 때 만들어 DB(push_keys)에 보관합니다.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
const APP_URL = "https://nestfurniture.github.io/nest-schedule/";
const WD = "일월화수목금토";

function firstKey(v) { try { const o = JSON.parse(v || "{}"); return Object.values(o)[0] || ""; } catch { return ""; } }
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rest(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* ---------- 날짜 (한국 시간) ---------- */
const pad = (n) => String(n).padStart(2, "0");
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}(${WD[dow(d)]})`;
function workDays(j) {
  const out = [], i = j.i || {};
  if (!i.start) return out;
  const end = i.end && i.end >= i.start ? i.end : i.start;
  for (let d = i.start, n = 0; d <= end && n < 370; d = addDays(d, 1), n++) {
    const w = dow(d);
    if ((w === 6 && !i.sat) || (w === 0 && !i.sun)) continue;
    out.push(d);
  }
  // '쉬는 날'로 뺀 날은 작업일이 아님
  const off = Array.isArray(i.off) ? i.off : [];
  return off.length ? out.filter((d) => !off.includes(d)) : out;
}
// 그날 들어가는 시공자: 날짜별로 따로 정했으면 그 사람들, 아니면 기본 시공자
const crewOn = (j, d) => { const x = j.i?.days?.[d]; return Array.isArray(x) ? x : (j.i?.crew || []); };
const crewAll = (j) => { const wd = workDays(j); return wd.length ? [...new Set(wd.flatMap((d) => crewOn(j, d)))] : (j.i?.crew || []); };
const short = (j) => String(j.name || "").replace(" 고객", "");
const man = (n) => n >= 10000 ? `${Math.round(n / 10000).toLocaleString("ko-KR")}만원` : `${n.toLocaleString("ko-KR")}원`;

/* ---------- 알림 내용 ---------- */
function dayLines(jobs, d) {
  const lines = [];
  const ins = jobs.filter((j) => workDays(j).includes(d));
  if (ins.length) lines.push(`시공 ${ins.length}곳: ${ins.map((j) => `${short(j)}(${crewOn(j, d).join("·") || "미배정"})`).join(", ")}`);
  const ms = jobs.filter((j) => j.m?.date === d);
  if (ms.length) lines.push(`실측: ${ms.map(short).join(", ")}`);
  const as = jobs.flatMap((j) => (j.f?.as || []).filter((a) => a.date === d && !a.done).map((a) => `${short(j)}(${a.crew || "담당 미정"})`));
  if (as.length) lines.push(`AS: ${as.join(", ")}`);
  return lines;
}
function unassigned(jobs, today) {
  // 7일 안에 시공자가 안 정해진 작업일이 있는 현장 (날짜별로 따로 정한 날도 봄)
  const first = (j) => workDays(j).find((d) => d >= today && d <= addDays(today, 7) && !crewOn(j, d).length);
  const soon = jobs.filter((j) => !j.f?.done && !j.f?.closed && first(j));
  return soon.length ? `시공자 미배정 ${soon.length}곳: ${soon.map((j) => `${short(j)} ${md(first(j))}`).join(", ")}` : "";
}
function moneyLines(money, today) {
  let dueN = 0, dueAmt = 0, lateN = 0, lateAmt = 0;
  for (const row of money) for (const p of row.data?.pays || []) {
    if (p.paid || !p.due) continue;
    if (p.due === today) { dueN++; dueAmt += +p.amount || 0; }
    else if (p.due < today) { lateN++; lateAmt += +p.amount || 0; }
  }
  const lines = [];
  if (dueN) lines.push(`오늘 받을 돈 ${dueN}건 ${man(dueAmt)}`);
  if (lateN) lines.push(`입금 지연 ${lateN}건 ${man(lateAmt)}`);
  return lines;
}
/* 시공이 끝났는데(최근 7일) 체크리스트가 안 온 현장. 업데이트 4 전이면(cls=null) 건너뜀 */
function noChecklist(jobs, cls, today) {
  if (!cls) return "";
  const done = new Set(cls.filter((c) => c.status === "submitted").map((c) => c.job_id));
  const late = jobs.filter((j) => { const wd = workDays(j), last = wd[wd.length - 1]; return !j.f?.closed && last && last < today && last >= addDays(today, -7) && !done.has(j.id); });
  return late.length ? `체크리스트 안 온 곳 ${late.length}곳: ${late.map((j) => { const wd = workDays(j); return `${short(j)} ${md(wd[wd.length - 1])}`; }).join(", ")}` : "";
}
/* slot: evening = 내일 일정, morning = 오늘 일정 + 미배정 경고 + 체크리스트 미제출 (+ 관리자에게 입금) */
function buildMessages(slot, jobs, money, today, cls = null) {
  const out = [];
  if (slot === "evening") {
    const d = addDays(today, 1), lines = dayLines(jobs, d);
    if (lines.length) out.push({ pref: "tomorrow", title: `내일 일정 · ${md(d)}`, body: lines.join("\n"), url: `${APP_URL}?day=${d}`, tag: `tomorrow-${d}` });
  } else {
    const lines = dayLines(jobs, today), warn = unassigned(jobs, today), cl = noChecklist(jobs, cls, today);
    if (warn) lines.push(warn);
    if (cl) lines.push(cl);
    if (lines.length) out.push({ pref: "today", title: `오늘 일정 · ${md(today)}`, body: lines.join("\n"), url: `${APP_URL}?day=${today}`, tag: `today-${today}` });
    const ml = moneyLines(money, today);
    if (ml.length) out.push({ pref: "money", admin: true, title: "입금 확인", body: ml.join("\n"), url: `${APP_URL}?tab=pay`, tag: `money-${today}` });
  }
  return out;
}

/* ---------- 웹 푸시 ---------- */
const enc = new TextEncoder();
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
let vapidCache = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let rows = await rest("push_keys?id=eq.1&select=*");
  if (!rows.length) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    await rest("push_keys", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ id: 1, public_key: b64u(pub), private_jwk: jwk }) });
    rows = await rest("push_keys?id=eq.1&select=*");
  }
  const key = await crypto.subtle.importKey("jwk", rows[0].private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapidCache = { pub: rows[0].public_key, key };
  return vapidCache;
}
async function vapidHeader(endpoint, v) {
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(`${h}.${p}`));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${v.pub}`;
}
/* RFC 8291 (aes128gcm) */
async function encrypt(sub, text) {
  const ua = fromB64u(sub.p256dh), auth = fromB64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hmac(await hmac(auth, secret), cat(enc.encode("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, ct);
}
async function push(sub, msg, v) {
  try {
    const body = await encrypt(sub, JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag }));
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: { TTL: "43200", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: await vapidHeader(sub.endpoint, v) },
      body,
    });
    if (r.status === 404 || r.status === 410) await rest(`push_subs?id=eq.${sub.id}`, { method: "DELETE" }); // 앱을 지웠거나 알림을 끈 기기
    return r.status;
  } catch (e) {
    console.error("push failed", e);
    return 0;
  }
}

/* ---------- 보내기 ---------- */
async function loadData() {
  const [jobs, admins, money, cls] = await Promise.all([rest("jobs?select=*"), rest("admins?select=user_id").catch(() => []), rest("job_money?select=*").catch(() => []),
    rest("checklists?select=job_id,status").catch(() => null)]);
  return { jobs, admins: new Set(admins.map((a) => a.user_id)), money, cls };
}
async function sendTo(subs, msgs, admins, v) {
  let sent = 0;
  await Promise.all(subs.flatMap((s) => msgs
    .filter((m) => (!m.admin || admins.has(s.user_id)) && (s.prefs || {})[m.pref] !== false)
    .map(async (m) => { if ((await push(s, m, v)) < 300) sent++; })));
  return sent;
}
/* 정해진 시간대에만 보냄: 아침 5~12시, 저녁 3~11시 (한국 시간). 엉뚱한 시간에 불려도 안 보냄 */
const WINDOW = { morning: [5, 12], evening: [15, 23] };
const kstHour = () => (new Date(Date.now()).getUTCHours() + 9) % 24;
async function run(slot) {
  const today = kstToday();
  const h = kstHour(), [from, to] = WINDOW[slot];
  if (h < from || h > to) return { skipped: "not now", slot, hour: h };
  // 같은 날 같은 알림이 두 번 가지 않게 기록 (이미 있으면 건너뜀)
  const logged = await rest("push_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ slot, day: today }) });
  if (!logged || !logged.length) return { skipped: "already sent", slot, today };
  const [{ jobs, admins, money, cls }, subs, v] = await Promise.all([loadData(), rest("push_subs?select=*"), vapid()]);
  const msgs = buildMessages(slot, jobs, money, today, cls);
  const sent = msgs.length ? await sendTo(subs, msgs, admins, v) : 0;
  await rest(`push_log?slot=eq.${slot}&day=eq.${today}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sent }) });
  return { slot, today, messages: msgs.length, sent };
}
async function userOf(req) {
  const auth = req.headers.get("Authorization") || "";
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
/* 테스트: 누른 사람의 기기에만 오늘/내일 일정을 지금 보내 봄 */
async function test(req) {
  const user = await userOf(req);
  if (!user) return json({ error: "login required" }, 401);
  const [{ jobs, admins, money, cls }, subs, v] = await Promise.all([loadData(), rest(`push_subs?user_id=eq.${user.id}&select=*`), vapid()]);
  if (!subs.length) return json({ sent: 0, error: "no device" });
  const today = kstToday();
  let msgs = [...buildMessages("morning", jobs, money, today, cls), ...buildMessages("evening", jobs, money, today)].map((m) => ({ ...m, pref: "_test" }));
  if (!msgs.length) msgs = [{ pref: "_test", title: "네스트퍼니처 알림", body: "알림이 잘 연결됐어요. 오늘과 내일은 잡힌 일정이 없어요.", url: APP_URL, tag: "test" }];
  return json({ sent: await sendTo(subs, msgs, admins, v) });
}

/* ---------- 시공 체크리스트: 시공자는 로그인 없이 링크 속 열쇠(token)로만 들어옴 ---------- */
const BUCKET = "job-files";
const okToken = (t) => typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t);
async function clByToken(token) {
  if (!okToken(token)) return null;
  const rows = await rest(`checklists?token=eq.${token}&select=*`);
  return rows[0] || null;
}
const storage = (path, init = {}) => fetch(`${SB_URL}/storage/v1/${path}`, {
  ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
});
async function signPaths(paths) {
  paths = [...new Set(paths.filter(Boolean))];
  if (!paths.length) return {};
  const r = await storage(`object/sign/${BUCKET}`, { method: "POST", body: JSON.stringify({ expiresIn: 6 * 3600, paths }) });
  if (!r.ok) return {};
  const out = {};
  for (const x of await r.json()) if (x && x.signedURL) out[x.path] = `${SB_URL}/storage/v1${x.signedURL}`;
  return out;
}
// 시방서 보관함(app_specs): 모델명은 대문자로, 띄어쓰기·하이픈 등은 빼고 비교 (앱의 checklist.js와 같은 규칙)
const modelKey = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
// 붙여서 설치하는 가전 묶음의 열쇠: 모델 열쇠를 정렬해 + 로 이음 (예: M623GBB042+Z322GB3S)
const comboKey = (models) => models.map(modelKey).filter(Boolean).sort().join("+");
const okKey = (k) => typeof k === "string" && /^[0-9A-Z가-힣]{3,60}(\+[0-9A-Z가-힣]{3,60}){0,5}$/.test(k);
const inList = (keys) => encodeURIComponent(`in.(${keys.map((k) => `"${k}"`).join(",")})`);
// 보관함의 모델별 줄 (찾는 중·못 찾음 포함). update-06 전이어도 되게 * 로 읽음
async function libRows(keys) {
  keys = [...new Set(keys.filter(okKey))];
  if (!keys.length) return {};
  const rows = await rest(`app_specs?select=*&model_key=${inList(keys)}`).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.model_key, r]));
}
const foundOnly = (rows) => Object.fromEntries(Object.entries(rows).filter(([, r]) => r.status === "found"));
// 냉장고·김치냉장고·와인셀러는 기본으로 '붙여서 설치' 묶음. 앱에서 체크를 끄면(join:false) 빠지고, 다른 가전도 체크하면(join:true) 들어감
const FRIDGE = new Set(["fridge", "kimchi", "wine"]);
const typeOf = (a, lib) => (TYPE_CODES[a.type] ? a.type : (lib[modelKey(a.model)] || {}).type || "");
function comboOf(apps, lib) {
  const members = apps.filter((a) => modelKey(a.model).length >= 3 && (a.join === true || (a.join !== false && FRIDGE.has(typeOf(a, lib)))));
  return members.length >= 2 ? { key: comboKey(members.map((a) => a.model)), members } : null;
}
const okUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" && !!x.hostname; } catch { return false; } };
const libList = (row, k) => (Array.isArray(row?.[k]) ? row[k] : []).filter((l) => l && okUrl(l.url)).slice(0, 4);
const LIB_PDF = /^lib\/spec\/\d{10,16}-[a-z0-9]{1,8}\.pdf$/, LIB_IMG = /^lib\/spec\/\d{10,16}-[a-z0-9]{1,8}\.(jpg|png|webp|gif)$/;
const libFiles = (row) => (Array.isArray(row?.files) ? row.files : []).filter((f) => f && typeof f.path === "string" && LIB_PDF.test(f.path)).slice(0, 2);
// 보관함에 옮겨 둔 치수도 그림 (제조사 그림 + 설명서에서 캡처한 쪽)
const libImgs = (row) => (Array.isArray(row?.images) ? row.images : []).filter((x) => x && typeof x.path === "string" && LIB_IMG.test(x.path)).slice(0, 10);
// 공식 자료가 아니면 출처를 함께 보여 줌 (시공자가 현장 실측으로 한 번 더 확인하게)
const srcOf = (row) => (row && row.official === false ? String(row.source || "공식 자료 아님").slice(0, 80) : "");
// 시공자 화면에 보낼 현장 정보 (비밀번호·돈은 빼고). 종류·확인 치수를 비워 둔 가전은 보관함 값으로
const jobPublic = (j, lib = {}, combo = null) => ({ id: j.id, name: j.name, item: j.item, addr: j.addr,
  i: { start: j.i?.start || "", end: j.i?.end || "", sat: !!j.i?.sat, sun: !!j.i?.sun, crew: crewAll(j), off: Array.isArray(j.i?.off) ? j.i.off : [], chk: j.i?.chk || [],
    apps: (j.i?.apps || []).map((a) => { const l = lib[modelKey(a.model)] || {};
      return { id: a.id, type: a.type || l.type || "", model: a.model || "", spec: a.spec || l.spec || "", src: a.spec ? "" : srcOf(l), ...(typeof a.join === "boolean" ? { join: a.join } : {}) }; }),
    comboSpec: combo?.spec || "", comboSrc: srcOf(combo) } });
const photoPrefix = (cl) => `${cl.job_id}/photo/cl-`;
// 체크리스트 사진은 이 현장의 cl-숫자-글자(.jpg / -t.jpg) 이름만 허용 (다른 파일 주소를 끼워 넣지 못하게)
const okPhotoPath = (cl, p) => typeof p === "string" && p.startsWith(photoPrefix(cl)) && /^cl-\d{10,16}-[a-z0-9]{1,8}(-t)?\.jpg$/.test(p.slice(photoPrefix(cl).length - 3));
const okPhoto = (cl, x) => x && typeof x === "object" && okPhotoPath(cl, x.path) && (!x.thumb || okPhotoPath(cl, x.thumb));
const plainObj = (o) => o && typeof o === "object" && !Array.isArray(o) ? o : {};
async function clOpen(b) {
  const cl = await clByToken(b.token);
  if (!cl) return json({ error: "not found" }, 404);
  const [jobs, specs] = await Promise.all([rest(`jobs?id=eq.${cl.job_id}&select=*`), rest(`files?job_id=eq.${cl.job_id}&kind=eq.spec&select=name,path,stage,mime`)]);
  if (!jobs.length) return json({ error: "not found" }, 404);
  const photos = (Array.isArray(cl.data?.photos) ? cl.data.photos : []).filter((p) => okPhoto(cl, p));
  const apps = jobs[0].i?.apps || [], lib = foundOnly(await libRows(apps.map((a) => modelKey(a.model))));
  const c = comboOf(apps, lib), combo = c ? foundOnly(await libRows([c.key]))[c.key] || null : null;
  // 가전마다(+ 붙여서 설치하는 묶음): 보관함에 저장해 둔 공식 PDF + 이 현장에만 올린 파일 + 링크 + 치수도 그림
  const srcs = [...apps.map((a) => [a.id, lib[modelKey(a.model)]]), ["combo", combo]].filter(([, r]) => r);
  const files = [...srcs.flatMap(([id, r]) => libImgs(r).map((x) => ({ app: id, name: String(x.title || "치수도").slice(0, 40), path: x.path, img: true }))),
    ...srcs.flatMap(([id, r]) => libFiles(r).map((f) => ({ app: id, name: f.name || "시방서", path: f.path }))),
    ...specs.map((f) => ({ app: f.stage, name: f.name, path: f.path }))];
  const urls = await signPaths([...files.map((f) => f.path), ...photos.map((p) => p.thumb || p.path)]);
  const extra = srcs.flatMap(([id, r]) => [
    ...libList(r, "links").map((l) => ({ app: id, name: String(l.title || (r.official === false ? "참고 자료" : "공식 홈페이지")).slice(0, 60), url: l.url, link: true, ...(r.official === false ? { ref: true } : {}) })),
    // 그림을 보관함에 옮겨 뒀으면 그것만, 아직이면 원래 주소로
    ...(libImgs(r).length ? [] : libList(r, "images").filter((l) => !l.skip)).map((l) => ({ app: id, name: String(l.title || "치수도").slice(0, 60), url: l.url, img: true })),
  ]);
  return json({
    job: jobPublic(jobs[0], lib, combo), status: cl.status, data: { ...(cl.data || {}), photos }, submitted_at: cl.submitted_at, submitted_by: cl.submitted_by,
    specs: [...files.map((f) => ({ app: f.app, name: f.name, url: urls[f.path] || "", ...(f.img ? { img: true } : {}) })), ...extra],
    urls: Object.fromEntries(photos.map((p) => [p.path, urls[p.thumb || p.path] || ""])),
  });
}
/* 고객용 견적서(est.html?t=열쇠): 읽기만. 고객이 열면 횟수·시간을 남김 (회사 앱에 로그인된 기기에서 연 것은 빼고) */
/* 고객용 견적서. 견적서에 적힌 것은 그대로 넘기고(견적서 칸이 늘어도 여기를 안 고쳐도 되게) 회사 안에서만 쓰는 값
   (묶음 id, 보낸 시각, 고객 연락처)만 뺌. 회사 정보는 견적서에 찍히는 것만. api 2 = 엑셀 양식 견적서 */
async function estOpen(b) {
  if (!okToken(b.token)) return json({ error: "not found", api: 2 }, 404);
  const rows = await rest(`estimates?token=eq.${b.token}&select=id,data,views,first_seen`);
  const e = rows[0];
  if (!e) return json({ error: "not found", api: 2 }, 404);
  let c = {};
  try { c = (await rest("est_conf?key=eq.company&select=data"))[0]?.data || {}; } catch (_) { /* 회사 정보를 아직 안 넣음 */ }
  const company = Object.fromEntries(["name", "en", "tag", "ceo", "bizNo", "addr", "tel", "email", "web", "bank", "stamp"].filter((k) => typeof c[k] === "string").map((k) => [k, c[k]]));
  if (!b.staff) {
    const t = new Date().toISOString();
    await rest(`estimates?id=eq.${e.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ views: (+e.views || 0) + 1, seen_at: t, first_seen: e.first_seen || t }) }).catch((x) => console.error(x));
  }
  const { base: _b, sentAt: _s, cust: rawCust, ...est } = e.data || {};
  const { phone: _ph, ...cust } = rawCust && typeof rawCust === "object" ? rawCust : {};
  return json({ api: 2, est: { ...est, cust }, company });
}
async function clOpenOnly(b) {
  const cl = await clByToken(b.token);
  if (!cl) return [null, json({ error: "not found" }, 404)];
  if (cl.status === "submitted") return [null, json({ error: "submitted" }, 409)];
  return [cl, null];
}
async function clUpload(b) {
  const [cl, bad] = await clOpenOnly(b);
  if (bad) return bad;
  const base = `${photoPrefix(cl)}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sign = async (p) => {
    const r = await storage(`object/upload/sign/${BUCKET}/${p}`, { method: "POST" });
    if (!r.ok) throw new Error(`upload sign ${r.status} ${await r.text()}`);
    return new URL(`${SB_URL}/storage/v1${(await r.json()).url}`).searchParams.get("token");
  };
  const [token, thumbToken] = await Promise.all([sign(`${base}.jpg`), sign(`${base}-t.jpg`)]);
  return json({ path: `${base}.jpg`, thumb: `${base}-t.jpg`, token, thumbToken });
}
async function clPhoto(b) {
  const [cl, bad] = await clOpenOnly(b);
  if (bad) return bad;
  const path = String(b.path || ""), thumb = String(b.thumb || "");
  if (!okPhotoPath(cl, path) || (thumb && !okPhotoPath(cl, thumb))) return json({ error: "bad path" }, 400);
  await rest("files", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
    job_id: cl.job_id, kind: "photo", stage: "시공 후", thumb, path, name: String(b.name || "체크리스트 사진.jpg").slice(0, 80),
    size: +b.size || 0, mime: "image/jpeg", uploaded_by: `체크리스트 · ${String(b.by || "시공자").slice(0, 30)}`,
  }) });
  const urls = await signPaths([thumb || path]);
  return json({ url: urls[thumb || path] || "" });
}
async function clRemove(b) {
  const [cl, bad] = await clOpenOnly(b);
  if (bad) return bad;
  const path = String(b.path || "");
  if (!okPhotoPath(cl, path)) return json({ error: "bad path" }, 400);
  const q = `files?job_id=eq.${cl.job_id}&path=eq.${encodeURIComponent(path)}`;
  const rows = await rest(`${q}&select=thumb`);
  await storage(`object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: [path, ...rows.map((r) => r.thumb)].filter(Boolean) }) });
  await rest(q, { method: "DELETE" });
  return json({ ok: true });
}
async function clSave(b) {
  const [cl, bad] = await clOpenOnly(b);
  if (bad) return bad;
  const raw = plainObj(b.data);
  if (JSON.stringify(raw).length > 200000) return json({ error: "too big" }, 413);
  // 시공자가 쓸 수 있는 칸만 저장 ('조치 완료' 같은 사무실 표시는 못 바꾸게)
  const data = { items: plainObj(raw.items), dims: plainObj(raw.dims), memo: String(raw.memo || "").slice(0, 4000), name: String(raw.name || "").slice(0, 30),
    photos: (Array.isArray(raw.photos) ? raw.photos : []).filter((p) => okPhoto(cl, p)).map((p) => ({ key: String(p.key || "").slice(0, 80), path: p.path, thumb: p.thumb || "" })) };
  const now = new Date().toISOString(), patch = { data, updated_at: now };
  const by = String(b.name || data.name || "").trim().slice(0, 30);
  if (b.submit) Object.assign(patch, { status: "submitted", submitted_at: now, submitted_by: by });
  await rest(`checklists?job_id=eq.${cl.job_id}&status=eq.open`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (b.submit) await clNotify(cl, b.summary || {}, by).catch((e) => console.error("checklist push", e));
  return json({ ok: true, status: b.submit ? "submitted" : "open" });
}
// 제출되면 알림을 켠 모든 기기로 (설정에서 '체크리스트 제출'을 끈 기기는 빼고)
async function clNotify(cl, sum, by) {
  const [jobs, subs, v] = await Promise.all([rest(`jobs?id=eq.${cl.job_id}&select=name`), rest("push_subs?select=*"), vapid()]);
  const bad = (Array.isArray(sum.bad) ? sum.bad : []).map((x) => String(x).slice(0, 80)).slice(0, 4);
  const n = Math.max(+sum.badCount || 0, bad.length);
  const body = (n ? `문제 ${n}건 · ${bad.join(" / ")}` : "문제 없음") + (by ? `\n작성 ${by}` : "");
  await sendTo(subs, [{ pref: "checklist", title: `체크리스트 제출 · ${jobs[0]?.name || "현장"}`, body: body.slice(0, 400), url: `${APP_URL}?job=${cl.job_id}`, tag: `cl-${cl.job_id}` }], new Set(), v);
}

/* ---------- 시방서 자동 찾기: 모델명(또는 붙여서 설치하는 모델 묶음)으로 시방서를 찾아 보관함(app_specs)에 저장 ----------
   Claude API(웹 검색·웹 읽기)를 씁니다. Supabase → Edge Functions → Secrets 에 ANTHROPIC_API_KEY 를 넣어야 켜져요.
   - 제조사 공식 자료를 먼저 찾고, 없으면 판매처·설명서 공유 사이트·같은 시리즈 모델까지 넓혀서라도 찾습니다 (공식이 아니면 출처 표시).
   - 서버 한 번 실행 시간(무료 요금제 150초)을 넘지 않게, 한 번에 2분 안쪽만 찾고 이어서 찾을 게 있으면 자기 자신을 다시 불러 계속합니다 (최대 3번).
   - 한 번 찾은 모델은 다시 찾지 않고, 24시간에 SPEC_DAY_CAP 개까지만 찾아서 비용이 갑자기 늘지 않게 막습니다. */
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("SPEC_MODEL") || "claude-opus-5-5";
const VISION_MODEL = Deno.env.get("SPEC_VISION_MODEL") || "claude-haiku-5-5"; // 모은 그림 중 설치 치수도만 고르는 데 씀 (싸고 빠름)
const SPEC_DAY_CAP = +(Deno.env.get("SPEC_DAY_CAP") || 30);
// 3 = 찾은 뒤 치수도 그림까지 보관함에 옮겨 둠 (찾기만 하고 그림 정리 전이면 2)
const FINDER_VER = 3, FOUND_VER = 2, ROUND_MS = +(Deno.env.get("SPEC_ROUND_MS") || 115e3), MAX_ROUNDS = 3, STALE_MS = 15 * 60e3;
const TYPE_CODES = { dish: "식기세척기", induction: "인덕션·전기레인지", fridge: "냉장고", kimchi: "김치냉장고", wine: "와인셀러", oven: "오븐·광파오븐",
  micro: "전자레인지", hood: "후드", water: "정수기", washer: "세탁기·건조기", styler: "스타일러·에어드레서·슈드레서", etc: "기타 가전" };
const SPEC_SYSTEM = `당신은 한국의 고급 빌트인 가구 회사(주방가구·붙박이장·신발장 제작)를 돕습니다. 가구 시공자가 빌트인 가전을 시방서대로 설치했는지 현장에서 확인할 수 있도록, 주어진 모델(또는 나란히 붙여 설치하는 모델 묶음)의 설치 시방서를 찾습니다. 가구 제작과 시공에 바로 쓰이므로 치수는 자료에 적힌 값만 씁니다.

자료를 찾는 순서 (앞 단계에서 충분하면 거기서 멈춤)
1. 제조사 한국 공식 사이트: 제품 페이지 스펙 표, 설치 가이드, 사용설명서·설치설명서 PDF (lge.co.kr, samsung.com/sec, downloadcenter.samsung.com, miele.co.kr, media.miele.com, bosch-home.co.kr, siemens-home.bsh-group.com, gaggenau.com, smeg, electrolux, fisherpaykel, liebherr 등)
2. 같은 제조사의 해외 공식 사이트·공식 설명서 저장소 (같은 모델의 지역 표기 포함)
3. 공식 자료가 없을 때만: 대형 판매처 상세페이지의 제조사 제공 사양표(롯데하이마트, 전자랜드, 다나와, 쿠팡, SSG, 11번가 등), 설명서 공유 사이트(manualslib 등), 치수가 분명한 설치 후기·블로그
4. 그래도 없으면: 같은 시리즈에서 색상·옵션 코드만 다른 모델의 자료 (note에 어떤 모델 기준인지 밝힘)
- 3·4단계 자료를 쓰면 official=false, source 에 출처를 짧게 적습니다 (예: "다나와 상품정보", "같은 시리즈 M623GBB041 공식 자료"). 1·2단계면 official=true, source 에 "LG전자 공식 홈페이지"처럼 적습니다.
- 어디에서도 치수를 하나도 못 찾았을 때만 found=false 입니다. 사람이 검색해서 나오는 모델은 반드시 찾아야 합니다.

읽는 법
- 제품 외형 치수와 설치 공간(니치·타공) 치수를 구분합니다. 가구 타공은 설치 공간 기준입니다.
- 그림 속 치수가 무엇을 가리키는지 확실하지 않으면 해석하지 말고 "도면 참조"라고 적습니다.
- 식기세척기: 걸레받이(하부장 받침) 높이의 기준값·허용 범위·깊이 조건·절단 필요 여부, 높이 조절 다리 범위.
- 도어부착형(완전 빌트인·패널 부착형): 전면 패널 높이 범위, 무게 범위(kg), 두께 제한.
- 공통: 이격거리(좌우·위·뒤), 통풍구, 도어 열림 공간, 전원·급배수 위치, 높이 조절 범위.
- 나란히 붙여 설치하는 묶음(냉장고·김치냉장고·냉동 컨버터블·와인셀러 등): 묶음 전체 설치 공간(폭·높이·깊이), 제품 사이 간격, 연결(페어링) 키트 모델명과 필요 여부, 좌우·위·뒤 이격, 문 열림 공간. LG 오브제컬렉션 냉장고 설치 가이드와 삼성 비스포크 냉장고 설명서에는 조합별 설치 공간 표가 있습니다. 묶음 자료가 없으면 각 모델의 시방서와 제조사가 정한 제품 사이 간격으로 계산하고 note에 "개별 시방서로 계산"이라고 밝힙니다.

찾는 요령
- 모델명은 웹 검색으로 먼저 찾습니다 (예: "LG전자 DUE6BGL2E 설치", "삼성전자 RF85C9101AP 설치 공간", "모델명 사양").
- LG전자: 제품 페이지 https://www.lge.co.kr/<카테고리>/<모델명 소문자> 는 스펙 표를 화면에서 나중에 불러와서 웹 읽기로는 치수가 안 보일 때가 많습니다. 그럴 땐 설치가이드 페이지(냉장고·김치냉장고·컨버터블: https://www.lge.co.kr/story/setup-guide/refrigerator-installation-guide, 식기세척기: https://www.lge.co.kr/story/user-guide/dishwashers-install-guide, 세탁기·건조기: https://www.lge.co.kr/story/setup-guide/washer-installation-guide)에서 모델명 앞 4자리(예: D646, M623, Z484)로 찾고, 검색 결과 요약과 판매처 사양표도 함께 봅니다. 외형 치수 그림 https://static.lge.co.kr/kr/images/spec/<모델명>.akor_2p.jpg, 냉장고 설치가이드 그림은 모델명 앞 4자리_01~04.png(앞·위·문 열림·옆), 2대 연결은 2set_<앞4자리>_<앞4자리>_01.png 같은 이름입니다.
- 삼성전자: 고객지원 https://www.samsung.com/sec/support/model/<모델명>/ 의 스펙과 downloadcenter.samsung.com 설명서 PDF('설치 공간 확인하기', '제품 및 설치 공간 치수' 쪽)
- 밀레: miele.co.kr 제품 페이지의 기술 데이터, media.miele.com 의 설치 도면·설명서. SCVi=완전 빌트인(도어부착형), SCi=세미 빌트인, SCU=언더카운터
- 웹 읽기(web_fetch)는 대화나 검색 결과에 나온 주소만 열 수 있습니다. 아래 사용자 메시지의 주소 후보는 열어 봐도 됩니다.

답
- 시공자는 글자보다 치수도 그림을 봅니다. 설치 공간·외형 치수가 그려진 그림 파일 주소(.png/.jpg)를 찾으면 images 에 꼭 넣고, 설명서 PDF는 치수 그림이 있는 쪽 번호를 pages 에 넣습니다 (예: [12, 16]).
- 마지막에 아래 JSON 하나만 씁니다(앞뒤 설명 없이).
{"found": true 또는 false, "official": true 또는 false, "source": "출처 한 줄", "brand": "제조사", "type": "종류 코드", "spec": "시공자가 볼 치수 요약. 한국어, mm, 한 줄에 한 항목, 최대 8줄 (예: 설치 공간 600×820~870×580 / 제품 598×815×567 / 걸레받이 높이 150 (121~150) / 도어 패널 높이 650~770, 무게 4~11kg)", "links": [{"title": "짧은 한국어 제목", "url": "https://...", "pdf": true 또는 false, "pages": [PDF에서 치수 그림이 있는 쪽 번호]}], "images": [{"title": "짧은 한국어 제목", "url": "https://... 치수도 그림 주소"}], "note": "확인 못 한 항목이나 주의할 점 한 줄"}
- 종류 코드: ${Object.entries(TYPE_CODES).map(([k, v]) => `${k}(${v})`).join(", ")}, 묶음이면 combo
- 설명서 PDF는 #page=N 을 붙여 치수 쪽으로 바로 열리게 합니다. links는 4개, images는 4개까지. 시방서를 실제로 확인한 주소를 links 맨 앞에 둡니다.`;
const SPEC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["found", "official", "source", "brand", "type", "spec", "links", "images", "note"],
  properties: {
    found: { type: "boolean" }, official: { type: "boolean" }, source: { type: "string" }, brand: { type: "string" },
    type: { type: "string", enum: [...Object.keys(TYPE_CODES), "combo", ""] }, spec: { type: "string" }, note: { type: "string" },
    links: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "pdf", "pages"], properties: { title: { type: "string" }, url: { type: "string" }, pdf: { type: "boolean" }, pages: { type: "array", items: { type: "integer" } } } } },
    images: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } },
  },
};
const WIDEN = "아직 치수를 찾지 못했어요. 여기서 멈추지 말고 범위를 넓혀 다시 찾아 주세요: 제조사 해외 공식 사이트·공식 설명서 PDF → 판매처 상세페이지(롯데하이마트, 전자랜드, 다나와, 쿠팡, SSG 등)의 제조사 제공 사양표 → 설명서 공유 사이트 → 치수가 분명한 설치 후기·블로그 → 같은 시리즈(색상·옵션 코드만 다른) 모델 자료. 공식이 아니면 official=false 와 source 에 출처를 적고, 마지막에 같은 JSON 하나만 답해 주세요.";
const SHORT = "\n\n(지난번에는 시간이 부족해서 끊겼어요. 이번에는 검색을 3번 이내로 하고, 찾은 자료로 바로 답해 주세요.)";

const wait = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); no(new Error("aborted")); }, { once: true });
});
async function claude(body, signal, fallback = true) {
  for (let i = 0; ; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      // 안전 분류기에 막히면 Anthropic이 권하는 다른 모델로 자동 재시도 (fallbacks: "default"). 그림 고르기(Haiku)는 이 기능이 없어서 끔
      headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(fallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
      body: JSON.stringify(fallback ? { fallbacks: "default", ...body } : body),
    });
    if (r.ok) return await r.json();
    const text = (await r.text()).slice(0, 300);
    // 한꺼번에 몰리거나(429) 잠깐 바쁠 때(5xx)는 기다렸다가 두 번까지 다시
    if (i < 2 && (r.status === 429 || r.status >= 500)) { await wait(Math.min(+(r.headers.get("retry-after") || 0) || 5 * (i + 1), 20) * 1000, signal); continue; }
    throw new Error(`claude ${r.status} ${text}`);
  }
}
const textOf = (res) => (res?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
function pickJson(t) {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(t.slice(a, b + 1)); return o && typeof o === "object" && "found" in o ? o : null; } catch { return null; }
}
// 사설 주소·IP 주소는 받지 않음 (https 공개 주소만)
function publicUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || x.username || x.password) return false;
    const h = x.hostname.toLowerCase();
    return h.includes(".") && !/^[\d.]+$/.test(h) && !h.includes(":") && !/(^|\.)(localhost|local|internal|supabase\.co)$/.test(h);
  } catch { return false; }
}
// 시방서 PDF는 보관함에 복사해 둠 (주소가 바뀌어도 볼 수 있게). PDF가 아니거나 20MB가 넘으면 링크만
async function savePdf(url, name, ms) {
  if (!publicUrl(url) || ms < 3e3) return null;
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), Math.min(20e3, ms));
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!r.ok || !publicUrl(r.url)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (!isPdf || buf.length > 20 * 1024 * 1024) return null;
    const path = `lib/spec/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
    const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", body: buf, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/pdf" },
    });
    if (!up.ok) return null;
    return { path, name: `${name.slice(0, 50)} 설명서.pdf`, mime: "application/pdf", size: buf.length };
  } catch { return null; } finally { clearTimeout(t); }
}
// 보관함 줄 고치기. update-06(official·source·ver 칸)을 아직 안 했으면 그 칸만 빼고 다시
async function patchSpec(key, body, filter = "") {
  const go = (b) => rest(`app_specs?model_key=eq.${encodeURIComponent(key)}${filter}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(b) });
  try { return await go(body); } catch (e) {
    if (!/official|source|"ver"|PGRST204/.test(String(e))) throw e;
    const { official, source, ver, ...rest06 } = body; return await go(rest06);
  }
}
const cleanList = (v, n) => (Array.isArray(v) ? v : []).filter((l) => l && publicUrl(l.url)).slice(0, n)
  .map((l) => ({ title: String(l.title || "").trim().slice(0, 60), url: String(l.url).slice(0, 500), ...(l.pdf !== undefined ? { pdf: !!l.pdf } : {}), ...(pagesOf(l).length ? { pages: pagesOf(l) } : {}) }));
// 설명서 PDF에서 치수 그림이 있는 쪽 (주소의 #page=N 과 pages 목록)
const pagesOf = (l) => [...new Set([...(Array.isArray(l?.pages) ? l.pages : []), +((String(l?.url || "").match(/#page=(\d{1,4})/) || [])[1] || 0)]
  .map((n) => Math.floor(+n)).filter((n) => n >= 1 && n <= 2000))].slice(0, 4);
const staleSearch = (r) => r.status === "searching" && Date.now() - new Date(r.searched_at || 0).getTime() > STALE_MS;
const nowIso = () => new Date().toISOString();

// 첫 질문: 모델 하나, 또는 붙여서 설치하는 묶음. 웹 읽기로 바로 열 수 있게 주소 후보도 함께
function askText(st) {
  const lines = [];
  if (st.combo) {
    lines.push("아래 가전들을 나란히 붙여(연결해) 빌트인으로 설치합니다. 이 묶음 그대로 설치할 때의 시방서를 찾아 주세요 (묶음 전체 설치 공간, 제품 사이 간격·연결 키트, 이격, 문 열림).");
    st.combo.forEach((m, i) => lines.push(`${i + 1}) ${m.model}${m.brand || m.type ? ` (${[m.brand, TYPE_CODES[m.type]].filter(Boolean).join(" ")})` : ""}${m.spec ? `\n   개별 시방서: ${m.spec.replace(/\n/g, " / ")}` : ""}`));
  } else {
    lines.push(`모델명: ${st.model}${st.type ? `\n종류: ${TYPE_CODES[st.type]}` : ""}`, "이 모델의 설치 시방서를 찾아 주세요.");
  }
  const models = st.combo ? st.combo.map((m) => m.model) : [st.model], types = st.combo ? st.combo.map((m) => m.type) : [st.type];
  const urls = [];
  const has = (...t) => types.some((x) => !x || t.includes(x));
  if (has("fridge", "kimchi", "wine")) urls.push("https://www.lge.co.kr/story/setup-guide/refrigerator-installation-guide");
  if (has("dish")) urls.push("https://www.lge.co.kr/story/user-guide/dishwashers-install-guide");
  if (has("washer", "styler")) urls.push("https://www.lge.co.kr/story/setup-guide/washer-installation-guide");
  const LG_CAT = { dish: "dishwashers", fridge: "refrigerators", kimchi: "kimchi-refrigerators", wine: "refrigerators" };
  models.forEach((m, i) => {
    const k = modelKey(m), cat = types[i] ? LG_CAT[types[i]] : "refrigerators";
    if (cat) urls.push(`https://www.lge.co.kr/${cat}/${k.toLowerCase()}`);
    urls.push(`https://www.samsung.com/sec/support/model/${k}/`);
  });
  lines.push("", "열어 볼 수 있는 주소 후보 (맞지 않으면 무시하고 검색으로 찾으세요):", ...urls.map((u) => `- ${u}`));
  return lines.join("\n") + (st.short ? SHORT : "");
}
const specTools = () => [
  { type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" } },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 40000 },
];
// 다음 차례는 새 실행(새 시간)으로: 자기 자신(notify)을 서비스 키로 다시 부름. 안 되면 여기서 그대로
const background = (p) => { if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p); else return p; };
async function relay(st) {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/notify`, { method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_step", st }) });
    if (r.ok) return true;
    console.error("spec relay", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("spec relay", String(e).slice(0, 200)); }
  return false;
}
async function begin(st) { if (!(await relay(st))) await background(step(st)); }
async function next(st) {
  if (await relay(st)) return;
  await patchSpec(st.key, { status: "error", note: "찾다가 멈췄어요. '다시 찾기'를 눌러 주세요.", ver: FINDER_VER, updated_at: nowIso() }).catch(() => {});
}
async function specStep(req, b) {
  if (!SERVICE || req.headers.get("Authorization") !== `Bearer ${SERVICE}`) return json({ error: "forbidden" }, 403);
  const st = plainObj(b.st);
  if (!okKey(st.key) || !Array.isArray(st.messages) && st.messages != null) return json({ error: "bad" }, 400);
  background(step(st));
  return json({ ok: true });
}
// 한 차례: Claude가 검색·읽기를 하고 답을 냄. 끊기면(시간·pause_turn) 다음 차례로, 못 찾았으면 범위를 넓혀 한 번 더
async function step(st) {
  st.round = (st.round || 0) + 1; st.deadline = Date.now() + ROUND_MS + 25e3; // 이 실행이 끝나야 할 때 (150초 안쪽)
  if (!st.messages) st.messages = [{ role: "user", content: [{ type: "text", text: askText(st) }] }];
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ROUND_MS);
  try {
    let res;
    try {
      res = await claude({ model: AI_MODEL, max_tokens: 16000, output_config: { effort: "medium" }, system: SPEC_SYSTEM, tools: specTools(), messages: st.messages }, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted || st.round >= MAX_ROUNDS) throw e;
      // 시간이 다 됨: 아직 첫 질문뿐이면 검색을 줄이라고 덧붙여서, 아니면 같은 대화 그대로 다음 실행에서 다시
      if (st.messages.length === 1 && !st.short) { st.short = true; st.messages[0].content[0].text += SHORT; }
      return await next(st);
    }
    if (res.stop_reason === "pause_turn") {
      st.messages.push({ role: "assistant", content: res.content });
      if (st.round < MAX_ROUNDS) return await next(st);
      return await finish(st, pickJson(textOf(res)));
    }
    if (res.stop_reason === "refusal") return await finish(st, null);
    st.messages.push({ role: "assistant", content: res.content });
    const text = textOf(res);
    let out = pickJson(text);
    if (!out && text.trim() && !ac.signal.aborted) {
      // 답이 JSON 모양이 아니면 도구 없이 한 번 더: 정해진 JSON 형식으로만 정리
      const fix = await claude({ model: AI_MODEL, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema: SPEC_SCHEMA } },
        messages: [{ role: "user", content: `아래 조사 결과를 JSON으로 정리해 주세요. 결과에 없는 내용은 만들지 마세요.\n\n${text.slice(0, 12000)}` }] }, ac.signal).catch(() => null);
      out = fix && fix.stop_reason !== "refusal" ? pickJson(textOf(fix)) : null;
    }
    if (!usable(out) && !st.widened && st.round < MAX_ROUNDS) {
      st.widened = true;
      st.messages.push({ role: "user", content: [{ type: "text", text: WIDEN }] });
      return await next(st);
    }
    return await finish(st, out);
  } catch (e) {
    console.error("spec lookup", st.model, String(e).slice(0, 300));
    // 크레딧·키 문제는 '다시 찾기'로 안 풀리니 이유를 적어 둠
    const why = /credit|billing|balance/i.test(String(e)) ? "Claude API 크레딧이 모자라요. Claude Console(platform.claude.com)에서 남은 크레딧을 확인해 주세요."
      : /claude 40[13] /.test(String(e)) ? "Claude API 키가 맞지 않아요. Supabase Secrets의 ANTHROPIC_API_KEY를 확인해 주세요." : "찾다가 멈췄어요. '다시 찾기'를 눌러 주세요.";
    await patchSpec(st.key, { status: "error", note: why, ver: FINDER_VER, updated_at: nowIso() }).catch(() => {});
  } finally { clearTimeout(timer); }
}
const usable = (r) => !!r && r.found === true && (String(r.spec || "").trim().length > 0 || cleanList(r.links, 4).length > 0);
async function finish(st, r) {
  r = r || {};
  const links = cleanList(r.links, 4), images = cleanList(r.images, 4).map(({ title, url }) => ({ title, url }));
  const spec = String(r.spec || "").trim().slice(0, 1000), found = usable(r);
  const saved = [];
  if (found) for (const l of links.filter((l) => l.pdf || /\.pdf(\?|#|$)/i.test(l.url)).slice(0, 2)) {
    const f = await savePdf(l.url.split("#")[0], st.model, (st.deadline || Infinity) - Date.now() - 8e3);
    if (f) saved.push({ ...f, ...(l.pages ? { pages: l.pages } : {}) });
  }
  const t = nowIso();
  await patchSpec(st.key, found
    ? { status: "found", brand: String(r.brand || "").slice(0, 40), type: st.combo ? "combo" : TYPE_CODES[r.type] ? r.type : st.type || "", spec, links, images, files: saved,
        note: String(r.note || "").slice(0, 300), official: r.official !== false, source: String(r.source || "").slice(0, 80), ver: FOUND_VER, searched_at: t, updated_at: t }
    : { status: "notfound", note: String(r.note || "어디에서도 이 모델의 치수를 찾지 못했어요.").slice(0, 300), ver: FINDER_VER, searched_at: t, updated_at: t });
  // 찾았으면 치수도 그림을 보관함으로 옮기는 일은 새 실행에서 (시간 넉넉하게). 안 되면 앱이 나중에 다시 시킴
  if (found) await relayMedia(st.key);
  // 모델 하나를 다 찾으면, 그 모델이 들어간 현장에 '붙여서 설치' 묶음이 생겼는지 보고 묶음 시방서도 찾기 시작
  if (!st.combo) {
    const jobs = await rest("jobs?select=id,i&order=updated_at.desc&limit=300").catch(() => []);
    for (const j of jobs.filter((j) => (j.i?.apps || []).some((a) => modelKey(a.model) === st.key))) {
      const c = await comboWork(j);
      if (c) await queue([c], false, st.by || "").catch((e) => console.error("combo", String(e).slice(0, 200)));
    }
  }
}
// 현장의 '붙여서 설치' 묶음 (종류를 아직 찾는 중인 가전이 있으면 다 찾은 뒤에)
async function comboWork(job) {
  const apps = (job.i?.apps || []).filter((a) => a && modelKey(a.model).length >= 3);
  const rows = await libRows(apps.map((a) => modelKey(a.model))), lib = foundOnly(rows);
  // 묶음에 들어갈 수 있는 가전(종류 모름·냉장고류·체크한 가전) 중 아직 찾는 중인 게 있으면, 다 찾은 뒤에 (각자 시방서를 묶음 찾기에 넘겨 주려고)
  const maybe = (a) => a.join === true || (a.join !== false && (!TYPE_CODES[a.type] || FRIDGE.has(a.type)));
  const busy = (a) => { const r = rows[modelKey(a.model)]; return r?.status === "searching" && !staleSearch(r); };
  if (apps.some((a) => maybe(a) && busy(a))) return null;
  const c = comboOf(apps, lib);
  return c && okKey(c.key) ? { key: c.key, model: c.members.map((a) => a.model).join(" + ").slice(0, 120), type: "combo",
    combo: c.members.map((a) => { const l = lib[modelKey(a.model)] || {}; return { model: String(a.model).slice(0, 60), type: typeOf(a, lib), brand: l.brand || "", spec: String(l.spec || "").slice(0, 600) }; }) } : null;
}
// 찾기 시작: 처음 보는 것만 (force = '다시 찾기'면 이미 있는 것도. 찾는 중인 것은 건너뜀). 여러 기기가 동시에 눌러도 한 번만 시작
async function queue(items, force, by) {
  const seen = new Set();
  items = items.filter((m) => okKey(m.key) && !seen.has(m.key) && seen.add(m.key));
  if (!items.length) return { queued: 0 };
  const rows = await libRows(items.map((m) => m.key));
  const todo = items.filter((m) => !rows[m.key] || (force && (rows[m.key].status !== "searching" || staleSearch(rows[m.key]))));
  if (!todo.length) return { queued: 0 };
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const used = (await rest(`app_specs?select=model_key&searched_at=gte.${encodeURIComponent(since)}`)).length;
  if (used + todo.length > SPEC_DAY_CAP) return { error: "limit" };
  const t = nowIso(), old = new Date(Date.now() - STALE_MS).toISOString(), mark = { status: "searching", searched_at: t, note: "", updated_by: by, updated_at: t };
  const started = [];
  for (const m of todo) {
    const got = rows[m.key]
      ? await patchSpec(m.key, mark, `&or=${encodeURIComponent(`(status.neq.searching,searched_at.lt."${old}")`)}`)
      : await rest("app_specs?on_conflict=model_key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify({ model_key: m.key, model: m.model, type: m.type || "", ...mark }) });
    if (Array.isArray(got) && got.length) started.push(m);
  }
  for (const m of started) await begin({ key: m.key, model: m.model, type: m.type === "combo" ? "" : m.type || "", combo: m.combo || null, by, round: 0, messages: null });
  return { queued: started.length };
}
/* ---------- 시방서를 그림으로: 치수도 그림을 보관함(job-files/lib/spec/…)에 옮겨 두고, 앱과 시공자 화면에 크게 보여 줌 ----------
   1) 찾을 때 나온 그림 주소 + 제조사가 정해 둔 그림 주소(LG 제품 치수 그림, LG 냉장고 설치가이드 그림)를 받아 옴
   2) 그중 설치 치수도만 Claude(Haiku)가 그림을 보고 고르고 제목을 붙임 (광고 사진·빈 그림·다른 모델 그림은 뺌)
   3) 설명서 PDF의 치수 쪽은 사무실 앱이 그림으로 캡처해서 spec_shot 으로 보내면, 같은 방법으로 골라서 보관 */
function imgKind(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["image/jpeg", "jpg"];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ["image/png", "png"];
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ["image/gif", "gif"];
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ["image/webp", "webp"];
  return null;
}
const IMG_MIN = 6 * 1024, IMG_MAX = 3.5 * 1024 * 1024; // 너무 작은 건 아이콘·빈 그림, 너무 큰 건 Claude가 못 봄
async function getImage(url, ms) {
  if (!publicUrl(url) || ms < 2e3) return null;
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), Math.min(15e3, ms));
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; NestSchedule/1.0)" } });
    if (!r.ok || !publicUrl(r.url)) return null;
    const buf = new Uint8Array(await r.arrayBuffer()), k = imgKind(buf);
    return k && buf.length >= IMG_MIN && buf.length <= IMG_MAX ? { buf, mime: k[0], ext: k[1] } : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function putLib(buf, mime, ext) {
  const path = `lib/spec/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", body: buf, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": mime } });
  return up.ok ? path : null;
}
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const sig = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", u8))).map((x) => x.toString(16).padStart(2, "0")).join("");
const subjectOf = (row) => row.type === "combo"
  ? `나란히 붙여 설치하는 묶음: ${row.model || String(row.model_key).split("+").join(" + ")}`
  : `${row.model || row.model_key} (${[row.brand, TYPE_CODES[row.type]].filter(Boolean).join(" ") || "가전"})`;
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["keep"], properties: { keep: { type: "array",
  items: { type: "object", additionalProperties: false, required: ["n", "title"], properties: { n: { type: "integer" }, title: { type: "string" } } } } } };
// 그림을 보고 설치 치수도만 고름: [{n, title}] (n은 1부터). 실패하면 null
async function judge(subject, imgs, signal) {
  const content = [{ type: "text", text: `가구 시공자가 빌트인 가전을 설치할 때 볼 시방서 그림을 고르고 있어요. 대상: ${subject}
남길 그림: 설치 공간(니치·타공) 치수도, 제품 외형 치수도, 이격거리·통풍, 문 열림 공간, 걸레받이, 도어 패널, 급배수·전원 위치, 나란히 붙여 설치하는 연결 도면처럼 치수가 적힌 그림이나 설명서 쪽.
뺄 그림: 치수가 없는 제품 사진·광고·로고·아이콘·빈 그림, 목차·주의사항만 있는 쪽, 대상과 분명히 다른 모델 전용 그림.
남길 그림마다 번호 n 과 짧은 한국어 제목(예: "설치 공간 치수 (앞)", "걸레받이 높이", "문 열림 공간")을 주세요. 남길 게 없으면 keep 은 빈 목록.` }];
  imgs.forEach((im, i) => content.push({ type: "text", text: `그림 ${i + 1}${im.hint ? ` (${im.hint})` : ""}` }, { type: "image", source: { type: "base64", media_type: im.mime, data: b64(im.buf) } }));
  const res = await claude({ model: VISION_MODEL, max_tokens: 2000, output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    messages: [{ role: "user", content }] }, signal, false);
  if (res.stop_reason === "refusal") return [];
  try { const o = JSON.parse(textOf(res)); return Array.isArray(o.keep) ? o.keep.filter((x) => Number.isInteger(x.n) && x.n >= 1 && x.n <= imgs.length) : null; } catch { return null; }
}
// 받아 볼 그림 주소: 찾을 때 나온 그림 + LG가 정해 둔 그림 주소 (없으면 그냥 넘어감)
function mediaCands(row) {
  const out = [], seen = new Set();
  const add = (url, title, hint) => { if (publicUrl(url) && !seen.has(url)) { seen.add(url); out.push({ url, title, hint }); } };
  (Array.isArray(row.images) ? row.images : []).filter((x) => x && !x.path && !x.skip && x.url).forEach((x) => add(x.url, String(x.title || "치수도"), "찾은 자료"));
  const lg = /LG|엘지/i.test(`${row.brand || ""} ${row.source || ""}`) || (Array.isArray(row.links) ? row.links : []).some((l) => /lge\.co\.kr/.test(l?.url || ""));
  if (lg) {
    const keys = String(row.model_key).split("+"), p4 = keys.map((k) => k.slice(0, 4));
    if (keys.length === 1) ["2p", "1p", "3p"].forEach((x) => add(`https://static.lge.co.kr/kr/images/spec/${keys[0]}.akor_${x}.jpg`, "제품 외형 치수", "LG 제품 치수 그림"));
    if (row.type === "combo" || FRIDGE.has(row.type)) {
      const names = ["설치 치수 (앞)", "설치 치수 (위)", "문 열림 공간", "설치 치수 (옆)"];
      const stems = keys.length === 1 ? [p4[0]] : keys.length === 2 ? [`2set_${p4[0]}_${p4[1]}`, `2set_${p4[1]}_${p4[0]}`] : [];
      for (const base of ["https://www.lge.co.kr/kr/story/setup-guide/images/refrigerator/", "https://www.lge.co.kr/kr/story/user-guide/images/refrigerator/"])
        for (const st of stems) names.forEach((t, i) => add(`${base}${st}_0${i + 1}.png`, keys.length > 1 ? `붙여서 설치 · ${t}` : t, "LG 설치가이드 그림"));
    }
  }
  return out.slice(0, 24);
}
// 한 모델(묶음)의 그림을 보관함으로 옮김. 끝나면 ver=3 (다시 하지 않음)
async function storeMedia(key, ms = 120e3) {
  const row = (await libRows([key]))[key];
  if (!row || row.status !== "found") return { stored: 0 };
  const until = Date.now() + ms, cands = mediaCands(row), got = [], seen = new Set();
  for (let i = 0; i < cands.length && until - Date.now() > 20e3; i += 6) {
    const part = await Promise.all(cands.slice(i, i + 6).map((c) => getImage(c.url, until - Date.now() - 20e3).then((g) => g && { ...c, ...g })));
    for (const g of part.filter(Boolean)) { const h = await sig(g.buf); if (!seen.has(h)) { seen.add(h); got.push(g); } }
  }
  let keep = [];
  if (got.length) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), Math.max(5e3, until - Date.now() - 5e3));
    const picked = await judge(subjectOf(row), got.slice(0, 10), ac.signal).catch((e) => { console.error("spec judge", key, String(e).slice(0, 200)); return null; }).finally(() => clearTimeout(t));
    keep = picked ? picked.map((p) => ({ ...got[p.n - 1], title: String(p.title || got[p.n - 1].title).trim().slice(0, 40) || got[p.n - 1].title }))
      : got.filter((g) => g.hint === "찾은 자료"); // 고르기에 실패하면 찾을 때 나온 그림만
  }
  const stored = [];
  for (const g of keep.slice(0, 6)) { const path = await putLib(g.buf, g.mime, g.ext); if (path) stored.push({ title: g.title, url: g.url, path }); }
  // 그 사이 앱이 캡처해 넣은 그림이 있을 수 있으니 다시 읽어서 합침
  const now = (await libRows([key]))[key] || row, tried = new Set(cands.map((c) => c.url)), done = new Set(stored.map((x) => x.url));
  const list = Array.isArray(now.images) ? now.images.filter(Boolean) : [];
  const images = [...list.filter((x) => x.path), ...stored, ...list.filter((x) => !x.path && !done.has(x.url)).map((x) => (tried.has(x.url) ? { ...x, skip: true } : x))].slice(0, 16);
  await patchSpec(key, { images, ver: FINDER_VER, updated_at: nowIso() });
  return { stored: stored.length };
}
async function relayMedia(key) {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/notify`, { method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ action: "spec_media", key }) });
    if (r.ok) return true;
    console.error("spec media relay", r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.error("spec media relay", String(e).slice(0, 200)); }
  return false;
}
// 서버 내부용: 새 실행에서 그림 옮기기
function specMedia(req, b) {
  if (!SERVICE || req.headers.get("Authorization") !== `Bearer ${SERVICE}`) return json({ error: "forbidden" }, 403);
  if (!okKey(b.key)) return json({ error: "bad" }, 400);
  background(storeMedia(b.key).catch((e) => console.error("spec media", b.key, String(e).slice(0, 200))));
  return json({ ok: true });
}
// 앱에서: 예전에 찾은 시방서의 그림 옮기기 (그림 정리 전인 줄만, 한 번에 5개까지)
async function specStore(req, b) {
  if (!(await userOf(req))) return json({ error: "login required" }, 401);
  if (!AI_KEY) return json({ error: "no key" }, 503);
  const keys = [...new Set((Array.isArray(b.keys) ? b.keys : []).filter(okKey))].slice(0, 5);
  const rows = await libRows(keys);
  const todo = keys.filter((k) => rows[k]?.status === "found" && (+rows[k].ver || 1) < FINDER_VER);
  for (const k of todo) if (!(await relayMedia(k))) background(storeMedia(k, 60e3).catch(() => {}));
  return json({ queued: todo.length });
}
// 앱에서: 설명서 PDF 한 쪽을 그림으로 캡처해 보냄 { key, file, page, data(jpeg base64) }, 다 보냈으면 { key, file, done:true }
async function specShot(req, b) {
  if (!(await userOf(req))) return json({ error: "login required" }, 401);
  if (!AI_KEY) return json({ error: "no key" }, 503);
  const row = okKey(b.key) ? (await libRows([b.key]))[b.key] : null;
  const file = row && libFiles(row).find((f) => f.path === b.file);
  if (!row || row.status !== "found" || !file) return json({ error: "bad" }, 400);
  if (b.done) {
    const files = (Array.isArray(row.files) ? row.files : []).map((f) => (f && f.path === b.file ? { ...f, scanned: true } : f));
    await patchSpec(b.key, { files, updated_at: nowIso() });
    return json({ ok: true });
  }
  const page = Math.floor(+b.page);
  if (!(page >= 1 && page <= 2000) || typeof b.data !== "string" || b.data.length > 5e6) return json({ error: "bad" }, 400);
  if (libImgs(row).some((x) => x.from === b.file && x.page === page)) return json({ kept: true, dup: true });
  let buf;
  try { buf = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0)); } catch { return json({ error: "bad" }, 400); }
  const k = imgKind(buf);
  if (!k || k[1] !== "jpg" || buf.length > IMG_MAX) return json({ error: "bad" }, 400);
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 60e3);
  const picked = await judge(subjectOf(row), [{ buf, mime: k[0], hint: `설명서 ${page}쪽` }], ac.signal)
    .catch((e) => { console.error("spec shot judge", b.key, String(e).slice(0, 200)); return null; }).finally(() => clearTimeout(t));
  if (!picked) return json({ error: "judge" }, 502); // 고르기를 못 했으면 앱이 다음에 다시 캡처 (scanned 안 함)
  if (!picked.length) return json({ kept: false });
  const path = await putLib(buf, k[0], k[1]);
  if (!path) return json({ error: "storage" }, 500);
  const now = (await libRows([b.key]))[b.key] || row;
  const images = [...(Array.isArray(now.images) ? now.images.filter(Boolean) : []), { title: String(picked[0].title || `설명서 ${page}쪽`).trim().slice(0, 40), path, page, from: b.file }].slice(0, 16);
  await patchSpec(b.key, { images, updated_at: nowIso() });
  return json({ kept: true });
}
// 앱에서: 현장을 저장하면 { job }, '지금 찾기·다시 찾기'는 { models, combos, force }
async function specFind(req, b) {
  const user = await userOf(req);
  if (!user) return json({ error: "login required" }, 401);
  if (!AI_KEY) return json({ error: "no key" }, 503);
  const by = String(user.email || "").slice(0, 80), items = [];
  const one = (x) => { const model = String(x && x.model || "").trim().slice(0, 60); return { model, key: modelKey(model), type: TYPE_CODES[x && x.type] ? x.type : "" }; };
  for (const x of Array.isArray(b.models) ? b.models.slice(0, 10) : []) { const m = one(x); if (m.key.length >= 3) items.push(m); }
  let job = null;
  if (typeof b.job === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.job)) {
    job = (await rest(`jobs?id=eq.${encodeURIComponent(b.job)}&select=id,i`))[0] || null;
    for (const a of (job?.i?.apps || []).slice(0, 12)) { const m = one(a); if (m.key.length >= 3) items.push(m); }
  }
  for (const list of Array.isArray(b.combos) ? b.combos.slice(0, 3) : []) {
    const ms = (Array.isArray(list) ? list.slice(0, 6) : []).map((x) => one(typeof x === "string" ? { model: x } : x)).filter((m) => m.key.length >= 3);
    if (ms.length < 2) continue;
    const lib = foundOnly(await libRows(ms.map((m) => m.key)));
    items.push({ key: comboKey(ms.map((m) => m.model)), model: ms.map((m) => m.model).join(" + ").slice(0, 120), type: "combo",
      combo: ms.map((m) => { const l = lib[m.key] || {}; return { model: m.model, type: m.type || l.type || "", brand: l.brand || "", spec: String(l.spec || "").slice(0, 600) }; }) });
  }
  const r = await queue(items, !!b.force, by);
  if (r.error) return json({ error: r.error, cap: SPEC_DAY_CAP }, 429);
  // 저장한 현장의 묶음은, 묶음에 든 가전 종류를 다 알면 바로 (모르면 그 가전을 다 찾은 뒤 finish 에서)
  if (job) { const c = await comboWork(job); if (c) { const q = await queue([c], false, by); if (q.queued) r.queued += q.queued; } }
  return json(r);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json({ publicKey: (await vapid()).pub });
    if (body.action === "test") return await test(req);
    if (body.action === "run" && (body.slot === "morning" || body.slot === "evening")) return json(await run(body.slot));
    if (body.action === "cl_open") return await clOpen(body);
    if (body.action === "cl_upload") return await clUpload(body);
    if (body.action === "cl_photo") return await clPhoto(body);
    if (body.action === "cl_remove") return await clRemove(body);
    if (body.action === "cl_save") return await clSave(body);
    if (body.action === "est_open") return await estOpen(body);
    if (body.action === "spec_status") return json({ auto: !!AI_KEY, cap: SPEC_DAY_CAP, v: FINDER_VER });
    if (body.action === "spec_find") return await specFind(req, body);
    if (body.action === "spec_step") return await specStep(req, body);
    if (body.action === "spec_media") return specMedia(req, body);
    if (body.action === "spec_store") return await specStore(req, body);
    if (body.action === "spec_shot") return await specShot(req, body);
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e && e.message || e) }, 500);
  }
});
