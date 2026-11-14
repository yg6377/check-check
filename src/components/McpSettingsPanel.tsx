// 운영 규칙 설정 > MCP 서버 설정 — AI(Claude)가 근태를 읽어 가는 읽기 전용 서버의 주소와 연결 방법 안내.
// 토큰은 여기에 표시하지 않는다(앱·저장소 어디에도 원문이 없다 — 서버에는 해시만 있다).
import React, { useState } from "react";
import { Check, Copy, Plug, ShieldCheck } from "lucide-react";

const MCP_URL = `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/mcp`;
const TOKEN_FILE = "~/.config/check-check/mcp-token.txt";

const CopyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한이 없으면 직접 선택해 복사한다 */
    }
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg bg-slate-50 text-xs font-mono text-slate-800 break-all select-all">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-bold text-blue-700 hover:bg-blue-100 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
};

export const McpSettingsPanel: React.FC = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
        <Plug className="w-5 h-5 text-gray-500" />
        MCP 서버 설정
      </h3>
      <p className="text-xs text-gray-400 mt-1">
        AI(Claude)가 이 앱의 근태 기록을 읽어 엑셀 노무대장을 채울 때 접속하는 주소입니다.
      </p>
    </div>

    <CopyRow label="MCP 서버 주소" value={MCP_URL} />

    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-800">
      <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-emerald-900">읽기 전용입니다</p>
        <p>
          근로자 사번·이름·고용형태·단가, 출퇴근 시각, 공수, 설정, 공휴일만 조회합니다. 주민번호·계좌·연락처·주소·위치
          좌표·QR 코드는 내보내지 않고, 이 주소로는 아무것도 수정할 수 없습니다.
        </p>
      </div>
    </div>

    <div className="space-y-3">
      <h4 className="text-sm font-bold text-gray-800">연결 방법 (컴퓨터의 Claude Code)</h4>
      <p className="text-xs text-gray-500 leading-relaxed">
        접속에는 주소와 함께 <b>접속 토큰</b>이 필요합니다. 토큰은 보안을 위해 이 화면에 표시하지 않으며, 서버를 설치한
        컴퓨터의 <code className="font-mono text-[11px]">{TOKEN_FILE}</code> 파일에 있습니다.
      </p>
      <CopyRow
        label="① 서버 등록 (터미널에서 한 번 실행)"
        value={`claude mcp add --transport http --scope user check-check ${MCP_URL} --header "Authorization: Bearer $(cat ${TOKEN_FILE})"`}
      />
      <CopyRow label="② 플러그인 저장소 추가" value="claude plugin marketplace add yg6377/checkin-app" />
      <CopyRow label="③ 플러그인 설치" value="claude plugin install check-check@check-check" />
      <p className="text-xs text-gray-500 leading-relaxed">
        설치 후 Claude Code에서 <code className="font-mono text-[11px]">/checkin 11월</code> 처럼 입력하면 그 달의 근태를
        읽어 노무대장 양식에 채운 엑셀 파일을 만듭니다.
      </p>
    </div>
  </div>
);
