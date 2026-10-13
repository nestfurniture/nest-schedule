-- 네스트퍼니처 업데이트 6: 시방서 출처 표시 (공식 자료인지, 어디서 찾았는지)
-- 제조사 공식 홈페이지에 없는 모델은 판매처·설명서 사이트 등 다른 출처에서라도 찾아 넣고, 공식 자료가 아니면 앱과 시공자 화면에 출처를 함께 보여 줘요.
-- Supabase → SQL Editor → New query 에 통째로 붙여넣고 Run 하세요. 여러 번 실행해도 괜찮아요.

alter table public.app_specs add column if not exists official boolean;              -- 제조사 공식 자료면 true, 다른 출처면 false
alter table public.app_specs add column if not exists source text not null default ''; -- 찾은 곳 (예: LG전자 공식 홈페이지, 다나와 상품정보)
alter table public.app_specs add column if not exists ver int not null default 1;      -- 찾는 방식 버전 (예전 방식으로 못 찾은 모델은 새 방식으로 다시 찾음)

-- 확인용
select '시방서 출처 칸 준비 완료' as "결과";
