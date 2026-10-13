// 앱 화면 파일만 캐시해서 빠르게 열리게 합니다. 일정 데이터는 항상 서버에서 받아옵니다.
const CACHE = "nest-schedule-v15";
const SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/badge-96.png", "icons/apple-touch-icon.png", "icons/favicon.png", "vendor/supabase.js", "checklist.js", "check.html", "check.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 알림에서 연 주소(?day=…)도 같은 화면이라 한 칸에만 저장. 시공자 체크리스트 화면은 따로
  const nav = e.request.mode === "navigate", check = url.pathname.endsWith("/check.html");
  const key = nav ? (check ? "check.html" : "./") : e.request;
  // 새 버전을 먼저 시도하고, 인터넷이 안 되면 저장해 둔 화면을 보여줌
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); return res;
  }).catch(() => caches.match(key).then(r => r || (nav && !check ? caches.match("index.html") : Response.error()))));
});

// 휴대폰 알림: 서버(notify)가 보낸 내용을 그대로 띄움
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "네스트퍼니처", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || undefined,
    data: { url: d.url || self.registration.scope },
  }));
});
// 알림을 누르면: 앱이 열려 있으면 그 화면으로, 아니면 새로 열기
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (!c.url.startsWith(self.registration.scope) || c.url.includes("check.html")) continue;
      try { await c.focus(); } catch (_) {}
      c.postMessage({ type: "open", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
