-- 네스트퍼니처 업데이트 10: 견적서 작성 + 업데이트 8(시공자 정산) · 9(결산 지출) 포함
-- 앱에서 견적서를 쓰고, 고객에게 링크로 보내고, 계약으로 확정하면 수금·결산에 바로 들어가요. 관리자 계정만 보고 고칠 수 있어요.
-- 업데이트 8·9를 아직 안 했어도 이 파일 하나만 실행하면 같이 돼요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 시공자 정산 (업데이트 8과 같음)
create table if not exists public.crew_pay (
  key text primary key check (key = 'rates' or key ~ '^\d{4}-\d{2}$'),  -- 'rates' = 일당 설정, '2026-10' = 그 달 조정·지급 기록
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.crew_pay enable row level security;
drop policy if exists "admins only" on public.crew_pay;
create policy "admins only" on public.crew_pay for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.crew_pay;
exception when duplicate_object then null; end $$;

-- 2) 회사 지출 (업데이트 9와 같음)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  day date not null,                                  -- 쓴 날 (매달 반복이면 시작한 날)
  cat text not null default '수수료·기타',             -- 항목 (임대료, 차량·유류 …)
  amount bigint not null default 0 check (amount >= 0),
  note text not null default '',
  repeat boolean not null default false,              -- 매달 나가는 돈 (임대료처럼)
  until text not null default '' check (until = '' or until ~ '^\d{4}-\d{2}$'),  -- 반복이 끝나는 달 (비우면 계속)
  created_at timestamptz not null default now()
);
alter table public.expenses enable row level security;
drop policy if exists "admins only" on public.expenses;
create policy "admins only" on public.expenses for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null; end $$;

-- 3) 견적서. 고객은 링크 속 열쇠(token)로 알림 서버를 거쳐서만 읽을 수 있어요
create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,   -- 연결된 현장 (없어도 됨)
  token text not null unique,                                  -- 고객 링크 열쇠
  status text not null default 'draft' check (status in ('draft', 'sent', 'won', 'lost')),  -- 작성중 · 보냄 · 계약 · 안 됨
  data jsonb not null default '{}'::jsonb,                     -- 고객·품목·할인·부가세·결제 조건
  views integer not null default 0,                            -- 고객이 링크를 연 횟수
  first_seen timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.estimates enable row level security;
drop policy if exists "admins only" on public.estimates;
create policy "admins only" on public.estimates for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.estimates;
exception when duplicate_object then null; end $$;

-- 4) 견적서 설정: 'company' = 회사 정보·도장, 'items' = 자주 쓰는 품목(단가표)
create table if not exists public.est_conf (
  key text primary key check (key in ('company', 'items')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.est_conf enable row level security;
drop policy if exists "admins only" on public.est_conf;
create policy "admins only" on public.est_conf for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.est_conf;
exception when duplicate_object then null; end $$;

-- 확인용
select '시공자 정산 · 결산 · 견적서 표 준비 완료' as "결과";
