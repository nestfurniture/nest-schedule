/* 시공 체크리스트 항목: 사무실 앱(app.js)과 시공자 화면(check.js)이 같이 씁니다.
   항목 문구를 바꾸려면 여기만 고치면 돼요. 이미 제출된 결과는 항목 이름(space, vent …)으로 저장돼 있어서 문구를 바꿔도 그대로 보여요. */
(function () {
  const ITEMS = {
    space: "설치 공간 치수가 시방서와 맞아요",
    cutout: "상판 타공 치수가 시방서와 맞아요",
    vent: "통풍 간격·통풍구를 시방서대로 확보했어요",
    gap: "아래 장·서랍과 시방서 간격을 띄웠어요",
    panel: "도어 패널 크기·무게가 시방서 범위 안이에요",
    door: "문을 끝까지 열어도 옆 장·벽과 부딪히지 않아요",
    plinth: "문을 열 때 걸레받이와 부딪히지 않아요",
    water: "급수·배수 호스가 꺾이지 않았고 누수가 없어요",
    duct: "설치 높이와 덕트 연결이 시방서와 맞아요",
    power: "전원 콘센트 위치와 전용 회로를 확인했어요",
    fix: "수평을 맞추고 단단히 고정했어요",
    run: "전원을 켜서 작동을 확인했어요",
  };
  // [코드, 이름, 확인 항목]
  const TYPES = [
    ["dish", "식기세척기", ["space", "panel", "door", "plinth", "water", "power", "fix", "run"]],
    ["induction", "인덕션·전기레인지", ["cutout", "gap", "power", "fix", "run"]],
    ["fridge", "냉장고", ["space", "vent", "panel", "door", "power", "fix", "run"]],
    ["kimchi", "김치냉장고", ["space", "vent", "panel", "door", "power", "fix", "run"]],
    ["wine", "와인셀러", ["space", "vent", "door", "power", "fix", "run"]],
    ["oven", "오븐·광파오븐", ["space", "vent", "power", "fix", "run"]],
    ["micro", "전자레인지", ["space", "vent", "power", "fix", "run"]],
    ["hood", "후드", ["duct", "power", "fix", "run"]],
    ["water", "정수기", ["space", "water", "power", "run"]],
    ["washer", "세탁기·건조기", ["space", "vent", "water", "door", "power", "fix", "run"]],
    ["styler", "스타일러·에어드레서·슈드레서", ["space", "vent", "door", "power", "fix", "run"]],
    ["etc", "기타 가전", ["space", "vent", "power", "fix", "run"]],
  ];
  const COMMON = [
    ["level", "수평·수직이 맞아요"],
    ["doors", "문짝 단차·간격을 맞췄어요"],
    ["hw", "경첩·레일·손잡이가 부드럽게 움직여요"],
    ["top", "상판·실리콘 마감이 깨끗해요"],
    ["trim", "걸레받이·몰딩·필러 마감을 끝냈어요"],
    ["damage", "보양을 걷고 벽·바닥 찍힘이 없는지 봤어요"],
    ["clean", "청소와 남은 자재 정리를 끝냈어요"],
  ];
  // 냉장고·김치냉장고 등을 나란히 붙여(연결해) 설치할 때 묶음으로 따로 확인
  const COMBO = [
    ["space", "합친 설치 공간(폭·높이·깊이)이 연결 시방서와 맞아요"],
    ["gap", "제품 사이 간격·연결 키트를 시방서대로 설치했어요"],
    ["vent", "좌우·위·뒤 통풍 간격을 시방서대로 띄웠어요"],
    ["line", "제품 높이와 앞면 라인이 나란히 맞아요"],
    ["door", "문을 끝까지 열어도 옆 제품·장과 부딪히지 않아요"],
  ];
  const FRIDGE = ["fridge", "kimchi", "wine"];
  const TYPE = Object.fromEntries(TYPES.map(([k, name, items]) => [k, { name, items }]));
  const typeName = (k) => (TYPE[k] || TYPE.etc).name;
  // 시방서 보관함: 모델명은 대문자로, 띄어쓰기·하이픈 등은 빼고 비교 (알림 서버 notify와 같은 규칙)
  const modelKey = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z가-힣]/g, "");
  let libOf = () => null;
  const useLib = (fn) => { libOf = fn || (() => null); };
  // 종류를 '자동'으로 두면 보관함에서 찾은 종류로, 그것도 없으면 기타 가전으로
  const appType = (a) => (TYPE[a.type] ? a.type : TYPE[(libOf(modelKey(a.model)) || {}).type] ? libOf(modelKey(a.model)).type : "etc");
  // 붙여서 설치하는 묶음: 냉장고·김치냉장고·와인셀러는 기본으로 들어가고, 체크를 끄면(join:false) 빠짐. 다른 가전도 체크하면(join:true) 들어감
  // (알림 서버 notify의 comboOf와 같은 규칙)
  const comboKey = (models) => models.map(modelKey).filter(Boolean).sort().join("+");
  const joinable = (a) => FRIDGE.includes(appType(a));
  const inCombo = (a) => modelKey(a.model).length >= 3 && (a.join === true || (a.join !== false && joinable(a)));
  function combo(job) {
    const i = (job && job.i) || {}, apps = (i.apps || []).filter(inCombo);
    if (apps.length < 2) return null;
    const key = comboKey(apps.map((a) => a.model)), lib = libOf(key) || {};
    const official = i.comboSrc ? false : lib.official !== false;
    return { key, apps, models: apps.map((a) => a.model), spec: i.comboSpec || lib.spec || "", src: i.comboSrc || (lib.official === false ? lib.source || "공식 자료 아님" : ""), official };
  }
  // 공식 자료가 아닌 치수면 출처와 함께 한 줄 경고
  const srcWarn = (src) => src ? `공식 자료가 아니에요 (출처: ${src}). 현장에서 실측으로 꼭 확인해 주세요.` : "";
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h.toString(36); };
  const RESULT = { ok: "확인", bad: "문제", na: "해당 없음" };

  // 현장 하나의 체크리스트 묶음: 가전마다 한 묶음 + 붙여서 설치하는 가전 묶음 + 가구 마감 + 이 현장 추가 확인
  function sections(job) {
    const i = (job && job.i) || {}, out = [];
    (i.apps || []).forEach((a) => {
      const t = TYPE[appType(a)], lib = libOf(modelKey(a.model)) || {};
      // 출처: 시공자 화면은 알림 서버가 a.src로 알려 줌, 사무실 앱은 보관함에서 (사무실이 직접 적은 치수면 경고 없음)
      const src = a.src || (a.spec ? "" : lib.official === false ? lib.source || "공식 자료 아님" : "");
      out.push({ key: `app:${a.id}`, kind: "app", title: t.name + (a.model ? ` · ${a.model}` : ""), app: a, spec: a.spec || lib.spec || "", warn: (a.spec || lib.spec) ? srcWarn(src) : "",
        items: t.items.map((k) => ({ key: `app:${a.id}:${k}`, label: ITEMS[k] })), dims: true, photo: "설치 사진 (통풍구·연결부가 보이게)" });
    });
    const c = combo(job);
    if (c) out.push({ key: "combo", kind: "combo", title: `붙여서 설치 · ${c.models.join(" + ")}`, spec: c.spec, warn: c.spec ? srcWarn(c.src) : "", combo: c,
      items: COMBO.map(([k, l]) => ({ key: `combo:${k}`, label: l })), dims: true, photo: "붙여서 설치한 사진 (제품 사이 간격·옆면이 보이게)" });
    out.push({ key: "common", kind: "common", title: "가구 마감", items: COMMON.map(([k, l]) => ({ key: `common:${k}`, label: l })), photo: "완성 사진 (전체가 보이게)" });
    const ex = (i.chk || []).map((s) => String(s).trim()).filter(Boolean);
    if (ex.length) out.push({ key: "extra", kind: "extra", title: "이 현장 추가 확인", items: ex.map((l) => ({ key: `extra:${hash(l)}`, label: l })) });
    return out;
  }
  // 몇 개 확인했는지, 문제는 뭔지, 빠진 사진은 어디인지
  function summary(job, data) {
    data = data || {};
    const it = data.items || {}, photos = data.photos || [], secs = sections(job);
    let total = 0, done = 0;
    const bad = [], missing = [];
    secs.forEach((s) => s.items.forEach((x) => {
      total++;
      const r = it[x.key];
      if (r && RESULT[r.v]) { done++; if (r.v === "bad") bad.push({ sec: s.title, label: x.label, note: r.note || "", key: x.key }); }
      else missing.push({ sec: s.title, label: x.label, key: x.key });
    }));
    const noPhoto = secs.filter((s) => s.photo && !photos.some((p) => p.key === s.key));
    const badNote = bad.filter((b) => !b.note.trim());
    return { secs, total, done, bad, missing, noPhoto, badNote, ready: !missing.length && !noPhoto.length && !badNote.length };
  }
  const dimsText = (d) => d && (d.w || d.h || d.d) ? `폭 ${d.w || "-"} · 높이 ${d.h || "-"} · 깊이 ${d.d || "-"} (mm)` : "";
  window.NEST_CL = { ITEMS, TYPES, COMMON, COMBO, RESULT, typeName, modelKey, comboKey, useLib, appType, joinable, inCombo, combo, sections, summary, dimsText };
})();
