-- 네스트퍼니처 업데이트 5: 시방서 찾을 모델 목록
-- 현장에 적어 둔 가전 모델명(모델명·종류만)을 Claude가 읽을 수 있게 합니다. 고객 이름·주소·일정·금액은 나가지 않아요.
-- Claude가 이 목록을 보고 제조사 공식 홈페이지에서 시방서를 찾아 앱(specs.json)에 넣어 둡니다.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

create or replace function public.spec_models()
returns table (model text, type text)
language sql stable security definer set search_path = public
as $$
  select distinct on (k) m, t from (
    select upper(regexp_replace(a->>'model', '[^0-9A-Za-z가-힣]', '', 'g')) as k,
           trim(a->>'model') as m, coalesce(a->>'type', '') as t
    from public.jobs, jsonb_array_elements(case when jsonb_typeof(i->'apps') = 'array' then i->'apps' else '[]'::jsonb end) as a
    where coalesce(trim(a->>'model'), '') <> ''
  ) x
  where k <> ''
  order by k, t desc;
$$;
revoke all on function public.spec_models() from public;
grant execute on function public.spec_models() to anon, authenticated;

-- 확인용: 지금까지 적어 둔 모델 목록
select * from public.spec_models();
