/* 고객용 견적서 화면. 로그인 없이 링크 속 열쇠(t)로 알림 서버(notify)를 거쳐 읽기만 합니다. */
(function () {
  const $ = (id) => document.getElementById(id);
  const E = window.NEST_EST, cfg = window.NEST_CONFIG || {};
  const TOKEN = new URLSearchParams(location.search).get("t") || "";
  $("edCss").textContent = E.css;
  function fail(title, text) { $("state").innerHTML = `<b>${E.esc(title)}</b>${E.esc(text || "")}`; $("state").hidden = false; $("paper").hidden = true; $("bar").hidden = true; $("hint").hidden = true; }
  // 같은 기기에서 회사 앱에 로그인돼 있으면 회사 사람이 확인하는 것이라 '고객이 열어 봄'에 세지 않음
  // (#me = 회사 앱의 '고객 화면 열기'로 연 것. 아이폰은 앱과 Safari의 저장소가 달라서 따로 표시)
  const staff = location.hash === "#me" || (() => { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch (e) { return false; } })();
  async function load() {
    if (!window.supabase || !cfg.SUPABASE_URL) return fail("견적서를 열 수 없어요", "잠시 뒤 다시 열어 주세요.");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(TOKEN)) return fail("링크가 올바르지 않아요", "받으신 링크를 다시 눌러 주세요.");
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.functions.invoke("notify", { body: { action: "est_open", token: TOKEN, staff } });
    if (error) {
      const st = error.context && error.context.status;
      return st === 404 ? fail("견적서를 찾을 수 없어요", "링크가 바뀌었거나 지워진 견적서예요. 네스트퍼니처에 문의해 주세요.") : fail("견적서를 불러오지 못했어요", "인터넷 연결을 확인하고 다시 열어 주세요.");
    }
    const e = E.norm(data && data.est), co = E.normCompany(data && data.company);
    document.title = `견적서${e.cust.name ? ` · ${e.cust.name}` : ""} · ${co.name || "네스트퍼니처"}`;
    $("paper").innerHTML = E.doc(e, co);
    $("state").hidden = true; $("paper").hidden = false; $("bar").hidden = false; $("hint").hidden = false;
    const tel = co.tel.replace(/[^\d+]/g, "");
    if (tel.length >= 8) { $("telBtn").href = `tel:${tel}`; $("telBtn").hidden = false; }
  }
  $("printBtn").onclick = () => window.print();
  load().catch(() => fail("견적서를 불러오지 못했어요", "인터넷 연결을 확인하고 다시 열어 주세요."));
})();
