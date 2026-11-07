// @ts-nocheck
// 네스트퍼니처 통장 서버 (Supabase Edge Function, 이름: bank)
// - 팝빌 계좌조회(EasyFinBank)로 회사 통장 입출금 내역을 가져와 bank_tx 표에 넣습니다.
// - 정해진 시간마다(Supabase Cron, update-12.sql) 또는 앱의 "지금 가져오기"로 불립니다.
// - 앱의 통장 연결 화면(관리자)에 팝빌 가입 여부·계좌·정액제 기한·포인트를 알려 주고, 팝빌 계좌 등록·정액제·포인트 충전 화면 주소를 받아 줍니다.
// 팝빌 열쇠(링크아이디·비밀키)는 Supabase Secrets에만 있고 앱으로 나가지 않습니다. 계좌 비밀번호는 팝빌 화면에서만 넣습니다.
// 팝빌 SDK 없이 REST로 직접 부릅니다(인증 방식은 팝빌 공식 SDK와 같음).
// 사업자가 여럿이면(리브젠·네스트) POPBILL_CORP_NUM에 "네스트:123-45-67890, 리브젠:234-56-78901"처럼 적습니다. 사업자마다 팝빌 회원·계좌가 따로예요.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || firstKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
const env = (k) => String(Deno.env.get(k) ?? "").trim();
const LINK_ID = env("POPBILL_LINK_ID");
const SECRET = env("POPBILL_SECRET_KEY");
const PB_USER0 = env("POPBILL_USER_ID");
const TEST = /^(1|true|yes|y|test|테스트)$/i.test(env("POPBILL_TEST"));
const VER = 2;
const fmtCorp = (n) => `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
// "이름:사업자번호"를 쉼표(또는 줄바꿈)로 이어 적음. 이름은 앱에 보일 이름이고 없어도 됨
const CORPS = [], CORP_BAD = [];
for (const part of env("POPBILL_CORP_NUM").split(/[,;|\n]+/)) {
  const p = part.trim(), i = p.search(/[:=]/);
  if (!p) continue;
  const num = (i >= 0 ? p.slice(i + 1) : p).replace(/\D/g, ""), name = (i >= 0 ? p.slice(0, i) : p.replace(/[\d\s-]+/g, " ")).trim().slice(0, 20);
  if (num.length !== 10) CORP_BAD.push(p.slice(0, 40));
  else if (!CORPS.some((c) => c.num === num)) CORPS.push({ num, name, label: name || fmtCorp(num) });
}
// 팝빌 담당자 아이디는 사업자가 하나일 때만 씀 (보통 비워 둠)
const PB_USER = CORPS.length === 1 ? PB_USER0 : "";
const SID = TEST ? "POPBILL_TEST" : "POPBILL";
const AUTH = "https://auth.linkhub.co.kr";
const API = TEST ? "https://popbill-test.linkhub.co.kr" : "https://popbill.linkhub.co.kr";
const BANKS = {
  "0002": "산업은행", "0003": "기업은행", "0004": "국민은행", "0007": "수협은행", "0011": "농협은행", "0020": "우리은행",
  "0023": "SC제일은행", "0027": "씨티은행", "0031": "아이엠뱅크", "0032": "부산은행", "0034": "광주은행", "0035": "제주은행",
  "0037": "전북은행", "0039": "경남은행", "0045": "새마을금고", "0048": "신협", "0071": "우체국", "0081": "하나은행",
  "0088": "신한은행", "0089": "케이뱅크",
};
// 팝빌 화면 주소 (30초 안에 열어야 함)
const URLS = { acct: "/EasyFin/Bank?TG=BankAccount", rate: "/EasyFin/Bank?TG=CHRG", point: "/Member?TG=CHRG", login: "/Member?TG=LOGIN" };

function firstKey(v) { try { const o = JSON.parse(v || "{}"); return Object.values(o)[0] || ""; } catch { return ""; } }
const configured = () => !!(LINK_ID && SECRET && CORPS.length);
// 앱이 고른 사업자 (안 보내면 첫 사업자)
const corpOf = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d ? CORPS.find((c) => c.num === d) || null : CORPS[0] || null; };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ymd = (s) => { s = String(s || ""); return /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ""; };
const compact = (d) => d.replace(/-/g, "");
const later = (a, b) => (a > b ? a : b);
// 시작일~오늘을 팝빌이 한 번에 받는 길이(한 달 이내)로 나눔
function windows(from, to, len = 30) {
  const out = [];
  for (let s = from; s <= to; s = addDays(s, len)) { const e = addDays(s, len - 1); out.push([s, e < to ? e : to]); }
  return out;
}

/* ---------- 팝빌 인증 (링크허브 토큰) ---------- */
const enc = new TextEncoder();
const b64 = (buf) => { let s = ""; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha256 = async (s) => b64(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(keyB64, s) {
  const k = await crypto.subtle.importKey("raw", unb64(keyB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
class PbErr extends Error { constructor(code, message) { super(message || "팝빌 오류"); this.code = code ?? -1; } }
const errOf = (e) => ({ code: e && e.code !== undefined ? e.code : -1, message: String((e && e.message) || e).slice(0, 300) });
async function readJson(r) { const t = await r.text(); try { return t ? JSON.parse(t) : {}; } catch { return { message: t.slice(0, 200) }; } }

const toks = new Map();
async function token(c) {
  const tok = toks.get(c.num);
  if (tok && tok.exp - Date.now() > 60e3) return tok.t;
  const uri = `/${SID}/Token`, body = JSON.stringify({ access_id: c.num, scope: ["member", "180"] }), xDate = new Date().toISOString();
  // 서명 대상: POST, 본문 해시, 시각, 허용 IP(*), API 버전, 주소 — 팝빌 공식 SDK(linkhub)와 같은 순서
  const target = `POST\n${await sha256(body)}\n${xDate}\n*\n2.0\n${uri}`;
  const r = await fetch(AUTH + uri, {
    method: "POST", body,
    headers: { "x-lh-date": xDate, "x-lh-version": "2.0", "x-lh-forwarded": "*", Authorization: `LINKHUB ${LINK_ID} ${await hmac(SECRET, target)}`, "Content-Type": "Application/json" },
  });
  const d = await readJson(r);
  if (!r.ok || !d.session_token) throw new PbErr(d.code, d.message || `팝빌 인증 실패 (HTTP ${r.status})`);
  toks.set(c.num, { t: d.session_token, exp: Date.parse(d.expiration) || Date.now() + 20 * 60e3 });
  return d.session_token;
}
async function pb(path, { method = "GET", body, auth = true, corp } = {}) {
  const headers = { "Content-Type": "application/json;charset=utf-8" };
  if (auth) headers.Authorization = `Bearer ${await token(corp)}`;
  if (auth && PB_USER) headers["x-pb-userid"] = PB_USER;
  const r = await fetch(API + path, { method, headers, body: method === "POST" ? (body === undefined ? "" : JSON.stringify(body)) : undefined });
  const d = await readJson(r);
  if (!r.ok) throw new PbErr(d.code, d.message || `팝빌 응답 오류 (HTTP ${r.status})`);
  return d;
}
async function point(path, c) {
  const r = await fetch(`${AUTH}/${SID}/${path}`, { headers: { Authorization: `Bearer ${await token(c)}` } });
  const d = await readJson(r);
  if (!r.ok) throw new PbErr(d.code, d.message);
  return +d.remainPoint || 0;
}
const isMember = async (c) => +(await pb(`/Join?CorpNum=${c.num}&LID=${encodeURIComponent(LINK_ID)}`, { auth: false })).code === 1;
const listAccts = async (c) => { const d = await pb("/EasyFin/Bank/ListBankAccount", { corp: c }); return Array.isArray(d) ? d : []; };
const acctKey = (a) => `${a.bankCode}-${a.accountNumber}`;
const acctInfo = (a, c) => ({
  key: acctKey(a), corp: c.num, biz: c.label, bank: BANKS[a.bankCode] || a.bankCode, tail: String(a.accountNumber || "").slice(-4), name: a.accountName || "", type: a.accountType || "",
  state: +a.state || 0, contract: +a.contractState || 0, end: ymd(a.useEndDate), closing: !!a.closeRequestYN, restrict: !!a.useRestrictYN, unpaid: !!a.unPaidYN,
});
const usable = (a) => +a.state === 1 && +a.contractState !== 2;

/* ---------- 거래내역 가져오기 ---------- */
const num = (v) => Math.round(Math.abs(+String(v ?? "").replace(/[^\d.-]/g, "") || 0));
const cut = (v, n = 300) => String(v ?? "").trim().slice(0, n);
function txRow(a, x, c) {
  const inn = num(x.accIn), out = num(x.accOut), d = ymd(x.trdate || x.trdt), t = String(x.trdt || "");
  if (!x.tid || !d || (!inn && !out)) return null;
  const bal = String(x.balance ?? "").trim();
  return {
    id: String(x.tid).slice(0, 64), acct: acctKey(a), corp: c.num, day: d, at: /^\d{12}/.test(t) ? `${t.slice(8, 10)}:${t.slice(10, 12)}` : "",
    dir: inn ? "in" : "out", amount: inn || out, balance: bal ? Math.round(+bal.replace(/[^\d.-]/g, "") || 0) : null,
    r1: cut(x.remark1), r2: cut(x.remark2), r3: cut(x.remark3), r4: cut(x.remark4), memo: cut(x.memo, 100),
  };
}
async function insertRows(rows) {
  // 이미 있는 거래(같은 번호)는 건드리지 않음: 앱에서 정해 둔 분류가 그대로 남음
  const r = await rest("bank_tx?on_conflict=id&select=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rows) });
  return Array.isArray(r) ? r.length : 0;
}
async function pull(c, a, from, to, deadline) {
  const job = (await pb(`/EasyFin/Bank/BankAccount?BankCode=${a.bankCode}&AccountNumber=${encodeURIComponent(a.accountNumber)}&SDate=${compact(from)}&EDate=${compact(to)}`, { method: "POST", corp: c })).jobID;
  if (!job) throw new PbErr(-1, "팝빌에서 수집 번호를 받지 못했어요.");
  for (let i = 0; ; i++) {
    await sleep(i < 6 ? 1000 : 2000);
    const s = await pb(`/EasyFin/Bank/${job}/State`, { corp: c });
    if (String(s.jobState) === "3") {
      if (+s.errorCode !== 1) throw new PbErr(s.errorCode, s.errorReason || "은행에서 내역을 가져오지 못했어요.");
      break;
    }
    if (Date.now() > deadline) throw new PbErr(0, "은행 응답이 늦어 다음 번에 다시 가져와요.");
  }
  // 같은 거래가 다른 번호로 또 오면(시험 환경 → 운영 전환 등) 날짜·시각·금액·잔액이 같은 줄은 건너뜀
  const have = await rest(`bank_tx?acct=eq.${encodeURIComponent(acctKey(a))}&day=gte.${from}&day=lte.${to}&select=id,day,at,dir,amount,balance`);
  const sig = (x) => [x.day, x.at, x.dir, x.amount, x.balance ?? ""].join("|"), seen = new Map((have || []).map((x) => [sig(x), x.id]));
  let added = 0;
  for (let page = 1; page <= 50; page++) {
    const r = await pb(`/EasyFin/Bank/${job}?TradeType=I,O&Page=${page}&PerPage=1000&Order=A`, { corp: c });
    const list = Array.isArray(r.list) ? r.list : [];
    const rows = list.map((x) => txRow(a, x, c)).filter((x) => x && (!seen.has(sig(x)) || seen.get(sig(x)) === x.id));
    if (rows.length) added += await insertRows(rows);
    if (!list.length || page >= (+r.pageCount || 1)) break;
  }
  return added;
}
async function getState() { const r = await rest("bank_kv?key=eq.state&select=data"); return (r && r[0] && r[0].data) || {}; }
async function putState(d) {
  await rest("bank_kv?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "state", data: d, updated_at: new Date().toISOString() }) });
}
async function collect(force) {
  const st = await getState(), now = Date.now();
  const since = st.lastRun ? now - Date.parse(st.lastRun) : Infinity;
  if (since < (force ? 20e3 : 4 * 60e3)) return { skipped: true, lastRun: st.lastRun };
  st.lastRun = new Date(now).toISOString();
  await putState(st);
  const deadline = now + 110e3, today = kstToday(), out = { accounts: 0, added: 0, errors: [] };
  const multi = CORPS.length > 1, prev = st.accts || {}, accts = {}, todo = [], fails = [];
  st.corps = {};
  // 사업자마다 계좌 목록을 받음. 한 사업자가 안 돼도 다른 사업자는 계속 가져옴
  for (const c of CORPS) {
    st.corps[c.num] = { name: c.label, err: null };
    try {
      for (const a of await listAccts(c)) { accts[acctKey(a)] = { ...(prev[acctKey(a)] || {}), ...acctInfo(a, c) }; if (usable(a)) todo.push([c, a]); }
    } catch (e) {
      const er = errOf(e);
      st.corps[c.num].err = er; fails.push({ ...er, message: (multi ? `${c.label}: ` : "") + er.message });
      for (const [k, v] of Object.entries(prev)) if (v.corp === c.num || (!v.corp && !multi)) accts[k] = v; // 계좌 이름표는 남겨 둠
    }
  }
  st.accts = accts;
  st.err = fails.length ? { code: fails[0].code, message: fails.map((f) => f.message).join(" / ") } : null;
  if (fails.length && fails.length === CORPS.length) { st.lastEnd = new Date().toISOString(); await putState(st); return { ...out, error: st.err }; }
  for (const [c, a] of todo) {
    const s = accts[acctKey(a)], oldest = addDays(today, -89);
    // 처음에는 지난달 1일부터, 그다음부터는 마지막으로 가져온 날 3일 전부터(늦게 들어온 거래까지)
    const from = later(s.last ? addDays(s.last, -3) : addDays(today.slice(0, 8) + "01", -1).slice(0, 8) + "01", oldest);
    let added = 0;
    s.err = null;
    for (const [sd, ed] of windows(from, today)) {
      if (Date.now() > deadline) { s.err = { code: 0, message: "시간이 모자라 다음 번에 이어서 가져와요." }; break; }
      try { added += await pull(c, a, sd, ed, deadline); s.last = ed; } catch (e) { s.err = errOf(e); break; }
    }
    s.at = new Date().toISOString(); s.n = added;
    out.accounts++; out.added += added;
    if (s.err) out.errors.push({ acct: `${multi ? `${c.label} ` : ""}${s.bank} ${s.tail}`, ...s.err });
  }
  if (fails.length) out.errors.unshift(...fails.map((f) => ({ acct: "계좌 목록", ...f })));
  st.lastEnd = new Date().toISOString(); st.added = out.added;
  await putState(st);
  return out;
}

/* ---------- 앱 화면용 ---------- */
async function corpStatus(c) {
  const o = { num: c.num, corp: fmtCorp(c.num), name: c.label, member: null, accounts: null, point: null, errors: [] };
  try { o.member = await isMember(c); } catch (e) { o.errors.push({ at: "member", ...errOf(e) }); }
  if (o.member) {
    try { o.accounts = (await listAccts(c)).map((a) => acctInfo(a, c)); } catch (e) { o.errors.push({ at: "accounts", ...errOf(e) }); }
    try { o.point = await point("Point", c); } catch (_) { /* 파트너 결제로 쓰면 회원 포인트가 없을 수 있음 */ }
  }
  return o;
}
async function status() {
  const st = await getState().catch(() => ({}));
  const o = {
    v: VER, configured: configured(), test: TEST, user: !!PB_USER, bad: CORP_BAD,
    state: { lastRun: st.lastRun || "", lastEnd: st.lastEnd || "", added: st.added || 0, err: st.err || null, accts: st.accts || {} },
    corps: [], partnerPoint: null,
  };
  if (!o.configured) return o;
  o.corps = await Promise.all(CORPS.map(corpStatus));
  const m = CORPS.find((c, i) => o.corps[i].member);
  if (m) try { o.partnerPoint = await point("PartnerPoint", m); } catch (_) { /* 연동회원 결제면 없음 */ }
  // 사업자 하나만 쓰던 예전 앱 화면용
  const f = o.corps[0];
  return Object.assign(o, { corp: f.corp, member: f.member, accounts: f.accounts, point: f.point, errors: f.errors });
}
const PW_OK = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[~!@#$%^&*()_+]).{8,20}$/;
async function join(c, b) {
  const f = b.form || {}, s = (v, n) => String(v ?? "").trim().slice(0, n);
  const form = {
    ID: s(f.id, 50), Password: String(f.pw ?? ""), LinkID: LINK_ID, CorpNum: c.num, CEOName: s(f.ceo, 100), CorpName: s(f.corp, 200), Addr: s(f.addr, 300),
    BizType: s(f.type, 100), BizClass: s(f.cls, 100), ContactName: s(f.name, 100), ContactEmail: s(f.email, 100), ContactTEL: s(f.tel, 20),
  };
  if (Object.values(form).some((v) => !v)) return { ok: false, message: "빈 칸을 모두 채워 주세요." };
  if (form.ID.length < 6) return { ok: false, message: "아이디는 6자 이상이에요." };
  if (!PW_OK.test(form.Password)) return { ok: false, message: "비밀번호는 8~20자로 영문·숫자·특수문자(~!@#$%^&*()_+)를 모두 넣어 주세요." };
  const d = await pb("/Join", { method: "POST", body: form, auth: false });
  return { ok: +d.code === 1, message: d.message || "" };
}

/* ---------- 누가 불렀는지 ---------- */
async function userOf(req) {
  const auth = req.headers.get("Authorization") || "";
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function adminOf(req) {
  const u = await userOf(req);
  if (!u) return null;
  const a = await rest(`admins?user_id=eq.${encodeURIComponent(u.id)}&select=user_id`);
  return Array.isArray(a) && a.length ? u : null;
}
async function cronOk(k) {
  if (typeof k !== "string" || k.length < 32) return false;
  const r = await rest("bank_secret?id=eq.1&select=k");
  const want = r && r[0] && r[0].k;
  if (!want || want.length !== k.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "ping") return json({ v: VER, configured: configured(), test: TEST, corps: CORPS.length });
    if (b.action === "collect") {
      const admin = b.k ? null : await adminOf(req);
      if (!admin && !(await cronOk(b.k))) return json({ error: "forbidden" }, 403);
      if (!configured()) return json({ error: "not configured" }, 503);
      return json(await collect(!!admin));
    }
    const admin = await adminOf(req);
    if (!admin) return json({ error: "admin only" }, 403);
    if (b.action === "status") return json(await status());
    if (!configured()) return json({ error: "not configured" }, 503);
    const c = corpOf(b.corp);
    if (!c) return json({ error: "bad corp" }, 400);
    if (b.action === "url") return URLS[b.to] ? json({ url: (await pb(URLS[b.to], { corp: c })).url || "" }) : json({ error: "bad target" }, 400);
    if (b.action === "join") return json(await join(c, b));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    if (e instanceof PbErr) return json({ error: "popbill", code: e.code, message: e.message }, 502);
    console.error(e);
    return json({ error: String((e && e.message) || e) }, 500);
  }
});
