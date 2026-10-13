-- 네스트퍼니처 업데이트 8: 시공자 정산 (일당 · 월별 조정 · 지급 완료)
-- 시공자별 일당을 넣어 두면 일정의 시공일로 월별 정산과 현장 인건비가 자동으로 계산돼요. 관리자 계정만 보고 고칠 수 있어요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

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

-- 확인용
select '시공자 정산 표 준비 완료' as "결과";
