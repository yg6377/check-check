#!/usr/bin/env python3
"""Check Check 근태 → 엑셀 노무대장 양식 채우기.

MCP 서버(읽기 전용)에서 한 달 근태를 받아, 양식 '전체' 시트의 출근·퇴근 칸에 시각을 넣는다.
공수·연장·수당 등은 양식의 수식이 계산하므로 건드리지 않는다.

  python3 -I fill_ledger.py --month 2026-11

양식 구조 (전체 시트):
  U1 = 연도, X1 = 월 / P열~AT열 = 1일~31일
  근로자 블록의 첫 행: B열 = 사번, O열 = "출근" / 바로 다음 행: O열 = "퇴근"

표준 라이브러리만 쓴다. xlsx 를 통째로 다시 쓰지 않고 해당 칸의 XML 만 바꾸므로
서식·수식·다른 시트는 그대로 남는다.
"""
import argparse
import calendar
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

MCP_URL = "https://xbbqklgxiaxavyrttkyz.supabase.co/functions/v1/mcp"
CONFIG_DIR = os.path.expanduser("~/.config/check-check")
TOKEN_FILE = os.path.join(CONFIG_DIR, "mcp-token.txt")
DEFAULT_TEMPLATE = os.path.join(CONFIG_DIR, "template.xlsx")
SHEET_NAME = "전체"
FIRST_DAY_COL = 16  # P
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    sys.exit(1)


# ---------- MCP ----------

def read_token():
    tok = os.environ.get("CHECK_CHECK_MCP_TOKEN", "").strip()
    if tok:
        return tok
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        fail(f"접속 토큰이 없습니다. {TOKEN_FILE} 파일 또는 환경변수 CHECK_CHECK_MCP_TOKEN 이 필요합니다.")


def mcp_call(token, tool, arguments):
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }).encode()
    req = urllib.request.Request(MCP_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        fail(f"MCP 서버 응답 오류 {e.code}" + (" — 토큰이 맞지 않습니다." if e.code == 401 else ""))
    except urllib.error.URLError as e:
        fail(f"MCP 서버에 연결하지 못했습니다: {e.reason}")
    if raw.lstrip().startswith(("event:", "data:")):
        raw = "".join(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
    msg = json.loads(raw)
    if "error" in msg:
        fail(f"MCP 오류: {msg['error'].get('message')}")
    result = msg["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        fail(f"MCP 도구 오류: {text[:300]}")
    return json.loads(text)


# ---------- xlsx ----------

def col_to_num(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


def num_to_col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


ROW_RE = re.compile(r'<row\b[^>]*?\br="(\d+)"[^>]*>(.*?)</row>', re.S)
CELL_RE = re.compile(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', re.S)
REF_RE = re.compile(r'\br="([A-Z]+)(\d+)"')


def parse_cells(row_inner):
    """행 XML → [(col_num, attrs, inner, start, end)]"""
    out = []
    for m in CELL_RE.finditer(row_inner):
        ref = REF_RE.search(m.group(1))
        if ref:
            out.append((col_to_num(ref.group(1)), m.group(1), m.group(2) or "", m.start(), m.end()))
    return out


def cell_text(attrs, inner, shared):
    if not inner:
        return ""
    if 't="s"' in attrs:
        v = re.search(r"<v>(\d+)</v>", inner)
        return shared[int(v.group(1))] if v else ""
    t = re.findall(r"<t[^>]*>(.*?)</t>", inner, re.S)
    if t:
        return "".join(t)
    v = re.search(r"<v>(.*?)</v>", inner, re.S)
    return v.group(1) if v else ""


def set_cells(row_inner, row_num, values):
    """values: {col_num: 숫자 또는 None(비우기)} — 서식(s)은 유지하고 값만 바꾼다."""
    cells = parse_cells(row_inner)
    existing = {c[0] for c in cells}
    pieces, pos = [], 0
    for col, attrs, _inner, start, end in cells:
        if col not in values:
            continue
        style = re.search(r'\bs="(\d+)"', attrs)
        s_attr = f' s="{style.group(1)}"' if style else ""
        ref = f"{num_to_col(col)}{row_num}"
        val = values[col]
        new = f'<c r="{ref}"{s_attr}/>' if val is None else f'<c r="{ref}"{s_attr}><v>{val}</v></c>'
        pieces.append(row_inner[pos:start] + new)
        pos = end
    result = "".join(pieces) + row_inner[pos:]
    # 행에 아예 없는 칸은 열 순서에 맞춰 끼워 넣는다
    for col in sorted(c for c, v in values.items() if c not in existing and v is not None):
        new = f'<c r="{num_to_col(col)}{row_num}"><v>{values[col]}</v></c>'
        after = [c for c in parse_cells(result) if c[0] > col]
        at = after[0][3] if after else len(result)
        result = result[:at] + new + result[at:]
    return result


def hhmm_to_fraction(hhmm):
    h, m = hhmm.split(":")
    return round((int(h) * 60 + int(m)) / 1440, 10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--template", default=DEFAULT_TEMPLATE)
    ap.add_argument("--out")
    args = ap.parse_args()

    m = re.fullmatch(r"(\d{4})-(\d{1,2})", args.month)
    if not m or not 1 <= int(m.group(2)) <= 12:
        fail("--month 는 YYYY-MM 형식이어야 합니다 (예: 2026-11)")
    year, month = int(m.group(1)), int(m.group(2))
    last_day = calendar.monthrange(year, month)[1]

    template = os.path.expanduser(args.template)
    if not os.path.isfile(template):
        fail(f"양식 파일이 없습니다: {template} — 노무대장 양식(.xlsx)을 이 위치에 두거나 --template 로 지정하세요.")
    out = os.path.expanduser(args.out) if args.out else os.path.expanduser(
        f"~/Downloads/{year % 100:02d}년{month}월노무대장_checkcheck.xlsx")
    if os.path.abspath(out) == os.path.abspath(template):
        fail("결과 파일이 양식 파일과 같습니다. 양식을 덮어쓰지 않도록 다른 --out 을 지정하세요.")

    token = read_token()
    data = mcp_call(token, "get_attendance", {
        "from": f"{year}-{month:02d}-01", "to": f"{year}-{month:02d}-{last_day:02d}",
    })
    records = data.get("records", [])

    # 사번 → {일: (출근, 퇴근)}
    by_worker, names, missing_out = {}, {}, []
    for r in records:
        code = (r.get("worker_code") or "").strip()
        if not code:
            continue
        names[code] = r.get("worker_name")
        day = int(r["work_date"][8:10])
        cin, cout = r.get("check_in_recognized"), r.get("check_out_recognized")
        if not cin:
            continue
        by_worker.setdefault(code, {})[day] = (cin, cout)
        if not cout:
            missing_out.append({"worker_code": code, "worker_name": names[code], "date": r["work_date"]})

    with zipfile.ZipFile(template) as z:
        infos = z.infolist()
        files = {i.filename: z.read(i.filename) for i in infos}

    wb = ET.fromstring(files["xl/workbook.xml"])
    rels = ET.fromstring(files["xl/_rels/workbook.xml.rels"])
    rid_to_target = {r.get("Id"): r.get("Target") for r in rels}
    sheet_path = None
    for s in wb.find(f"{{{NS}}}sheets"):
        if s.get("name") == SHEET_NAME:
            target = rid_to_target[s.get(f"{{{RNS}}}id")]
            sheet_path = target.lstrip("/") if target.startswith("/") else "xl/" + target
    if not sheet_path or sheet_path not in files:
        fail(f"양식에 '{SHEET_NAME}' 시트가 없습니다.")

    shared = []
    if "xl/sharedStrings.xml" in files:
        for si in ET.fromstring(files["xl/sharedStrings.xml"]).findall(f"{{{NS}}}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS}}}t")))

    xml = files[sheet_path].decode("utf-8")
    rows = {int(mm.group(1)): mm for mm in ROW_RE.finditer(xml)}

    def text_at(row_num, col):
        rm = rows.get(row_num)
        if not rm:
            return ""
        for c, attrs, inner, _s, _e in parse_cells(rm.group(2)):
            if c == col:
                return cell_text(attrs, inner, shared).strip()
        return ""

    COL_B, COL_O = 2, 15
    blocks = {}  # 사번 → 출근 행 번호
    for rn in sorted(rows):
        code = text_at(rn, COL_B)
        if code and text_at(rn, COL_O) == "출근" and text_at(rn + 1, COL_O) == "퇴근":
            blocks[code] = rn
    if not blocks:
        fail("양식에서 근로자 행(B열 사번 + O열 '출근'/'퇴근')을 찾지 못했습니다. 양식 구조가 다릅니다.")

    day_cols = [FIRST_DAY_COL + d - 1 for d in range(1, 32)]
    edits = {}  # row_num → {col: value|None}
    filled_workers, filled_days = 0, 0
    for code, rn in blocks.items():
        days = by_worker.get(code, {})
        ins = {c: None for c in day_cols}   # 양식에 남아 있던 이전 달 값은 지운다
        outs = {c: None for c in day_cols}
        for day, (cin, cout) in days.items():
            col = FIRST_DAY_COL + day - 1
            ins[col] = hhmm_to_fraction(cin)
            if cout:
                outs[col] = hhmm_to_fraction(cout)
            filled_days += 1
        edits[rn], edits[rn + 1] = ins, outs
        if days:
            filled_workers += 1
    edits.setdefault(1, {}).update({col_to_num("U"): year, col_to_num("X"): month})

    def replace_row(mm):
        rn = int(mm.group(1))
        if rn not in edits:
            return mm.group(0)
        head = mm.group(0)[: mm.start(2) - mm.start(0)]
        return head + set_cells(mm.group(2), rn, edits[rn]) + "</row>"

    files[sheet_path] = ROW_RE.sub(replace_row, xml).encode("utf-8")

    # 열 때 수식을 전부 다시 계산하게 한다 (저장된 계산값은 이전 달 것)
    wbx = files["xl/workbook.xml"].decode("utf-8")
    if "fullCalcOnLoad" not in wbx:
        if "<calcPr" in wbx:
            wbx = wbx.replace("<calcPr", '<calcPr fullCalcOnLoad="1"', 1)
        else:
            wbx = wbx.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
        files["xl/workbook.xml"] = wbx.encode("utf-8")

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in infos:
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = info.external_attr
            zout.writestr(zi, files[info.filename])

    print(json.dumps({
        "ok": True,
        "month": f"{year}-{month:02d}",
        "output": out,
        "template": template,
        "workers_in_template": len(blocks),
        "workers_filled": filled_workers,
        "attendance_days_filled": filled_days,
        "unmatched_in_app": [
            {"worker_code": c, "worker_name": names.get(c), "days": len(d)}
            for c, d in sorted(by_worker.items()) if c not in blocks
        ],
        "no_records_in_template": sorted(c for c in blocks if c not in by_worker),
        "missing_check_out": missing_out,
        "note": "공수·수당은 양식 수식이 계산합니다. 엑셀에서 열어야 숫자가 갱신됩니다.",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
