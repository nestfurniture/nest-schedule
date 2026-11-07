-- 네스트퍼니처 업데이트 12: 통장 거래내역 자동 연결 (팝빌 계좌조회)
-- 먼저 README의 "업데이트 12" 1~2단계대로 통장 서버(bank)를 만들고 팝빌 열쇠를 넣은 다음,
-- Supabase → SQL Editor → New query 에 이 내용을 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 통장 거래내역: 서버가 팝빌에서 가져와 넣고, 관리자가 앱에서 어디로 넣을지(회사 지출·거래처 지급·고객 입금 …) 정해요
create table if not exists public.bank_tx (
  id text primary key,                                         -- 팝빌 거래 번호 (같은 거래는 두 번 안 들어감)
  acct text not null,                                          -- 은행코드-계좌번호
  day date not null,                                           -- 거래한 날
  at text not null default '',                                 -- 거래 시각 (HH:MM)
  dir text not null check (dir in ('in', 'out')),              -- in = 들어온 돈, out = 나간 돈
  amount bigint not null check (amount >= 0),
  balance bigint,                                              -- 거래 뒤 잔액
  r1 text not null default '',                                 -- 은행이 적어 준 내용 (보낸 분·받는 분·적요)
  r2 text not null default '',
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
create index if not exists bank_tx_day on public.bank_tx (day desc);
alter table public.bank_tx enable row level security;
drop policy if exists "admins only" on public.bank_tx;
create policy "admins only" on public.bank_tx for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 2) 통장 설정: 서버가 적는 마지막 가져온 시각·계좌 목록(state), 앱이 기억하는 분류 규칙(rules)
create table if not exists public.bank_kv (
  key text primary key check (key in ('state', 'rules')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.bank_kv enable row level security;
drop policy if exists "admins only" on public.bank_kv;
create policy "admins only" on public.bank_kv for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 3) 예약 실행 열쇠: 정해진 시간에 서버를 부를 때만 씀. 앱에서는 아무도 못 읽어요
create table if not exists public.bank_secret (
  id int primary key default 1 check (id = 1),
  k text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.bank_secret enable row level security;
insert into public.bank_secret (id) values (1) on conflict (id) do nothing;

-- 4) 회사 지출에 통장에서 넣은 줄 표시 (지출을 지우면 그 거래는 다시 '확인할 것'으로)
alter table public.expenses add column if not exists bank_id text;

do $$ begin
  alter publication supabase_realtime add table public.bank_tx;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bank_kv;
exception when duplicate_object then null; end $$;

-- 5) 한국 시간 아침 6시~밤 11시, 매시 5분에 통장 내역 가져오기 (시간은 세계 표준시라 9시간 빼서 적음)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('nest-bank', '5 21-23,0-14 * * *', $$
  select net.http_post(
    url := 'https://gpedhtiyqsjwkxfxftlx.supabase.co/functions/v1/bank',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwZWRodGl5cXNqd2t4ZnhmdGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MDI0MTEsImV4cCI6MjEwNzM3ODQxMX0.DMRNnJ82FvNM8PywBuu_yXoAiv3vMLKKYTjtjmYG4Gk'),
    body := jsonb_build_object('action', 'collect', 'k', (select k from public.bank_secret where id = 1)),
    timeout_milliseconds := 120000);
$$);

-- 확인용: '통장 연결 준비 완료'와 nest-bank 한 줄이 보이면 끝이에요
select '통장 연결 준비 완료' as "결과", (select schedule from cron.job where jobname = 'nest-bank') as "가져오는 시간(세계 표준시)";
