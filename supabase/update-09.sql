-- 네스트퍼니처 업데이트 9: 결산 (회사 지출 기록) + 업데이트 8(시공자 정산) 포함
-- 임대료·차량·공구처럼 현장에 딸리지 않은 회사 지출을 기록해서, 연·월·현장별 매출 − 매입 − 지출을 보여 줘요. 관리자 계정만 보고 고칠 수 있어요.
-- 업데이트 8을 아직 안 했어도 이 파일 하나만 실행하면 같이 돼요.
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

-- 2) 회사 지출 (현장에 딸리지 않은 돈)
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

-- 확인용
select '시공자 정산 · 결산 표 준비 완료' as "결과";
