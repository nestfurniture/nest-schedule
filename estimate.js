/* 견적서: 앱(index.html)과 고객용 화면(est.html)이 같이 쓰는 계산과 문서 모양.
   rows = 구분 줄 {t:"h",name} 과 품목 줄 {t:"i",name,spec,qty,unit,price,note}. 부가세 vat = add(별도) | incl(포함) | none(없음) */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const VAT = { add: "부가세 별도", incl: "부가세 포함", none: "부가세 없음" };
  const DEF_TERMS = [{ label: "계약금", pct: 30 }, { label: "중도금", pct: 40 }, { label: "잔금", pct: 30 }];
  const int = (v) => Math.max(0, Math.round(+String(v ?? "").replace(/[^\d.]/g, "") || 0));
  const dec = (v) => { const n = +String(v ?? "").replace(/[^\d.]/g, ""); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const str = (v, n) => String(v ?? "").slice(0, n);
  function normRow(r) {
    r = r || {};
    if (r.t === "h") return { t: "h", name: str(r.name, 80) };
    return { t: "i", name: str(r.name, 120), spec: str(r.spec, 120), qty: dec(r.qty), unit: str(r.unit, 10), price: int(r.price), note: str(r.note, 120) };
  }
  function normTerms(a) { return (Array.isArray(a) ? a : []).map((t) => ({ label: str(t && t.label, 12) || "계약금", pct: Math.min(100, dec(t && t.pct)) })).filter((t) => t.pct > 0); }
  function norm(d) {
    d = d || {}; const c = d.cust || {};
    return {
      no: str(d.no, 30), date: isDate(d.date) ? d.date : "", valid: Math.min(365, int(d.valid)), ver: Math.max(1, int(d.ver) || 1), base: str(d.base, 40),
      cust: { name: str(c.name, 60), phone: str(c.phone, 30), addr: str(c.addr, 120) }, title: str(d.title, 120),
      rows: (Array.isArray(d.rows) ? d.rows : []).map(normRow), disc: int(d.disc), vat: VAT[d.vat] ? d.vat : "add",
      terms: Array.isArray(d.terms) ? normTerms(d.terms) : DEF_TERMS.map((t) => ({ ...t })), memo: str(d.memo, 2000), sentAt: str(d.sentAt, 30),
    };
  }
  function normCompany(d) {
    d = d || {};
    return { name: str(d.name, 40), ceo: str(d.ceo, 20), bizNo: str(d.bizNo, 20), addr: str(d.addr, 120), tel: str(d.tel, 30), email: str(d.email, 60), bank: str(d.bank, 80),
      stamp: /^data:image\/(png|jpeg|webp);base64,/.test(d.stamp || "") ? d.stamp : "", valid: d.valid === undefined ? 30 : Math.min(365, int(d.valid)),
      terms: Array.isArray(d.terms) ? normTerms(d.terms) : DEF_TERMS.map((t) => ({ ...t })), memo: str(d.memo, 2000) };
  }
  const lineAmt = (r) => (r.t === "i" ? Math.round((+r.qty || 0) * (+r.price || 0)) : 0);
  /* supply = 품목 합계, net = 할인 뺀 금액, total = 고객이 낼 돈. 포함이면 net 안에 부가세가 들어 있음 */
  function calc(e) {
    const supply = e.rows.reduce((a, r) => a + lineAmt(r), 0), disc = Math.min(e.disc, supply), net = supply - disc;
    let vat = 0, total = net, base = net;
    if (e.vat === "add") { vat = Math.round(net * 0.1); total = net + vat; }
    else if (e.vat === "incl") { base = Math.round(net / 1.1); vat = net - base; }
    return { supply, disc, net, vat, total, base };
  }
  /* 결제 조건(%)으로 나눈 금액. 끝자리는 마지막 줄에 몰아서 합계가 딱 맞게 */
  function payPlan(terms, total) {
    const t = terms.filter((x) => x.pct > 0); let left = total;
    return t.map((x, k) => { const a = k === t.length - 1 ? left : Math.round(total * x.pct / 100 / 1000) * 1000; left -= a; return { label: x.label, pct: x.pct, amount: a }; });
  }
  function hangul(n) {
    n = Math.floor(Math.abs(n)); if (!n) return "영";
    const D = "일이삼사오육칠팔구", S = ["", "십", "백", "천"], B = ["", "만", "억", "조"]; let out = "", i = 0;
    while (n > 0) { let p = n % 10000, s = ""; n = Math.floor(n / 10000);
      for (let k = 0; k < 4 && p; k++) { const d = p % 10; p = Math.floor(p / 10); if (d) s = D[d - 1] + S[k] + s; }
      if (s) out = s + B[i] + out; i++; }
    return out;
  }
  const num = (n) => (+n || 0).toLocaleString("ko-KR");
  const qtyTxt = (q) => (q ? (+q).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "");
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00"); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const ko = (d) => (isDate(d) ? `${d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8)}일` : "");
  const validUntil = (e) => (e.date && e.valid ? addDays(e.date, e.valid) : "");

  /* 문서 한 장. co = 회사 정보(normCompany). 좁은 화면에서는 품목이 한 줄씩 카드처럼, 인쇄는 A4 표 */
  function doc(e, co) {
    const t = calc(e), plan = payPlan(e.terms, t.total), heads = e.rows.some((r) => r.t === "h");
    let n = 0, body = "", secName = "", secSum = 0, secItems = 0;
    const closeSec = () => { if (heads && secName && secItems) body += `<tr class="st"><td colspan="6">${esc(secName)} 소계</td><td class="a">${num(secSum)}</td><td></td></tr>`; };
    for (const r of e.rows) {
      if (r.t === "h") { closeSec(); secName = r.name; secSum = 0; secItems = 0; if (r.name) body += `<tr class="h"><td colspan="8">${esc(r.name)}</td></tr>`; continue; }
      if (!r.name && !r.price) continue;
      n++; secItems++; const a = lineAmt(r); secSum += a;
      const m = [r.qty ? `${qtyTxt(r.qty)}${esc(r.unit)}` : "", r.price ? `× ${num(r.price)}원` : ""].filter(Boolean).join(" ");
      body += `<tr><td class="n">${n}</td><td class="nm">${esc(r.name)}</td><td class="sp">${esc(r.spec)}</td><td class="m">${m}</td><td class="q">${qtyTxt(r.qty)}</td><td class="u">${esc(r.unit)}</td><td class="p">${r.price ? num(r.price) : ""}</td><td class="a">${a ? num(a) : ""}</td><td class="nt">${esc(r.note)}</td></tr>`;
    }
    closeSec();
    if (!n) body += `<tr class="none"><td colspan="8">품목을 넣으면 여기에 보여요.</td></tr>`;
    const kv = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : "");
    const until = validUntil(e);
    const fromRow = (k, v, cls = "") => (v ? `<tr><th>${k}</th><td class="${cls}">${v}</td></tr>` : "");
    const ceo = co.ceo ? `${esc(co.ceo)} <span class="ed-seal">(인)${co.stamp ? `<img class="ed-stamp" src="${esc(co.stamp)}" alt="">` : ""}</span>` : (co.stamp ? `<span class="ed-seal">(인)<img class="ed-stamp" src="${esc(co.stamp)}" alt=""></span>` : "");
    const fromRows = [fromRow("등록번호", esc(co.bizNo)), fromRow("상호", esc(co.name || "네스트퍼니처")), fromRow("대표자", ceo, "ed-ceo"), fromRow("주소", esc(co.addr)), fromRow("연락처", [co.tel, co.email].filter(Boolean).map(esc).join("<br>"))].filter(Boolean);
    const totRows = e.vat === "add"
      ? `${t.disc ? `<tr><th>품목 합계</th><td>${num(t.supply)}</td></tr><tr><th>할인</th><td>-${num(t.disc)}</td></tr>` : ""}<tr><th>공급가액</th><td>${num(t.net)}</td></tr><tr><th>부가세 (10%)</th><td>${num(t.vat)}</td></tr>`
      : `${t.disc ? `<tr><th>품목 합계</th><td>${num(t.supply)}</td></tr><tr><th>할인</th><td>-${num(t.disc)}</td></tr>` : ""}${e.vat === "incl" ? `<tr class="sm"><th>공급가액 · 부가세</th><td>${num(t.base)} · ${num(t.vat)}</td></tr>` : ""}`;
    return `<article class="ed"><div class="ed-in">
  <header class="ed-top"><div class="ed-brand"><span class="ed-wm">NEST FURNITURE</span></div><h1 class="ed-title">견적서</h1>
    <div class="ed-no">${e.no ? `No. ${esc(e.no)}` : ""}${e.ver > 1 ? ` <span>${e.ver}차</span>` : ""}</div></header>
  <section class="ed-head">
    <div class="ed-to"><p class="ed-cust"><b>${esc(e.cust.name) || "&nbsp;"}</b> 귀하</p>
      <dl class="ed-kv">${kv("견적일", ko(e.date))}${kv("공사명", esc(e.title))}${kv("현장", esc(e.cust.addr))}${kv("유효기간", until ? `${ko(until)}까지` : "")}</dl>
      <p class="ed-lead">아래와 같이 견적합니다.</p></div>
    <div class="ed-fromw"><table class="ed-from"><tbody>${fromRows.map((r, k) => (k ? r : r.replace("<tr>", `<tr><th class="ed-vh" rowspan="${fromRows.length}">공<br>급<br>자</th>`))).join("")}</tbody></table></div>
  </section>
  <div class="ed-sum"><span class="k">합계금액 <small>(${VAT[e.vat]})</small></span><span class="w">일금 ${hangul(t.total)}원정</span><span class="n">₩${num(t.total)}</span></div>
  <table class="ed-items"><thead><tr><th class="n">No</th><th class="nm">품명</th><th class="sp">규격</th><th class="q">수량</th><th class="u">단위</th><th class="p">단가</th><th class="a">금액</th><th class="nt">비고</th></tr></thead><tbody>${body}</tbody></table>
  <table class="ed-tot"><tbody>${totRows}<tr class="g"><th>합계${e.vat === "none" ? "" : e.vat === "incl" ? " (부가세 포함)" : ""}</th><td>${num(t.total)}원</td></tr></tbody></table>
  <section class="ed-notes">
    ${plan.length && t.total ? `<div><h3>결제 조건</h3><p class="ed-terms">${plan.map((p) => `<span>${esc(p.label)} ${qtyTxt(p.pct)}% <b>${num(p.amount)}원</b></span>`).join("")}</p></div>` : ""}
    ${co.bank ? `<div><h3>입금 계좌</h3><p>${esc(co.bank)}</p></div>` : ""}
    ${e.memo ? `<div><h3>조건 · 안내</h3><p>${esc(e.memo)}</p></div>` : ""}
  </section>
  <footer class="ed-foot"><span>${esc(co.name || "네스트퍼니처")}${co.tel ? ` · ${esc(co.tel)}` : ""}</span><span class="ed-wm sm">NEST FURNITURE</span></footer>
</div></article>`;
  }

  const css = `
.ed{container:ed/inline-size;background:#fff;color:#2B2A28;font-family:"Noto Sans KR",system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:13px;line-height:1.55;max-width:794px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.ed *{box-sizing:border-box}
.ed table{min-width:0;width:auto;border-collapse:collapse}
.ed th,.ed td{letter-spacing:normal;border:0;background:none}
.ed tbody tr{cursor:auto}
.ed tbody tr:hover{background:none}
.ed h1{display:block;text-wrap:wrap}
.ed-in{--i:#2B2A28;--m:#6E655B;--l:#E3DDD2;--s:#B9AFA0;--a:#A9471C;--t:#F6F4EE;padding:36px 40px}
.ed-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:end;gap:12px;padding-bottom:12px;border-bottom:2px solid var(--a)}
.ed-wm{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;letter-spacing:.22em;color:var(--a);font-size:16px;line-height:1.1;white-space:nowrap}
.ed-wm.sm{font-size:11px}
.ed-title{margin:0;font-size:27px;font-weight:700;letter-spacing:.5em;padding-left:.5em;line-height:1.2;color:var(--i)}
.ed-no{text-align:right;color:var(--m);font-size:12px;font-variant-numeric:tabular-nums}
.ed-no span{color:var(--a);font-weight:700}
.ed-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;margin-top:18px;align-items:start}
.ed-to,.ed-fromw{min-width:0}
.ed-cust{font-size:18px;margin:0 0 8px}
.ed-cust b{font-weight:700;padding:0 4px 1px;border-bottom:1px solid var(--i)}
.ed-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0}
.ed-kv dt{color:var(--m)}
.ed-kv dd{margin:0;word-break:keep-all;overflow-wrap:break-word}
.ed-lead{margin:10px 0 0;color:var(--m)}
.ed-from{border-collapse:collapse;width:100%;font-size:12px}
.ed-from th,.ed-from td{border:1px solid var(--s);padding:5px 8px;text-align:left;vertical-align:middle;word-break:keep-all;overflow-wrap:break-word}
.ed-from th{background:var(--t);font-weight:500;color:var(--m);white-space:nowrap;width:1%}
.ed-from th.ed-vh{text-align:center;line-height:1.35;color:var(--i);font-weight:700}
.ed-seal{position:relative;display:inline-block;margin-left:6px;color:var(--m)}
.ed-stamp{position:absolute;left:50%;top:50%;width:56px;height:56px;object-fit:contain;transform:translate(-50%,-50%);mix-blend-mode:multiply;pointer-events:none}
.ed-sum{margin-top:18px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:11px 14px;border:1px solid var(--a);background:#FBF4EF}
.ed-sum .k{color:var(--m)}
.ed-sum .k small{font-size:11px}
.ed-sum .w{font-size:15px;font-weight:700}
.ed-sum .n{margin-left:auto;font-size:18px;font-weight:700;color:var(--a);font-variant-numeric:tabular-nums}
.ed-items{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
.ed-items th{background:var(--t);color:var(--m);font-weight:500;border-top:1.5px solid var(--i);border-bottom:1px solid var(--s);padding:6px;text-align:center;white-space:nowrap}
.ed-items td{border-bottom:1px solid var(--l);padding:6px;vertical-align:top;word-break:keep-all;overflow-wrap:break-word}
.ed-items .n{text-align:center;color:var(--m);width:30px}
.ed-items td.nm{font-weight:500}
.ed-items .q,.ed-items .u{text-align:center;white-space:nowrap}
.ed-items .p,.ed-items .a{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ed-items td.a{font-weight:600}
.ed-items td.nt{color:var(--m);font-size:11px}
.ed-items td.m{display:none}
.ed-items tr.h td{background:#FBF9F5;font-weight:700;border-bottom:1px solid var(--s);padding-top:8px;color:var(--i)}
.ed-items tr.st td{text-align:right;color:var(--m);font-size:11.5px;border-bottom:1px solid var(--s)}
.ed-items tr.st td.a{color:var(--i)}
.ed-items tr.none td{text-align:center;color:var(--m);padding:18px}
.ed-items tr{break-inside:avoid}
.ed-tot{margin:10px 0 0 auto;border-collapse:collapse;min-width:300px;font-size:13px}
.ed-tot th{text-align:left;font-weight:400;color:var(--m);padding:3px 18px 3px 0;white-space:nowrap}
.ed-tot td{text-align:right;padding:3px 0;font-variant-numeric:tabular-nums;white-space:nowrap}
.ed-tot tr.sm th,.ed-tot tr.sm td{font-size:11.5px}
.ed-tot tr.g th,.ed-tot tr.g td{border-top:1.5px solid var(--i);padding-top:7px;font-weight:700;color:var(--i);font-size:15px}
.ed-notes{margin-top:18px;display:grid;gap:10px;font-size:12px}
.ed-notes:empty{display:none}
.ed-notes h3{margin:0 0 3px;font-size:12px;color:var(--a);font-weight:700}
.ed-notes p{margin:0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word}
.ed-terms{display:flex;flex-wrap:wrap;gap:2px 18px;white-space:normal!important}
.ed-terms b{font-weight:600;font-variant-numeric:tabular-nums}
.ed-foot{margin-top:26px;padding-top:9px;border-top:1px solid var(--l);display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--m);font-size:11px}
@container ed (max-width:620px){
  .ed-in{padding:22px 16px}
  .ed-top{grid-template-columns:minmax(0,1fr) auto}
  .ed-title{grid-row:2;grid-column:1/-1;font-size:24px;text-align:center}
  .ed-head{grid-template-columns:minmax(0,1fr);gap:16px}
  .ed-sum .n{margin-left:0;flex-basis:100%}
  .ed-items thead{display:none}
  .ed-items tbody{display:block}
  .ed-items tr{display:grid;grid-template-columns:24px 1fr auto;column-gap:8px;border-bottom:1px solid var(--l);padding:8px 0}
  .ed-items td{border:0;padding:0}
  .ed-items td.n{grid-row:1/span 4;grid-column:1;text-align:left;width:auto}
  .ed-items td.nm,.ed-items td.sp,.ed-items td.nt{grid-column:2/4}
  .ed-items td.sp{color:var(--m)}
  .ed-items td.m{display:block;grid-column:2;color:var(--m)}
  .ed-items td.a{grid-column:3}
  .ed-items td.q,.ed-items td.u,.ed-items td.p,.ed-items td:empty{display:none}
  .ed-items tr.h,.ed-items tr.st,.ed-items tr.none{display:block;padding:0}
  .ed-items tr.h td,.ed-items tr.none td{display:block;padding:9px 6px}
  .ed-items tr.st td{display:inline-block;padding:6px 0 6px 12px;border:0}
  .ed-items tr.st td:empty{display:none}
  .ed-items tr.st{text-align:right;border-bottom:1px solid var(--s)}
  .ed-tot{min-width:0;width:100%}
  .ed-foot{flex-direction:column;align-items:flex-start}
}
@media print{.ed{max-width:none}.ed-in{padding:0}}
`;
  // 앱 화면의 표·제목 모양이 문서에 섞이지 않게 문서 안 규칙은 모두 .ed 아래로
  const cssScoped = css.replace(/(^|[,{}]\s*|\n\s*)\.ed-/g, "$1.ed .ed-");
  window.NEST_EST = { esc, VAT, DEF_TERMS, norm, normCompany, normRow, normTerms, calc, payPlan, lineAmt, hangul, doc, css: cssScoped, validUntil, ko, qtyTxt };
})();
