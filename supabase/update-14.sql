-- 네스트퍼니처 업데이트 14: AS 접수함 (갤럭시 카톡·통화 자동 접수)
-- 사장님 갤럭시의 MacroDroid 앱이 카톡 알림(보낸 사람 + 내용)과 통화 끝(전화번호)을 알림 서버(notify)로 보내면,
--   카톡: AI가 고객의 AS 요청인지 보고, AS면 여기(as_inbox)에 넣고 휴대폰 알림을 보내요. AS가 아닌 카톡은 저장하지 않아요.
--   통화: 고객 전화번호와 같고 시공을 시작한 현장이면 '통화 확인'으로 넣어요. 모르는 번호는 저장하지 않아요.
-- 앱의 현장 › AS 화면에서 'AS로 등록' 또는 'AS 아님'을 눌러 정리해요. AS 건 자체는 지금처럼 현장(jobs.f)에 저장돼요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) AS 접수함
create table if not exists public.as_inbox (
  id uuid primary key default gen_random_uuid(),
  src text not null check (src in ('kakao', 'call')),          -- kakao = 카톡 알림, call = 통화
  who text not null default '',                               -- 카톡 보낸 사람(알림 제목) 또는 통화한 현장 이름
  tel text not null default '',                               -- 통화한 전화번호
  body text not null default '',                              -- 카톡 내용 (같은 사람이 이어 보낸 건 이어 붙임) 또는 통화 시각
  sum text not null default '',                               -- AI가 정리한 한 줄 증상
  job_id uuid references public.jobs(id) on delete set null,  -- 찾은 현장 (못 찾으면 비움)
  status text not null default 'new' check (status in ('new', 'done', 'skip')),  -- new = 확인 전, done = AS로 등록함, skip = AS 아님
  case_id text not null default '',                           -- 등록한 AS 건 (jobs.f.asc 의 id)
  done_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists as_inbox_status_idx on public.as_inbox (status, updated_at desc);
alter table public.as_inbox enable row level security;

-- 2) 자동 접수 설정: 빼고 볼 카톡 이름(ignore), 서버가 마지막으로 받은 시각과 오늘 AI 사용 횟수(ping)
create table if not exists public.as_kv (
  key text primary key check (key in ('ignore', 'ping')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.as_kv enable row level security;

-- 사무실 직원(업데이트 13을 했으면 사무실 직원·관리자만, 안 했으면 로그인한 직원 모두)만 읽고 씀. 시공자 계정은 못 봄
do $$
declare cond text := case when to_regprocedure('public.is_office()') is not null then 'public.is_office()' else 'true' end;
begin
  drop policy if exists "office all" on public.as_inbox;
  execute format('create policy "office all" on public.as_inbox for all to authenticated using (%s) with check (%s)', cond, cond);
  drop policy if exists "office all" on public.as_kv;
  execute format('create policy "office all" on public.as_kv for all to authenticated using (%s) with check (%s)', cond, cond);
end $$;

-- 3) 휴대폰(MacroDroid)이 서버를 부를 때 쓰는 열쇠. 앱에서는 관리자만 as_key()로 볼 수 있어요
create table if not exists public.as_secret (
  id int primary key default 1 check (id = 1),
  k text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.as_secret enable row level security;
insert into public.as_secret (id) values (1) on conflict (id) do nothing;

create or replace function public.as_key(p_reset boolean default false) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'admin only';
  end if;
  if p_reset then
    update public.as_secret set k = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), created_at = now() where id = 1;
  end if;
  return (select k from public.as_secret where id = 1);
end $$;
revoke all on function public.as_key(boolean) from public, anon;
grant execute on function public.as_key(boolean) to authenticated;

-- 4) 다른 기기에서 바뀐 내용이 바로 보이게
do $$ begin
  alter publication supabase_realtime add table public.as_inbox;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.as_kv;
exception when duplicate_object then null; end $$;

select 'AS 접수함 준비 끝' as result, (select count(*) from public.as_inbox) as inbox_rows;
