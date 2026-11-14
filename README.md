# Checkin App Template

Supabase 기반 출퇴근/근태 관리 템플릿입니다.

## Stack

- React
- Vite
- Supabase

## Local Development

1. 의존성 설치
   `npm install`
2. 환경변수 설정
   `.env.example`을 참고해 `.env.local` 생성
3. 개발 서버 실행
   `npm run dev`

## Environment Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Build

```bash
npm run build
```

## Notes

- `.env.local`은 커밋하지 않습니다.
- Vercel 배포 시 동일한 환경변수를 프로젝트 설정에 등록해야 합니다.

## AI로 엑셀 노무대장 채우기 — 읽기 전용 MCP 서버

`supabase/functions/mcp`는 AI(Claude 등)가 근로자·근태·공수 데이터를 **읽기만** 하는 MCP 서버입니다.
엑셀 양식은 사용자가 AI에게 직접 주고, 이 서버는 데이터만 제공합니다. 주민번호·계좌·연락처·주소·좌표·QR 코드는 제공하지 않습니다.

| 도구 | 내용 |
|---|---|
| `list_workers` | 사번, 이름, 고용유형, 부서/직급/직종, 입사일·퇴사일, 단가(월급/시급/일급) |
| `get_attendance(from, to, worker_code?)` | 일별 출퇴근(원본·인정 시각), 근무/연장/야간/휴일/휴일연장 시간, 공수, 확정 여부. 최대 93일 |
| `get_monthly_summary(month, worker_code?)` | 근로자별 출근일수, 공수 합계, 시간 합계, 퇴근 미체크 건수 |
| `get_settings` | 급여정산 테이블, 가산율, 근무시간 기준, 보험·세율 |
| `get_holidays(year)` | 등록된 휴일 |

### 1. 토큰 만들기 (한 번)

토큰 원문은 저장소에 넣지 않습니다. 서버에는 해시만 등록합니다.

```bash
TOKEN=$(openssl rand -hex 32)
echo "토큰(클라이언트에 입력, 따로 보관): $TOKEN"
printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1   # ← 이 해시를 아래 시크릿에 넣는다
```

### 2. 시크릿 등록과 배포

```bash
supabase login
supabase link --project-ref <프로젝트 ref>
supabase secrets set MCP_TOKEN_SHA256=<위에서 나온 해시 64자>
supabase functions deploy mcp
```

- `supabase/config.toml`에 `verify_jwt = false`가 들어 있어 CLI 배포 시 자동 적용됩니다(함수가 직접 토큰을 검사).
- `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에 기본 제공되므로 따로 넣지 않습니다.
- `MCP_TOKEN_SHA256`이 없으면 모든 요청이 401로 거부됩니다.
- 토큰 교체: 1번을 다시 해서 `supabase secrets set MCP_TOKEN_SHA256=<새 해시>`만 실행하면 옛 토큰은 바로 무효가 됩니다.

배포 확인:

```bash
curl -s https://<프로젝트 ref>.supabase.co/functions/v1/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

토큰 없이 부르면 `401`이 나와야 합니다.

### 3. 클라이언트 연결

Claude Code:

```bash
claude mcp add --transport http checkin https://<프로젝트 ref>.supabase.co/functions/v1/mcp --header "Authorization: Bearer <토큰>"
```

Claude Desktop 등 `mcpServers` 설정 파일을 쓰는 클라이언트 (`mcp-remote` 경유):

```json
{
  "mcpServers": {
    "checkin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<프로젝트 ref>.supabase.co/functions/v1/mcp", "--header", "Authorization: Bearer <토큰>"]
    }
  }
}
```

요청 헤더를 직접 지정할 수 없는 클라이언트(OAuth 로그인만 지원하는 커넥터 등)로는 연결할 수 없습니다.

### 4. 엑셀 양식 채우기 절차

1. 앱 근태 화면에서 해당 월의 근태를 **확정**해 둡니다. 확정하지 않은 날은 출퇴근 시각으로 자동 계산한 값이 나오며, 나중에 확정하면 달라질 수 있습니다.
2. AI에게 엑셀 양식 파일을 첨부하고 이렇게 요청합니다.
   > 첨부한 노무대장 양식에 2026년 11월 데이터를 채워 줘. checkin MCP의 `get_monthly_summary`와 `get_attendance`를 쓰고, 근로자는 사번으로 맞춰 줘. 양식의 수식과 서식은 건드리지 말고, 미확정이거나 퇴근 미체크인 날은 따로 목록으로 알려 줘.
3. 결과에서 `unconfirmed_days`·`missing_check_out`이 0이 아닌 근로자를 확인합니다. 퇴근 미체크인 날은 시간·공수가 0으로 나옵니다.
4. 주민번호·계좌·연락처·주소 칸은 MCP가 제공하지 않으므로 기존 대장에서 옮기거나 직접 채웁니다.
5. 합계(공수 × 단가 등)를 앱의 노무대장 엑셀 발행 결과와 한두 명 대조해 봅니다.

### 계산 로직을 고쳤을 때

미확정 근태의 계산은 `supabase/functions/mcp/calc.ts`가 프런트(`src/utils/attendanceHours.ts` 등)를 복사해 씁니다. 원본을 고치면 복사본도 고치고, 아래 테스트를 통과시킨 뒤 `supabase functions deploy mcp`로 다시 배포하세요.

```bash
deno test --no-check --sloppy-imports --allow-read --allow-env supabase/functions/mcp/calc.test.ts
```

## Claude Code 플러그인 — `/checkin`

한 달 근태를 읽어 엑셀 노무대장 양식의 출근·퇴근 칸을 채웁니다. (읽기 전용 MCP 서버 사용)

```bash
/plugin install check-check --marketplace yg6377/checkin-app
```

준비물 (저장소에는 넣지 않습니다 — 개인정보·비밀값):

- 접속 토큰: `~/.config/check-check/mcp-token.txt` (또는 환경변수 `CHECK_CHECK_MCP_TOKEN`)
- 노무대장 양식: `~/.config/check-check/template.xlsx`

사용: Claude Code에서 `/checkin 11월` → `~/Downloads/26년11월노무대장_checkcheck.xlsx` 생성.
스크립트(`plugin/scripts/fill_ledger.py`)는 '전체' 시트의 연·월 칸과 출근·퇴근 칸만 바꾸고, 공수·수당은 양식의 수식이 계산합니다.

