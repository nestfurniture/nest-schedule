// @ts-nocheck
// 네스트퍼니처 알림 보내기 (Supabase Edge Function, 이름: notify)
// - 매일 아침/저녁 정해진 시간에 Supabase Cron이 불러서 휴대폰으로 일정 알림을 보냅니다.
// - 앱이 알림용 공개키를 받아갈 때, 사용자가 "테스트 알림"을 누를 때도 불립니다.
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
/* slot: evening = 내일 일정, morning = 오늘 일정 + 미배정 경고 (+ 관리자에게 입금) */
function buildMessages(slot, jobs, money, today) {
  const out = [];
  if (slot === "evening") {
    const d = addDays(today, 1), lines = dayLines(jobs, d);
    if (lines.length) out.push({ pref: "tomorrow", title: `내일 일정 · ${md(d)}`, body: lines.join("\n"), url: `${APP_URL}?day=${d}`, tag: `tomorrow-${d}` });
  } else {
    const lines = dayLines(jobs, today), warn = unassigned(jobs, today);
    if (warn) lines.push(warn);
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
  const [jobs, admins, money] = await Promise.all([rest("jobs?select=*"), rest("admins?select=user_id").catch(() => []), rest("job_money?select=*").catch(() => [])]);
  return { jobs, admins: new Set(admins.map((a) => a.user_id)), money };
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
  const [{ jobs, admins, money }, subs, v] = await Promise.all([loadData(), rest("push_subs?select=*"), vapid()]);
  const msgs = buildMessages(slot, jobs, money, today);
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
  const [{ jobs, admins, money }, subs, v] = await Promise.all([loadData(), rest(`push_subs?user_id=eq.${user.id}&select=*`), vapid()]);
  if (!subs.length) return json({ sent: 0, error: "no device" });
  const today = kstToday();
  let msgs = [...buildMessages("morning", jobs, money, today), ...buildMessages("evening", jobs, money, today)].map((m) => ({ ...m, pref: "_test" }));
  if (!msgs.length) msgs = [{ pref: "_test", title: "네스트퍼니처 알림", body: "알림이 잘 연결됐어요. 오늘과 내일은 잡힌 일정이 없어요.", url: APP_URL, tag: "test" }];
  return json({ sent: await sendTo(subs, msgs, admins, v) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json({ publicKey: (await vapid()).pub });
    if (body.action === "test") return await test(req);
    if (body.action === "run" && (body.slot === "morning" || body.slot === "evening")) return json(await run(body.slot));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e && e.message || e) }, 500);
  }
});
