# RAG API 연동 명세

이 문서 하나만 보고 RAG 기능을 연동할 수 있도록 쓴 것이다. 이 시스템을 처음 보는 사람을
독자로 가정하고, 요청 형식·성공 응답·실패 응답·주의점을 엔드포인트마다 전부 적었다.

**다루는 범위 (7가지)**

| # | 기능 | 엔드포인트 |
|---|------|-----------|
| 1 | 문서 인입 | `POST /api/documents/ingest` |
| 2 | 문서 조회 | `GET /api/documents/metadata` |
| 3 | 문서 삭제 | `DELETE /api/documents`, `POST /api/documents/reset` |
| 4 | RAG 질의 | `POST /api/rag/query` |
| 5 | RAG 설정 변경 | `GET`/`POST /api/rag/settings` |
| 6 | 프롬프트 설정 | `/api/rag_prompts` 계열 14개 |
| 7 | 상담 내용 요약 | `POST /api/summary` |

부수적으로 **비동기 작업 조회**(`/api/async_task_status/{task_id}` 등)도 함께 적었다.
문서 인입이 기본적으로 비동기라서, 이걸 모르면 1번을 연동할 수 없기 때문이다.

서버에는 FAQ·챗봇·그래프 탐색 등 다른 API도 있지만 **이 문서는 위 7가지만 다룬다.**
그 밖의 기능이 필요하면 담당자에게 문의할 것.

---

## 0. 시작하기 전에

### 0-1. 접속 정보

| 항목 | 값 |
|------|-----|
| **Base URL** | **`http://118.129.180.214:28081`** — 이 문서의 모든 예제가 쓰는 주소. 모든 경로가 `/api` 로 시작한다 |
| 인증 | **없다.** API 키·토큰·세션 어느 것도 요구하지 않는다 |
| CORS | 전체 허용(`*`). 브라우저에서 직접 호출해도 막히지 않는다 |
| 문자셋 | 요청·응답 모두 UTF-8 JSON |

> ⚠️ **이 주소 앞에는 리버스 프록시가 있다.** 요청·응답은 그대로 전달되므로 평소에는
> 신경 쓸 것이 없지만, **타임아웃과 최대 본문 크기는 프록시 쪽 값이 먼저 걸린다.**
> 아래 0-4 의 200MB 제한은 서버 값이고 프록시가 그보다 먼저 자를 수 있다. 수십 MB 이상을
> 올리거나 수 분이 걸리는 동기 요청을 쓸 계획이라면 **실제 크기로 한 번 시험해 보고 쓸 것.**

### 0-2. 요청 형식 — 엔드포인트마다 다르다

두 부류가 있고, 받아들이는 Content-Type이 다르다. **틀리면 A 부류는 "필수값 누락" 400,
B 부류는 스키마 검증 실패 422가 나온다.**

| 부류 | 해당 엔드포인트 | 받아들이는 형식 |
|------|----------------|----------------|
| **A. 문서·RAG 계열** | `/api/documents/*`, `/api/rag/query`, `/api/rag/settings` | `application/json` · `multipart/form-data` · `application/x-www-form-urlencoded` · (셋 다 아니면) **쿼리스트링** |
| **B. JSON 전용** | `/api/rag_prompts*`, `/api/summary` | `application/json` **만** |

A 부류는 `Content-Type` 헤더를 보고 본문 파싱 방식을 고른다. 헤더가 없거나 위 셋 중 어느
것도 아니면 **본문을 아예 읽지 않고 쿼리스트링을 데이터로 쓴다** — 본문에 JSON을 넣고
헤더를 빼면 값이 통째로 사라진다.

파일이 없는 요청이면 JSON이 가장 간단하고, 파일을 올릴 때만 `multipart/form-data`를 쓰면 된다.
form 으로 보내면 모든 값이 문자열이므로 숫자도 `"0.35"` 처럼 문자열로 보내면 된다.

A 부류에서 본문과 쿼리스트링에 같은 키가 있으면 **본문이 이긴다.**

> ⚠️ **A 부류에서 쿼리스트링 폴백을 쓸 때는 반드시 percent-encoding 할 것.**
> 한글을 그대로 URL에 넣으면 uvicorn이 요청 자체를 거절해, JSON이 아니라 평문
> `Invalid HTTP request received.` 가 돌아온다.

> ⚠️ **A 부류에 `Content-Type: application/json`을 주고 본문이 깨져 있으면 오류가 아니라
> "빈 요청"이 된다.** 파싱 실패 시 조용히 `{}` 로 폴백하며, 그때는 쿼리스트링도 보지 않는다.
> 그 결과 "필수값 누락" 400이 나와 원인이 본문 문법 오류라는 걸 알기 어렵다.
> (B 부류는 반대로 깨진 JSON을 422로 정확히 알려준다.)

### 0-3. 응답을 읽는 법 — **HTTP 200이 성공을 뜻하지 않는다**

이 API에서 가장 자주 틀리는 지점이다. 아래 세 가지는 **모두 HTTP 200**으로 온다.

| 상황 | 응답 | 판별 방법 |
|------|------|-----------|
| 문서 인입/삭제/초기화 **실패** | `{"result": "RAG Vector DB 추가 실패."}` | `result` 문자열이 `실패.`로 끝나는지 |
| RAG 질의에서 **근거 문서를 못 찾음** | `{"result": "정보가 부족하여 ...", "retrieval_success": 0, ...}` | `retrieval_success == 0` |
| 요약에서 **LLM을 못 씀(폴백)** | `{"result": "죄송합니다. 요약을 생성할 수 없습니다.", "degraded": true}` | `degraded == true` |

**따라서 연동 코드는 HTTP 상태 코드와 본문을 둘 다 봐야 한다.**

응답 본문의 모양도 한 가지가 아니다. 세 종류가 섞여 있으니 파싱할 때 주의할 것.

```jsonc
{"result": ...}                                  // 문서·질의 계열의 정상 응답
{"status": "success"|"error", "message": "..."}  // 설정·프롬프트 계열
{"error": "...", "code": "..."}                  // 미들웨어/전역 핸들러가 만든 오류(413/404/500/503)
{"error": "..."}                                 // 라우트가 직접 만든 오류 — code 키가 없다(요약 API의 400/500)
{"detail": [...]}                                // FastAPI 스키마 검증 실패(422) — 요약 API에서만
```

**같은 상태 코드라도 본문 모양이 다를 수 있다.** 예를 들어 404는 두 가지다 —
없는 경로를 호출했을 때는 `{"error": "요청한 리소스를 찾을 수 없습니다.", "code": "NOT_FOUND"}`,
활성 프롬프트 변경에서 없는 ID를 줬을 때는 `{"status": "error", "message": "..."}` 다.

### 0-4. 모든 엔드포인트에 공통으로 걸리는 제한

| HTTP | 언제 | 응답 본문 | 적용 범위 |
|------|------|-----------|----------|
| 413 | 요청 본문이 **200MB** 초과 | `{"error": "파일 크기가 너무 큽니다. 최대 200MB까지 업로드 가능합니다.", "code": "FILE_TOO_LARGE"}` | 전체 |
| 429 | 같은 IP에서 **분당 200회** 초과 | `{"status": "error", "message": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}` | **A 부류만** (프롬프트·요약에는 레이트리밋이 없다) |
| 503 | 동시 처리 **50건** 초과 또는 메모리 부족 | `{"error": "서버가 과부하 상태입니다. 잠시 후 다시 시도해주세요.", "code": "SERVER_OVERLOAD"}` | 전체 |
| 503 | vLLM(추론 서버)이 준비되지 않음 | `{"error": "서비스 초기화 중입니다. 잠시 후 다시 시도해주세요."}` (`code` 키 **없음**) | 아래 0-5 참조 |
| 404 | 존재하지 않는 경로 | `{"error": "요청한 리소스를 찾을 수 없습니다.", "code": "NOT_FOUND"}` | 전체 |
| 500 | 처리되지 않은 서버 예외 | `{"error": "내부 서버 오류가 발생했습니다.", "code": "INTERNAL_ERROR"}` | 전체 |

- **413 은 `Content-Length` 헤더로 판정한다.** 헤더 없이 보내는 chunked 전송은 검사되지 않는다.
  라우팅보다 먼저 판정하므로 **존재하지 않는 경로로 보내도 404가 아니라 413**이 온다.
- 429의 창은 **최근 60초 슬라이딩 윈도우**이고 IP 단위다. 잠시 기다렸다 재시도하면 된다.
- 두 종류의 503은 **본문 모양이 다르다**(`code` 키 유무). 재시도 전략을 나누려면 이걸로 구분한다.

### 0-5. vLLM 게이트 — 어떤 API가 추론 서버에 묶여 있나

이 시스템은 답변 생성을 위해 별도의 추론 서버(vLLM)를 쓴다. vLLM이 준비되지 않았거나
죽으면 **아래 경로만** 503으로 막힌다.

이 문서 범위에서 막히는 것은 **`POST /api/rag/query` 하나뿐이다.**

| 엔드포인트 | vLLM 죽었을 때 |
|-----------|---------------|
| `POST /api/rag/query` | **503** (`{"error": "서비스 초기화 중입니다. ..."}`) |
| `POST /api/summary` | **200 + `degraded: true`** — 막지 않고 고정 문구로 폴백한다 |
| `/api/documents/*` | **막히지 않는다.** 다만 인입은 내부에서 vLLM을 쓰므로 결과 품질이 떨어지거나 실패할 수 있다 |
| `/api/rag/settings`, `/api/rag_prompts*` | **막히지 않는다** (파일·DB CRUD라 vLLM과 무관) |

⚠️ **vLLM이 죽어도 503은 곧바로 시작되지 않는다** — 서버가 상태를 감지하기까지 최대
15초쯤 걸린다. **그 사이의 요청은 503이 아니라 500이나 폴백 응답을 받는다.**

현재 상태는 `GET /api/status`로 확인한다.

```bash
curl http://118.129.180.214:28081/api/status
```
```json
{
  "status": "healthy",
  "vllm_ready": true,
  "uptime": 38127.4,
  "services": {
    "vllm": {"status": "connected", "model": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"},
    "neo4j": {"status": "connected"}
  }
}
```

vLLM이 끊겨 있으면 `status`가 `degraded`가 되고 **`services.vllm`에 `error` 키가 붙는다.**

```json
{
  "status": "degraded",
  "vllm_ready": false,
  "uptime": 250587.6,
  "services": {
    "vllm": {"status": "disconnected", "error": "HTTPConnectionPool(host='127.0.0.1', port=8000): ... Connection refused"},
    "neo4j": {"status": "connected"}
  }
}
```

`status`는 `healthy`(전부 연결) / `degraded`(일부 연결) / `unhealthy`(전부 끊김)이며,
`unhealthy`일 때만 HTTP 503이다(`degraded`는 200). **연동 시작 전에 이 엔드포인트로
준비 상태를 먼저 보라.**

### 0-6. 용어

| 용어 | 뜻 |
|------|-----|
| `company` / `category` / `subcategory` | 문서를 분류하는 3단계 메타데이터. 인입할 때 붙이고, 질의·삭제할 때 범위를 좁히는 데 쓴다. 자유 문자열이며 미리 등록할 필요가 없다 |
| `source` | 인입된 원본 파일의 서버 경로. 문서를 식별하는 값 |
| `paragraph_id` | 청크(문단) 식별자. **전역 유일하지 않다** — 문서가 다르면 같은 값이 있을 수 있어, 청크를 특정하려면 `(source, paragraph_id)` 쌍을 써야 한다 |
| 청크(chunk) | 문서를 잘라 벡터로 저장한 단위. 검색은 이 단위로 이뤄진다 |

---

## 1. 문서 인입

```
POST /api/documents/ingest
Content-Type: multipart/form-data  또는  application/json
```

파일 하나를 파싱 → 청킹 → 키워드·엔티티 추출 → Neo4j 저장까지 수행한다.
같은 파일 경로(`source`)의 문서가 이미 있으면 덮어쓴다.

### 1-1. 요청

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `file` | 파일 | 조건부 | — | 업로드할 파일. `multipart/form-data`일 때만 쓸 수 있다 |
| `file_path` | string | 조건부 | — | **서버에 이미 있는** 파일의 경로 |
| `company` | string | **필수** | — | 회사/기관명 |
| `category` | string | **필수** | — | 카테고리 |
| `subcategory` | string | **필수** | — | 서브카테고리 |
| `force_sync` | string | 선택 | `"false"` | `"true"`면 비동기 대신 **동기**로 처리(응답이 올 때까지 대기) |

- `file`과 `file_path` 중 **정확히 하나**는 있어야 한다. 둘 다 주면 `file`이 이긴다.
- `company`/`category`/`subcategory`는 **셋 다** 필수다. 하나라도 비면 400이다.
- 업로드한 파일은 서버의 `backend/uploads/<원본파일명>`에 저장된다.
  **같은 이름이면 경고 없이 덮어쓴다** — 파일명이 겹칠 수 있으면 호출 측에서 유일하게 만들 것.
- `file_path`는 `uploads/` 안으로 제한되지 않는다. **서버 프로세스가 읽을 수 있는 임의의
  절대경로**(`/tmp/...` 등)가 그대로 받아들여진다. 편리한 만큼, 이 API를 외부에 노출하면
  서버의 아무 파일이나 인입 대상이 될 수 있다는 뜻이기도 하다.
- `force_sync` 판정 규칙은 **"값을 문자열로 바꿔 소문자화한 게 `true`인가"** 하나다.
  따라서 `"true"`·`"TRUE"`(문자열)와 **JSON 불리언 `true`** 가 동기 처리로 인정되고,
  `1`·`"1"`·`"yes"`는 전부 무시되어 비동기로 간다.

**지원 파일 형식**

| 확장자 | 처리 방식 |
|--------|----------|
| `.pdf` | 그대로 처리 |
| `.xlsx` · `.xls` | PDF 변환 없이 엑셀 전용 파이프라인으로 처리 |
| `.docx` · `.pptx` 등 | LibreOffice로 PDF 변환 후 처리. 변환 실패 시 원본으로 처리 시도 |
| `.hwp` · `.hwpx` | ⚠️ **리눅스 서버에서는 사실상 동작하지 않는다.** 변환 분기가 Windows 전용이다. 한글 문서는 PDF로 미리 변환해 올릴 것 |

### 1-2. 요청 예시

```bash
# (a) 파일을 직접 올리는 경우
curl -X POST http://118.129.180.214:28081/api/documents/ingest \
  -F "file=@./연금안내서.pdf" \
  -F "company=국민연금" \
  -F "category=노령연금" \
  -F "subcategory=수급요건"

# (b) 서버에 이미 있는 파일을 쓰는 경우 (JSON)
curl -X POST http://118.129.180.214:28081/api/documents/ingest \
  -H "Content-Type: application/json" \
  -d '{
        "file_path": "/home/doota/Desktop/project/rag-system/backend/uploads/연금안내서.pdf",
        "company": "국민연금",
        "category": "노령연금",
        "subcategory": "수급요건"
      }'

# (c) 끝날 때까지 기다리고 싶은 경우 (동기)
curl -X POST http://118.129.180.214:28081/api/documents/ingest \
  -F "file=@./연금안내서.pdf" -F "company=국민연금" \
  -F "category=노령연금" -F "subcategory=수급요건" \
  -F "force_sync=true"
```

### 1-3. 성공 응답

**기본은 비동기다.** 서버 설정(`SERVER_ENABLE_ASYNC_PROCESSING`)이 기본 켜져 있어,
`force_sync=true`를 주지 않으면 아래처럼 즉시 `task_id`만 돌아온다.

```json
{
  "status": "async_started",
  "task_id": "3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70",
  "message": "작업이 백그라운드에서 시작되었습니다. task_id: 3f2a1b8c-...",
  "task_type": "rag_add"
}
```
→ 이후 `GET /api/async_task_status/{task_id}`로 진행 상황을 폴링한다(5장).

**얼마나 걸리나** — 4쪽·85KB PDF 1건이 **약 143초**에 6청크로 저장됐다.
분량과 표·이미지 양에 비례해 늘어나므로 수백 쪽 문서는 수십 분을 각오할 것.

`force_sync=true`로 동기 처리했을 때:

```json
{ "result": "RAG Vector DB 추가 성공." }
```

> ⚠️ **동기 처리는 최대 3시간(10800초)까지 기다린다.** 대용량 PDF는 실제로 수십 분이
> 걸리므로, 클라이언트·프록시 타임아웃이 그보다 짧으면 연결이 먼저 끊긴다.
> **특별한 이유가 없으면 비동기(기본값)를 쓸 것.**

### 1-4. 실패 응답

| HTTP | 조건 | 응답 본문 |
|------|------|-----------|
| **200** | 파싱·저장이 실패했다 | `{"result": "RAG Vector DB 추가 실패."}` ← **200이지만 실패다** |
| 400 | `company`/`category`/`subcategory` 중 하나라도 빔 | `{"status": "error", "message": "문서 인입에는 company, category, subcategory가 모두 필요합니다."}` |
| 400 | `file`·`file_path` 둘 다 없음 | `{"status": "error", "message": "문서 인입에는 업로드 파일(file) 또는 file_path가 필요합니다."}` |
| 408 | 동기 처리가 10800초를 넘김 | `{"error": "요청 처리 시간이 초과되었습니다. (타임아웃: 10800초)"}` |
| 413 | 본문 200MB 초과 | `{"error": "파일 크기가 너무 큽니다. ...", "code": "FILE_TOO_LARGE"}` |
| 429 | 분당 200회 초과 | `{"status": "error", "message": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}` |
| 500 | 처리 중 예외 | `{"error": "내부 서버 오류가 발생했습니다.", "code": "INTERNAL_ERROR"}` |
| 503 | 동시 처리 한도 초과 | `{"error": "서버가 과부하 상태입니다. ...", "code": "SERVER_OVERLOAD"}` |

**비동기로 시작한 뒤의 실패는 이 표에 안 나온다.** `async_started` 응답은 "접수했다"는
뜻일 뿐이므로, 실제 성패는 `task_info.status`와 `task_info.result`로 확인해야 한다(5장).

### 1-5. 알아둘 점

- **인입은 vLLM 게이트 대상이 아니다.** vLLM이 죽어 있어도 요청은 받아들여진다.
  하지만 내부에서 청크 키워드·섹션 제목 생성과 표 이미지 해석에 vLLM을 쓰므로,
  그 상태로 인입하면 메타데이터가 빈 채로 저장되거나 실패한다.
  **인입 전에 `GET /api/status`로 `vllm.status == "connected"`를 확인할 것.**
- 인입은 오래 걸리고 동시 처리 슬롯을 그동안 계속 점유한다. 여러 문서를 넣을 때는
  한꺼번에 던지지 말고 **직렬로(앞 작업 완료 후 다음)** 돌리는 편이 안전하다.
- 문서를 지워도 그 문서에서 만든 FAQ 항목은 함께 지워지지 않는다.
- **같은 파일을 다시 인입하면 덮어쓰기가 된다** — 청크를 `(파일명, 청크번호)`로 식별해
  같은 자리를 갱신한다. 다만 **지운 뒤 넣는 것이 아니어서**, 다시 넣었을 때 청크 수가
  줄면 **예전 청크가 남는다.** 확실히 갈아끼우려면 `DELETE /api/documents`로 지운 뒤
  인입할 것.

---

## 2. 문서 조회 (적재 현황)

```
GET /api/documents/metadata
```

Neo4j에 적재된 문서가 회사·카테고리·서브카테고리별로 몇 청크씩 있는지 돌려준다.
**요청 파라미터는 없다.**

### 2-1. 요청 예시

```bash
curl http://118.129.180.214:28081/api/documents/metadata
```

### 2-2. 성공 응답 — ⚠️ JSON 객체가 아니라 **여러 줄 문자열**이다

```json
{
  "result": "--- 벡터 DB 메타 정보 ---\n\n총 저장된 벡터의 개수: 1842\n\n회사별 벡터 저장 인덱스 개수:\n- 국민연금: 1200개\n- 근로복지공단: 642개\n\n회사별 카테고리 및 서브카테고리 정보 및 벡터 저장 인덱스 개수:\n\n- 국민연금:\n  - 노령연금: 800개\n    - 수급요건: 500개\n    - 청구방법: 300개\n  - 유족연금: 400개\n\n- 근로복지공단:\n  - 산재보험: 642개\n    - 요양급여: 642개\n"
}
```

줄바꿈을 풀면 이런 모양이다.

```text
--- 벡터 DB 메타 정보 ---

총 저장된 벡터의 개수: 1842

회사별 벡터 저장 인덱스 개수:
- 국민연금: 1200개
- 근로복지공단: 642개

회사별 카테고리 및 서브카테고리 정보 및 벡터 저장 인덱스 개수:

- 국민연금:
  - 노령연금: 800개
    - 수급요건: 500개
    - 청구방법: 300개
  - 유족연금: 400개
```

**파싱 규칙**

| 줄 모양 | 뜻 |
|---------|-----|
| `총 저장된 벡터의 개수: N` | 전체 청크 수 |
| `- {회사}: N개` (들여쓰기 0칸, 첫 번째 블록) | 회사별 청크 수 |
| `- {회사}:` (들여쓰기 0칸, 두 번째 블록) | 회사 헤더 |
| `  - {카테고리}: N개` (2칸) | 카테고리별 청크 수 |
| `    - {서브카테고리}: N개` (4칸) | 서브카테고리별 청크 수 |

회사·카테고리·서브카테고리는 각각 이름순으로 정렬돼 나온다. 데이터가 없으면
헤더 줄만 있고 항목이 비어 있는 문자열이 온다.

> 이 형식은 프론트엔드가 그대로 파싱하고 있어서 유지되고 있다. 구조화된 JSON이 필요하면
> 이 문자열을 위 규칙으로 파싱하는 수밖에 없다.

### 2-3. 실패 응답

| HTTP | 조건 | 응답 본문 |
|------|------|-----------|
| **200** | Neo4j 조회 실패(연결 끊김 등) | `{"result": "Graph DB가 로드되지 않았습니다."}` ← **200이지만 실패다** |
| 429 | 분당 200회 초과 | `{"status": "error", "message": "요청이 너무 많습니다. ..."}` |
| 503 | 동시 처리 한도 초과 | `{"error": "서버가 과부하 상태입니다. ...", "code": "SERVER_OVERLOAD"}` |

---

## 3. 문서 삭제

```
DELETE /api/documents
Content-Type: application/json  또는  multipart/form-data
```

메타데이터 조건에 맞는 청크를 Neo4j에서 지운다. 함께 매달려 있던 엔티티 중
**어디에도 연결되지 않게 된 것(고아)** 도 같이 정리된다.

### 3-1. 요청

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `company` | string | **필수** | 이 회사의 문서를 지운다 |
| `category` | string | 선택 | 주면 이 카테고리로 범위를 좁힌다 |
| `subcategory` | string | 선택 | 주면 더 좁힌다. **`category` 없이 단독으로 줄 수 없다** |

조건은 **AND**로 결합된다. `company`만 주면 그 회사 문서 전부가 지워지므로 주의할 것.

### 3-2. 요청 예시

```bash
# 서브카테고리 하나만 삭제
curl -X DELETE http://118.129.180.214:28081/api/documents \
  -H "Content-Type: application/json" \
  -d '{"company": "국민연금", "category": "노령연금", "subcategory": "수급요건"}'

# 회사 전체 삭제 (되돌릴 수 없다)
curl -X DELETE http://118.129.180.214:28081/api/documents \
  -H "Content-Type: application/json" \
  -d '{"company": "국민연금"}'
```

### 3-3. 성공 응답

```json
{ "result": "RAG Vector DB 삭제 성공." }
```

> ⚠️ **`"RAG Vector DB 삭제 성공."` 은 "1건 이상 지웠다"는 뜻이다.** 반대로 조건에 맞는
> 문서가 **0건이면 `{"result": "RAG Vector DB 삭제 실패."}` 가 온다**(HTTP는 그대로 200).
> 서버가 `deleted_count > 0`을 그대로 성패로 돌려주기 때문이다.
>
> 그래서 이 응답은 **"지울 게 없었다"와 "쿼리가 실패했다"를 구분하지 못한다.** "실패"를
> 받았다고 무조건 재시도·알람을 걸지 말고, 먼저 `GET /api/documents/metadata`로 그 조건의
> 문서가 실제로 있었는지 확인할 것. 몇 건이 지워졌는지는 응답에 없다(서버 로그에만 남는다).

> ⚠️ **문서를 지워도 그 문서에서 생성된 FAQ 항목은 남는다.** 삭제는 FAQ로 연쇄되지 않는다.
> FAQ까지 정리하려면 **이 문서 범위 밖의 FAQ API**를 따로 호출해야 한다(담당자에게 문의).

### 3-4. 실패 응답

| HTTP | 조건 | 응답 본문 |
|------|------|-----------|
| **200** | **조건에 맞는 문서가 0건**이거나, 조건이 서버까지 도달하지 못했거나, 쿼리 오류 | `{"result": "RAG Vector DB 삭제 실패."}` |
| 400 | `company` 누락 | `{"status": "error", "message": "company를 입력해야 합니다."}` |
| 400 | `category` 없이 `subcategory`만 전달 | `{"status": "error", "message": "subcategory를 지정하려면 category도 함께 입력해야 합니다."}` |
| 429 · 503 · 500 | 0-4 공통 표와 동일 | |

삭제는 항상 **동기**로 실행된다(`force_sync` 불필요). 타임아웃은 600초다.

---

## 4. 문서 DB 전체 초기화

```
POST /api/documents/reset
```

**Neo4j의 RAG 데이터를 전부 지운다. 되돌릴 수 없다.** 요청 파라미터는 없다.

```bash
curl -X POST http://118.129.180.214:28081/api/documents/reset
```

| 결과 | HTTP | 응답 본문 |
|------|------|-----------|
| 성공 | 200 | `{"result": "RAG Vector DB 초기화 성공."}` |
| 실패 | 200 | `{"result": "RAG Vector DB 초기화 실패."}` |
| 과부하·예외 | 503 · 500 | 0-4 공통 표와 동일 |

> ⚠️ 운영 중인 서버에 이 API를 노출하지 말 것. 확인 절차도, 취소도, 복구도 없다.

---

## 5. 비동기 작업 조회 (인입 진행 상황)

문서 인입은 기본이 비동기이므로, `task_id`로 진행 상황을 확인해야 완결된 연동이 된다.

### 5-1. 작업 상태 조회

```
GET /api/async_task_status/{task_id}
```

```bash
curl http://118.129.180.214:28081/api/async_task_status/3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70
```

**진행 중**
```json
{
  "status": "success",
  "task_id": "3f2a1b8c-...",
  "task_info": { "status": "running", "start_time": 1788768000.12, "progress": 0 }
}
```

**완료** — `task_info.result`에 동기 호출이었다면 받았을 값이 그대로 들어 있다.
```json
{
  "status": "success",
  "task_id": "3f2a1b8c-...",
  "task_info": {
    "status": "completed",
    "start_time": 1788768000.12,
    "progress": 0,
    "result": "RAG Vector DB 추가 성공.",
    "end_time": 1788768931.44
  }
}
```

**실패**
```json
{
  "status": "success",
  "task_id": "3f2a1b8c-...",
  "task_info": {
    "status": "failed",
    "start_time": 1788768000.12,
    "progress": 0,
    "error": "...예외 메시지...",
    "end_time": 1788768120.9
  }
}
```

**없는 task_id** — 404가 아니라 **200**이다.
```json
{ "status": "success", "task_id": "없는-id", "task_info": { "status": "not_found" } }
```

`task_info.status` 값: `running` · `cancelling` · `completed` · `failed` · `cancelled` · `not_found`

취소된 작업에는 `cancelled_time` 키가 하나 더 붙는다.
```json
{"status": "cancelled", "start_time": 1788750600.1, "progress": 0,
 "cancelled_time": 1788750640.42, "end_time": 1788750640.42}
```
`cancelling` 은 취소 처리 중의 짧은 중간 상태다 — 취소 직후 조회에도 이미
`cancelled` 였으므로, 관측되지 않는다고 가정하고 짜도 된다.

> ⚠️ **완료 판정은 `task_info.status`로 하고, 성패는 `task_info.result` 문자열까지 봐야 한다.**
> `status: "completed"` 이면서 `result: "RAG Vector DB 추가 실패."` 인 경우가 정상적으로 존재한다
> (예외 없이 파이프라인이 실패한 경우).

> ⚠️ `progress`는 현재 갱신되지 않는다. 항상 `0`이며, 완료돼도 100이 되지 않는다.
> 진행률 UI를 만들 계획이라면 이 값에 의존하지 말 것.

> ⚠️ **작업 목록은 서버 프로세스 메모리에 있다.** 서버를 재시작하면 진행 중이던 작업과
> 그 기록이 함께 사라지고, 그 뒤 조회는 `not_found`가 된다.

> ⚠️ **반대로, 재시작 전에는 아무것도 지워지지 않는다.** 완료된 작업을 정리하는 함수
> (`cleanup_completed_tasks`)가 정의만 되어 있고 **호출하는 곳이 없어서**, `GET /api/async_tasks`
> 목록은 재시작 전까지 단조 증가한다. 목록 API를 주기적으로 폴링한다면 응답이 계속
> 커진다는 점을 감안할 것(개별 조회 `GET /api/async_task_status/{id}` 는 영향 없다).

**폴링 예시** — 인입 → 완료 대기까지의 전체 흐름

```bash
TASK=$(curl -s -X POST http://118.129.180.214:28081/api/documents/ingest \
        -F "file=@./연금안내서.pdf" -F "company=국민연금" \
        -F "category=노령연금" -F "subcategory=수급요건" \
       | python3 -c 'import sys,json; print(json.load(sys.stdin)["task_id"])')

while true; do
  BODY=$(curl -s "http://118.129.180.214:28081/api/async_task_status/$TASK")
  echo "$BODY"
  echo "$BODY" | grep -q '"status": "running"' || break
  sleep 10           # 인입은 수 분~수십 분 걸린다. 5~10초 간격이면 충분하다
done
```

### 5-2. 작업 목록 조회

```
GET /api/async_tasks
```
```json
{
  "status": "success",
  "total_tasks": 2,
  "tasks": {
    "3f2a1b8c-...": {"status": "completed", "start_time": 1788768000.1, "end_time": 1788768931.4, "progress": 0},
    "9c1d0e2f-...": {"status": "running",   "start_time": 1788769100.7, "end_time": null,        "progress": 0}
  }
}
```
(목록에는 `result`·`error`가 포함되지 않는다. 상세는 5-1로 조회할 것.)

### 5-3. 작업 취소

```
POST /api/async_task_cancel/{task_id}
```

| 결과 | HTTP | 응답 본문 |
|------|------|-----------|
| 취소 요청됨 | 200 | `{"status": "success", "task_id": "...", "message": "작업이 취소되었습니다."}` |
| 이미 끝났거나 없는 id | 400 | `{"status": "error", "task_id": "...", "message": "작업을 취소할 수 없습니다. (이미 완료되었거나 존재하지 않음)"}` |

취소는 이미 Neo4j에 쓰인 데이터를 되돌리지 않는다. 중간까지 저장된 청크는 남을 수 있으므로,
취소 후에는 `DELETE /api/documents`로 정리한 뒤 다시 인입하는 편이 안전하다.

---

## 6. RAG 질의

```
POST /api/rag/query
Content-Type: application/json  또는  multipart/form-data
```

문서에서 근거를 찾아 LLM이 답변을 생성한다. **이 문서에서 유일하게 vLLM 게이트에 걸리는
엔드포인트**이며, 항상 **동기**로 실행된다(`force_sync`를 줘도 달라지지 않는다).

### 6-1. 요청

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `question` | string | **필수** | — | 질문 문장 |
| `company` | string | **필수** | — | 검색 대상 회사/기관. 이 값으로 문서 범위가 정해진다 |
| `category` | string | 선택 | `""` | 주면 검색 범위를 좁힌다 |
| `subcategory` | string | 선택 | `""` | 주면 더 좁힌다 |
| `provider` | string | 선택 | `"pdf"` | 답변 생성 모델. **`pdf` 만 쓸 것** (아래 참조) |
| `similarity_threshold` | number | 선택 | 서버 설정값(현재 `0.3`) | 이 요청에만 적용할 유사도 하한(0.0~1.0) |

**`provider` 값**

| 값 | 답변 생성 | 비고 |
|----|----------|------|
| `pdf` | 로컬 추론 서버 | **기본값이자 운영에서 쓰는 유일한 값.** 이걸 쓸 것 |
| `gpdf` | Gemini | ⚠️ **쓰지 말 것** — 외부 API 로 나가며 운영에서 쓰지 않는다 |
| `opdf` | OpenAI | ⚠️ **쓰지 말 것** — 위와 같다 |

> ⚠️ **`gpdf`·`opdf` 는 요청 본문을 외부 서비스로 보낸다.** 값 자체는 받아들여지므로
> 실수로 넣으면 오류 없이 그대로 나간다. **`provider` 는 `pdf` 로 고정하거나 아예 생략하라**
> (생략하면 `pdf` 다).

- `provider`는 앞뒤 공백을 제거하고 소문자로 변환해 비교하므로 `"PDF"`도 받아들여진다.
  **빈 문자열(`""`)이나 공백만 보내면 400이 아니라 기본값 `pdf` 로 폴백한다** — 오타를
  400으로 걸러주는 건 `"pdfx"` 처럼 내용이 있는 잘못된 값뿐이다.
- 옛 이름 `rag_model`도 아직 받는다(`provider`가 없을 때만). 새로 연동한다면 `provider`를 쓸 것.
- **`provider`는 답변 생성 모델만 고른다.** 어떤 방식으로 문서를 찾을지(유사도/앙상블/그래프)는
  요청이 아니라 서버 전역 설정이며, 7장의 `search_method`로 바뀐다.

**`similarity_threshold` 의 함정**

숫자가 아니거나 0.0~1.0 밖이면 **오류가 아니라 조용히 무시되고 서버 기본값이 쓰인다.**
`-1`, `"abc"`, `2.5` 모두 400이 나지 않는다. 값이 반영됐는지 확인하려면 서버 로그를 봐야 한다.

값을 올릴수록 근거를 엄격히 고르지만, **너무 올리면 문서가 0건이 되어 "정보가 부족하여
답변할 수 없습니다"만 돌아온다.** 특별한 이유가 없으면 이 필드를 아예 보내지 말고
서버 기본값을 쓰는 것을 권한다.

### 6-2. 요청 예시

```bash
curl -X POST http://118.129.180.214:28081/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{
        "question": "노령연금 수급 자격이 어떻게 되나요?",
        "company": "국민연금",
        "category": "노령연금",
        "provider": "pdf"
      }'
```

### 6-3. 성공 응답 (검색 성공)

```json
{
  "result": "노령연금은 가입기간이 십 년 이상이고 수급 개시 연령에 도달하시면 받으실 수 있어요. ...",
  "keywords": ["수급요건", "가입기간", "지급개시연령"],
  "source_info": {
    "total_sources": 3,
    "common_metadata": {
      "company": "국민연금",
      "category": "노령연금",
      "subcategory": "수급요건"
    },
    "sources": [
      {
        "file_path": "/home/.../backend/uploads/연금안내서.pdf",
        "page": 12,
        "total_pages": 84,
        "paragraph_id": "p-0f3a91c4",
        "section_title": "노령연금 수급요건",
        "paragraph_keywords": ["수급요건", "가입기간"],
        "processed_at": "2026-08-14T10:22:31.884120",
        "processing_model": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit",
        "chunk_index": 37,
        "highlight_text": "가입기간이 10년 이상인 자가 지급개시연령에 도달한 때...",
        "start_char": 0,
        "end_char": 0,
        "content_length": 512
      }
    ]
  },
  "retrieval_success": 1
}
```

**최상위 필드는 정확히 이 4개다.** 그래프 확장 정보 등 내부 메타는 응답에 포함되지 않는다.

| 필드 | 타입 | 설명 |
|------|------|------|
| `result` | string | LLM이 생성한 답변 본문 |
| `keywords` | string[] | 근거 청크들에서 뽑은 대표 키워드. 없으면 `[]` |
| `source_info` | object \| null | 근거 정보. **배열이 아니라 객체다** |
| `retrieval_success` | 0 \| 1 | `1`이면 근거를 찾아 답한 것, `0`이면 못 찾은 것 |

**`source_info` 내부**

| 필드 | 설명 |
|------|------|
| `total_sources` | 근거 청크 개수 (= `sources` 배열 길이) |
| `common_metadata` | 첫 번째 근거 청크의 `company`/`category`/`subcategory`. **모든 근거의 공통값이라는 보장은 없다** |
| `sources[]` | 근거 청크 목록 |

**`sources[]` 원소** — 값을 못 구한 필드는 문자열 `"N/A"`가 들어간다(`null`이 아니다).

| 필드 | 타입 | 설명 |
|------|------|------|
| `file_path` | string | 원본 파일 경로(구분자는 `/`로 정규화됨) |
| `page` | number \| `"N/A"` | **1부터 시작하는** 페이지 번호(PDF 기준). ⚠️ **엑셀로 인입한 청크는 값이 1 크게 나온다** — 인입이 이미 1-based로 저장하는데 응답에서 한 번 더 +1 하기 때문이고, 애초에 "페이지"가 아니라 문서 순번이다 |
| `total_pages` | number \| `"N/A"` | 원본 총 페이지 수 |
| `paragraph_id` | string | 청크 식별자. `file_path`와 **쌍으로** 써야 유일하다 |
| `section_title` | string | 청크가 속한 절 제목 |
| `paragraph_keywords` | string[] | 청크 키워드 |
| `processed_at` | string | 인입 시각(ISO8601) |
| `processing_model` | string | 인입 때 메타데이터를 만든 모델명 |
| `chunk_index` | number \| `"N/A"` | 문서 내 청크 순번 |
| `highlight_text` | string | 근거로 강조할 구간 텍스트 |
| `start_char` / `end_char` | number | **현재 항상 `0`이다.** 아직 채워지지 않는 자리표시자이므로 쓰지 말 것 |
| `content_length` | number | 청크 본문 길이 |

> ⚠️ **위 예시처럼 모든 필드가 채워져 있으리라 기대하지 말 것.** 실제 응답에서는
> `total_pages`·`processed_at`·`processing_model`·`chunk_index` 가 근거 5건 **전부 `"N/A"`**
> 였다(인입 시점에 그 메타데이터가 저장되지 않은 문서였다). 계약 위반은 아니지만,
> 이 필드들을 화면에 그대로 쓰려면 `"N/A"` 처리가 반드시 필요하다.

> 청크 본문 전체가 필요하면 `POST /api/rag_paragraph_detail`을 `file_path`(=`source`)와
> `paragraph_id`로 호출한다. 원본 PDF 페이지 이미지는 `POST /api/rag_source_pdf_image`다.
> **둘 다 이 문서 범위 밖이라 요청·응답 상세는 적지 않았다** — 필요하면 담당자에게 문의할 것.

### 6-4. 성공 응답 (근거를 못 찾았을 때) — **HTTP 200**

```json
{
  "result": "정보가 부족하여 답변할 수 없습니다.",
  "keywords": [],
  "source_info": null,
  "retrieval_success": 0
}
```

- 질문이 영어로 판정되면 `result`는 `"The requested information cannot be found in the provided documents."`가 된다.
- **`retrieval_success == 0` 이 유일한 판별 기준이다.** `source_info`로 판별하지 말 것.
- 이 응답이 나오는 경우는 셋이고, 응답만으로는 서로 구분되지 않는다.

| 원인 | `source_info` |
|------|---------------|
| 1. 임계값을 넘는 청크가 하나도 없었다 | `null` |
| 2. 질문이 적재된 문서 범위 밖이라고 판정됐다(LLM 호출 없이 종료) | `null` |
| 3. 청크는 찾았지만 LLM이 "모르겠다"는 취지의 답을 냈다 | **채워진 객체 그대로** |

> ⚠️ 3번 때문에 **`source_info === null` 로 실패를 판별하면 안 된다.** 근거는 있는데
> 답을 못 만든 경우를 성공으로 오분류한다. 반드시 `retrieval_success` 를 볼 것.
- `company` 값에 오타가 있으면 문서가 0건이므로 **항상 이 응답이 온다.**
  `GET /api/documents/metadata`의 회사명과 정확히 일치하는지 먼저 확인할 것.

### 6-5. 실패 응답

| HTTP | 조건 | 응답 본문 |
|------|------|-----------|
| 400 | `provider`가 `pdf`/`gpdf`/`opdf`가 아님(빈 문자열은 제외 — `pdf` 로 폴백) | `{"status": "error", "message": "provider는 pdf, gpdf, opdf 중 하나여야 합니다."}` |
| 400 | `company` 누락 | `{"status": "error", "message": "company를 입력해야 합니다."}` |
| 400 | `question` 누락 | `{"status": "error", "message": "question을 입력해야 합니다."}` |
| 408 | 600초 초과 | `{"error": "요청 처리 시간이 초과되었습니다. (타임아웃: 600초)"}` |
| 429 | 분당 200회 초과 | `{"status": "error", "message": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}` |
| 500 | 처리 중 예외 | `{"error": "내부 서버 오류가 발생했습니다.", "code": "INTERNAL_ERROR"}` |
| 503 | 동시 처리 한도 초과 | `{"error": "서버가 과부하 상태입니다. ...", "code": "SERVER_OVERLOAD"}` |
| **503** | **vLLM 미준비/다운** | `{"error": "서비스 초기화 중입니다. 잠시 후 다시 시도해주세요."}` (`code` 없음) |

검증 순서는 `provider` → `company` → `question`이다. 여러 개가 동시에 잘못되면 앞의 것만 보고된다.

**LLM 호출 자체가 실패한 경우**는 400/500이 아니라 200으로 온다 —
`result`가 `"답변 생성 중 오류가 발생했습니다: ..."`로 시작하고 `retrieval_success`는 `1`이다.
답변 본문을 사용자에게 그대로 노출한다면 이 접두어를 확인하는 편이 좋다.

### 6-6. 응답 시간

한 번 호출에 **수 초~수십 초**가 걸린다(검색 + LLM 생성). 타임아웃은 서버가 600초이므로,
클라이언트 타임아웃은 넉넉히(최소 120초) 잡을 것. 스트리밍 응답은 지원하지 않는다.

---

## 7. RAG 설정 변경

```
GET  /api/rag/settings
POST /api/rag/settings
```

검색 유사도 임계값과 검색 방식을 바꾼다. **서버 재시작 없이 즉시 적용**되며,
값은 `backend/runtime/config.json`에 저장돼 재시작 후에도 유지된다.

> ⚠️ **이 설정은 서버 전역이다.** 특정 호출자나 세션에만 적용되는 값이 아니라,
> 이후 모든 `/api/rag/query` 와 챗봇 응답에 영향을 준다. 여러 클라이언트가 붙어 있다면
> 한쪽이 바꾼 값이 다른 쪽에 그대로 반영된다. **요청 단위로만 임계값을 바꾸고 싶다면
> 이 API 대신 질의의 `similarity_threshold` 필드를 쓸 것.**

### 7-1. 설정 조회

```bash
curl http://118.129.180.214:28081/api/rag/settings
```
```json
{
  "status": "success",
  "current_threshold": 0.3,
  "current_search_method": 3,
  "message": "현재 기본 RAG 유사도 임계값과 검색 방식을 조회했습니다."
}
```

| 필드 | 설명 |
|------|------|
| `current_threshold` | 현재 유사도 임계값(0.0~1.0). 높을수록 근거를 엄격하게 고른다 |
| `current_search_method` | `1` 유사도 검색 · `2` 앙상블+재랭킹 · `3` 그래프 검색 |

> 현재 운영값은 **임계값 `0.3`, 검색 방식 `3`**이다(바뀔 수 있으니 조회로 확인할 것).
> 코드의 기본 상수(`1`)와 다르므로, **활성값은 반드시 이 API로 확인할 것.**

### 7-2. 설정 변경

```
POST /api/rag/settings
```

`action` 값에 따라 세 가지 동작을 한다.

| `action` | 함께 보내는 값 | 하는 일 |
|----------|---------------|---------|
| `update_threshold` | `threshold` (0.0~1.0) | 임계값 변경 |
| `update_search_method` | `search_method` (`1`/`2`/`3`) | 검색 방식 변경 |
| `reset_threshold` | 없음 | 임계값을 코드 기본값으로 되돌린다 |

```bash
# 임계값 변경 (form)
curl -X POST http://118.129.180.214:28081/api/rag/settings \
  -F "action=update_threshold" -F "threshold=0.35"

# 검색 방식 변경 (JSON)
curl -X POST http://118.129.180.214:28081/api/rag/settings \
  -H "Content-Type: application/json" \
  -d '{"action": "update_search_method", "search_method": 2}'

# 임계값 초기화
curl -X POST http://118.129.180.214:28081/api/rag/settings \
  -H "Content-Type: application/json" -d '{"action": "reset_threshold"}'
```

**성공 응답**

```jsonc
// action=update_threshold
{
  "status": "success",
  "previous_threshold": 0.3,
  "new_threshold": 0.35,
  "message": "기본 RAG 유사도 임계값이 0.35로 변경되었습니다."
}

// action=update_search_method
{
  "status": "success",
  "new_search_method": 2,
  "message": "RAG 검색 방식이 2로 변경되었습니다. (1: 유사도, 2: 앙상블, 3: 그래프 검색)"
}

// action=reset_threshold  (기본값은 설정의 RAG_DEFAULT_SIMILARITY_THRESHOLD, 현재 0.3)
{
  "status": "success",
  "previous_threshold": 0.35,
  "new_threshold": 0.3,
  "message": "기본 RAG 유사도 임계값이 기본값 0.3로 리셋되었습니다."
}
```

**실패 응답 (모두 HTTP 400)**

| 조건 | `message` |
|------|-----------|
| `threshold` 누락 또는 빈 값 | `새로운 임계값을 입력해주세요.` |
| `threshold`가 숫자가 아님 | `유효한 숫자를 입력해주세요.` |
| `threshold`가 0.0~1.0 밖 | `임계값은 0.0과 1.0 사이의 값이어야 합니다.` |
| `search_method` 누락 | `검색 방식을 입력해주세요 (1: 유사도, 2: 앙상블, 3: 그래프 검색).` |
| `search_method`가 정수가 아님 | `검색 방식은 1, 2, 또는 3의 정수여야 합니다.` |
| `search_method`가 1/2/3이 아닌 정수 | `검색 방식은 1(유사도), 2(앙상블), 또는 3(그래프 검색)만 가능합니다.` |
| `action`이 위 3개가 아님 | `지원되지 않는 작업: {보낸 값}` |

전부 `{"status": "error", "message": "..."}` 모양이다.
`action`을 아예 안 보내면 빈 문자열로 처리되어 `지원되지 않는 작업: ` 이 온다.

> ⚠️ **임계값 `0` 은 보내는 형식에 따라 결과가 갈린다.** 검증이 값의 참/거짓을 먼저 보기
> 때문에, JSON으로 숫자 `0`(또는 `0.0`)을 보내면 "누락"으로 취급돼
> `새로운 임계값을 입력해주세요.` 400을 받고, form으로 문자열 `"0"`을 보내면 통과한다.
> 혼동을 피하려면 0 대신 아주 작은 값(`0.001`)을 쓰는 편이 안전하다.
> 빈 문자열 `""` 은 어느 형식이든 400이다.

---

## 8. 프롬프트 설정

```
/api/rag_prompts ...  (Content-Type: application/json 전용)
```

RAG 답변 생성에 쓰는 **시스템 프롬프트 템플릿**을 관리한다. 답변의 말투·길이·금지사항이
여기서 정해진다. 저장 위치는 `backend/runtime/config.json`이며, **바꾸면 다음 질의부터
즉시 적용된다**(서버 재시작 불필요).

**적용 우선순위** — 질의의 `company` 값이 기준이다.

```
① 그 회사에 매핑된 프롬프트  →  ② 활성 프롬프트(active_prompt)  →  ③ default
```

매핑된 프롬프트가 삭제됐다면 매핑은 자동으로 지워지고 ②로 내려간다.

> ⚠️ 이 계열은 **인증이 없는 관리자 API**다. 프롬프트 내용을 바꾸면 모든 사용자의 답변이
> 바뀌고, 복구 API는 임의 경로의 파일을 읽는다. **외부에 그대로 노출하지 말 것.**

> ⚠️ **본문이 없거나 JSON이 깨져 있으면 400이 아니라 500**(`{"error": "내부 서버 오류가
> 발생했습니다.", "code": "INTERNAL_ERROR"}`)이 온다. 본문을 읽는 **6개** 엔드포인트
> (생성 · 수정 · `activate` · `restore` · `backup/delete` · `company_mappings` 설정)가 모두 그렇다.
> `Content-Type: application/json`과 올바른 본문을 항상 함께 보낼 것.
>
> 반대로 `backup` · `reset` · `company_mappings/cleanup` 세 개는 본문을 읽지 않으므로
> 본문 없이 호출하는 것이 정상이다.

### 8-1. 프롬프트 목록 조회

```
GET /api/rag_prompts
```
```json
{
  "status": "success",
  "prompts": {
    "default": {
      "name": "기본 RAG 프롬프트",
      "template": "TTS 음성 합성용 답변 전문가입니다.\n\n규칙\n1 질문의 핵심만 ...",
      "description": "TTS용 답변 생성 기본 프롬프트",
      "created_at": "2024-01-01T00:00:00Z",
      "is_active": true,
      "is_system_default": true,
      "updated_at": "2026-07-07T14:39:49.440812"
    },
    "Consultation_Multilingual_Support": {
      "name": "다국어 지원 상담(Gemini권장)",
      "template": "...",
      "description": "영어/한국어가 가능한 다국어 지원 상담 프롬프트",
      "created_at": "2025-10-13T08:38:52.920495",
      "is_active": false
    }
  },
  "active_prompt": "default"
}
```

| 필드 | 설명 |
|------|------|
| `prompts` | **객체**(배열 아님). 키가 `prompt_id`다 |
| `active_prompt` | 현재 활성 프롬프트의 `prompt_id` |
| `is_active` | 활성 여부. `active_prompt`와 같은 정보다 |
| `is_system_default` | `true`면 **삭제할 수 없는** 시스템 기본 프롬프트(현재 `default` 하나) |
| `updated_at` | 한 번도 수정된 적 없으면 **키 자체가 없다** |

### 8-2. 프롬프트 생성

```
POST /api/rag_prompts
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `prompt_id` | string | **필수** | 고유 ID. 이미 있으면 실패 |
| `name` | string | **필수** | 표시 이름 |
| `template` | string | **필수** | 프롬프트 본문 |
| `description` | string | 선택 | 설명(기본 `""`) |

**템플릿 검증 규칙** — 어기면 400이고, 어긴 항목이 `errors` 배열로 전부 온다.

| 규칙 | 위반 시 메시지 |
|------|---------------|
| 최소 50자 | `프롬프트가 너무 짧습니다 (최소 50자)` |
| 최대 10000자 | `프롬프트가 너무 깁니다 (최대 10000자)` |
| `{{` 또는 `}}` 금지 | `잘못된 중괄호 사용이 감지되었습니다` |

`{context}`·`{question}` 은 넣어도 되지만 **넣을 필요가 없다.** 남아 있으면 답변 생성 직전에
자동으로 제거된다. 검색된 문서와 질문은 시스템이 알아서 붙인다.

```bash
curl -X POST http://118.129.180.214:28081/api/rag_prompts \
  -H "Content-Type: application/json" \
  -d '{
        "prompt_id": "customer_support_v2",
        "name": "고객지원 톤",
        "template": "당신은 고객 상담 전문가입니다. 제공된 문서 내용만 근거로 답변하고, 문서에 없으면 전문기관 문의로 안내하세요. 존댓말로 세 문장 이내로 답변합니다.",
        "description": "상담센터용"
      }'
```

**성공 (200)**
```json
{ "status": "success", "message": "프롬프트가 성공적으로 생성되었습니다" }
```

**실패 (400)**
```jsonc
// 필수 필드 누락 또는 공백만 있음
{
  "status": "error",
  "message": "요청 데이터 검증 실패",
  "errors": ["필드 'template'는 비어있을 수 없습니다"]
}

// 템플릿 검증 실패 / 중복 ID
{
  "status": "error",
  "message": "프롬프트 생성 실패",
  "errors": ["프롬프트가 너무 짧습니다 (최소 50자)"]
}
{
  "status": "error",
  "message": "프롬프트 생성 실패",
  "errors": ["프롬프트 ID 'customer_support_v2'가 이미 존재합니다"]
}
```

두 실패의 `message`가 다르다는 점에 주의할 것 — 상세 원인은 항상 `errors` 배열에 있다.

### 8-3. 프롬프트 수정

```
PUT /api/rag_prompts/{prompt_id}
```

바꿀 필드만 보내면 된다(`name` · `template` · `description`).

```bash
curl -X PUT http://118.129.180.214:28081/api/rag_prompts/customer_support_v2 \
  -H "Content-Type: application/json" \
  -d '{"description": "상담센터용 - 2차 개정", "name": "고객지원 톤 v2"}'
```

**성공 (200)**
```json
{ "status": "success", "message": "프롬프트가 성공적으로 업데이트되었습니다" }
```

**실패 (400)**

| 조건 | 응답 |
|------|------|
| 본문이 빈 객체 `{}` | `{"status": "error", "message": "요청 데이터가 필요합니다"}` |
| 없는 `prompt_id` | `{"status": "error", "message": "프롬프트 수정 실패", "errors": ["프롬프트 ID 'x'를 찾을 수 없습니다"]}` |
| `template` 검증 실패 | `{"status": "error", "message": "프롬프트 수정 실패", "errors": ["프롬프트가 너무 짧습니다 (최소 50자)"]}` |

> ⚠️ `name`과 `template`은 **빈 문자열을 보내면 무시된다**(값을 지울 수 없다).
> `description`만 빈 문자열로 덮어쓸 수 있다.

> ⚠️ `default`(시스템 기본)도 **수정은 된다.** 삭제만 막혀 있다. 원본으로 되돌리려면
> 8-10의 초기화를 쓴다.

### 8-4. 프롬프트 삭제

```
DELETE /api/rag_prompts/{prompt_id}
```

```bash
curl -X DELETE http://118.129.180.214:28081/api/rag_prompts/customer_support_v2
```

**성공 (200)**
```json
{ "status": "success", "message": "프롬프트가 성공적으로 삭제되었습니다" }
```

**실패 (400)**

| 조건 | `errors` |
|------|----------|
| 없는 ID | `["프롬프트 ID 'x'를 찾을 수 없습니다"]` |
| `is_system_default: true` 인 프롬프트 | `["시스템 기본 프롬프트는 삭제할 수 없습니다"]` |

> ⚠️ **활성 프롬프트도 삭제된다.** 막히지 않으며, 삭제되면 활성 프롬프트가 조용히
> `default`로 되돌아간다. 그 프롬프트를 쓰던 **회사 매핑도 함께 사라진다.**
> 삭제 전에 `GET /api/rag_prompts`로 `active_prompt`를, `GET /api/rag_prompts/company_mappings`로
> 매핑을 확인할 것.

### 8-5. 활성 프롬프트 변경

```
POST /api/rag_prompts/activate
```

```bash
curl -X POST http://118.129.180.214:28081/api/rag_prompts/activate \
  -H "Content-Type: application/json" -d '{"prompt_id": "military_pension"}'
```

**성공 (200)**
```json
{
  "status": "success",
  "message": "프롬프트 'military_pension'가 활성화되었습니다",
  "active_prompt": "military_pension"
}
```

**실패**

| HTTP | 조건 | 응답 |
|------|------|------|
| 400 | `prompt_id` 누락/빈 문자열 | `{"status": "error", "message": "prompt_id가 필요합니다"}` |
| **404** | 없는 `prompt_id` | `{"status": "error", "message": "프롬프트 ID 'x'를 찾을 수 없습니다"}` |

**이 계열에서 404를 쓰는 곳은 여기뿐이다.** (다른 곳은 없는 ID도 400이다.)

### 8-6. 백업 생성

```
POST /api/rag_prompts/backup
```
요청 본문 없음.

```json
{
  "status": "success",
  "message": "백업이 생성되었습니다",
  "backup_path": "/home/.../rag-system/backend/prompt_backups/prompts_backup_20260907_142530.json"
}
```
실패 시 **500** `{"status": "error", "message": "백업 생성 실패: ..."}`

백업에는 프롬프트 전체, 활성 프롬프트, 회사 매핑, 키워드 프롬프트까지 함께 담긴다.
저장 위치는 `backend/prompt_backups/`이고 파일명은 `prompts_backup_<YYYYMMDD>_<HHMMSS>.json` 이다.
요청 본문은 필요 없다.

### 8-7. 백업 목록 조회

```
GET /api/rag_prompts/backups
```
```json
{
  "status": "success",
  "backups": [
    {
      "filename": "prompts_backup_20260907_142530.json",
      "filepath": "/home/.../rag-system/backend/prompt_backups/prompts_backup_20260907_142530.json",
      "created_at": "2026-09-07T14:25:30.118437",
      "size": 20481
    }
  ]
}
```
**최신순으로 정렬**되어 온다. 백업이 없거나 폴더가 없으면 `"backups": []`다.
복구·삭제에는 여기의 `filepath` 값을 그대로 넘긴다.

### 8-8. 백업에서 복구

```
POST /api/rag_prompts/restore
```
```bash
curl -X POST http://118.129.180.214:28081/api/rag_prompts/restore \
  -H "Content-Type: application/json" \
  -d '{"backup_path": "/home/.../prompts_backup_20260907_142530.json"}'
```

| 결과 | HTTP | 응답 |
|------|------|------|
| 성공 | 200 | `{"status": "success", "message": "백업에서 성공적으로 복구되었습니다"}` |
| `backup_path` 누락 | 400 | `{"status": "error", "message": "backup_path가 필요합니다"}` |
| 파일 없음·JSON 깨짐 | 400 | `{"status": "error", "message": "백업 복구 실패: ..."}` |

> ⚠️ **복구는 현재 프롬프트 전체를 백업 내용으로 교체한다.** 복구 후 사라지면 곤란한
> 프롬프트가 있다면 **복구 전에 백업을 한 번 더 만들 것**(8-6).

### 8-9. 백업 삭제

```
POST /api/rag_prompts/backup/delete
```
(DELETE가 아니라 **POST**다.)

```bash
curl -X POST http://118.129.180.214:28081/api/rag_prompts/backup/delete \
  -H "Content-Type: application/json" \
  -d '{"backup_path": "/home/.../prompts_backup_20260907_142530.json"}'
```

| 결과 | HTTP | `message` |
|------|------|-----------|
| 성공 | 200 | `백업 파일이 성공적으로 삭제되었습니다` |
| `backup_path` 누락 | 400 | `backup_path가 필요합니다` |
| 파일 없음 | 400 | `백업 파일을 찾을 수 없습니다` |
| 백업 폴더 밖의 경로 | 400 | `잘못된 백업 파일 경로입니다` |

### 8-10. 기본값으로 초기화

```
POST /api/rag_prompts/reset
```
요청 본문 없음. **사용자가 만든 프롬프트가 전부 사라지고 시스템 기본 프롬프트만 남는다.**

| 결과 | HTTP | 응답 |
|------|------|------|
| 성공 | 200 | `{"status": "success", "message": "시스템 기본값으로 초기화되었습니다"}` |
| 실패 | 500 | `{"status": "error", "message": "..."}` |

> ⚠️ 확인 절차가 없다. **실행 전에 8-6으로 백업할 것.**

### 8-11. 회사별 프롬프트 매핑 조회

```
GET /api/rag_prompts/company_mappings
```
```json
{
  "status": "success",
  "mappings": [
    {
      "company": "국민연금",
      "prompt_id": "military_pension",
      "prompt_name": "군인연금(Gemini 권장)",
      "prompt_description": "군인연금 법률 관련 TTS 프롬프트",
      "is_valid": true
    }
  ]
}
```
**`mappings`는 배열이다**(회사명을 키로 하는 객체가 아니다). 매핑이 없으면 `[]`.
`is_valid`가 `false`면 매핑된 프롬프트가 이미 삭제된 것이며, 그 회사는 활성 프롬프트를 쓴다.
이때 `prompt_name`은 `"Unknown"`, `prompt_description`은 `""` 로 채워진다.

### 8-12. 회사별 프롬프트 매핑 설정

```
POST /api/rag_prompts/company_mappings
```
```bash
curl -X POST http://118.129.180.214:28081/api/rag_prompts/company_mappings \
  -H "Content-Type: application/json" \
  -d '{"company": "국민연금", "prompt_id": "customer_support_v2"}'
```

| 결과 | HTTP | 응답 |
|------|------|------|
| 성공 | 200 | `{"status": "success", "message": "회사 '국민연금'에 프롬프트 'customer_support_v2'가 매핑되었습니다"}` |
| `company`/`prompt_id` 누락 | 400 | `{"status": "error", "message": "company와 prompt_id가 필요합니다"}` |
| 없는 `prompt_id` | 400 | `{"status": "error", "message": "회사별 프롬프트 매핑 설정 실패", "errors": ["프롬프트 ID 'x'를 찾을 수 없습니다"]}` |

한 회사에는 프롬프트 하나만 매핑된다(다시 설정하면 덮어쓴다).
회사명은 앞뒤 공백이 제거되어 저장되며, **질의의 `company` 값과 정확히 일치해야** 적용된다.

### 8-13. 회사별 프롬프트 매핑 제거

```
DELETE /api/rag_prompts/company_mappings/{company}
```
회사명은 URL 경로에 들어간다. 한글을 인코딩 없이 보내도 동작하지만, 클라이언트·프록시에
따라 깨질 수 있으므로 **percent-encoding 을 권장한다.**

```bash
curl -X DELETE "http://118.129.180.214:28081/api/rag_prompts/company_mappings/$(python3 -c 'import urllib.parse;print(urllib.parse.quote("국민연금"))')"
```

| 결과 | HTTP | 응답 |
|------|------|------|
| 성공 | 200 | `{"status": "success", "message": "회사 '국민연금'의 프롬프트 매핑이 제거되었습니다"}` |
| 매핑 없음 | 400 | `{"status": "error", "message": "회사별 프롬프트 매핑 제거 실패", "errors": ["회사 '국민연금'의 매핑을 찾을 수 없습니다"]}` |

### 8-14. 무효 매핑 정리

```
POST /api/rag_prompts/company_mappings/cleanup
```
삭제된 프롬프트를 가리키는 매핑을 모두 지운다. 요청 본문 없음. **항상 200**이다.

```json
{ "status": "success", "message": "2개의 무효한 회사 매핑이 정리되었습니다", "cleaned_count": 2 }
```
정리할 게 없으면 `{"status": "success", "message": "정리할 무효한 매핑이 없습니다", "cleaned_count": 0}`.

---

## 9. 상담 내용 요약

```
POST /api/summary
Content-Type: application/json
```

상담 대화 원문을 **고객 관점의 2~3문장 요약**으로 만든다. RAG(문서 검색)와 무관하며,
LLM만 사용한다. 상담 종료 후 고객에게 남길 요약문을 만드는 용도다.

### 9-1. 요청

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `text` | string | **필수** | 요약할 상담 내용 원문 |

`text` 외의 필드는 무시된다. 길이 상한은 명시돼 있지 않지만, 요약 출력은 최대 500토큰이다.

```bash
curl -X POST http://118.129.180.214:28081/api/summary \
  -H "Content-Type: application/json" \
  -d '{"text": "상담사: 안녕하세요 무엇을 도와드릴까요. 고객: 노령연금을 언제부터 받을 수 있는지 궁금합니다. 상담사: 가입기간이 10년 이상이시면 만 63세부터 받으실 수 있고, 청구는 지사 방문이나 홈페이지로 가능합니다. 고객: 서류는 뭐가 필요한가요. 상담사: 신분증과 통장 사본이 필요합니다."}'
```

### 9-2. 성공 응답

```json
{
  "result": "가입기간이 10년 이상이면 만 63세부터 노령연금을 받으실 수 있습니다. 청구는 지사 방문 또는 홈페이지로 하실 수 있으며, 신분증과 통장 사본이 필요합니다.",
  "degraded": false
}
```

| 필드 | 설명 |
|------|------|
| `result` | 요약문. **줄바꿈·탭이 모두 공백으로 치환된 한 덩어리 문자열**이다 |
| `degraded` | `false`면 실제 LLM 요약, `true`면 폴백(아래) |

요약문에는 인사말·맺음말·목록기호·이모지·특수문자가 들어가지 않도록 지시돼 있다.

### 9-3. LLM을 못 쓸 때 — **200 + `degraded: true`**

vLLM이 죽었거나 호출이 실패하면 **에러가 아니라 고정 문구**가 돌아온다.

```json
{
  "result": "죄송합니다. 요약을 생성할 수 없습니다.",
  "degraded": true
}
```

- 이 엔드포인트는 **vLLM 게이트에 걸리지 않는다.** 503이 아니라 이 응답이 온다.
- **`degraded`를 확인하지 않으면 이 문구를 진짜 요약으로 저장하게 된다.**
  `degraded == true`면 재시도하거나 요약 없이 진행하도록 처리할 것.
- `result` 문자열로 판별하지 말고 `degraded` 불리언을 볼 것.

### 9-4. 실패 응답

| HTTP | 조건 | 응답 본문 |
|------|------|-----------|
| 400 | `text`가 공백만 있음 | `{"error": "text 필드가 필요합니다."}` |
| **422** | `text` 키 자체가 없음 · 타입이 문자열이 아님 · 본문이 JSON이 아님 | FastAPI 표준 검증 오류 (아래) |
| 500 | 그 밖의 서버 예외 | `{"error": "요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}` — **`code` 키가 없다** |
| 503 | 동시 처리 한도 초과 | `{"error": "서버가 과부하 상태입니다. ...", "code": "SERVER_OVERLOAD"}` |

**422 본문 예시** — 이 문서 범위에서 422가 나는 곳은 여기뿐이다.
```json
{
  "detail": [
    { "type": "missing", "loc": ["body", "text"], "msg": "Field required", "input": {} }
  ]
}
```

`""`(빈 문자열)과 `"   "`(공백만)는 422가 아니라 **400**이라는 점에 주의할 것.
이 엔드포인트에는 레이트리밋(429)이 적용되지 않는다.

> ⚠️ **이 API의 400·500은 라우트가 직접 만들기 때문에 `code` 키가 없다.** 0-4의 공통
> 500(`{"error": ..., "code": "INTERNAL_ERROR"}`)과 **문자열도 모양도 다르다.**
> `code` 키의 유무로 오류를 분기하는 코드를 짠다면 이 엔드포인트를 예외로 다뤄야 한다.

---

## 부록 A. 상태 코드 한눈에 보기

| HTTP | 본문 모양 | 뜻 | 재시도 |
|------|-----------|-----|--------|
| 200 | `{"result": ...}` 등 | 요청은 처리됨. **내용까지 봐야 성패를 안다**(0-3) | — |
| 400 | `{"status": "error", "message": ...}` | 요청 값이 잘못됨 | 고쳐서 재요청 |
| 404 | `{"error": ..., "code": "NOT_FOUND"}` | 존재하지 않는 경로 | 경로 확인 |
| 404 | `{"status": "error", "message": ...}` | 활성 프롬프트 변경에서 없는 ID | 고쳐서 재요청 |
| 408 | `{"error": "요청 처리 시간이 초과되었습니다. ..."}` | 서버 측 타임아웃 | 비동기로 전환 권장 |
| 413 | `{"error": ..., "code": "FILE_TOO_LARGE"}` | 본문 200MB 초과 | 파일을 나눌 것 |
| 422 | `{"detail": [...]}` | 요약 API의 스키마 검증 실패 | 고쳐서 재요청 |
| 429 | `{"status": "error", "message": "요청이 너무 많습니다. ..."}` | 분당 200회 초과 | **잠시 후 재시도** |
| 500 | `{"error": ..., "code": "INTERNAL_ERROR"}` | 서버 예외(전역 핸들러) | 로그 확인 필요 |
| 500 | `{"error": "요청 처리 중 오류가 발생했습니다. ..."}` | 요약 API의 서버 예외 — `code` 없음 | 로그 확인 필요 |
| 503 | `{"error": ..., "code": "SERVER_OVERLOAD"}` | 동시 처리 한도 초과 | **백오프 후 재시도** |
| 503 | `{"error": "서비스 초기화 중입니다. ..."}` (`code` 없음) | vLLM 미준비 | `/api/status` 확인 후 재시도 |

## 부록 B. 연동할 때 자주 틀리는 것

1. **HTTP 200을 성공으로 단정한다.** 인입·삭제 실패, 검색 실패, 요약 폴백이 전부 200이다(0-3).
2. **`Content-Type` 헤더를 빼먹는다.** 문서·RAG 계열은 헤더가 없으면 본문을 무시하고
   쿼리스트링을 읽어, "필수값 누락" 400이 난다.
3. **인입 응답의 `task_id`를 버린다.** 기본이 비동기라 그 응답만으로는 결과를 알 수 없다.
4. **`source_info`를 배열로 파싱한다.** 객체이고, 목록은 `source_info.sources`다.
5. **`paragraph_id` 하나로 청크를 식별한다.** 전역 유일하지 않다. `(file_path, paragraph_id)` 쌍을 쓸 것.
6. **`company` 오타.** 검색은 오류 없이 `retrieval_success: 0`만 돌려준다.
   `GET /api/documents/metadata`의 이름과 대조할 것.
7. **`similarity_threshold`에 잘못된 값을 넣고 반영됐다고 믿는다.** 조용히 무시된다.
8. **RAG 설정을 요청별 설정으로 착각한다.** 전역이며 다른 사용자에게도 영향을 준다.
9. **클라이언트 타임아웃이 너무 짧다.** 질의는 수십 초, 동기 인입은 수십 분이 걸릴 수 있다.
10. **프롬프트 API에 빈 본문을 보낸다.** 400이 아니라 500이 난다.

## 부록 C. 처음부터 끝까지 해보기

```bash
HOST=http://118.129.180.214:28081

# 0) 서버·vLLM·Neo4j 준비 확인 — vllm.status 가 connected 여야 한다
curl -s $HOST/api/status | python3 -m json.tool

# 1) 문서 인입 (비동기) → task_id 확보
curl -s -X POST $HOST/api/documents/ingest \
  -F "file=@./연금안내서.pdf" \
  -F "company=테스트기관" -F "category=연금" -F "subcategory=수급요건"
# → {"status":"async_started","task_id":"...","task_type":"rag_add", ...}

# 2) 완료될 때까지 폴링 (status 가 completed 가 될 때까지)
curl -s $HOST/api/async_task_status/<task_id> | python3 -m json.tool
# → task_info.status == "completed" && task_info.result == "RAG Vector DB 추가 성공."

# 3) 적재 확인
curl -s $HOST/api/documents/metadata | python3 -m json.tool

# 4) 현재 검색 설정 확인
curl -s $HOST/api/rag/settings | python3 -m json.tool

# 5) 질의
curl -s -X POST $HOST/api/rag/query \
  -H "Content-Type: application/json" \
  -d '{"question":"수급 요건이 어떻게 되나요?","company":"테스트기관","provider":"pdf"}' \
  | python3 -m json.tool
# → retrieval_success 가 1 인지 먼저 볼 것

# 6) 답변 톤을 바꾸고 싶다면 프롬프트 생성 후 활성화
curl -s -X POST $HOST/api/rag_prompts -H "Content-Type: application/json" \
  -d '{"prompt_id":"tone_test","name":"테스트 톤","template":"제공된 문서 내용만 근거로 존댓말로 두 문장 이내로 답변하세요. 문서에 없으면 전문기관 문의로 안내합니다."}'
curl -s -X POST $HOST/api/rag_prompts/activate -H "Content-Type: application/json" \
  -d '{"prompt_id":"tone_test"}'

# 7) 상담 요약
curl -s -X POST $HOST/api/summary -H "Content-Type: application/json" \
  -d '{"text":"상담사: ... 고객: ..."}' | python3 -m json.tool
# → degraded 가 false 인지 확인

# 8) 정리 — 넣었던 테스트 문서 삭제
curl -s -X DELETE $HOST/api/documents -H "Content-Type: application/json" \
  -d '{"company":"테스트기관"}'
```
