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
  return out;
}
const short = (j) => String(j.name || "").replace(" 고객", "");
const man = (n) => n >= 10000 ? `${Math.round(n / 10000).toLocaleString("ko-KR")}만원` : `${n.toLocaleString("ko-KR")}원`;

/* ---------- 알림 내용 ---------- */
function dayLines(jobs, d) {
  const lines = [];
  const ins = jobs.filter((j) => workDays(j).includes(d));
  if (ins.length) lines.push(`시공 ${ins.length}곳: ${ins.map((j) => `${short(j)}(${(j.i?.crew || []).join("·") || "미배정"})`).join(", ")}`);
  const ms = jobs.filter((j) => j.m?.date === d);
  if (ms.length) lines.push(`실측: ${ms.map(short).join(", ")}`);
  const as = jobs.flatMap((j) => (j.f?.as || []).filter((a) => a.date === d && !a.done).map((a) => `${short(j)}(${a.crew || "담당 미정"})`));
  if (as.length) lines.push(`AS: ${as.join(", ")}`);
  return lines;
}
function unassigned(jobs, today) {
  const soon = jobs.filter((j) => !j.f?.done && j.i?.start && j.i.start >= today && j.i.start <= addDays(today, 7) && !(j.i.crew || []).length);
  return soon.length ? `시공자 미배정 ${soon.length}곳: ${soon.map((j) => `${short(j)} ${md(j.i.start)}`).join(", ")}` : "";
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
  const late = jobs.filter((j) => { const wd = workDays(j), last = wd[wd.length - 1]; return last && last < today && last >= addDays(today, -7) && !done.has(j.id); });
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
const inList = (keys) => encodeURIComponent(`in.(${keys.map((k) => `"${k}"`).join(",")})`);
async function specLib(apps) {
  const keys = [...new Set(apps.map((a) => modelKey(a.model)).filter(Boolean))];
  if (!keys.length) return {};
  const rows = await rest(`app_specs?select=model_key,type,spec,links,images,files,status&model_key=${inList(keys)}`).catch(() => []);
  return Object.fromEntries(rows.filter((r) => r.status === "found").map((r) => [r.model_key, r]));
}
const okUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" && !!x.hostname; } catch { return false; } };
const libList = (row, k) => (Array.isArray(row?.[k]) ? row[k] : []).filter((l) => l && okUrl(l.url)).slice(0, 4);
const libFiles = (row) => (Array.isArray(row?.files) ? row.files : []).filter((f) => f && typeof f.path === "string" && /^lib\/spec\/\d{10,16}-[a-z0-9]{1,8}\.pdf$/.test(f.path)).slice(0, 2);
// 시공자 화면에 보낼 현장 정보 (비밀번호·돈은 빼고). 종류·확인 치수를 비워 둔 가전은 보관함 값으로
const jobPublic = (j, lib = {}) => ({ id: j.id, name: j.name, item: j.item, addr: j.addr,
  i: { start: j.i?.start || "", end: j.i?.end || "", sat: !!j.i?.sat, sun: !!j.i?.sun, crew: j.i?.crew || [], chk: j.i?.chk || [],
    apps: (j.i?.apps || []).map((a) => { const l = lib[modelKey(a.model)] || {}; return { ...a, type: a.type || l.type || "", spec: a.spec || l.spec || "" }; }) } });
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
  const apps = jobs[0].i?.apps || [], lib = await specLib(apps), libOf = (a) => lib[modelKey(a.model)];
  // 가전마다: 보관함에 저장해 둔 공식 PDF + 이 현장에만 올린 파일 + 공식 링크 + 치수도 그림
  const files = [...apps.flatMap((a) => libFiles(libOf(a)).map((f) => ({ app: a.id, name: f.name || "시방서", path: f.path }))),
    ...specs.map((f) => ({ app: f.stage, name: f.name, path: f.path }))];
  const urls = await signPaths([...files.map((f) => f.path), ...photos.map((p) => p.thumb || p.path)]);
  const extra = apps.flatMap((a) => [
    ...libList(libOf(a), "links").map((l) => ({ app: a.id, name: String(l.title || "공식 홈페이지").slice(0, 60), url: l.url, link: true })),
    ...libList(libOf(a), "images").map((l) => ({ app: a.id, name: String(l.title || "치수도").slice(0, 60), url: l.url, img: true })),
  ]);
  return json({
    job: jobPublic(jobs[0], lib), status: cl.status, data: { ...(cl.data || {}), photos }, submitted_at: cl.submitted_at, submitted_by: cl.submitted_by,
    specs: [...files.map((f) => ({ app: f.app, name: f.name, url: urls[f.path] || "" })), ...extra],
    urls: Object.fromEntries(photos.map((p) => [p.path, urls[p.thumb || p.path] || ""])),
  });
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

/* ---------- 시방서 자동 찾기: 모델명으로 제조사 공식 홈페이지를 검색해 보관함(app_specs)에 저장 ----------
   Claude API(웹 검색·웹 읽기)를 씁니다. Supabase → Edge Functions → Secrets 에 ANTHROPIC_API_KEY 를 넣어야 켜져요.
   한 번 찾은 모델은 다시 찾지 않고, 24시간에 SPEC_DAY_CAP 개까지만 찾아서 비용이 갑자기 늘지 않게 막습니다. */
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const AI_MODEL = Deno.env.get("SPEC_MODEL") || "claude-opus-5-5";
const SPEC_DAY_CAP = +(Deno.env.get("SPEC_DAY_CAP") || 30);
const TYPE_CODES = { dish: "식기세척기", induction: "인덕션·전기레인지", fridge: "냉장고", kimchi: "김치냉장고", wine: "와인셀러", oven: "오븐·광파오븐",
  micro: "전자레인지", hood: "후드", water: "정수기", washer: "세탁기·건조기", styler: "스타일러·에어드레서·슈드레서", etc: "기타 가전" };
const SPEC_SYSTEM = `당신은 한국의 고급 빌트인 가구 회사(주방가구·붙박이장·신발장 제작)를 돕습니다. 가구 시공자가 빌트인 가전을 제조사 시방서대로 설치했는지 현장에서 확인할 수 있도록, 주어진 모델의 설치 시방서를 찾습니다.

원칙
- 제조사 공식 사이트 자료만 씁니다 (lge.co.kr, samsung.com/sec, downloadcenter.samsung.com, miele.co.kr, media.miele.com, 각 브랜드의 공식 한국·본사 사이트). 쇼핑몰·오픈마켓·블로그·카페 수치는 쓰지 않습니다.
- 정확히 그 모델(또는 같은 모델의 지역 표기) 자료만 씁니다. 비슷한 모델로 추측하지 않습니다. 공식 자료가 시리즈 공통 도면이면 note에 그렇게 밝힙니다.
- 치수는 원문(스펙 표, 설명서, 치수도)에서 읽은 값만 적습니다. 그림 속 치수가 무엇을 가리키는지 확실하지 않으면 해석하지 말고 "도면 참조"라고 적습니다.
- 제품 외형 치수와 설치 공간(니치·타공) 치수를 구분합니다. 가구 타공은 설치 공간 기준입니다.
- 식기세척기는 걸레받이(하부장 받침) 높이를 반드시 찾습니다: 기준 높이, 허용 범위, 깊이 조건, 절단 필요 여부, 높이 조절 다리 범위. 못 찾으면 note에 못 찾았다고 적습니다.
- 도어부착형(완전 빌트인·패널 부착형) 가전은 전면 패널 높이 범위와 무게 범위(kg), 패널 두께 제한을 찾습니다.
- 그 밖에 이격거리(좌우·상·후면), 통풍구, 도어 열림 공간, 전원·급배수 위치, 높이 조절 범위를 찾습니다.

찾는 요령
- LG전자: 제품 페이지 https://www.lge.co.kr/<카테고리>/<모델명 소문자> (스펙 표에 제품 크기·걸레받이 높이), 설치가이드 https://www.lge.co.kr/story/user-guide/dishwashers-install-guide (식기세척기 걸레받이 도면), https://www.lge.co.kr/story/user-guide/objetcollection-refrigerator-install-guide (냉장고·김치냉장고·컨버터블), 설명서 https://www.lge.co.kr/support/product-manuals?mktModelCd=<모델명>.AKOR
- 삼성전자: 고객지원 https://www.samsung.com/sec/support/model/<모델명>/ 의 스펙과 downloadcenter.samsung.com 설명서 PDF('설치 공간 확인하기', '제품 및 설치 공간 치수' 쪽)
- 밀레: miele.co.kr 제품 페이지의 기술 데이터(설치 너비·높이·깊이, 전면 패널 무게), media.miele.com 의 설치 도면·드릴 템플릿·설명서. SCVi=완전 빌트인(도어부착형), SCi=세미 빌트인, SCU=언더카운터
- 그 밖의 브랜드(보쉬, 지멘스, 가게나우, 일렉트로룩스, SK매직, 쿠쿠 등): 공식 한국 사이트의 제품·고객지원 페이지와 설치 설명서 PDF

답
- 마지막에 아래 JSON 하나만 씁니다(앞뒤 설명 없이).
{"found": true 또는 false, "brand": "제조사", "type": "종류 코드", "spec": "시공자가 볼 치수 요약. 한국어, mm, 한 줄에 한 항목, 최대 6줄 (예: 설치 공간 600×820~870×580 / 제품 598×815×567 / 걸레받이 높이 150 (121~150) / 도어 패널 높이 650~770, 무게 4~11kg)", "links": [{"title": "짧은 한국어 제목", "url": "https://...", "pdf": true 또는 false}], "images": [{"title": "짧은 한국어 제목", "url": "https://... 공식 치수도 그림 주소"}], "note": "확인 못 한 항목이나 주의할 점 한 줄"}
- 종류 코드: ${Object.entries(TYPE_CODES).map(([k, v]) => `${k}(${v})`).join(", ")}
- 설명서 PDF는 #page=N 을 붙여 치수 쪽으로 바로 열리게 합니다. links는 4개, images는 4개까지.
- 공식 자료를 못 찾으면 found=false 로 하고 note에 확인한 경로를 한 줄로 적습니다.`;
const SPEC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["found", "brand", "type", "spec", "links", "images", "note"],
  properties: {
    found: { type: "boolean" }, brand: { type: "string" }, type: { type: "string", enum: [...Object.keys(TYPE_CODES), ""] }, spec: { type: "string" }, note: { type: "string" },
    links: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "pdf"], properties: { title: { type: "string" }, url: { type: "string" }, pdf: { type: "boolean" } } } },
    images: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } },
  },
};

const wait = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); no(new Error("aborted")); }, { once: true });
});
async function claude(body, signal) {
  for (let i = 0; ; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      // 안전 분류기에 막히면 Anthropic이 권하는 다른 모델로 자동 재시도 (fallbacks: "default")
      headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01", "content-type": "application/json" },
      body: JSON.stringify({ fallbacks: "default", ...body }),
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
async function askSpec(m, signal) {
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul" } },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
  ];
  const messages = [{ role: "user", content: `모델명: ${m.model}${m.type ? `\n종류: ${TYPE_CODES[m.type]}` : ""}\n이 모델의 설치 시방서를 제조사 공식 홈페이지에서 찾아 주세요.` }];
  let res;
  for (let i = 0; i < 5; i++) {
    res = await claude({ model: AI_MODEL, max_tokens: 16000, output_config: { effort: "medium" }, system: SPEC_SYSTEM, tools, messages }, signal);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content }); // 서버 쪽 검색이 길어지면 그대로 이어서
  }
  if (res.stop_reason === "refusal") return null;
  const text = textOf(res);
  const out = pickJson(text);
  if (out || !text.trim()) return out;
  // 답이 JSON 모양이 아니면 도구 없이 한 번 더: 정해진 JSON 형식으로만 정리
  const fix = await claude({ model: AI_MODEL, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema: SPEC_SCHEMA } },
    messages: [{ role: "user", content: `아래 조사 결과를 JSON으로 정리해 주세요. 결과에 없는 내용은 만들지 마세요.\n\n${text.slice(0, 12000)}` }] }, signal);
  return fix.stop_reason === "refusal" ? null : pickJson(textOf(fix));
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
// 공식 PDF는 보관함에 복사해 둠 (제조사 주소가 바뀌어도 볼 수 있게). PDF가 아니거나 20MB가 넘으면 링크만
async function savePdf(url, m, signal) {
  if (!publicUrl(url)) return null;
  try {
    const r = await fetch(url, { signal, redirect: "follow" });
    if (!r.ok || !publicUrl(r.url)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (!isPdf || buf.length > 20 * 1024 * 1024) return null;
    const path = `lib/spec/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
    const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", body: buf, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/pdf" },
    });
    if (!up.ok) return null;
    return { path, name: `${m.model} 설명서.pdf`, mime: "application/pdf", size: buf.length };
  } catch { return null; }
}
const patchSpec = (key, body) => rest(`app_specs?model_key=eq.${encodeURIComponent(key)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
const cleanList = (v, n) => (Array.isArray(v) ? v : []).filter((l) => l && publicUrl(l.url)).slice(0, n)
  .map((l) => ({ title: String(l.title || "").trim().slice(0, 60), url: String(l.url).slice(0, 500), ...(l.pdf !== undefined ? { pdf: !!l.pdf } : {}) }));
async function lookup(m) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 130e3);
  const now = () => new Date().toISOString();
  try {
    const r = (await askSpec(m, ac.signal)) || {};
    const links = cleanList(r.links, 4), images = cleanList(r.images, 4).map(({ title, url }) => ({ title, url }));
    const spec = String(r.spec || "").trim().slice(0, 800);
    const found = r.found === true && (links.length > 0 || spec.length > 0);
    const saved = [];
    if (found) for (const l of links.filter((l) => l.pdf || /\.pdf(\?|#|$)/i.test(l.url)).slice(0, 2)) { const f = await savePdf(l.url.split("#")[0], m, ac.signal); if (f) saved.push(f); }
    await patchSpec(m.key, found
      ? { status: "found", brand: String(r.brand || "").slice(0, 40), type: TYPE_CODES[r.type] ? r.type : m.type, spec, links, images, files: saved,
          note: String(r.note || "").slice(0, 300), searched_at: now(), updated_at: now() }
      : { status: "notfound", note: String(r.note || "공식 홈페이지에서 이 모델을 찾지 못했어요.").slice(0, 300), searched_at: now(), updated_at: now() });
  } catch (e) {
    console.error("spec lookup", m.model, String(e).slice(0, 300));
    await patchSpec(m.key, { status: "error", note: "찾다가 멈췄어요. 잠시 후 다시 찾아 주세요.", updated_at: now() }).catch(() => {});
  } finally { clearTimeout(timer); }
}
const staleSearch = (r) => r.status === "searching" && Date.now() - new Date(r.searched_at || 0).getTime() > 10 * 60e3;
async function specFind(req, b) {
  const user = await userOf(req);
  if (!user) return json({ error: "login required" }, 401);
  if (!AI_KEY) return json({ error: "no key" }, 503);
  const seen = new Set(), list = [];
  for (const x of Array.isArray(b.models) ? b.models.slice(0, 10) : []) {
    const model = String(x && x.model || "").trim().slice(0, 60), key = modelKey(model);
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key); list.push({ model, key, type: TYPE_CODES[x.type] ? x.type : "" });
  }
  if (!list.length) return json({ queued: 0 });
  const rows = await rest(`app_specs?select=model_key,status,searched_at&model_key=${inList(list.map((m) => m.key))}`);
  const by = Object.fromEntries(rows.map((r) => [r.model_key, r]));
  // 처음 보는 모델은 바로 찾고, 이미 있는 모델은 '다시 찾기'를 눌렀을 때만 (찾는 중이면 건너뜀)
  const todo = list.filter((m) => !by[m.key] || (b.force && (by[m.key].status !== "searching" || staleSearch(by[m.key]))));
  if (!todo.length) return json({ queued: 0 });
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const used = (await rest(`app_specs?select=model_key&searched_at=gte.${encodeURIComponent(since)}`)).length;
  if (used + todo.length > SPEC_DAY_CAP) return json({ error: "limit", cap: SPEC_DAY_CAP }, 429);
  const now = new Date().toISOString(), email = String(user.email || "").slice(0, 80);
  for (const m of todo) {
    if (by[m.key]) await patchSpec(m.key, { status: "searching", searched_at: now, note: "", updated_by: email, updated_at: now });
    else await rest("app_specs?on_conflict=model_key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ model_key: m.key, model: m.model, type: m.type, status: "searching", searched_at: now, updated_by: email, updated_at: now }) });
  }
  const work = Promise.all(todo.map(lookup));
  // 답은 바로 돌려주고 찾는 일은 뒤에서 계속 (끝나면 앱 화면이 저절로 바뀜)
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
  return json({ queued: todo.length });
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
    if (body.action === "spec_status") return json({ auto: !!AI_KEY, cap: SPEC_DAY_CAP });
    if (body.action === "spec_find") return await specFind(req, body);
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e && e.message || e) }, 500);
  }
});
