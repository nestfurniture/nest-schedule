/* 견적서: 앱(index.html)과 고객용 화면(est.html)이 같이 쓰는 계산과 문서 모양.
   모양은 회사 엑셀 견적서(네스트퍼니처_견적서.xlsx)를 따름: 표지 → 요약 → 공간별 상세 견적 → 사양 및 조건.
   rows = 공간 줄 {t:"h",name,en,desc} 과 품목 줄 {t:"i",name,spec,mat,hw,qty,unit,price,note}.
   부가세 vat = add(별도) | incl(포함) | none(없음). 사양 및 조건은 memo 글: "[제목]" 줄은 묶음, "항목: 내용" 줄은 표 한 줄 */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const VAT = { add: "부가세 별도", incl: "부가세 포함", none: "부가세 없음" };
  const WHEN = { 계약금: "계약 체결 시", 중도금: "제작 착수 전 (도면 최종 승인 후)", 잔금: "설치 완료 및 검수 후" };
  const DEF_TERMS = [{ label: "계약금", pct: 30, when: WHEN.계약금 }, { label: "중도금", pct: 40, when: WHEN.중도금 }, { label: "잔금", pct: 30, when: WHEN.잔금 }];
  // 엑셀 상세견적의 공간 11개 (이름 · 영문 · 주요 구성)
  const SPACES = [["현관", "ENTRANCE", "천장형 신발장 · 벤치"], ["거실", "LIVING", "TV 월 수납장 · 아트월"], ["주방", "KITCHEN", "하부장 · 상부장 · 키큰장 · 아일랜드"],
    ["다이닝", "DINING", "다이닝 수납장 · 홈바"], ["안방", "MASTER BEDROOM", "붙박이장 · 화장대"], ["드레스룸", "DRESS ROOM", "시스템 드레스룸 · 아일랜드 서랍장"],
    ["작은방 1", "BEDROOM 1", "붙박이장 · 책상 · 책장"], ["작은방 2", "BEDROOM 2", "붙박이장 · 책상 · 책장"], ["욕실", "BATHROOM", "세면대 하부장 · 상부 수납장"],
    ["다용도실", "UTILITY", "세탁실 수납장 · 팬트리"], ["부대 비용", "SITE WORKS", "배송 · 설치 · 양중 · 철거 · 폐기물"]];
  const DEF_SPECS = `[표준 사양]
몸통 자재: E0 등급 친환경 PB/MDF 18T (KS 인증), 내부 LPM 마감
도어 마감: 무광/유광 도장, 천연 무늬목, 패브릭·가죽 랩핑 중 선택 (공간별 상세 견적 기준)
엣지: ABS 2T 레이저 엣지 (이음선 최소화)
하드웨어: Blum · Hettich 정품 힌지·레일·리프트 (소프트 클로징 기본)
조명: LED 간접조명·센서등은 상세 견적에 표기된 경우 포함

[포함 및 불포함]
포함: 실측, 시공 도면, 제작, 배송, 설치, 설치 후 청소
불포함: 전기·설비·타일 공사, 가전제품, 기존 가구 철거 (상세 견적에 별도 표기 시 포함)

[일정]
제작 기간: 도면 최종 승인 후 약 4~6주 (사양에 따라 변동)
설치: 현장 여건 확인 후 일정 협의

[품질 보증]
무상 A/S: 설치 완료일로부터 1년 (사용자 과실 제외)
하드웨어: 제조사 보증 기준 적용

[유의 사항]
견적 기준: 본 견적은 제공된 도면·실측 전 정보를 기준으로 하며, 실측 후 금액이 조정될 수 있습니다.
변경: 도면 승인 후 사양 변경 시 추가 비용과 일정이 발생할 수 있습니다.
유효기간: 견적일로부터 표지에 표기된 유효기간까지 유효합니다.`;
  const SEC_EN = { "표준 사양": "STANDARD SPECIFICATIONS", "포함 및 불포함": "SCOPE", "일정": "SCHEDULE", "품질 보증": "WARRANTY", "유의 사항": "NOTES" };
  const DEF_TAG = "Bespoke Furniture & Interior Joinery";
  const int = (v) => Math.max(0, Math.round(+String(v ?? "").replace(/[^\d.]/g, "") || 0));
  const sint = (v) => { const n = Math.round(+String(v ?? "").replace(/[^\d.-]/g, "")); return isFinite(n) ? Math.max(-1e10, Math.min(1e10, n)) : 0; };
  const dec = (v) => { const n = +String(v ?? "").replace(/[^\d.]/g, ""); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const str = (v, n) => String(v ?? "").slice(0, n);
  function normRow(r) {
    r = r || {};
    if (r.t === "h") return { t: "h", name: str(r.name, 80), en: str(r.en, 40), desc: str(r.desc, 120) };
    return { t: "i", name: str(r.name, 120), spec: str(r.spec, 120), mat: str(r.mat, 160), hw: str(r.hw, 120), qty: dec(r.qty), unit: str(r.unit, 10), price: int(r.price), note: str(r.note, 120) };
  }
  // when(언제 내는 돈인지)이 없는 예전 조건은 이름으로 채움
  function normTerms(a) {
    return (Array.isArray(a) ? a : []).map((t) => { const label = str(t && t.label, 12) || "계약금";
      return { label, pct: Math.min(100, dec(t && t.pct)), when: typeof (t && t.when) === "string" ? str(t.when, 40) : WHEN[label] || "" }; }).filter((t) => t.pct > 0);
  }
  function norm(d) {
    d = d || {}; const c = d.cust || {};
    return {
      no: str(d.no, 30), date: isDate(d.date) ? d.date : "", valid: Math.min(365, int(d.valid)), ver: Math.max(1, int(d.ver) || 1), base: str(d.base, 40),
      cust: { name: str(c.name, 60), phone: str(c.phone, 30), addr: str(c.addr, 120), mgr: str(c.mgr, 40) }, title: str(d.title, 120),
      rows: (Array.isArray(d.rows) ? d.rows : []).map(normRow), disc: int(d.disc), adj: sint(d.adj), vat: VAT[d.vat] ? d.vat : "add",
      terms: Array.isArray(d.terms) ? normTerms(d.terms) : DEF_TERMS.map((t) => ({ ...t })), memo: str(d.memo, 4000), sentAt: str(d.sentAt, 30),
    };
  }
  /* 회사 정보. fmt 2 = 엑셀 양식으로 바꾼 뒤 저장한 것 (그 전에 앱이 미리 채워 둔 30일은 엑셀 기본값 15일로 봄) */
  function normCompany(d) {
    d = d || {};
    return { name: str(d.name, 40), en: str(d.en, 40) || "NEST FURNITURE", tag: d.tag === undefined ? DEF_TAG : str(d.tag, 80), ceo: str(d.ceo, 20), bizNo: str(d.bizNo, 20),
      addr: str(d.addr, 120), tel: str(d.tel, 30), email: str(d.email, 60), web: str(d.web, 80), bank: str(d.bank, 80),
      prefix: d.prefix === undefined ? "NF" : str(d.prefix, 10).replace(/[^0-9A-Za-z가-힣]/g, ""),
      stamp: /^data:image\/(png|jpeg|webp);base64,/.test(d.stamp || "") ? d.stamp : "",
      valid: d.valid === undefined || (!d.fmt && +d.valid === 30) ? 15 : Math.min(365, int(d.valid)),
      terms: Array.isArray(d.terms) ? normTerms(d.terms) : DEF_TERMS.map((t) => ({ ...t })), memo: str(d.memo, 4000).trim() || DEF_SPECS, fmt: 2 };
  }
  const lineAmt = (r) => (r.t === "i" ? Math.round((+r.qty || 0) * (+r.price || 0)) : 0);
  /* supply = 품목 합계, net = 할인·단수 조정 뒤 공급가액, total = 고객이 낼 돈.
     부가세는 엑셀처럼 원 단위 미만 버림. 포함이면 net 안에 부가세가 들어 있음 */
  function calc(e) {
    const supply = e.rows.reduce((a, r) => a + lineAmt(r), 0), disc = Math.min(e.disc, supply), adj = e.adj || 0, net = Math.max(0, supply - disc + adj);
    let vat = 0, total = net, base = net;
    if (e.vat === "add") { vat = Math.floor(net / 10); total = net + vat; }
    else if (e.vat === "incl") { base = Math.round(net / 1.1); vat = net - base; }
    return { supply, disc, adj, net, vat, total, base };
  }
  /* 결제 조건(%)으로 나눈 금액. 천 원 단위로 맞추고 끝자리는 마지막 줄에 몰아서 합계가 딱 맞게 (엑셀과 같음) */
  function payPlan(terms, total) {
    const t = terms.filter((x) => x.pct > 0); let left = total;
    return t.map((x, k) => { const a = k === t.length - 1 ? left : Math.round(total * x.pct / 100 / 1000) * 1000; left -= a; return { label: x.label, pct: x.pct, when: x.when || "", amount: a }; });
  }
  function hangul(n) {
    n = Math.floor(Math.abs(n)); if (!n) return "영";
    const D = "일이삼사오육칠팔구", S = ["", "십", "백", "천"], B = ["", "만", "억", "조"]; let out = "", i = 0;
    while (n > 0) { let p = n % 10000, s = ""; n = Math.floor(n / 10000);
      for (let k = 0; k < 4 && p; k++) { const d = p % 10; p = Math.floor(p / 10); if (d) s = D[d - 1] + S[k] + s; }
      if (s) out = s + B[i] + out; i++; }
    return out;
  }
  /* 공간별 묶음. 공간 줄보다 앞에 있는 품목은 이름 없는 묶음(문서에는 '기타') */
  function sections(e) {
    const out = []; let cur = null;
    for (const r of e.rows) {
      if (r.t === "h") { cur = { name: r.name, en: r.en, desc: r.desc, items: [], sum: 0 }; out.push(cur); continue; }
      if (!r.name && !r.price && !r.spec && !r.mat) continue;
      if (!cur) { cur = { name: "", en: "", desc: "", items: [], sum: 0 }; out.push(cur); }
      cur.items.push(r); cur.sum += lineAmt(r);
    }
    return out.filter((s) => s.items.length);
  }
  /* 사양 및 조건 글 → [{ko,en,rows:[{k,v}]}] */
  function specs(text) {
    const out = []; let cur = null;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const l = raw.trim(); if (!l) continue;
      const h = l.match(/^\[(.+)\]$/);
      if (h) { const ko = h[1].trim().replace(/\s+/g, " "); cur = { ko, en: SEC_EN[ko] || "", rows: [] }; out.push(cur); continue; }
      if (!cur) { cur = { ko: "", en: "", rows: [] }; out.push(cur); }
      const m = l.match(/^([^:：]{1,16}?)\s*[:：]\s*(.+)$/);
      cur.rows.push(m && !/^https?$/i.test(m[1].trim()) ? { k: m[1].trim(), v: m[2].trim() } : { k: "", v: l });
    }
    return out.filter((s) => s.rows.length);
  }
  const num = (n) => (+n || 0).toLocaleString("ko-KR");
  const W = (n) => (n ? `${n < 0 ? "-" : ""}₩${num(Math.abs(n))}` : "-");
  const qtyTxt = (q) => (q ? (+q).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "");
  const pad2 = (n) => String(n).padStart(2, "0");
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00"); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
  const ko = (d) => (isDate(d) ? `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8)}일` : "");
  const dot = (d) => (isDate(d) ? d.replace(/-/g, ". ") : "");
  const validUntil = (e) => (e.date && e.valid ? addDays(e.date, e.valid) : "");

  /* 문서. co = 회사 정보(normCompany). 화면에서는 종이 여러 장처럼, 인쇄는 A4로 장마다 나뉨(공간마다 새 장).
     좁은 화면에서는 표가 한 줄씩 카드처럼 */
  function doc(e, co) {
    const t = calc(e), plan = payPlan(e.terms, t.total), secs = sections(e), until = validUntil(e), sp = specs(e.memo);
    const brand = esc(co.en || "NEST FURNITURE"), noTxt = e.no ? `${esc(e.no)}${e.ver > 1 ? ` (${e.ver}차)` : ""}` : "";
    const run = `<div class="ed-run"><b>${brand}</b><span>${noTxt ? `No. ${noTxt}` : ""}</span></div>`;
    const totLabel = e.vat === "none" ? "총 견적금액" : "총 견적금액 (VAT 포함)";
    const lb = (en, k) => (en ? `<span class="ed-lb">${en}</span><small>${k}</small>` : `<span class="ed-lb">${k}</span>`);
    const sep = '<span class="ed-sep">|</span>';

    const cvRow = (en, k, v) => `<div class="ed-cr"><div class="ed-ck">${lb(en, k)}</div><div class="ed-cv">${v}</div></div>`;
    const cover = `<section class="ed-pg ed-cover"><i class="ed-bar"></i>
  <div class="ed-brand"><b>${brand}</b>${co.tag ? `<i>${esc(co.tag)}</i>` : ""}</div><i class="ed-gap ed-g3"></i>
  <h1 class="ed-title">가구제작견적서</h1><i class="ed-rule"></i>
  <div class="ed-proj"><span class="ed-lb">PROJECT</span><p>${esc(e.title)}</p></div><i class="ed-gap"></i>
  <div class="ed-cvs">${cvRow("", "업체", esc(e.cust.name))}${cvRow("SITE", "현장", esc(e.cust.addr))}${cvRow("DESIGNER", "담당", esc(e.cust.mgr))}${cvRow("DATE", "견적일", dot(e.date))}${cvRow("NO.", "견적번호", noTxt)}${cvRow("VALID UNTIL", "유효기간", dot(until))}</div><i class="ed-gap ed-g2"></i>
  <div class="ed-ctot"><div class="ed-ck">${lb("TOTAL AMOUNT", totLabel)}</div><div class="ed-cv">${W(t.total)}</div></div><i class="ed-gap ed-g2"></i>
  <div class="ed-cfoot"><p>${[co.name || "네스트퍼니처", co.bizNo && `사업자등록번호 ${co.bizNo}`, co.addr].filter(Boolean).map(esc).join(sep)}</p><p>${[co.tel && `T. ${co.tel}`, co.email, co.web].filter(Boolean).map(esc).join(sep)}</p></div>
</section>`;

    const meta = [["PROJECT", esc(e.title)], ["업체", esc(e.cust.name)], ["SITE", esc(e.cust.addr)], ["DATE", dot(e.date)], ["VALID UNTIL", dot(until)]]
      .map(([k, v]) => `<div><dt class="ed-lb">${k}</dt><dd>${v}</dd></div>`).join("");
    const showSm = secs.length > 1 || (secs[0] && secs[0].name);
    const smRows = secs.map((s, k) => `<tr><td class="n">${pad2(k + 1)}</td><td class="nm"><b>${esc(s.name || "기타")}</b>${s.en ? ` <b class="en">${esc(s.en)}</b>` : ""}</td><td class="ds">${esc(s.desc)}</td><td class="r">${t.supply && s.sum ? `${Math.round(s.sum / t.supply * 100)}%` : "-"}</td><td class="a">${W(s.sum)}</td></tr>`).join("");
    const tr = (k, v, cls = "") => `<tr class="${cls}"><th>${k}</th><td class="g"></td><td>${v}</td></tr>`;
    const tot = tr(e.vat === "incl" ? "품목 합계" : "공급가 합계", W(t.supply), "b top") + tr("특별 할인", W(-t.disc)) + tr("단수 조정", W(t.adj))
      + tr("공급가액", W(t.base), "b") + (e.vat === "none" ? "" : tr("부가세", W(t.vat)));
    const pay = plan.length && t.total ? `<div class="ed-payh"><span class="ed-lb">PAYMENT SCHEDULE</span><small>결제 일정</small></div>
  <table class="ed-pay"><colgroup><col class="c-l"><col class="c-w"><col class="c-p"><col class="c-a"></colgroup><tbody>${plan.map((p) => `<tr><td class="l">${esc(p.label)}</td><td class="w">${esc(p.when)}</td><td class="p">${qtyTxt(p.pct)}%</td><td class="a">${W(p.amount)}</td></tr>`).join("")}</tbody></table>` : "";
    const seal = `<span class="ed-seal">(인)${co.stamp ? `<img class="ed-stamp" src="${esc(co.stamp)}" alt="">` : ""}</span>`;
    const summary = `<section class="ed-pg ed-sum">${run}<h2 class="ed-h">SUMMARY<small>견적 요약</small></h2><dl class="ed-meta">${meta}</dl>
  ${showSm ? `<table class="ed-sm"><colgroup><col class="c-n"><col class="c-nm"><col class="c-ds"><col class="c-r"><col class="c-a"></colgroup><thead><tr><th class="n">No.</th><th>공간</th><th>주요 구성</th><th class="r">비중</th><th class="a">${e.vat === "incl" ? "금액 (VAT 포함)" : "금액 (공급가)"}</th></tr></thead><tbody>${smRows}</tbody></table>` : ""}
  <table class="ed-tot"><colgroup><col class="c-k"><col class="c-g"><col class="c-v"></colgroup><tbody>${tot}</tbody></table>
  <div class="ed-total"><b>TOTAL</b><span>${totLabel}</span><strong>${W(t.total)}</strong></div>
  ${pay}${co.bank ? `<p class="ed-bank">입금 계좌&nbsp; ${esc(co.bank)}</p>` : ""}
  <p class="ed-lead">위와 같이 견적을 제안드립니다.</p>
  <div class="ed-sign"><div class="ed-sg"><span class="ed-lb">SUPPLIER</span><p><span>${esc(co.name || "네스트퍼니처")}${co.ceo ? `&nbsp; 대표 ${esc(co.ceo)}` : ""}&nbsp; ${seal}</span></p></div>
    <div class="ed-sg"><span class="ed-lb">업체</span><p><span>${esc(e.cust.name)}</span><small>(서명)</small></p></div></div>
</section>`;

    const cols = `<colgroup><col class="c-n"><col class="c-nm"><col class="c-sp"><col class="c-mt"><col class="c-hw"><col class="c-q"><col class="c-u"><col class="c-p"><col class="c-a"><col class="c-nt"></colgroup>`;
    const dhead = `<thead><tr class="ed-runrow"><th colspan="10">${run}<h2 class="ed-h">DETAILED QUOTATION<small>공간별 상세 견적</small></h2></th></tr>
  <tr class="ed-cols"><th>No.</th><th>품목</th><th>규격 (W×D×H, mm)</th><th>소재 · 마감</th><th>하드웨어</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>비고</th></tr></thead>`;
    const item = (r, no) => { const a = lineAmt(r), m = [r.qty ? `${qtyTxt(r.qty)}${esc(r.unit)}` : "", r.price ? `× ${num(r.price)}원` : ""].filter(Boolean).join(" ");
      return `<tr class="it"><td class="n">${no}</td><td class="nm">${esc(r.name)}</td><td class="sp">${esc(r.spec).replace(/([×xX*/])/g, "$1<wbr>")}</td><td class="mt">${esc(r.mat)}</td><td class="hw">${esc(r.hw)}</td><td class="m">${m}</td><td class="q">${qtyTxt(r.qty)}</td><td class="u">${esc(r.unit)}</td><td class="p">${r.price ? num(r.price) : ""}</td><td class="a">${a ? num(a) : ""}</td><td class="nt">${esc(r.note)}</td></tr>`; };
    const detail = (secs.length ? secs : [null]).map((s, k) => `<section class="ed-pg ed-dpg"><table class="ed-dt">${cols}${dhead}<tbody>${s
      ? `${showSm ? `<tr class="sp"><td class="n">${pad2(k + 1)}</td><td class="nm">${esc(s.name || "기타")}</td><td class="en">${esc(s.en)}</td><td class="ds" colspan="4">${esc(s.desc)}</td><td colspan="3"></td></tr>` : ""}
  ${s.items.map((r, i) => item(r, `${k + 1}-${i + 1}`)).join("")}
  <tr class="st"><td class="k" colspan="8">소계</td><td class="a">${W(s.sum)}</td><td class="nt">${esc(s.name)}</td></tr>`
      : `<tr class="none"><td colspan="10">품목을 넣으면 여기에 보여요.</td></tr>`}</tbody></table></section>`).join("");

    const specPage = sp.length ? `<section class="ed-pg ed-spg">${run}<h2 class="ed-h">SPECIFICATIONS &amp; TERMS<small>표준 사양 및 계약 조건</small></h2>
  ${sp.map((s) => `<div class="ed-spec">${s.ko ? `<div class="ed-sph">${lb(esc(s.en), esc(s.ko))}</div>` : ""}${s.rows.map((r) => (r.k ? `<div class="ed-spr"><b>${esc(r.k)}</b><p>${esc(r.v)}</p></div>` : `<div class="ed-spr full"><p>${esc(r.v)}</p></div>`)).join("")}</div>`).join("")}
</section>` : "";
    return `<article class="ed">${cover}${summary}${detail}${specPage}</article>`;
  }

  const css = `
.ed{container:ed/inline-size;--bg:#F6EFE1;--lt:#FFFBF3;--a:#CC5500;--st:#F2DCC6;--i:#3A2E26;--m:#5E5048;--mu:#9C8B7E;--hl:#D9CBB5;
  --sans:"Noto Sans KR",system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;--serif:Georgia,"Times New Roman","Noto Serif KR",serif;
  background:#E6DFD2;padding:12px;display:flex;flex-direction:column;gap:12px;color:var(--i);font-family:var(--sans);font-size:12.5px;line-height:1.5;
  max-width:820px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.ed *{box-sizing:border-box}
.ed table{min-width:0;width:100%;border-collapse:collapse;table-layout:fixed}
.ed th,.ed td{padding:0;border:0;background:none;letter-spacing:normal;white-space:normal;font:inherit;color:inherit;text-align:left;vertical-align:middle}
.ed tbody tr{cursor:auto}
.ed tbody tr:hover{background:none}
.ed h1,.ed h2{display:block;margin:0;text-wrap:wrap;font-weight:400}
.ed p,.ed dl,.ed dd,.ed dt{margin:0}
.ed i{font-style:normal}
.ed-pg{background:var(--bg);padding:28px 32px 34px;box-shadow:0 1px 2px rgba(58,46,38,.12)}
.ed-lb{font-family:var(--serif);font-weight:700;color:var(--a);font-size:10.5px;letter-spacing:.03em;line-height:1.35}
.ed-run{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px solid var(--i);padding-bottom:3px;text-align:left}
.ed-run b{font-family:var(--serif);font-weight:700;font-size:13.5px}
.ed-run span{font-family:var(--serif);font-size:11px;color:var(--mu);white-space:nowrap}
.ed-h{font-family:var(--serif);font-size:24px;line-height:1.2;margin-top:22px!important;text-align:left}
.ed-h small{display:block;font-family:var(--sans);font-size:12.5px;color:var(--m);margin-top:5px}
/* 표지 */
.ed-cover{display:flex;flex-direction:column;min-height:1080px;padding-top:0}
.ed-bar{display:block;height:13px;background:var(--a);margin:0 -32px 46px}
.ed-brand b{display:block;font-family:var(--serif);font-weight:700;font-size:15px;border-bottom:1px solid var(--i);padding-bottom:3px}
.ed-brand i{display:block;font-family:var(--serif);font-style:italic;font-size:11px;color:var(--mu);margin-top:4px}
.ed-gap{display:block;flex:1 1 0;min-height:26px}
.ed-g2{flex-grow:1.6}
.ed-g3{flex-grow:4}
.ed-title{font-size:35px;font-weight:700!important;line-height:1.25;letter-spacing:-.01em}
.ed-rule{display:block;width:40%;height:2px;background:var(--a);margin:28px 0 30px}
.ed-proj .ed-lb{display:block;margin-bottom:8px}
.ed-proj p{font-size:20px;font-weight:700;min-height:34px;word-break:keep-all;overflow-wrap:break-word}
.ed-cr,.ed-ctot{display:grid;grid-template-columns:19% minmax(0,1fr);gap:12px;align-items:start}
.ed-cr{padding:7px 0 9px;border-bottom:.5px solid var(--hl)}
.ed-cr:first-child{border-bottom:0;margin-bottom:8px}
.ed-ck small{display:block;font-size:10.5px;color:var(--mu);margin-top:3px}
.ed-cv{font-size:14px;word-break:keep-all;overflow-wrap:break-word}
.ed-ctot{align-items:center;border-bottom:2px solid var(--a);padding-bottom:8px}
.ed-ctot .ed-cv{font-family:var(--serif);font-size:27px;font-variant-numeric:tabular-nums}
.ed-cfoot{display:flex;flex-direction:column;gap:9px;font-size:10px;color:var(--mu);padding-bottom:6px}
.ed-sep{margin:0 10px;color:var(--hl)}
/* 요약 */
.ed-meta{margin-top:20px}
.ed-meta div{display:grid;grid-template-columns:23.7% minmax(0,1fr);gap:8px;align-items:center;min-height:27px;border-bottom:.5px solid var(--hl);padding:3px 0}
.ed-meta dd{font-size:12.5px;word-break:keep-all;overflow-wrap:break-word}
.ed-sm{margin-top:34px}
.ed-sm .c-n{width:7.2%}.ed-sm .c-nm{width:37.1%}.ed-sm .c-ds{width:26.8%}.ed-sm .c-r{width:10.3%}.ed-sm .c-a{width:18.6%}
.ed-sm th{background:var(--a);color:#fff;font-weight:700;font-size:11px;padding:6px 8px;height:29px}
.ed-sm th.n,.ed-sm th.r{text-align:center}
.ed-sm th.a{text-align:right}
.ed-sm td{border-bottom:.5px solid var(--hl);padding:6px 8px;height:32px;word-break:keep-all;overflow-wrap:break-word}
.ed-sm td.n{text-align:center;font-family:var(--serif);color:var(--a);font-size:13px}
.ed-sm td.nm b{font-weight:700;font-size:12.5px}
.ed-sm td.nm .en{margin-left:.3em}
.ed-sm td.ds{font-size:11px;color:var(--m)}
.ed-sm td.r{text-align:center;font-size:11px;color:var(--mu)}
.ed-sm td.a{text-align:right;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ed-tot{width:61.4%;margin-left:auto}
.ed-tot .c-k{width:48.2%}.ed-tot .c-g{width:18.5%}.ed-tot .c-v{width:33.3%}
.ed-tot th{text-align:right;font-size:12px;color:var(--m);padding:5px 0 5px 8px;height:29px;white-space:nowrap}
.ed-tot td{text-align:right;font-size:13px;padding:5px 8px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ed-tot tr.b th,.ed-tot tr.b td{font-weight:700}
.ed-tot tr.b td{color:var(--i)}
.ed-tot tr.top th,.ed-tot tr.top td{border-top:1px solid var(--hl)}
.ed-total{margin-top:24px;background:var(--a);color:#fff;display:grid;grid-template-columns:23.7% minmax(0,1fr) auto;align-items:center;gap:8px;min-height:45px;padding:6px 10px}
.ed-total b{font-family:var(--serif);font-weight:700;font-size:12px;letter-spacing:.03em}
.ed-total span{font-size:12px}
.ed-total strong{font-family:var(--serif);font-weight:700;font-size:19px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ed-payh{margin-top:36px;display:grid;grid-template-columns:44.3% minmax(0,1fr);align-items:baseline;padding-bottom:5px}
.ed-payh small{font-size:11px;color:var(--mu)}
.ed-pay .c-l{width:23.7%}.ed-pay .c-w{width:47.4%}.ed-pay .c-p{width:10.3%}.ed-pay .c-a{width:18.6%}
.ed-pay td{border-bottom:.5px solid var(--hl);padding:5px 8px;height:29px}
.ed-pay td.l{font-weight:700;font-size:12.5px}
.ed-pay td.w{font-size:11px;color:var(--m)}
.ed-pay td.p{text-align:center;font-size:12px}
.ed-pay td.a{text-align:right;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ed-bank{margin-top:24px!important;font-size:11.5px;color:var(--m);word-break:keep-all;overflow-wrap:break-word}
.ed-lead{margin-top:34px!important;font-size:12px;color:var(--m)}
.ed-sign{display:grid;grid-template-columns:44.3% minmax(0,1fr);margin-top:20px}
.ed-sg .ed-lb{display:block;margin-bottom:8px}
.ed-sg p{border-bottom:1px solid var(--i);min-height:40px;display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 0}
.ed-sg p small{margin-left:auto;font-size:10.5px;color:var(--mu);white-space:nowrap}
.ed-seal{position:relative;display:inline-block;color:var(--m);white-space:nowrap}
.ed-stamp{position:absolute;left:50%;top:50%;width:52px;height:52px;object-fit:contain;transform:translate(-50%,-50%);mix-blend-mode:multiply;pointer-events:none}
/* 공간별 상세 견적 */
.ed-dt .c-n{width:4.4%}.ed-dt .c-nm{width:14.4%}.ed-dt .c-sp{width:12.6%}.ed-dt .c-mt{width:17.6%}.ed-dt .c-hw{width:10%}
.ed-dt .c-q{width:4.6%}.ed-dt .c-u{width:4.6%}.ed-dt .c-p{width:10%}.ed-dt .c-a{width:12.8%}.ed-dt .c-nt{width:9%}
.ed-runrow th{padding-bottom:18px}
.ed-cols th{background:var(--a);color:#fff;font-weight:700;font-size:10.5px;text-align:center;padding:4px 3px;height:32px;line-height:1.25;word-break:keep-all}
.ed-dt tr.sp td{padding:16px 6px 5px;border-bottom:2px solid var(--a);vertical-align:bottom;word-break:keep-all;overflow-wrap:break-word}
.ed-dt tr.sp td.n{font-family:var(--serif);color:var(--a);font-size:18.5px;line-height:1.1;padding-left:2px;padding-right:0}
.ed-dt tr.sp td.nm{font-weight:700;font-size:16px;line-height:1.2;background:var(--lt)}
.ed-dt tr.sp td.en{font-family:var(--serif);font-size:11.5px;color:var(--mu);background:var(--lt)}
.ed-dt tr.sp td.ds{font-size:11px;color:var(--mu);background:var(--lt)}
.ed-dt tr.it td{border-bottom:.5px solid var(--hl);padding:6px 5px;height:32px;font-size:11.5px;word-break:keep-all;overflow-wrap:break-word;background:var(--lt)}
.ed-dt tr.it td.n,.ed-dt tr.it td.a{background:none}
.ed-dt tr.it td.n{text-align:center;font-family:var(--serif);font-size:10.5px;color:var(--mu);padding:6px 1px}
.ed-dt tr.it td.nm{font-weight:700;font-size:12px}
.ed-dt tr.it td.q,.ed-dt tr.it td.u{text-align:center;white-space:nowrap;padding:6px 2px}
.ed-dt tr.it td.p,.ed-dt tr.it td.a{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding:6px 4px}
.ed-dt tr.it td.a{font-size:12px}
.ed-dt tr.it td.sp{font-size:11px}
.ed-dt tr.it td.nt{font-size:10.5px;color:var(--mu)}
.ed-dt tr.it td.m{display:none}
.ed-dt tr.st td{border-top:1px solid var(--hl);padding:5px 6px;height:30px}
.ed-dt tr.st td.k{text-align:right;font-weight:700;font-size:11px;color:var(--m)}
.ed-dt tr.st td.a{background:var(--st);text-align:right;font-weight:700;font-size:12.5px;white-space:nowrap;font-variant-numeric:tabular-nums;padding:5px 4px}
.ed-dt tr.st td.nt{font-size:10.5px;color:var(--mu)}
.ed-dt tr.none td{text-align:center;color:var(--mu);padding:26px}
.ed-dt tr.it,.ed-dt tr.st{break-inside:avoid}
/* 사양 및 조건 */
.ed-spec{margin-top:24px}
.ed-sph{display:grid;grid-template-columns:23.9% minmax(0,1fr);gap:8px;align-items:center;border-bottom:2px solid var(--a);min-height:31px;padding:4px 0}
.ed-sph small{font-size:11px;color:var(--mu)}
.ed-spr{display:grid;grid-template-columns:23.9% minmax(0,1fr);border-bottom:.5px solid var(--hl);break-inside:avoid}
.ed-spr b{font-size:12px;color:var(--m);font-weight:700;padding:10px 8px 10px 6px;align-self:center}
.ed-spr p{background:var(--lt);padding:10px 10px;font-size:12px;min-height:43px;display:flex;align-items:center;word-break:keep-all;overflow-wrap:break-word;white-space:pre-wrap}
.ed-spr.full{grid-template-columns:minmax(0,1fr)}
@container ed (max-width:620px){
  .ed{padding:6px;gap:6px}
  .ed-pg{padding:18px 16px 22px}
  .ed-cover{min-height:0}
  .ed-bar{margin:0 -16px 26px}
  .ed-gap{flex:none;min-height:20px}
  .ed-g3{min-height:44px}
  .ed-title{font-size:28px}
  .ed-rule{margin:18px 0 22px}
  .ed-proj p{font-size:18px}
  .ed-cr,.ed-ctot{grid-template-columns:31% minmax(0,1fr)}
  .ed-ctot .ed-cv{font-size:22px}
  .ed-meta div{grid-template-columns:31% minmax(0,1fr)}
  .ed-sm{margin-top:24px}
  .ed-sm,.ed-sm tbody{display:block}
  .ed-sm colgroup,.ed-sm thead{display:none}
  .ed-sm tr{display:grid;grid-template-columns:26px minmax(0,1fr) auto;column-gap:8px;border-bottom:.5px solid var(--hl);padding:8px 0}
  .ed-sm td{border:0;padding:0;height:auto}
  .ed-sm td.n{grid-row:1/3;text-align:left}
  .ed-sm td.nm{grid-column:2;grid-row:1}
  .ed-sm td.a{grid-column:3;grid-row:1}
  .ed-sm td.ds{grid-column:2;grid-row:2}
  .ed-sm td.r{grid-column:3;grid-row:2;text-align:right}
  .ed-sm td.nm .en{display:inline-block}
  .ed-tot{width:100%;table-layout:auto}
  .ed-tot col{width:auto!important}
  .ed-tot td.g{display:none}
  .ed-tot th{text-align:left;padding-left:0}
  .ed-total{grid-template-columns:auto minmax(0,1fr);padding:10px 12px}
  .ed-total strong{grid-column:1/-1;text-align:right}
  .ed-payh{grid-template-columns:auto minmax(0,1fr);gap:10px;margin-top:28px}
  .ed-pay,.ed-pay tbody{display:block}
  .ed-pay colgroup{display:none}
  .ed-pay tr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:10px;align-items:baseline;border-bottom:.5px solid var(--hl);padding:7px 0}
  .ed-pay td{border:0;padding:0;height:auto}
  .ed-pay td.p{text-align:left;color:var(--m)}
  .ed-pay td.w{grid-column:1/-1;grid-row:2}
  .ed-lead{margin-top:26px!important}
  .ed-sign{grid-template-columns:minmax(0,1fr);gap:16px}
  .ed-dt,.ed-dt thead,.ed-dt tbody,.ed-runrow,.ed-runrow th{display:block}
  .ed-dt colgroup,.ed-cols{display:none}
  .ed-runrow th{padding-bottom:4px}
  .ed-dpg+.ed-dpg .ed-runrow{display:none}
  .ed-dt tr.sp{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;border-bottom:2px solid var(--a);padding:12px 0 5px}
  .ed-dt tr.sp td,.ed-dt tr.sp td.nm,.ed-dt tr.sp td.en,.ed-dt tr.sp td.ds{display:block;border:0;padding:0;background:none}
  .ed-dt tr.sp td:empty{display:none}
  .ed-dt tr.sp td.ds{flex-basis:100%;margin-top:2px}
  .ed-dt tr.it{display:grid;grid-template-columns:30px minmax(0,1fr) auto;column-gap:8px;row-gap:1px;border-bottom:.5px solid var(--hl);padding:8px 0}
  .ed-dt tr.it td{border:0;padding:0;height:auto;background:none}
  .ed-dt tr.it td.n{grid-row:1/span 7;text-align:left;padding:1px 0 0}
  .ed-dt tr.it td.nm{grid-column:2;grid-row:1}
  .ed-dt tr.it td.a{grid-column:3;grid-row:1;padding:0}
  .ed-dt tr.it td.sp,.ed-dt tr.it td.mt,.ed-dt tr.it td.hw,.ed-dt tr.it td.m,.ed-dt tr.it td.nt{grid-column:2/4;color:var(--m);font-size:11.5px}
  .ed-dt tr.it td.sp::before{content:"규격  ";color:var(--mu)}
  .ed-dt tr.it td.mt::before{content:"소재·마감  ";color:var(--mu)}
  .ed-dt tr.it td.hw::before{content:"하드웨어  ";color:var(--mu)}
  .ed-dt tr.it td.m{display:block}
  .ed-dt tr.it td.nt{color:var(--mu)}
  .ed-dt tr.it td.q,.ed-dt tr.it td.u,.ed-dt tr.it td.p,.ed-dt tr.it td:empty{display:none}
  .ed-dt tr.st{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:6px 0}
  .ed-dt tr.st td{display:block;border:0;height:auto}
  .ed-dt tr.st td.nt{display:none}
  .ed-dt tr.none,.ed-dt tr.none td{display:block}
  .ed-sph,.ed-spr{grid-template-columns:minmax(0,1fr)}
  .ed-sph{gap:2px}
  .ed-spr b{padding:9px 0 2px}
  .ed-spr p{background:none;padding:0 0 9px;min-height:0;display:block}
}
@media print{
  .ed{max-width:none;background:none;padding:0;gap:0;display:block}
  .ed-pg{box-shadow:none;break-before:page;padding:6mm 7mm 8mm}
  .ed-pg:first-child{break-before:auto}
  .ed-cover{min-height:279mm;padding-top:0}
  .ed-bar{margin:0 -7mm 12mm}
}
`;
  // 앱 화면의 표·제목 모양이 문서에 섞이지 않게 문서 안 규칙은 모두 .ed 아래로
  const cssScoped = css.replace(/(^|[,{}]\s*|\n\s*)\.ed-/g, "$1.ed .ed-");
  window.NEST_EST = { esc, VAT, WHEN, DEF_TERMS, DEF_SPECS, SPACES, norm, normCompany, normRow, normTerms, calc, payPlan, lineAmt, hangul, sections, specs, doc, css: cssScoped, validUntil, ko, dot, qtyTxt };
})();
