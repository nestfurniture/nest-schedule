-- 네스트퍼니처 업데이트 11: 시공자 일당 등록
-- 시공자 화면에서 시공자가 그날 일당을 직접 적으면, 관리자의 시공자 정산과 현장 시공비에 그 금액이 들어가요.
-- 시공자는 자기가 적은 일당만 보고 고칠 수 있고, 관리자가 그 달 지급 완료를 체크하면 더는 못 고쳐요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

create table if not exists public.crew_days (
  id uuid primary key default gen_random_uuid(),
  crew text not null check (length(crew) between 1 and 40),            -- 시공자 이름 (시공자 명단과 같은 이름)
  day date not null,                                                   -- 일한 날
  amount bigint not null check (amount between 1 and 5000000),         -- 그날 일당(원)
  note text not null default '' check (length(note) <= 200),           -- 메모 (반일, 야간 등)
  job_id uuid references public.jobs(id) on delete set null,           -- 일정에 없는 날이면 어느 현장인지
  user_id uuid not null default auth.uid(),                            -- 적은 계정
  by_name text not null default '' check (length(by_name) <= 40),      -- 적은 사람 이름
  locked boolean not null default false,                               -- 지급 완료라 못 고침
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crew, day)
);
alter table public.crew_days enable row level security;

-- 관리자: 모두 보고 고침
drop policy if exists "admins all" on public.crew_days;
create policy "admins all" on public.crew_days for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
-- 시공자(직원 계정): 자기가 적은 것만 보고, 오늘까지의 날짜만 적고, 지급 완료 전까지만 고치거나 지움
drop policy if exists "own read" on public.crew_days;
create policy "own read" on public.crew_days for select to authenticated using (user_id = auth.uid());
drop policy if exists "own add" on public.crew_days;
create policy "own add" on public.crew_days for insert to authenticated
  with check (user_id = auth.uid() and not locked and day <= (now() at time zone 'Asia/Seoul')::date);
drop policy if exists "own edit" on public.crew_days;
create policy "own edit" on public.crew_days for update to authenticated
  using (user_id = auth.uid() and not locked)
  with check (user_id = auth.uid() and not locked and day <= (now() at time zone 'Asia/Seoul')::date);
drop policy if exists "own delete" on public.crew_days;
create policy "own delete" on public.crew_days for delete to authenticated using (user_id = auth.uid() and not locked);

do $$ begin
  alter publication supabase_realtime add table public.crew_days;
exception when duplicate_object then null; end $$;

-- 확인용
select '시공자 일당 등록 표 준비 완료' as "결과";
