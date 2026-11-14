# AGENTS.md

이 파일은 AI 에이전트(Codex / Claude Code 등)가 본 저장소에서 작업할 때 참고하는 가이드입니다.
`CLAUDE.md`는 이 파일을 가리키는 포인터입니다 — **문서를 고칠 때는 이 파일만 고치세요.**

---

## 1. 프로젝트 개요

**이름:** Check Check — 건설 현장 출퇴근 · 노무 · 급여 관리 앱 (저장소·Vercel·Supabase 프로젝트 이름은 예전 그대로)
**도메인:** 건설 현장 노무 관리 — 근로자 등록, QR 출퇴근 타각, 근태 정산, 임금 정책(연장/야간/휴일 가산, 4대보험, 세금) 설정, 급여 시뮬레이션, 노무대장·급여명세서 엑셀 발행
**현재 버전:** `package.json`의 `version` (빌드 시 `__APP_VERSION__` 전역 상수로 주입되어 화면 우상단에 표시)

> 이 프로젝트는 Google AI Studio 프로토타입(Firebase 기반)에서 출발했지만, **현재는 Supabase(Postgres + Auth + RLS + RPC)로 완전히 이관되었습니다.** Firebase 관련 파일·코드는 저장소에 남아 있지 않습니다.

### 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | React 19 + TypeScript 5.8 |
| 빌드 | Vite 6 |
| 스타일 | Tailwind CSS 4 (`@tailwindcss/vite`) |
| 인증/DB | Supabase (`@supabase/supabase-js` v2) — Postgres + Auth + RLS + RPC |
| PWA | `vite-plugin-pwa` — 새 배포 감지 시 확인 없이 자동 갱신 (7절 참고) |
| QR | `html5-qrcode`(스캔, 동적 import) / `qrcode`(생성) |
| 엑셀 | `exceljs` + `file-saver` |
| 아이콘/모션 | `lucide-react`, `motion` |
| 배포 | Vercel (`vercel.json`, framework: vite) |

### 실행

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY 채우기
npm run dev                  # vite, 포트 3000, --host 0.0.0.0 (모바일 실기기 테스트용)
npm run build
npm run lint                 # tsc --noEmit — 프런트 검증 수단 (supabase/functions 는 Deno 코드라 검사 제외, MCP 계산은 5절의 deno test)
```

`src/supabase.ts`는 환경변수가 없으면 **모듈 로드 시점에 throw** 합니다. `.env.local` 없이는 앱이 뜨지 않습니다.

---

## 2. 파일 구조

```
출퇴근앱/
├── index.html
├── vite.config.ts                  # PWA manifest, __APP_VERSION__ 주입, @ alias
├── vercel.json
├── .env.example
├── AGENTS.md                       # ← 이 파일 (단일 진실 원천)
├── CLAUDE.md                       # AGENTS.md 포인터 (gitignore 대상, 커밋 안 됨)
├── README.md
├── supabase/
│   ├── schema.sql                  # 초기 스키마 (테이블 8종 + 트리거 + 헬퍼 함수)
│   ├── policies.sql                # RLS 정책 (재실행 안전)
│   ├── seed.sql                    # settings 8종 + 공휴일 시드 (멱등)
│   ├── bootstrap_first_admin.sql   # 첫 관리자 계정 생성 안내
│   ├── migrations/001~012_*.sql    # 순차 적용 마이그레이션
│   ├── config.toml                 # Edge Function 배포 옵션 (verify_jwt = false)
│   └── functions/                  # Edge Function (Deno — tsc 검사 제외)
│       ├── health/                 # 대시보드용 운영 지표 (집계만)
│       └── mcp/                    # 읽기 전용 MCP 서버 (index.ts, calc.ts, calc.test.ts) — 5절 참고
└── src/
    ├── main.tsx
    ├── App.tsx                     # 로그인 게이트 → 역할별 분기 (Admin 5탭 / Worker 포털)
    ├── supabase.ts                 # 클라이언트 초기화 (18줄)
    ├── types.ts                    # AllSettings, Worker, Holiday, SettingsHistory
    ├── i18n.tsx                    # 7개 언어 × 73개 키 (ko/vi/km/my/ne/zh/en)
    ├── context/
    │   └── SupabaseContext.tsx     # Auth + CRUD + RPC 래퍼 — 앱의 데이터 허브 (944줄)
    ├── components/
    │   ├── WorkerTab.tsx           # 근로자 CRUD (1308줄)
    │   ├── AttendanceTab.tsx       # 근태 조회·수정·정산 확정 (1386줄)
    │   ├── ExpiryTab.tsx           # 계약·여권 만료 알림 (281줄)
    │   ├── SettingsTab.tsx         # 임금 정책 설정 + 현장 QR 코드 발급 (1774줄)
    │   ├── ManDayTableEditor.tsx   # 일용/사업소득 급여정산 테이블 편집 창
    │   ├── SiteLocationEditor.tsx  # 현장 기준점·반경 편집 (SiteMap.tsx = Leaflet 지도, 동적 import)
    │   ├── SimulatorTab.tsx        # 월 급여 시뮬레이터 (563줄)
    │   └── WorkerPortal.tsx        # 근로자용 모바일 화면 — QR 스캔 출퇴근 (759줄)
    ├── utils/
    │   ├── payrollCalculator.ts    # 급여 계산 (309줄)
    │   ├── attendanceHours.ts      # 타각 보정 + 근로시간/공수 분해 (244줄)
    │   ├── geo.ts                  # 기준점 설정 여부 판정, 거리 표기
    │   ├── datetime.ts             # IANA 타임존 기준 날짜·시각 변환 (99줄)
    │   ├── excelExporter.ts        # 노무대장/급여명세서/근태부 3종 (1280줄)
    │   └── auth.ts                 # 로그인 ID ↔ 가짜 이메일 변환 (53줄)
    ├── constants/workerOptions.ts  # 부서·직급·직종 기본 선택지
    └── data/defaults.ts            # DEFAULT_SETTINGS (+ 미사용 상수 2종, 3절 참고)
```

---

## 3. 인증 구조 — "가짜 이메일" 패턴

Supabase Auth는 이메일을 요구하지만 사용자는 ID/비밀번호로 로그인합니다. `src/utils/auth.ts`가 변환을 담당합니다.

| 역할 | 입력 ID | 변환 결과 |
|---|---|---|
| 관리자 | `admin01` | `admin01@admin.cm.local` |
| 근로자 | `010-1234-5678` (전화번호) | `01012345678@worker.cm.local` (숫자만 추출) |

- **역할 판정은 이메일 도메인으로 결정됩니다.** `auth.users` INSERT 시 `handle_new_auth_user()` 트리거가 도메인을 보고 `profiles.role`을 `admin`/`worker`로 설정하고, 근로자면 `login_id` 숫자와 매칭해 `profiles.worker_id`까지 자동 연결합니다.
- RLS 헬퍼: `is_admin()`, `current_worker_id()` — 모든 정책이 이 둘을 재사용합니다.
- 첫 관리자는 Supabase 대시보드에서 직접 생성해야 합니다 (`supabase/bootstrap_first_admin.sql` 참고).
- `App.tsx` 루트 분기: 미로그인 → `LoginGate`, `role === "worker"` → `WorkerPortal`, 그 외 → `AdminPortal`.

---

## 4. 데이터 모델 (Postgres)

`schema.sql` 기준 8개 테이블. **단, migrations 001~010에서 컬럼과 함수가 계속 추가되었으므로 `schema.sql`만 보고 판단하면 안 됩니다.**

| 테이블 | 용도 |
|---|---|
| `profiles` | `auth.users` ↔ 역할(`admin`/`worker`) ↔ `worker_id` 매핑 |
| `settings` | 8개 카테고리를 `category` PK + `data jsonb`로 보관 (`types.ts`의 `AllSettings` 키와 1:1) |
| `workers` | 근로자 마스터 (월급/시급/일용/사업소득 4유형) |
| `holidays` | 공휴일 + 사용자 지정 휴일 |
| `attendance` | 일별 출퇴근 헤더. `unique (worker_id, work_date)` |
| `attendance_segments` | 일 내 구간별 시간·공수 분해. **정산 확정 결과가 여기 저장됨** |
| `payroll_records` | 월별 급여 명세 확정본 (스키마만 존재 — UI 미연결, 6절 참고) |
| `settings_history` | 감사 로그 |

### 마이그레이션 이력 (적용 순서 = 파일명 순서)

| 파일 | 내용 |
|---|---|
| `001_domain_based_role` | 이메일 도메인 기반 역할 자동 판정 |
| `002_worker_account_rpc` | `create_worker_with_account` / `reset_worker_password` / `delete_worker_auth_account` |
| `003_qr_attendance` | `regenerate_site_checkin_code` / `submit_attendance` (QR 코드 검증 + 타각) |
| `004_encrypt_resident_number` | 주민번호 pgcrypto 암호화 (`resident_number_enc`) + `get/set_resident_number` |
| `005_worker_self_service` | `update_my_worker_profile` / `change_my_password` (근로자 본인용) |
| `006_attendance_korea_work_date` | `submit_attendance`의 근무일자를 KST 기준으로 산정 |
| `007_worker_job_and_org_options` | `workers.job` 추가 + 부서/직급/직종 옵션 |
| `008_foreign_worker_fields` | 외국인 필드 (`is_foreigner`, `visa_type`, `passport_expiry`, 본국 연락처 등) + `contract_end_date` |
| `009_retired_worker_retention` | `retire_worker` / `purge_retired_worker_private_data` (퇴사자 개인정보 파기) |
| `010_worker_has_vehicle` | `workers.has_vehicle` — 자가운전보조금 비과세 분리용 |
| `011_expand_attendance_statuses` | `attendance.status` check 제약 확장 |
| `012_geo_attendance` | `submit_attendance`에 위치 인자(`p_lat`/`p_lng`/`p_accuracy`, 기본 NULL) 추가 + `check_in/out_accuracy_m` 컬럼 |

운영 DB에는 Supabase 마이그레이션 이력 테이블이 비어 있습니다(001~011은 SQL 편집기로 수동 적용). 012부터 이력에 남습니다. **파일이 있다고 운영에 적용됐다고 가정하지 말고 실제 DB를 확인하세요.**

`create_worker_with_account`는 002·004·007·008·010에서 **다섯 번 재정의**되었습니다. 이 함수를 수정할 때는 최신 정의(010)를 기준으로 새 마이그레이션 파일에 전체를 재작성하세요.

### RLS 원칙 (`policies.sql`)

- `admin` → 전체 R/W
- `worker` → 본인 데이터만 R, 출퇴근 INSERT/UPDATE만 W
- 미인증 → 전면 차단
- `settings`·`holidays`는 인증된 사용자면 누구나 SELECT 가능 (근로자 화면에서 근로시간 계산에 필요)

---

## 5. 핵심 도메인 로직

### 타각 보정(스냅) — `attendanceHours.ts` + `types.ts:AttendanceSnapRule`

"이 요일에 이 시간 구간에 찍으면 → 이 시각으로 인정"하는 규칙. `dayType`(weekday/saturday/sunday/holiday) × `kind`(in/out) × 구간 → `snapTo`.
기본값은 `DEFAULT_SETTINGS.overtimeRules.snapRules`에 18개 정의되어 있고, 관리자가 `SettingsTab`에서 수정 가능합니다. 규칙에 걸리지 않는 타각은 **보정하지 않고 원본 시각 사용**.

### 출퇴근 검증 방식 — QR 검증 + 위치 기록

**출퇴근을 막는 검증은 QR 코드뿐입니다. 위치(GPS)는 타각을 막지 않고 거리·반경 내 여부를 기록·표시만 합니다.** (GPS 오차나 권한 거부로 출근이 막히면 안 된다는 결정)

- 관리자가 `SettingsTab`에서 `regenerate_site_checkin_code` RPC로 현장 QR 코드를 발급 → 근로자가 `WorkerPortal`에서 스캔 → `submit_attendance` RPC가 타각합니다.
- 코드는 `settings.site` 문서의 `data->>'checkinCode'`에 **현장당 하나, 정적으로** 보관됩니다. 시간 만료나 자동 회전이 없어 관리자가 수동 재발급할 때까지 계속 유효합니다.
- `submit_attendance`가 검증하는 것: ① 근로자 계정 로그인 여부(`current_worker_id()`) ② 퇴사 여부(`retire_date`) ③ QR 코드 문자열 일치 ④ 당일 중복 출근/퇴근 ⑤ 퇴근 전 출근 선행.
- **위치 기록(012):** `WorkerPortal`이 스캐너를 열 때 `navigator.geolocation`을 병렬로 요청하고, 좌표가 있으면 `submit_attendance(scanned_code, action, p_lat, p_lng, p_accuracy)`로 함께 보냅니다. 서버가 haversine 거리를 계산해 `attendance.check_in/out_lat·lng·accuracy_m·distance_m·within_geo`에 씁니다. 좌표가 없으면 전부 NULL. 위치 계산은 별도 예외 블록 안에 있어 어떤 입력에도 타각을 실패시키지 않습니다.
- **주소로 좌표 찾기:** 현장 주소란에서 Enter → `geo.ts`의 `geocodeAddress()`(OpenStreetMap Nominatim, 키 없음)가 좌표를 찾아 지도 draft만 옮깁니다(저장은 관리자가 직접). 시골 도로명 주소는 읍·시 단위까지만 찾아지므로 "대략적인 위치" 안내를 띄웁니다. 정확도를 높이려면 이 함수만 카카오 주소 검색 등으로 바꾸면 됩니다.
- **`settings.site.siteLocationSet`이 `true`일 때만 거리·반경 판정을 합니다.** 관리자가 `SiteLocationEditor`(Leaflet + OpenStreetMap, "현재 위치를 기준점으로" 버튼)에서 저장하면 true가 됩니다. 좌표 값으로 "미설정"을 추측하지 마세요 — 운영 DB에는 예전 가짜 지도를 눌러 생긴 `37.123, 126.457`이 들어 있었고, 시드 더미 `37.1234, 126.4567`과 달라 값 비교로는 걸러지지 않았습니다. 프런트 판정은 `utils/geo.ts`의 `isSiteLocationUnset()`.
- 인자 3개에 기본값이 있어 옛 버전 PWA의 2인자 호출도 그대로 동작합니다. 이 함수를 다시 고칠 때는 오버로드가 두 개 남지 않도록 기존 시그니처를 DROP하고 012 정의를 기준으로 전체를 재작성하세요.
- 관리자 화면: `AttendanceTab`의 출퇴근 시각 옆 "현장 밖 · 거리" 배지(`within_geo === false`일 때만). `health` Edge Function의 "현장 밖 타각" 지표도 같은 컬럼을 봅니다.
- geolocation은 HTTPS에서만 동작합니다. `npm run dev`(http, 0.0.0.0)로 띄운 실기기에서는 위치가 잡히지 않는 것이 정상입니다.

**"출퇴근이 반경 밖에서도 찍힌다"는 제보는 버그가 아니라 사양입니다.** 차단으로 바꾸려면 사용자 결정이 먼저 필요합니다.

**알려진 한계 — 야간조 퇴근:** `submit_attendance`는 근무일자를 "찍는 순간의 KST 날짜"로 정합니다. 저녁에 출근해 다음 날 새벽에 퇴근을 찍으면 그날 출근 행이 없어 "출근 체크가 먼저 필요합니다"로 거부됩니다. 지금은 관리자가 `AttendanceTab`에서 퇴근을 수동 입력해야 합니다.

### 근태 정산 확정 흐름

1. 근로자가 `WorkerPortal`에서 현장 QR을 스캔 → `submit_attendance` RPC → `attendance` 행 생성/갱신
2. 관리자가 `AttendanceTab`에서 조회 → `calculateDailyBreakdown()`이 정규/연장/휴일/휴일연장/야간/공수 6종으로 자동 분해
3. 관리자가 값을 검토·수정 후 **확정** → `confirmAttendanceBreakdown()`이 기존 `attendance_segments`를 지우고 새로 INSERT
4. 엑셀 발행 및 집계는 확정된 segments를 우선 사용, 없으면 자동 계산값 사용

`AttendanceBreakdownValues`(앱) ↔ `attendance_segments.segment_type`(DB) 매핑은 `SupabaseContext.tsx`의 `segmentsToBreakdown()`에 있습니다. **segment_type을 추가하면 이 함수도 반드시 수정해야 합니다.**

주의: DB `check` 제약은 segment_type 8종을 허용하지만, `confirmAttendanceBreakdown()`이 실제로 쓰는 것은 `standard` / `weekday_ot` / `holiday` / `holiday_ot` / `night` **5종뿐**입니다. 일용직용 `early_morning` / `afternoon_ot` / `evening_ot`는 읽기(`segmentsToBreakdown`)만 지원되고 쓰이는 경로가 없습니다. 공수(`man_days`)도 `standard` 행에 전량 몰아서 기록합니다.

### 일용/사업소득 공수 — 급여정산 테이블 (`attendanceHours.ts`)

일용직(`daily`)·사업소득자(`business`)의 공수는 수식이 아니라 **관리자가 편집하는 표**로 정합니다. 원본은 엑셀 노무대장의 "급여정산 테이블" 시트이고, 엑셀 수식과 같은 결과가 나와야 합니다.

- 표는 `settings.dailyWorkerRules.manDayTable`(`ManDayRow[]`)에 저장합니다. `undefined`면 `defaults.ts`의 `DEFAULT_MAN_DAY_TABLE`(엑셀 원본)을 씁니다. 편집 화면은 `ManDayTableEditor.tsx`(SettingsTab 하위 탭, draft + 저장 버튼, 미리보기 계산기).
- 규칙(`calculateManDaysFromTable`): 각 행에 대해 **출근 ≤ 시작 AND 퇴근 ≥ 종료**이면 그 행의 공수를 더합니다. 구간을 완주하지 못하면 0입니다(비례 계산 없음).
- 출근 시각 ≥ `nightShiftStartTime`(기본 15:00)이면 야간조 표, 아니면 주간조 표.
- 요일 구분(`resolveManDayDayType`): 일요일 또는 **평일에 걸린 공휴일 → 일요일 표**, 토요일 → 토요일 표, 그 외 평일 표. 엑셀 라벨은 "토요일/공휴일"이지만 수식이 이렇게 동작해 수식을 따랐습니다.
- `countable: false` 행은 표시용(예: 평일 08–17 = 1, 점심·식사시간)이라 합산하지 않습니다. 합산하면 반일 두 개와 중복됩니다. `outBefore`가 있는 행(오후조기퇴근)은 퇴근이 그 시각 미만일 때만 적용.
- 검증용 정답: 평일 08–17=1 / 08–19:30=1.5 / 08–22=2 / 08–24=2.5 / 토 08–16=1 / 일 08–15:30=1 / 평일 야간 19:30–05:30=2.
- 타각 보정(`snapRules`)이 먼저 적용된 시각으로 계산합니다. `excelExporter.ts`도 같은 함수를 호출합니다 — 공수 수식을 다른 곳에 다시 구현하지 마세요.
- `dailyWorkerRules`의 `earlyMorning*` / `afternoonOvertime*` / `eveningOvertime*` / `holidayRate`는 일용·사업소득 공수에는 더 이상 쓰이지 않지만 **삭제 금지**: 시급제 연장 판정과 `payrollCalculator.ts` 시뮬레이터가 계속 씁니다.
- 표를 바꿔도 이미 확정된 근태(`attendance_segments`)는 바뀌지 않고, 미확정 행만 새 규칙으로 계산됩니다.
- **`attendanceHours.ts`·`datetime.ts`·`DEFAULT_MAN_DAY_TABLE`은 `supabase/functions/mcp/calc.ts`에 복사본이 있습니다(MCP 서버용). 한쪽을 고치면 다른 쪽도 같이 고치고 `calc.test.ts`를 돌리세요** — 아래 "읽기 전용 MCP 서버" 절 참고.

### 지각 표시 (`attendanceHours.ts`의 `getLateMinutes`)

- 기준: 근무시간 설정의 기본 출근 시각(`workTime.defaultCheckIn`, 보통 08:00)을 **넘기면** 지각(08:01부터). 사용자 결정 사항입니다.
- 타각 보정(`snapRules`)과는 별개입니다. 08:20 출근은 공수 계산에서 08:00으로 인정되지만 지각 표시는 남습니다.
- 야간조(출근이 `nightShiftStartTime` 이후)는 요일마다 시작 시각이 달라 **판정하지 않습니다.**
- DB에 저장하지 않고 출근 시각에서 그때그때 계산합니다(마이그레이션 없음). 관리자가 출근 시각을 고치면 표시도 따라 바뀝니다.
- 근로자: 출근 QR 타각 결과 창에 "지각입니다" 안내(`lateTitle`/`lateDetail`, 7개 언어). 출근 자체는 정상 처리됩니다.
- 관리자: `AttendanceTab`의 "지각" 요약 카드(누르면 지각만 보기), 출근 시각 옆 배지("지각 N분 · 누적 N회"). 누적은 **조회 기간 안** 그 근로자의 지각 횟수입니다.

### 급여 계산 — `payrollCalculator.ts`

`calculatePayroll(worker, settings, input)` 하나가 4개 고용유형을 모두 처리합니다. 통상시급은 `getOrdinaryHourlyRate()`가 유형별로 산출(월급제는 `hourlyOrdinaryMonthlyHours`=209로 나눔). 월급제는 `has_vehicle`이 true일 때만 자가운전보조금을 비과세로 분리합니다.

### 타임존 — `datetime.ts`

DB는 `timestamptz`, 프런트엔드의 표시·판정은 `settings.site.timezone`(기본 `Asia/Seoul`) 기준. **`new Date().getHours()` 같은 로컬 시각 직접 접근을 새로 추가하지 마세요.** `getZonedClockMinutes` / `getZonedYmd` / `zonedWallTimeToUtcIso`를 사용합니다.

**단, `submit_attendance` RPC 안에는 `AT TIME ZONE 'Asia/Seoul'`이 SQL로 하드코딩되어 있습니다** (006에서 도입). 즉 타각 시 근무일자(`work_date`) 결정은 `settings.site.timezone` 설정을 무시하고 항상 KST로 계산합니다. 타임존을 실제로 바꿀 일이 생기면 프런트엔드만 고쳐서는 안 되고 이 RPC도 함께 수정해야 합니다.

### 엑셀 — `excelExporter.ts`

`exportLaborLedger`(노무대장) / `exportPayslips`(급여명세서) / `exportAttendanceBook`(근태부) 3종. 노무대장은 근로자 1인당 구분 6행(출근/퇴근/연장/휴일/휴일연장/야간) 구조입니다.

### 읽기 전용 MCP 서버 — `supabase/functions/mcp`

AI(Claude 등)가 앱 데이터를 읽어 사용자가 준 엑셀 노무대장 양식을 채우게 하는 Edge Function입니다. **조회만 합니다. 쓰기 도구를 추가하지 마세요**(사용자 결정).

- **경로:** `https://<프로젝트 ref>.supabase.co/functions/v1/mcp`. MCP Streamable HTTP, 상태 없음(세션 없음) + JSON 응답. POST만 받고 GET/DELETE는 405. 공식 SDK(`@modelcontextprotocol/sdk`)의 `WebStandardStreamableHTTPServerTransport`를 요청마다 새로 만듭니다.
- **인증:** `Authorization: Bearer <토큰>`의 SHA-256을 함수 시크릿 **`MCP_TOKEN_SHA256`**(16진수 64자)과 비교합니다. 시크릿이 없으면 모든 요청이 401입니다. 토큰 원문은 저장소·함수 어디에도 없습니다(해시만 시크릿에). `supabase/config.toml`의 `verify_jwt = false`가 있어야 게이트웨이에서 막히지 않습니다. DB는 함수 안에서만 service role로 읽습니다.
- **토큰 교체:** 새 토큰을 만들어 해시를 `supabase secrets set MCP_TOKEN_SHA256=<새 해시>`로 덮어쓰면 즉시 옛 토큰이 무효가 됩니다(재배포 불필요). 명령은 `README.md` 참고. `health` 함수는 아직 해시가 코드에 박혀 있어 교체하려면 코드 수정 + 재배포가 필요합니다.
- **도구 5개:** `list_workers`, `get_attendance(from, to, worker_code?)`, `get_monthly_summary(month, worker_code?)`, `get_settings`, `get_holidays(year)`. 기간은 한 번에 최대 93일.
- **노출 범위(화이트리스트):** 근로자는 사번·이름·고용유형·부서/직급/직종·입사일/퇴사일·단가 3종만. 근태는 근무일·출퇴근 시각·상태·확정 segments만. 설정은 `index.ts`의 `pick()` 목록에 적힌 키만. **주민번호·계좌·연락처·주소·좌표·QR 코드(`checkinCode`)·관리자 메모(`note`)는 select조차 하지 않습니다.** 컬럼을 늘릴 때 `select('*')`를 쓰지 말고 목록에 명시하세요.
- **계산:** 확정된 행은 `attendance_segments`(규칙은 `segmentsToBreakdown()`과 동일 — `index.ts`에 같은 이름의 복사본이 있으니 segment_type을 추가하면 함께 수정), 미확정 행은 `calc.ts`의 `calculateDailyBreakdown()`. `calc.ts`는 프런트 유틸의 **복사본**입니다. 원본이 확장자 없는 import를 쓰는 Vite 코드라 Deno 번들이 직접 가져올 수 없어서입니다.
- **복사본 동등성 테스트** (원본과 3만 건 조합 비교 + 공수 정답표):
  ```bash
  deno test --no-check --sloppy-imports --allow-read --allow-env supabase/functions/mcp/calc.test.ts
  ```
  `attendanceHours.ts`·`datetime.ts`·`defaults.ts`의 공수표를 고친 뒤에는 `calc.ts`에 같은 수정을 넣고 이 테스트를 통과시킨 다음 함수를 재배포해야 합니다. 그러지 않으면 앱 화면과 AI가 채운 엑셀의 미확정 공수가 달라집니다.
- 배포는 수동입니다(`supabase functions deploy mcp`). CI가 없으므로 코드를 고쳐도 재배포 전에는 운영에 반영되지 않습니다.
- **앱 안 안내 화면:** 운영 규칙 설정 > "MCP 서버 설정"(`McpSettingsPanel.tsx`)이 서버 주소와 연결 명령을 보여 줍니다. 토큰은 표시하지 않습니다(앱은 토큰을 모릅니다).

### Claude Code 플러그인 — `plugin/` (`/checkin`)

`/checkin 11월`처럼 부르면 한 달 근태를 엑셀 노무대장 양식에 채웁니다. 마켓플레이스 정의는 저장소 루트 `.claude-plugin/marketplace.json`, 플러그인 본체는 `plugin/`.

- 스킬(`plugin/skills/checkin/SKILL.md`)은 달을 `YYYY-MM`으로 정해 `plugin/scripts/fill_ledger.py`를 실행만 합니다. 스크립트가 MCP 서버의 `get_attendance`를 직접 호출합니다(한 달 치를 AI가 읽어 옮기지 않도록).
- 스크립트는 양식 '전체' 시트의 **U1(연)·X1(월)과 출근·퇴근 행의 P~AT열(1~31일)만** 바꿉니다. 근로자 행은 B열 사번 + O열 "출근"/"퇴근"으로 찾습니다. 공수·수당은 양식 수식이 계산하므로, 넣는 값은 인정 시각(`check_in/out_recognized`)의 시간 분수입니다. xlsx를 통째로 다시 쓰지 않고 해당 칸 XML만 바꿉니다(표준 라이브러리만 사용).
- **이 저장소는 공개입니다. 양식 파일(근로자 주민번호·계좌 포함)과 토큰은 절대 커밋하지 마세요.** 둘 다 사용자 컴퓨터의 `~/.config/check-check/`(`template.xlsx`, `mcp-token.txt`)에 둡니다.

---

## 6. 알려진 상태 · 미구현

### 미구현

- **`payroll_records` 테이블이 UI에 연결되어 있지 않음** — 스키마·RLS는 준비됐지만 `SimulatorTab`은 여전히 화면상 모의 계산만 하고 결과를 저장하지 않습니다. 급여 확정·이력 관리를 하려면 여기부터.
- **연차 관리** — `annualLeave` 설정값만 있고 발생/소진 추적 화면 없음
- **은행 이체 연동** — 계좌 정보 수집만, 펌뱅킹 API 없음
- **연말정산 / 원천징수영수증** 없음
- **프런트 테스트 0건 / CI 없음** — 검증 수단은 `npm run lint`(tsc)와 MCP 계산 복사본의 `deno test`(5절)뿐

### 정리 대상 (동작에는 영향 없음)

- `src/data/defaults.ts`의 **`MOCK_WORKERS`·`DEFAULT_HOLIDAYS`는 어디서도 import되지 않는 죽은 코드**입니다. 시드는 `supabase/seed.sql`이 담당합니다. (`MOCK_WORKERS`에는 주민번호·계좌번호 형식의 더미 데이터가 들어 있습니다.)
- **미사용 의존성 4종:** `@google/genai`, `express`, `dotenv`, `autoprefixer` — 소스 참조 0건. `package.json`의 `clean` 스크립트도 존재하지 않는 `server.js`를 지웁니다.
- `SupabaseContext.tsx` 말미의 `useFirebase` / `FirebaseProvider` 별칭 — Firebase 시절 하위호환용

### 하드코딩된 값

- 회사명 `"씨엠(CM)건설"`, 현장 주소 `"충남 당진시 신평면 신평로 45"` — `defaults.ts` 및 `seed.sql`
- 인증 도메인 `admin.cm.local` / `worker.cm.local` — `auth.ts` + `handle_new_auth_user()` 트리거 **양쪽에 박혀 있음.** 바꾸려면 둘 다 고쳐야 합니다.
- `ExpiryTab.tsx`: 만료 알림 임계값 `ALERT_WINDOW_DAYS = 60`, 개인정보 보존 `PRIVACY_RETENTION_YEARS = 2`
- `WorkerTab.tsx`: 신규 등록 기본값 (월급 3,000,000 / 시급 12,000 / 일급 180,000 / 사번 포맷 `CM-{year}-{nnn}`)

---

## 7. 작업 시 주의사항

- **겉모습은 `src/index.css`의 `@theme` 토큰으로 바꿉니다.** 색(slate·gray·stone을 같은 중립색으로 통일, blue가 포인트 색)·모서리·그림자·글꼴(Pretendard)이 여기서 정해집니다. 관리자가 고령이라 **화면 배치(탭 순서, 버튼 위치, 표의 열, 문구)는 바꾸지 않는다**는 것이 사용자 요청입니다. 디자인을 손볼 때 컴포넌트의 레이아웃 클래스를 건드리지 마세요.
- 앱 아이콘(`public/icons/`)은 가방+시계 그림 한 장을 크기만 달리한 것입니다(512는 maskable 겸용).

- **DB 변경은 반드시 새 마이그레이션 파일로.** `schema.sql`을 직접 수정하지 마세요 — 이미 배포된 DB에는 반영되지 않습니다. 다음 번호는 `013_`입니다.
- **RPC 함수를 고칠 때는 최신 정의를 찾아 전체를 재작성.** `create_or replace`가 누적되어 있어 부분 수정이 불가능합니다.
- 컬럼 추가 시 손대야 하는 곳: 마이그레이션 SQL → `types.ts` → `SupabaseContext.tsx`의 `dbToWorker()` 어댑터 → `create_worker_with_account` RPC → `WorkerTab.tsx` 폼. **하나라도 빠지면 조용히 값이 유실됩니다.**
- 모든 mutation은 `settings_history`에 로그를 남기는 패턴 — 신규 CRUD 추가 시 동일 패턴 유지.
- DB는 `snake_case`, 앱은 `camelCase`. 변환 지점은 `SupabaseContext.tsx`의 어댑터 함수뿐입니다.
- 주민번호는 평문으로 조회되지 않습니다 (`dbToWorker`가 빈 문자열 반환). 수정 화면에서 필요할 때만 `get_resident_number` RPC로 별도 조회합니다.
- **PWA는 자동 갱신됩니다.** `registerType: "prompt"`이지만 `main.tsx`의 `onNeedRefresh`가 확인 없이 즉시 `updateSW(true)`를 호출하고, 1시간 주기 + 탭 활성화 시점에 업데이트를 확인합니다. 현장 단말이 옛 캐시에 머물러 출퇴근이 안 되던 문제 때문에 의도적으로 이렇게 되어 있으니 되돌리지 마세요. 버전 확인은 화면에 표시되는 `__APP_VERSION__`으로.
- 변경 후에는 최소한 `npm run lint`를 통과시키세요.
