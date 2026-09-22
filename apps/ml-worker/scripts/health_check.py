"""`pnpm --filter ml-worker run health` 이 호출하는 단순 헬스체크 클라이언트."""
import json
import os
import sys
import urllib.error
import urllib.request

port = os.environ.get("ML_WORKER_PORT", "8100")
url = f"http://127.0.0.1:{port}/health"

try:
    with urllib.request.urlopen(url, timeout=5) as res:
        body = json.loads(res.read().decode("utf-8"))
        print(json.dumps(body, ensure_ascii=False, indent=2))
        sys.exit(0 if body.get("status") == "ok" else 1)
except (urllib.error.URLError, TimeoutError) as exc:
    print(f"[ml-worker] 헬스체크 실패: {exc}", file=sys.stderr)
    sys.exit(1)
