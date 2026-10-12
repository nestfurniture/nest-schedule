# 네스트퍼니처

현장별 실측일, 시공 기간과 시공자 배정, 마감 추가 투입 인원과 AS를 관리하고, 현장마다 사진·도면·견적서를 보관하는 웹앱입니다.
시공자별 일정판(겹침 경고), 수금 관리, 원가·매출 요약(관리자만)도 들어 있습니다.
PC와 휴대폰 브라우저에서 쓰고, 휴대폰 홈 화면에 설치하면 앱처럼 전체 화면으로 열립니다.

- 화면: `index.html`, `app.js` (빌드 과정 없음, 파일 그대로 올리면 됨)
- 저장·로그인·파일 보관: Supabase (`supabase/schema.sql` + `supabase/update-02.sql`, 비공개 Storage 버킷 `job-files`)
- 설치(PWA): `manifest.webmanifest`, `sw.js`, `icons/`

## 처음 설정

1. Supabase 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`, 이어서 `supabase/update-02.sql` 내용을 실행합니다. 표(jobs, crew, files, admins, job_money)와 파일 보관함(job-files)이 만들어집니다.
2. Authentication → Sign In / Providers에서 "Allow new users to sign up"을 끕니다. (아무나 가입하지 못하게)
3. Authentication → Users → Add user로 사장님과 직원 계정(이메일, 비밀번호)을 만듭니다. "Auto Confirm User"를 체크하세요.
4. `config.js`에 Project URL과 anon public 키를 넣습니다. service_role 키는 넣지 않습니다.
5. GitHub 저장소 Settings → Pages에서 Source를 "Deploy from a branch", 브랜치 `main`, 폴더 `/ (root)`로 저장합니다.
   잠시 뒤 `https://<계정>.github.io/nest-schedule/` 주소로 열립니다.

## 업데이트 2 (현장 사진 · 수금 · 매출) 적용

이미 쓰고 있는 앱에는 Supabase → SQL Editor → New query에 `supabase/update-02.sql` 내용을 통째로 붙여넣고 Run을 한 번 누르면 됩니다.
처음 실행할 때 가장 먼저 만든 계정(사장님)이 관리자로 등록되고, 관리자만 계약금액·입금·원가·매출 화면을 볼 수 있습니다.

다른 계정도 관리자로 만들려면 SQL Editor에서 이메일만 바꿔 실행하세요.

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = '직원이메일@example.com'
on conflict do nothing;
```

## 휴대폰에 설치

- 아이폰: Safari로 주소를 열고 공유 버튼 → "홈 화면에 추가"
- 안드로이드: Chrome으로 주소를 열고 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"

## 보안 메모

anon 키는 공개되어도 되는 키입니다. 데이터는 로그인한 계정만 읽고 쓸 수 있도록 Supabase 행 수준 보안(RLS)으로 막혀 있습니다.

## 파일 보관 용량

Supabase 무료 요금제는 파일 합계 1GB, 파일 하나당 50MB까지입니다. 넘으면 Pro 요금제(월 25달러, 100GB)로 올리면 됩니다.
현장 사진은 올릴 때 자동으로 줄여서(장당 약 0.2~0.5MB) 저장합니다.
