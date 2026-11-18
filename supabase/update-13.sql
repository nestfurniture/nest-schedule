-- 네스트퍼니처 업데이트 13: 시공자 계정 잠그기 (계정마다 사무실 직원 / 시공자 정하기)
-- 시공자 계정은 앱이 '내 일정' 화면으로만 열리고, 서버에서도 자기 현장의 시공 정보만 읽어요.
--   읽기: 자기가 들어가는 현장의 이름·품목·주소·출입번호·현장 담당·시공 날짜·가전, 그 현장의 도면과 사진, 자기 체크리스트, 자기가 적은 일당
--   쓰기: 그 현장 사진 올리기, 체크리스트 시작하기, 자기 이름으로 일당 적기 (지우기·고치기·다른 현장·돈·알림은 안 돼요)
-- 계정은 사장님이 앱의 내 정보 → 직원 계정에서 '사무실 직원' 또는 '시공자(이름)'로 정해요.
-- 아직 정하지 않은 새 계정은 로그인해도 아무것도 못 봐요.
-- 처음 실행할 때만: 이미 있는 계정은 시공자 화면에서 이름을 골라 둔 계정 = 시공자, 나머지 = 사무실 직원으로 정해 둬요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

-- 1) 계정별 역할 (관리자는 admins 표 그대로)
do $$ begin
  if to_regclass('public.staff_roles') is null then
    create table public.staff_roles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      email text not null default '',
      role text not null check (role in ('office', 'crew')),          -- office = 사무실 직원, crew = 시공자
      crew text not null default '',                                   -- 시공자 이름 (시공자 명단과 같은 이름)
      updated_at timestamptz not null default now(),
      check (role <> 'crew' or length(crew) between 1 and 40)
    );
    insert into public.staff_roles (user_id, email, role, crew)
    select u.id, coalesce(u.email, ''),
      case when btrim(coalesce(u.raw_user_meta_data->>'crew', '')) <> '' then 'crew' else 'office' end,
      left(btrim(coalesce(u.raw_user_meta_data->>'crew', '')), 40)
    from auth.users u
    where not exists (select 1 from public.admins a where a.user_id = u.id);
  end if;
end $$;
alter table public.staff_roles enable row level security;

-- 2) 누구인지 알려 주는 함수 (표 권한과 상관없이 자기 것만 봄)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.staff_roles where user_id = auth.uid() and role = 'office')
$$;
create or replace function public.my_crew() returns text
language sql stable security definer set search_path = public as $$
  select r.crew from public.staff_roles r where r.user_id = auth.uid() and r.role = 'crew' and not public.is_admin()
$$;
create or replace function public.is_crew() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_crew() is not null
$$;

-- 시공자가 들어가는 현장: 기본 시공자나 날짜별 시공자에 이름이 있고 시공이 75일 안쪽까지 이어지는 현장, 또는 자기 AS가 남은 현장
create or replace function public.crew_job_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with me as (select public.my_crew() as n, to_char((now() at time zone 'Asia/Seoul')::date - 75, 'YYYY-MM-DD') as c)
  select j.id from public.jobs j, me
  where me.n is not null and (
    (greatest(coalesce(j.i->>'start', ''), coalesce(j.i->>'end', '')) collate "C" >= me.c and (
      (case when jsonb_typeof(j.i->'crew') = 'array' then j.i->'crew' else '[]'::jsonb end) ? me.n
      or exists (select 1 from jsonb_each(case when jsonb_typeof(j.i->'days') = 'object' then j.i->'days' else '{}'::jsonb end) d
                 where jsonb_typeof(d.value) = 'array' and d.value ? me.n)))
    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.f->'as') = 'array' then j.f->'as' else '[]'::jsonb end) a
               where a->>'crew' = me.n and ((a->>'done') is distinct from 'true' or coalesce(a->>'date', '') collate "C" >= me.c)))
$$;

-- 시공자 화면에 보낼 현장 정보: 시공에 필요한 칸만 (고객 전화·실측·진행 흐름·마감 기록·다른 사람 AS·돈은 빠짐)
create or replace function public.crew_jobs() returns setof jsonb
language sql stable security definer set search_path = public as $$
  with me as (select public.my_crew() as n)
  select jsonb_build_object(
    'id', j.id, 'name', j.name, 'item', j.item, 'addr', j.addr, 'created_at', j.created_at,
    'i', jsonb_build_object('start', j.i->'start', 'end', j.i->'end', 'crew', j.i->'crew', 'sat', j.i->'sat', 'sun', j.i->'sun',
      'days', j.i->'days', 'off', j.i->'off', 'gate', j.i->'gate', 'door', j.i->'door', 'mgr', j.i->'mgr',
      'apps', j.i->'apps', 'chk', j.i->'chk', 'color', j.i->'color'),
    'f', jsonb_build_object('done', j.f->'done', 'closed', j.f->'closed',
      'as', coalesce((select jsonb_agg(a) from jsonb_array_elements(case when jsonb_typeof(j.f->'as') = 'array' then j.f->'as' else '[]'::jsonb end) a
                      where a->>'crew' = me.n), '[]'::jsonb)))
  from public.jobs j, me
  where me.n is not null and j.id in (select public.crew_job_ids())
$$;

-- 관리자: 로그인 계정 목록과 역할
create or replace function public.list_accounts() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', u.id, 'email', coalesce(u.email, ''), 'name', coalesce(u.raw_user_meta_data->>'name', ''),
    'created_at', u.created_at, 'last_in', u.last_sign_in_at,
    'admin', exists (select 1 from public.admins a where a.user_id = u.id),
    'role', coalesce(r.role, ''), 'crew', coalesce(r.crew, ''))
  from auth.users u left join public.staff_roles r on r.user_id = u.id
  where public.is_admin()
  order by u.created_at
$$;

-- 관리자: 계정 역할 정하기 (role = office · crew · none). 시공자로 정하면 그 계정의 휴대폰 알림은 꺼져요
create or replace function public.set_account(p_user uuid, p_role text, p_crew text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select coalesce(email, '') into v_email from auth.users where id = p_user;
  if not found then return jsonb_build_object('ok', false, 'why', 'no_user'); end if;
  if exists (select 1 from public.admins where user_id = p_user) then return jsonb_build_object('ok', false, 'why', 'admin'); end if;
  p_crew := btrim(coalesce(p_crew, ''));
  if p_role = 'none' then
    delete from public.staff_roles where user_id = p_user;
  elsif p_role = 'office' then
    insert into public.staff_roles (user_id, email, role, crew) values (p_user, v_email, 'office', '')
    on conflict (user_id) do update set email = excluded.email, role = 'office', crew = '', updated_at = now();
  elsif p_role = 'crew' then
    if length(p_crew) not between 1 and 40 then return jsonb_build_object('ok', false, 'why', 'crew'); end if;
    insert into public.staff_roles (user_id, email, role, crew) values (p_user, v_email, 'crew', p_crew)
    on conflict (user_id) do update set email = excluded.email, role = 'crew', crew = excluded.crew, updated_at = now();
    delete from public.push_subs where user_id = p_user;
  else
    return jsonb_build_object('ok', false, 'why', 'role');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_office() from public, anon;
revoke all on function public.my_crew() from public, anon;
revoke all on function public.is_crew() from public, anon;
revoke all on function public.crew_job_ids() from public, anon;
revoke all on function public.crew_jobs() from public, anon;
revoke all on function public.list_accounts() from public, anon;
revoke all on function public.set_account(uuid, text, text) from public, anon;
grant execute on function public.is_admin(), public.is_office(), public.my_crew(), public.is_crew(),
  public.crew_job_ids(), public.crew_jobs(), public.list_accounts(), public.set_account(uuid, text, text) to authenticated, service_role;

-- 3) 역할 표: 각자 자기 줄만 보고, 고치는 건 관리자만
drop policy if exists "own read" on public.staff_roles;
create policy "own read" on public.staff_roles for select to authenticated using (user_id = auth.uid());
drop policy if exists "admins all" on public.staff_roles;
create policy "admins all" on public.staff_roles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- 4) 현장 · 시공자 명단 · 가전 시방서: 사무실(관리자 · 사무실 직원)만. 시공자는 위 crew_jobs()로만 읽어요
drop policy if exists "staff all" on public.jobs;
drop policy if exists "office all" on public.jobs;
create policy "office all" on public.jobs for all to authenticated using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists "staff all" on public.crew;
drop policy if exists "office all" on public.crew;
create policy "office all" on public.crew for all to authenticated using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists "staff all" on public.app_specs;
drop policy if exists "office all" on public.app_specs;
create policy "office all" on public.app_specs for all to authenticated using ((select public.is_office())) with check ((select public.is_office()));

-- 5) 현장 파일: 시공자는 자기 현장 도면·사진만 보고, 사진만 올림 (지우기·고치기 안 됨)
drop policy if exists "staff all" on public.files;
drop policy if exists "office all" on public.files;
create policy "office all" on public.files for all to authenticated using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists "crew read" on public.files;
create policy "crew read" on public.files for select to authenticated
  using ((select public.is_crew()) and kind in ('drawing', 'photo') and job_id in (select public.crew_job_ids()));
drop policy if exists "crew add photo" on public.files;
create policy "crew add photo" on public.files for insert to authenticated
  with check ((select public.is_crew()) and kind = 'photo' and job_id in (select public.crew_job_ids()));

drop policy if exists "nest staff job-files" on storage.objects;
drop policy if exists "nest office job-files" on storage.objects;
create policy "nest office job-files" on storage.objects for all to authenticated
  using (bucket_id = 'job-files' and (select public.is_office())) with check (bucket_id = 'job-files' and (select public.is_office()));
drop policy if exists "nest crew read" on storage.objects;
create policy "nest crew read" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and (select public.is_crew()) and (storage.foldername(name))[2] in ('drawing', 'photo')
    and (storage.foldername(name))[1] in (select x::text from public.crew_job_ids() x));
drop policy if exists "nest crew photo" on storage.objects;
create policy "nest crew photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and (select public.is_crew()) and (storage.foldername(name))[2] = 'photo'
    and (storage.foldername(name))[1] in (select x::text from public.crew_job_ids() x));

-- 6) 체크리스트: 시공자는 자기 현장 것만 보고 새로 시작만 함 (쓰는 건 지금처럼 체크리스트 링크로)
drop policy if exists "staff all" on public.checklists;
drop policy if exists "office all" on public.checklists;
create policy "office all" on public.checklists for all to authenticated using ((select public.is_office())) with check ((select public.is_office()));
drop policy if exists "crew read" on public.checklists;
create policy "crew read" on public.checklists for select to authenticated
  using ((select public.is_crew()) and job_id in (select public.crew_job_ids()));
drop policy if exists "crew add" on public.checklists;
create policy "crew add" on public.checklists for insert to authenticated
  with check ((select public.is_crew()) and job_id in (select public.crew_job_ids()) and status = 'open' and data = '{}'::jsonb);

-- 7) 일당: 시공자는 사장님이 정한 자기 이름으로만, 자기 현장으로만 적음
drop policy if exists "own add" on public.crew_days;
create policy "own add" on public.crew_days for insert to authenticated
  with check (user_id = auth.uid() and not locked and day <= (now() at time zone 'Asia/Seoul')::date
    and crew = (select public.my_crew()) and (job_id is null or job_id in (select public.crew_job_ids())));
drop policy if exists "own edit" on public.crew_days;
create policy "own edit" on public.crew_days for update to authenticated
  using (user_id = auth.uid() and not locked)
  with check (user_id = auth.uid() and not locked and day <= (now() at time zone 'Asia/Seoul')::date
    and crew = (select public.my_crew()) and (job_id is null or job_id in (select public.crew_job_ids())));

-- 8) 휴대폰 알림(전체 현장 소식)은 사무실 계정만. 시공자 계정 기기는 지금 꺼요
drop policy if exists "own subs" on public.push_subs;
create policy "own subs" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (select public.is_office()));
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb, p_device text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.is_office() then raise exception 'office only' using errcode = '42501'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth, prefs, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_prefs, '{}'::jsonb), coalesce(p_device, ''))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = excluded.prefs, device = excluded.device, updated_at = now();
end $$;
revoke all on function public.save_push_sub(text, text, text, jsonb, text) from public, anon;
grant execute on function public.save_push_sub(text, text, text, jsonb, text) to authenticated;
delete from public.push_subs p where not exists (select 1 from public.admins a where a.user_id = p.user_id)
  and not exists (select 1 from public.staff_roles r where r.user_id = p.user_id and r.role = 'office');

-- 확인용: 계정마다 정해진 역할
select coalesce(u.email, '') as "계정",
  case when exists (select 1 from public.admins a where a.user_id = u.id) then '관리자'
       when r.role = 'office' then '사무실 직원'
       when r.role = 'crew' then '시공자 · ' || r.crew
       else '아직 안 정함 (못 들어옴)' end as "역할"
from auth.users u left join public.staff_roles r on r.user_id = u.id
order by u.created_at;
