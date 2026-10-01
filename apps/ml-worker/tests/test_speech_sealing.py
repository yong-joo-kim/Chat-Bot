"""No.32 봉인 시험 — VO-3(디스크 0·하위 프로세스 0)·VO-4(로그 무글자)·VO-16(외부 송신·DB 0), AC-VO2-8.

정적 검사는 `speech/**` 소스를 토큰 단위로 읽는다(주석·문자열·독스트링은 제외 — 금지 이유를 설명하는 글이
오탐되지 않도록). 런타임 감시는 요청 처리 중 임시 파일 생성·쓰기 모드 open·하위 프로세스를 가로챈다.
"""
from __future__ import annotations

import ast
import builtins
import io
import subprocess
import tempfile
import tokenize
from pathlib import Path

import pytest

SPEECH_DIR = Path(__file__).resolve().parents[1] / "src" / "ml_worker" / "speech"
FILES = sorted(SPEECH_DIR.glob("*.py"))

# VO-3: 디스크·하위 프로세스·multipart / VO-16: 외부 송신·DB
FORBIDDEN_NAMES = {
    "UploadFile", "File", "Form", "tempfile", "NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile",
    "mkstemp", "mkdtemp", "TemporaryDirectory", "subprocess", "Popen", "ffmpeg", "write_bytes", "write_text",
    "save", "multipart", "httpx", "requests", "urllib", "urllib3", "aiohttp", "socket", "http", "smtplib",
    "sqlite3", "psycopg", "psycopg2", "pymysql", "sqlalchemy", "prisma", "asyncpg", "pymongo", "redis",
}


def _code_tokens(path: Path) -> list[tokenize.TokenInfo]:
    with tokenize.open(path) as fh:
        toks = list(tokenize.generate_tokens(fh.readline))
    return [t for t in toks if t.type in (tokenize.NAME, tokenize.OP)]


def test_speech_package_exists_and_is_scanned():
    assert {p.name for p in FILES} >= {"routes.py", "body.py", "decoder.py", "vad.py", "transcriber.py", "limits.py"}


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_vo3_vo16_no_disk_subprocess_network_or_db_names(path):
    toks = _code_tokens(path)
    hits = sorted({t.string for t in toks if t.type == tokenize.NAME and t.string in FORBIDDEN_NAMES})
    assert hits == [], f"{path.name}: 금지 이름 사용 {hits}"


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_vo3_no_builtin_open_and_no_print(path):
    toks = _code_tokens(path)
    for i, t in enumerate(toks):
        if t.type == tokenize.NAME and t.string in ("open", "print"):
            prev = toks[i - 1].string if i else ""
            nxt = toks[i + 1].string if i + 1 < len(toks) else ""
            # `av.open(`(메모리 BytesIO)만 허용 — 맨 이름 open(...)·print(...)는 금지
            assert not (prev != "." and nxt == "("), f"{path.name}:{t.start[0]} 맨 {t.string}( 호출"


def test_vo3_open_is_only_called_on_bytesio_in_decoder():
    src = (SPEECH_DIR / "decoder.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    opens = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "open"
    ]
    assert opens, "decoder가 av.open을 쓰지 않는다"
    for call in opens:
        first = call.args[0]
        assert isinstance(first, ast.Call) and getattr(first.func, "attr", "") == "BytesIO", "av.open 인자는 BytesIO여야 한다"


def test_vo3_post_handlers_take_only_request_no_body_models():
    """Pydantic 본문 모델·UploadFile 인자가 없는 원시 `Request` 핸들러."""
    tree = ast.parse((SPEECH_DIR / "routes.py").read_text(encoding="utf-8"))
    handlers = [
        n for n in ast.walk(tree)
        if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
        and any(isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "post" for d in n.decorator_list)
    ]
    assert len(handlers) == 1
    args = handlers[0].args.args
    assert [a.arg for a in args] == ["request"]
    assert ast.unparse(args[0].annotation) == "Request"


def test_vo4_logger_calls_never_take_text_data_pcm():
    banned = {"text", "data", "pcm", "audio", "payload", "result", "transcript", "speech", "body"}
    for path in FILES:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                owner = node.func.value
                if isinstance(owner, ast.Name) and owner.id == "logger":
                    names = {n.id for a in node.args for n in ast.walk(a) if isinstance(n, ast.Name)}
                    attrs = {n.attr for a in node.args for n in ast.walk(a) if isinstance(n, ast.Attribute)}
                    assert not (names | attrs) & banned, f"{path.name}:{node.lineno} 로그 인자 {names | attrs}"


def test_vo16_package_has_no_network_db_imports_anywhere_in_ml_worker_speech_graph():
    """import 문 자체를 AST로 한 번 더 확인(이름 검사와 별개로 모듈 경로)."""
    mods: set[str] = set()
    for path in FILES:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                mods |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods.add(node.module.split(".")[0])
    assert not mods & {"httpx", "requests", "urllib", "socket", "sqlite3", "tempfile", "subprocess", "http"}
    assert mods <= {
        "__future__", "asyncio", "io", "logging", "threading", "time", "typing", "numpy", "fastapi", "ml_worker",
        "av", "faster_whisper",
    }


# ── 런타임 디스크 감시(AC-VO2-8) ───────────────────────────────────────────────────────────
def test_request_path_touches_no_temp_file_no_write_open_no_subprocess(monkeypatch):
    pytest.importorskip("av")
    import speechenv as se

    wav = se.make_wav(se.speech_like(1.0))
    webm = None
    try:
        webm = se.make_container(se.speech_like(1.0), "webm", "libopus")
    except Exception:  # noqa: BLE001
        pass

    with se.speech_client() as c:
        hdr = {"content-type": "application/octet-stream"}
        assert c.post("/speech/transcribe", content=wav, headers=hdr).status_code == 200  # 지연 import 워밍

        violations: list[str] = []

        def boom(name):
            def _f(*a, **k):
                violations.append(name)
                raise AssertionError(f"요청 경로에서 {name} 호출")

            return _f

        for name in ("NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile", "mkstemp", "mkdtemp", "TemporaryDirectory"):
            monkeypatch.setattr(tempfile, name, boom(f"tempfile.{name}"))
        monkeypatch.setattr(subprocess, "Popen", boom("subprocess.Popen"))

        real_open = builtins.open

        def spy_open(file, mode="r", *a, **k):
            if any(ch in str(mode) for ch in "wax+"):
                violations.append(f"open({mode!r})")
            return real_open(file, mode, *a, **k)

        monkeypatch.setattr(builtins, "open", spy_open)
        monkeypatch.setattr(io, "open", spy_open)

        cases = [wav, b"garbage", wav + b"\x00" * 10, b""]
        if webm:
            cases.append(webm)
        for payload in cases:
            c.post("/speech/transcribe", content=payload, headers=hdr)
        # 크기 초과 경로도 포함
        appenv_settings = __import__("appenv").app_module.settings
        appenv_settings.stt_max_audio_bytes = 100
        c.post("/speech/transcribe", content=wav, headers=hdr)
    assert violations == []
