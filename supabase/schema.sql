-- 네스트퍼니처 현장 일정: Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  item text not null default '',
  addr text not null default '',
  m jsonb not null default '{"date":"","done":false}'::jsonb,          -- 실측: 날짜, 완료 여부
  i jsonb not null default '{"start":"","end":"","crew":[]}'::jsonb,   -- 시공: 시작일, 종료일, 시공자
  f jsonb not null default '{"done":false,"extra":[]}'::jsonb,         -- 마감: 완료 여부, 추가 투입 기록
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crew (
  name text primary key,
  created_at timestamptz not null default now()
);

-- 로그인한 직원만 읽고 쓸 수 있게
alter table public.jobs enable row level security;
alter table public.crew enable row level security;

drop policy if exists "staff all" on public.jobs;
create policy "staff all" on public.jobs for all to authenticated using (true) with check (true);
drop policy if exists "staff all" on public.crew;
create policy "staff all" on public.crew for all to authenticated using (true) with check (true);

-- 다른 기기에서 고친 내용이 바로 보이게
do $$ begin
  alter publication supabase_realtime add table public.jobs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.crew;
exception when duplicate_object then null; end $$;

-- 도면 · 견적서 파일 (파일 자체는 Storage, 목록은 files 표)
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('drawing', 'estimate')),   -- drawing = 도면, estimate = 견적서
  name text not null,                                           -- 올린 사람이 보던 원래 파일 이름
  path text not null unique,                                    -- Storage 안의 위치
  size bigint not null default 0,
  mime text not null default '',
  uploaded_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists files_job_id_idx on public.files (job_id);
alter table public.files enable row level security;
drop policy if exists "staff all" on public.files;
create policy "staff all" on public.files for all to authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table public.files;
exception when duplicate_object then null; end $$;

-- 비공개 파일 보관함: 로그인한 직원만 올리고 볼 수 있음, 파일 하나당 50MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('job-files', 'job-files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "nest staff job-files" on storage.objects;
create policy "nest staff job-files" on storage.objects for all to authenticated
  using (bucket_id = 'job-files') with check (bucket_id = 'job-files');

-- 이어서 같은 폴더의 update-02.sql(현장 사진 · 수금 · 매출)도 실행하세요.
