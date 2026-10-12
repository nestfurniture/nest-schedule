-- 네스트퍼니처 업데이트 2: 현장 사진 · 수금 · 원가/매출
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 현장 사진: files 표에 사진 종류(photo), 단계(실측·시공 전 등), 작은 미리보기 위치 칸 추가
alter table public.files drop constraint if exists files_kind_check;
alter table public.files add constraint files_kind_check check (kind in ('drawing', 'estimate', 'photo'));
alter table public.files add column if not exists stage text not null default '';
alter table public.files add column if not exists thumb text not null default '';

-- 2) 관리자(사장님) 명단: 여기 들어 있는 계정만 금액을 보고 고칠 수 있어요
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select to authenticated using (user_id = auth.uid());

-- 처음 실행할 때만: 가장 먼저 만든 계정(사장님 계정)을 관리자로 등록
insert into public.admins (user_id, email)
select id, coalesce(email, '') from auth.users
where not exists (select 1 from public.admins)
order by created_at
limit 1;

-- 3) 현장별 돈 기록(계약금액, 입금, 원가): 관리자만 읽고 쓸 수 있음
create table if not exists public.job_money (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.job_money enable row level security;
drop policy if exists "admins only" on public.job_money;
create policy "admins only" on public.job_money for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.job_money;
exception when duplicate_object then null; end $$;

-- 확인용: 관리자로 등록된 계정이 아래에 보이면 끝이에요
select email as "관리자 계정" from public.admins;
