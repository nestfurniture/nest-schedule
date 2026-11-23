/* 통장 엑셀 읽기 일꾼 (업데이트 15). bank.js가 은행에서 내려받은 거래내역 파일(.xls .xlsx .csv, 엑셀처럼 보이는 .html)을 넘기면
   표마다 칸 글자를 그대로 돌려줌. 어느 칸이 날짜·입금·출금인지는 bank.js가 정함.
   SheetJS(vendor/xlsx.full.min.js, 0.18.5)는 일부러 망가뜨린 파일에 약점이 알려져 있어서 화면과 떨어진 이 일꾼 안에서만 읽고,
   오래 걸리면 화면 쪽이 일꾼을 멈춤. 사장님이 은행에서 받은 파일만 올리는 곳이라 그 정도면 충분함. */
importScripts("vendor/xlsx.full.min.js");
const pad = (n) => String(n).padStart(2, "0");
const MAX_ROWS = 6000, MAX_COLS = 40;
/* 엑셀 날짜 칸은 표시 형식이 날짜인 숫자라서 직접 연·월·일로 풀어 줌 (시간대 계산 없이) */
function cellVal(c) {
  if (!c) return "";
  if (c.t === "n") {
    if (c.z && XLSX.SSF.is_date(c.z)) {
      const p = XLSX.SSF.parse_date_code(c.v);
      if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}:${pad(Math.floor(p.S))}`;
    }
    return c.v;
  }
  if (c.t === "d" && c.v instanceof Date) { const d = c.v; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  if (c.t === "b") return c.v ? "TRUE" : "FALSE";
  if (c.t === "e") return "";
  return String(c.v == null ? (c.w || "") : c.v);
}
/* 글자 파일(.csv, .html)은 UTF-8이 아니면 한글 윈도우 글자(EUC-KR)로 읽음 */
function decode(u8) {
  const head = new TextDecoder("latin1").decode(u8.subarray(0, 4096));
  if (/charset\s*=\s*["']?\s*(euc-kr|ks_c_5601|cp949|x-windows-949)/i.test(head)) return new TextDecoder("euc-kr").decode(u8);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) { return new TextDecoder("euc-kr").decode(u8); }
}
self.onmessage = (e) => {
  try {
    const u8 = new Uint8Array(e.data.buf);
    const zip = u8[0] === 0x50 && u8[1] === 0x4b, ole = u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0;
    const wb = zip || ole ? XLSX.read(u8, { type: "array", cellNF: true, cellDates: false, dense: false })
      : XLSX.read(decode(u8).replace(/^﻿/, ""), { type: "string", raw: true, cellNF: true });
    const sheets = [];
    for (const name of wb.SheetNames.slice(0, 6)) {
      const ws = wb.Sheets[name];
      if (!ws || !ws["!ref"]) continue;
      const R = XLSX.utils.decode_range(ws["!ref"]), rows = [];
      for (let r = R.s.r; r <= Math.min(R.e.r, R.s.r + MAX_ROWS); r++) {
        const row = [];
        for (let c = R.s.c; c <= Math.min(R.e.c, R.s.c + MAX_COLS); c++) row.push(cellVal(ws[XLSX.utils.encode_cell({ r, c })]));
        rows.push(row);
      }
      sheets.push({ name, rows });
    }
    self.postMessage({ ok: true, sheets });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
