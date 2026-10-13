-- 네스트퍼니처 업데이트 5: 시방서 보관함 (모델명으로 자동 찾기)
-- 현장에 가전 모델명을 적고 저장하면, 알림 서버(notify)가 제조사 공식 홈페이지에서 시방서를 찾아 여기에 모델별로 보관해요.
-- 한 번 찾은 모델은 다시 찾지 않고, 같은 모델을 쓰는 모든 현장의 시공 체크리스트에 자동으로 붙어요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

create table if not exists public.app_specs (
  model_key text primary key,                 -- 모델명을 대문자로, 띄어쓰기·하이픈 등을 빼고 (예: DUE6BGH)
  model text not null default '',             -- 처음 적은 모델명 그대로
  brand text not null default '',
  type text not null default '',              -- 가전 종류 코드 (dish, fridge …), 모르면 빈칸
  spec text not null default '',              -- 시공 때 꼭 맞춰야 할 치수 요약
  links jsonb not null default '[]'::jsonb,   -- 제조사 공식 페이지·설명서 링크 [{title, url}]
  images jsonb not null default '[]'::jsonb,  -- 공식 치수도 그림 [{title, url}]
  files jsonb not null default '[]'::jsonb,   -- 보관해 둔 공식 설명서 PDF [{path, name, mime, size}]
  status text not null default '' check (status in ('', 'searching', 'found', 'notfound', 'error')),
  note text not null default '',
  searched_at timestamptz,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_specs add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.app_specs enable row level security;
drop policy if exists "staff all" on public.app_specs;
create policy "staff all" on public.app_specs for all to authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table public.app_specs;
exception when duplicate_object then null; end $$;

-- 앞서 안내했던 '모델 목록 공개 함수'는 이제 쓰지 않아서 지웁니다 (실행한 적 없어도 괜찮아요)
drop function if exists public.spec_models();

-- 확인용
select '시방서 보관함 준비 완료' as "결과";
