-- 네스트퍼니처 업데이트 4: 시공 체크리스트 · 가전 시방서
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 가전 시방서 파일(spec)도 현장 파일로 보관
alter table public.files drop constraint if exists files_kind_check;
alter table public.files add constraint files_kind_check check (kind in ('drawing', 'estimate', 'photo', 'spec'));

-- 2) 현장별 시공 체크리스트: 시공자는 링크 속 열쇠(token)로 알림 서버를 거쳐서만 작성할 수 있어요
create table if not exists public.checklists (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  token text not null unique,
  status text not null default 'open' check (status in ('open', 'submitted')),
  data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  submitted_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.checklists enable row level security;
drop policy if exists "staff all" on public.checklists;
create policy "staff all" on public.checklists for all to authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table public.checklists;
exception when duplicate_object then null; end $$;

-- 확인용
select '체크리스트 준비 완료' as "결과";
