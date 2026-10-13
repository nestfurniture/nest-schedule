-- 네스트퍼니처 업데이트 3: 휴대폰 알림
-- 먼저 README의 "업데이트 3" 1단계대로 알림 서버(notify)를 만든 다음,
-- Supabase → SQL Editor → New query 에 이 내용을 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 알림 받을 기기 목록: 각자 자기 기기만 보고 지울 수 있어요
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  prefs jsonb not null default '{}'::jsonb,
  device text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own subs" on public.push_subs;
create policy "own subs" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 기기 등록·설정 저장 (한 휴대폰에서 다른 계정으로 바꿔 로그인해도 꼬이지 않게)
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth, prefs, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_prefs, '{}'::jsonb), coalesce(p_device, ''))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = excluded.prefs, device = excluded.device, updated_at = now();
end $$;
revoke all on function public.save_push_sub(text, text, text, jsonb, text) from public, anon;
grant execute on function public.save_push_sub(text, text, text, jsonb, text) to authenticated;

-- 2) 알림 서버 전용 표 (앱에서는 못 읽어요): 알림 열쇠, 보낸 기록(같은 알림 두 번 방지)
create table if not exists public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_keys enable row level security;
create table if not exists public.push_log (
  slot text not null,
  day date not null,
  sent int not null default 0,
  created_at timestamptz not null default now(),
  primary key (slot, day)
);
alter table public.push_log enable row level security;

-- 3) 매일 정해진 시간에 알림 서버 부르기 (시간은 세계 표준시라 한국보다 9시간 느려요)
--    아침 7시 30분 = 전날 22:30, 저녁 6시 = 09:00
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('nest-push-morning', '30 22 * * *', $$
  select net.http_post(
    url := 'https://gpedhtiyqsjwkxfxftlx.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwZWRodGl5cXNqd2t4ZnhmdGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MDI0MTEsImV4cCI6MjEwNzM3ODQxMX0.DMRNnJ82FvNM8PywBuu_yXoAiv3vMLKKYTjtjmYG4Gk'),
    body := '{"action":"run","slot":"morning"}'::jsonb,
    timeout_milliseconds := 30000);
$$);
select cron.schedule('nest-push-evening', '0 9 * * *', $$
  select net.http_post(
    url := 'https://gpedhtiyqsjwkxfxftlx.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwZWRodGl5cXNqd2t4ZnhmdGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MDI0MTEsImV4cCI6MjEwNzM3ODQxMX0.DMRNnJ82FvNM8PywBuu_yXoAiv3vMLKKYTjtjmYG4Gk'),
    body := '{"action":"run","slot":"evening"}'::jsonb,
    timeout_milliseconds := 30000);
$$);

-- 확인용: 아래에 두 줄(nest-push-morning, nest-push-evening)이 보이면 끝이에요
select jobname as "예약된 알림", schedule as "시간(세계 표준시)" from cron.job where jobname like 'nest-push-%';
