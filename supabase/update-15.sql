-- 네스트퍼니처 업데이트 15: 통장 내역 (팝빌 없이) — 갤럭시 은행 알림 + 엑셀 올리기
-- 업데이트 14(AS 자동 접수)를 먼저 한 뒤에 하세요. MacroDroid 열쇠를 AS 자동 접수와 같이 써요.
-- Supabase → SQL Editor → New query 에 이 내용을 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.
-- 업데이트 12(팝빌)를 안 했어도 이것만 하면 돼요. 했어도 그대로 두고 이것만 더 하면 돼요.

-- 1) 통장 거래내역: 휴대폰 은행 알림·엑셀(또는 팝빌)로 들어오고, 관리자가 앱에서 어디로 넣을지(회사 지출·거래처 지급·고객 입금 …) 정해요
create table if not exists public.bank_tx (
  id text primary key,                                         -- 거래 번호 (알림 a:…, 엑셀 x:…, 팝빌 번호)
  acct text not null,                                          -- 앱에서 등록한 계좌 (모르면 ?은행이름)
  corp text not null default '',                               -- 사업자 (리브젠·네스트)
  day date not null,                                           -- 거래한 날
  at text not null default '',                                 -- 거래 시각 (HH:MM)
  dir text not null check (dir in ('in', 'out')),              -- in = 들어온 돈, out = 나간 돈
  amount bigint not null check (amount >= 0),
  balance bigint,                                              -- 거래 뒤 잔액
  r1 text not null default '',                                 -- 보낸 분·받는 분
  r2 text not null default '',                                 -- 적요 (타행이체, 체크카드 …)
  r3 text not null default '',
  r4 text not null default '',
  memo text not null default '',
  status text not null default 'new' check (status in ('new', 'done', 'skip')),  -- new = 아직 안 정함
  link jsonb,                                                  -- 어디에 넣었는지 (되돌리기에 씀)
  note text not null default '' check (length(note) <= 300),
  done_at timestamptz,
  done_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bank_tx add column if not exists corp text not null default '';
alter table public.bank_tx add column if not exists src text not null default '';   -- alert = 휴대폰 알림, excel = 엑셀, 빈칸 = 팝빌
alter table public.bank_tx add column if not exists raw text not null default '';   -- 받은 알림 글 (어떻게 읽었는지 확인용)
create index if not exists bank_tx_day on public.bank_tx (day desc);
alter table public.bank_tx enable row level security;
drop policy if exists "admins only" on public.bank_tx;
create policy "admins only" on public.bank_tx for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 2) 통장 설정: 등록한 계좌(accts), 알림 받은 상태(ping), 기억한 분류(rules), 팝빌 상태(state)
create table if not exists public.bank_kv (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.bank_kv drop constraint if exists bank_kv_key_check;
alter table public.bank_kv add constraint bank_kv_key_check check (key in ('state', 'rules', 'accts', 'ping'));
alter table public.bank_kv enable row level security;
drop policy if exists "admins only" on public.bank_kv;
create policy "admins only" on public.bank_kv for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 3) 회사 지출에 통장에서 넣은 줄 표시 (지출을 지우면 그 거래는 다시 '확인할 것'으로)
alter table public.expenses add column if not exists bank_id text;

do $$ begin
  alter publication supabase_realtime add table public.bank_tx;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bank_kv;
exception when duplicate_object then null; end $$;

-- 확인용: '통장 내역 준비 완료'와 'AS 열쇠 있음'이 보이면 끝이에요
select '통장 내역 준비 완료' as "결과",
  case when to_regclass('public.as_secret') is null then '업데이트 14를 먼저 해 주세요' else 'AS 열쇠 있음 (MacroDroid 주소에 같이 씀)' end as "휴대폰 알림 열쇠";
