# 음성 AI(눌러서 말하기 + 답변 듣기) 세부 설계서 (No.32)

> **요구사항**: `docs/requirements/voice-ai.md`(확정 2026-10-01 — J-1~J-12, R-1~R-13, FR-0-322~334, FR-VO1-\*~FR-VO8-\*, NFR-VOP/VOS/VOR/VOA/VOM, AC-VO1~VO5, EX-VO-1~25, P-1~P-16, U-1~U-7 · **요구사항 환류 H-1~H-10 PM 결정 반영 2026-10-01 — §12.3**)
> **상위 문서**: `docs/02-spec/개발명세서.md` §1·§2·§2.2·§3·§4·§5.1·§6(**결정 51 신설** · 결정 16·17·29 갱신 각주)·§7 · `docs/01-requirements/기능요구사항.md` 74행 · ADR-0024 — 반영 문구는 **`docs/02-spec/voice-ai-patches.md`**(찾기/바꾸기 목록 · ⏳ 적용 대기 — 대상 파일이 CRLF라 바이트 보존 적용은 오케스트레이터가 한다 · 2026-10-01 구현 반영으로 A-5·A-6·A-9·A-12·A-13·A-15·A-16·A-17·A-18·B-1·C-2 갱신 · 22건 앵커 1회 매칭 재확인 · §21)
> **신규 ADR**: **ADR-0052**(`decisions/ADR-0052-voice-ai-push-to-talk-dedicated-stt-process-device-local-tts-speech-reply-key-and-zero-audio-retention.md`). `decisions/`의 현재 최대 번호는 **0051**(시연 하네스 DT-1 — `ADR-0051-demo-harness-…`)이다. 요구사항 문서가 예상한 "ADR-0051"은 이미 쓰였으므로 **0052**를 쓴다(가번호는 예약이 아니다 — ADR-0045 §12).
> **갱신 ADR(각주)**: **ADR-0024**(재검토 트리거 "음성(STT/TTS)·비전 착수 → ml-worker 내부 구조 재결정" **발동 · 해소** — 음성 인식 전용 역할 `speech`) · ADR-0011(공개 표면 9 → **10**) · ADR-0012(위젯 — Preact 트리거 미발동 · zod 무의존 서브패스 +1) · ADR-0026(Provider 포트 선례 — `packages/llm-provider` 미승격 유지) · ADR-0040(출구 7 → **8** · 데이터 종류 +1) · ADR-0038(기능 선언 3 → **4**) · ADR-0023(보류 답변 폴링 응답 선택 키 +1)
> **작성일**: 2026-10-01 · **개정**: 2026-10-01(요구사항 환류 H-1~H-10 PM 결정 반영 — H-3 읽기 대상 축소 · H-10 운영 mock 기동 실패 · H-5 개통 전 체크리스트 · H-1·H-2·H-4·H-6~H-9 설계안 수용) · **구현 반영 개정 2026-10-01**(위젯 gzip 증가 예산 7KB — PM 결정 · 가용성 연속 실패 임계 · 위젯 503 처리 · Esc·포커스·자동 읽기 확정 · 한글 숫자 규칙 보완 · ml-worker 디코더 허용 목록 · 구현 결정 합치 — §23 I-1~I-16) · **GPU**: **6 유지 + 각주**(P-12) · 구축형 △ → **○** · 구독형 ○ + 각주
> **구현 담당**: `ml-engineer`(ml-worker `speech` 역할 · 디코더·VAD·STT · 3050 "동작 확인" · 라이선스 원문 · 한글 숫자 정규화 규칙 목록 · 상투 문장 목록 · 운영 실측 계획) + `backend-implementer`(API `speech` 모듈 · 공개 인식 경로 · 응답 선택 키 · 관리 API · 거버넌스 편입 · 운영 mock 기동 검사) + `ui-designer`(위젯 마이크·듣기·자동 읽기 · 콘솔 음성 구역 · 말투 이름·대응표 값) + `frontend-implementer`(위젯 · 콘솔). 역할 분담은 §17.
> **표기**: 설계 결정 **DD-115~DD-136**(저장소 기존 최대 DD-114 — `learning-augmentation-설계.md`) · 코드에서 찾은 제약 **C-1~C-17** · 봉인 **VO-1~VO-17** · 의도된 기존 시험 기대값 변경 **X-1~X-12(닫힌 목록 — FR-0-334 · X-12는 구현 중 추가 — §15.3)** · 알려진 제한 **K-1~K-17** · 요구사항 대비 해석 **R-1~R-17** · **요구사항 환류 H-1~H-10(§20 — PM 결정 2026-10-01 반영 완료)** · 고객 개통 전 체크리스트 **OC-1~OC-8(§17.5)** · 구현 편차는 구현 후 §23에 **I-n**

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

사용자(PM)는 2026-10-01에 **규모 A**를 확정했다 — 웹 위젯에서 **마이크 버튼으로 최대 30초 녹음 → 서버 사내 STT → 인식 글자를 입력창에 채워 사용자가 확인 후 전송**, 봇 답변은 **사용자 브라우저 내장 음성(SpeechSynthesis, 기기 안 `ko` 음성만)** 으로 듣기, "감정 톤"은 **응답 종류·관리자 지정에 따른 규칙 기반 말투(rate·pitch·volume)**, **음성 원본 저장 0·디스크 0·외부 전송 0**. 이 설계는 **음성을 쓰지 않는 챗봇·사이트·구버전 위젯의 요청·응답·데이터 지도를 한 바이트도 바꾸지 않고** 다음을 만든다. ① ml-worker에 **세 번째 프로세스 종류 `ML_WORKER_ROLE=speech`**(STT 전용 · 임베딩·생성과 배타 · DB·외부 송신·디스크 0)를 둔다 — ADR-0024 음성 트리거의 해소다 ② API에 **`speech` 모듈**(STT Provider 포트 `mock｜local` · 공개 인식 경로 1개 · 관리 API 3개 · 설정·일별 숫자 2테이블)을 둔다 ③ 공개 인식 경로 `POST /public/chatbots/:slug/speech/transcriptions`(**`@Public()` 10번째** · 원시 오디오 본문 · 세션 헤더 · 전용 버킷 · 동시 처리 상한 즉시 거절)가 오디오를 **메모리에서만** ml-worker로 넘기고 `{ text, durationMs, empty? }`를 돌려준다 — 대화 로그·미응답·통계 대화 수에 아무것도 남기지 않는다 ④ 공개 메시지·보류 답변 폴링 응답에 **선택 키 `speech: { text, tone }`**(마지막 키 · 위젯 기능 선언 `speech-v1` ∧ 챗봇 듣기 켜짐 ∧ **봇 답변**일 때만 · 저장 0)를 붙인다 — **봇 답변 = 정상 답 · 폴백(미응답) 안내 · No.36 안전 문구 대체**이고, 금지어 안내·일시 장애·RAG 대기 같은 **시스템 안내 문구는 읽지 않는다**(H-3 PM 결정 · DD-136). 읽기용 글자는 **화면에 보낸 최종 봇 출력**(출구 금지어·RAG 출구 가림 이후 · 앞에 붙은 상담원 미전달 메시지 제외)에서 서버가 문자열 변환으로 만들고, 말투는 서버가 규칙으로 고른다(모델 호출 0) ⑤ 공개 설정 응답에 **선택 키 `voice`**(마지막 키)를 붙인다 ⑥ 위젯은 브라우저 기본 기능(`MediaRecorder`·`speechSynthesis`)만으로 녹음·읽기를 한다(런타임 의존성 0) ⑦ **운영 환경(`NODE_ENV=production`)에서 서버 음성 스위치가 켜져 있는데 공급자가 `mock`이면 API 기동 실패**(가짜 인식 결과의 운영 노출 차단 — H-10 PM 결정 · DD-135). **`packages/dialogue-engine`·채널 어댑터·`packages/pii-mask` 변경 0, 동기 대화 턴의 모델 호출 추가 0.**

> 이 설계가 코드에서 **추가로 찾은 제약 17건**(요구사항 §0.2 외):
> **C-1 ADR-0051은 이미 쓰였다**(`decisions/ADR-0051-demo-harness-…` — 2026-10-01 시연 하네스). 요구사항의 "예상 ADR-0051" → **ADR-0052**(DD-115).
> **C-2 Nest는 가드 → 인터셉터 → 파이프 순서이고, API의 본문 파서는 JSON·urlencoded 2종뿐이다**(`apps/api/src/main.ts` 16·20·21행 — `bodyParser:false` 후 직접 등록). `audio/*`·`application/octet-stream` 본문은 **어떤 파서도 읽지 않은 채 요청 스트림으로 남는다** → 가드(레이트·Origin)가 본문을 한 바이트도 읽기 전에 돌고, 핸들러가 상한을 걸고 직접 읽는다(§5.3). 같은 이유로 **전용 버킷의 키를 본문에서 꺼낼 수 없다**(No.35는 JSON 본문이라 가능했다 — `public-rate-limit.guard.ts` 118~125행) → 세션 키는 **헤더**(`x-cb-session-id` — No.24 상담 폴링과 같은 헤더 · `HANDOFF_SESSION_HEADER`, `conversation.ts` 373행).
> **C-3 FastAPI의 `UploadFile`(python-multipart)은 `SpooledTemporaryFile`로 받아 일정 크기(기본 1MB)를 넘으면 디스크로 넘긴다. 또 Pydantic 본문 검증 실패(422) 응답은 입력값을 되돌려 싣는다** → ml-worker는 오디오를 `Request.stream()`으로 **원시 바이트로만** 받는다(`UploadFile`·`File()`·`Form()`·Pydantic 본문 모델 금지 — VO-3 · DD-117).
> **C-4 `PublicConversationService.sendMessage()`의 반환 지점은 6곳이다**(`public-conversation.service.ts` 221 BLOCK · 251 상담 HANDLED · 280 버전 읽기 실패 · 318 입구 가드레일 대체 · 413 보류 RAG 시작 · 467 정상) → `speech` 키는 **봇 답변 반환 지점 2곳(318 안전 문구 대체 · 467 정상)** 에만 같은 헬퍼로 붙는다. 221·280·413은 **제품 고정 문구**(`BANNED_WORD_GUIDANCE_TEXT`·`VERSION_UNAVAILABLE_FALLBACK_TEXT`·`RAG_WAITING_TEXT` — 코드 상수)를 내보내는 시스템 안내라 붙이지 않고(H-3), 251은 상담 구간이라 붙이지 않는다. 413은 응답에는 붙이지 않되 **폴링용 말투 계획만 보류 저장소에 둔다**(§6.4 · DD-136).
> **C-5 보류 답변 폴링 요청에는 기능 선언이 없다**(`GET …/messages/:messageId` — 본문 없음). 폴링 응답의 `speech` 여부는 **보류 시작 시점에 결정해 `PendingAnswerStore`에 함께 둔다**(`pending-answer.store.ts` 21행 `create(id, meta)`의 선택 필드 — §6.5).
> **C-6 외부 RAG 출구 가드레일의 "안전 문구로 대체"는 `FAILED`로 수렴해 폴백과 구분되지 않는다**(`rag-answer.service.ts` 145~161행 `finishAsFallback(…, override)`) → 말투 "차분함" 고정(FR-VO4-4)을 지키려면 `complete()` 결과에 **선택 표식 `safetyReplaced`** 가 필요하다(1줄 — §6.5).
> **C-7 No.46 강등 사다리의 텍스트 단계는 읽기용이 아니다** — `[카드] 제목`·`[링크] 라벨`·`[이미지] 대체글`·`[전화] 라벨` 접두를 붙이고, 캐러셀 텍스트 단계는 LINK 버튼을 `라벨: 주소`로 적는다(`rich-degrade.ts` 245·336·343·355·362행). 그대로 읽으면 "대괄호 카드"·URL을 읽는다 → **같은 판별 유니온 전수 분기 구조만 따르고 함수는 재사용하지 않는다**(DD-126).
> **C-8 데이터 지도 `egress.exits[]`는 레지스트리의 모든 출구를 행으로 만든다**(DB 결정 출구 3종만 제외 — `governance-map.service.ts` 256행). 새 출구 클래스를 등록하면 **기본 설치의 데이터 지도 바이트가 바뀐다**(FR-0-322 위반) → 새 출구 행은 **서버 음성 인식이 켜진 설치에서만** 넣는다(DD-130).
> **C-9 기존 시험의 고정 개수 단언**: `@Public()` 9 = 7개 파일 · `EgressExitId`/`EGRESS_REGISTRY` 7 = 4개 파일 · 영구삭제 동반 삭제 34테이블 = `chatbots.service.spec.ts` 142행 · 컨트롤러 전수 목록 = `public-decorator-count.spec.ts` → 닫힌 목록 X-1~X-12(§15.3 — X-12 공개 스키마 목록은 구현 중 추가). G-1·G-2(출구 파일·가드 순서)는 레지스트리 기반이라 **자동 추종**한다(`governance-sealing.spec.ts` 144~226행).
> **C-10 위젯의 `sendMessage`는 기능 선언 3개를 고정 배열로 보낸다**(`public-client.ts` 100행). 공통 `request()`는 오류 본문의 `code`를 읽지 않는다(`classifyStatus` — 49~55행) → 인식 호출은 **전용 함수**로 오류 코드를 구분한다(§9.6).
> **C-11 위젯은 창을 열 때(`handleOpen`) 설정을 받는다**(`app.ts` 432행). 음성 가능 여부는 열기 뒤에야 알 수 있다 → 마이크·듣기 UI는 `CONFIG_LOADED` 뒤 조립한다(음성 꺼짐이면 권한 요청·`getVoices()` 호출 0 — NFR-VOP5).
> **C-12 대화 세션은 클라이언트가 만든 UUID이고 서버에 세션 등록부가 없다**(ADR-0009). 요구사항 FR-VO2-2 원안 "세션이 그 챗봇 것일 때만"은 **검증할 원천이 없다** → 대체 통제를 둔다(K-1). **PM 결정(H-1): 대체 통제 수용 · 서명 토큰 1차 미도입 · 요구사항 FR-VO2-2 문구 정정 · 남은 위험은 요구사항 R-13.**
> **C-13 `packages/pii-mask`의 가림 표시 상수는 export되지 않는다**(`index.ts` 107~108행 `TEXT_RRN`·`TEXT_CARD` 비공개 · 전화·이메일·계좌는 인라인 문자열) → 읽기 정리는 **닫힌 표시 목록**을 API에 두고, `maskPii()` 출력에서 표시를 수집해 목록과 대조하는 **표류 감시 시험**을 둔다(pii-mask 변경 0 — VO-14).
> **C-14 공개 대화 첫 턴 쿼리 수 17이 3개 통합 시험에 고정돼 있다**(`ai-guardrails-query-count.integration.spec.ts` 11행 외) → 음성 설정 조회는 No.36과 같은 **전역 색인(TTL) + 챗봇별 캐시** 패턴으로 "음성 안 쓰는 신규 챗봇의 첫 턴" 쿼리를 0 더한다(DD-129). 대화 턴은 기능 선언에 `speech-v1`이 없으면 색인조차 보지 않는다.
> **C-15 공개 표면 CORS는 `origin:'*'`·무자격증명·프리플라이트 캐시 600초이고 허용 헤더를 지정하지 않는다**(`main.ts` 31~37행 — `cors` 기본 = 요청 헤더 반사). 오디오 `Content-Type`·세션 헤더 프리플라이트가 **추가 설정 없이** 통과한다(CORS 변경 0).
> **C-16 [개정 추가] 정상 턴·입구 안전 문구 대체 턴의 최종 `outputs` 앞에는 상담원 미전달 메시지가 붙을 수 있다** — 구버전(LEGACY) 상담이 시간 종료로 끝나 미전달 메시지가 있으면 게이트가 `prependOutputs`를 실어 보내고 서비스가 `maskOutbound([...handoffPrependOutputs, ...봇 출력])`으로 합친다(`public-conversation.service.ts` 256·299·387행 — G-8). 이것은 **상담원 메시지**라 읽기 대상이 아니다(J-8). `maskOutbound`는 `maskOutputs` = `outputs.map(...)`(`banned-words/lib/output-text-fields.ts` 82~84행)으로 **길이·순서를 보존**하므로, 읽기 글자는 `outputs.slice(handoffPrependOutputs.length)`(= 봇 출력만)에서 만든다(DD-136).
> **C-17 [개정 추가] API에는 "운영 환경" 판별 기준이 없다** — 저장소 전체(의존성 폴더 제외)에서 `NODE_ENV` 사용 0건 · `apps/api/package.json` `start`는 `node dist/main.js`(환경 표시 없음) · `apps/api/.env.example` 파일 없음. H-10의 "운영 환경"은 **Node 관례 `NODE_ENV=production`을 이 기능이 처음 읽는 것**으로 정한다(DD-135). 설정하지 않은 운영 설치는 판별되지 않으므로(fail-open) 개통 전 체크리스트 OC-5·기동 경고·데이터 지도 표시로 보완한다(K-17).

---

## 1. PM 확정 사항 · architect 결정 일람

### 1.1 PM 확정 (2026-10-01)

| # | 확정 | 이 문서 반영 |
|---|---|---|
| P-1 | 규모 A · WEB만 · 30초 눌러서 말하기 + 듣기 | 전체 |
| P-2 | 서버 STT → 입력창 · 사용자 확인 후 전송 | §9.3 |
| **P-3** | **브라우저 내장 음성(기기 안 `ko`·`localService`)** — 서버 합성 0 | §6 · §9.4 |
| P-4 | 규칙 기반 말투 · rate·pitch·volume만 | §6.2 |
| P-5 | 음성 원본 저장 0 · 디스크 0 · 외부 전송 0 | §8.3 · §11 · VO-3 |
| P-6 | 3050 = "동작 확인" · STT 합격 = L40S 실측(No.17과 함께) · TTS 합격 대상 아님 | §8.8 · §13 |
| P-7~P-16 | 클라우드 미구현 · 자동 읽기 기본 꺼짐 · 30초 · 봇 답변만 · 캐시 해당 없음 · GPU 6+각주 · 고지(법무 전 미구현) · 원본 미확인 · 일별 숫자만 · 숫자 정규화 | 각 절 |

### 1.2 요구사항 §12.1 "architect 확정 사항" 결정 일람

| DD | 쟁점 | 결정 | 근거(요약) | 절 |
|---|---|---|---|---|
| **DD-115** | 새 ADR 번호 | **ADR-0052** | 0051 사용 중(C-1) | 머리말 |
| **DD-116** | ml-worker 음성 인식 프로세스 역할·분리 | **`ML_WORKER_ROLE=speech` — 배타 역할**(`embed`·`augment`·`both`와 결합 불가 · `both` 의미 불변). 같은 패키지·같은 진입점(`ml_worker.app:app`)이며 `speech`일 때만 `/speech/*` 경로 등록. **ADR-0024 음성 트리거 발동 → 해소** | 대화 임베딩(300ms 예산)과 GPU·스레드 풀 분리(ADR-0024 §갱신 1-②) · 진입점·운영 명령 1벌 유지 · 별도 앱 모듈 기각(§8.1) | §8 |
| **DD-117** | 디스크를 쓰지 않는 디코딩 | **원시 본문(`Request.stream()` 상한 읽기) → PyAV `av.open(io.BytesIO(…))` → 16kHz 모노 float32 넘파이 → VAD → STT(넘파이 배열 입력)**. 프레임 루프에서 길이·시간 상한 검사. `UploadFile`·multipart·`tempfile`·ffmpeg 하위 프로세스 금지 | C-3 · NFR-VOS3 압축 폭탄 · ffmpeg 파이프 기각(프로세스 생성·종료 관리 비용) | §8.3 |
| **DD-118** | STT 모델 후보 선택 구조 | **`STT_BACKEND=mock｜faster-whisper` + `STT_MODEL_ID`(경로 또는 캐시 이름) + 교체 지점 `_load_transcriber()` 1곳**(No.37 `_load_generator()` 선례) · 모델 파일은 **기동 중 내려받기 0**(`local_files_only` 고정) · 후보 비교는 `eval/stt_candidates.py`(CI 밖) | NFR-VOM1 · FR-VO7-2 · R-10 | §8.5 |
| **DD-119** | STT Provider 포트 위치·이름 | **`apps/api/src/speech/providers/speech-recognition-provider.port.ts` — `SpeechRecognitionProvider`**(`mock`·`local` · `cloud`는 유니온 주석의 예약 자리만). 이름은 채널·위젯 무관(**No.33 멀티모달의 "음성 이해"가 그대로 재사용**) · `packages/llm-provider` 승격 안 함(LLM 소비자 아님) | J-10 · ADR-0026 §6 | §7 |
| **DD-120** | 공개 인식 엔드포인트 경로·본문 | **`POST /public/chatbots/:slug/speech/transcriptions`** · 본문 = 녹음 바이트 그대로(`Content-Type: audio/*` 또는 `application/octet-stream`) · 세션 = 헤더 `x-cb-session-id` · 응답 `{ text, durationMs, empty? }` · 핸들러는 컨트롤러 **맨 끝**(10번째) | C-2 · multipart 기각(busboy 표면 · 필드 파싱 불필요) · base64 JSON 기각(33% 팽창 · JSON 파서 2MB 상한 소비) | §5.3 |
| **DD-121** | 전용 요청 한도 버킷 | `@PublicRateBucket({ kind: 'SPEECH', key: { from: 'header', name: 'x-cb-session-id', ns: 'session' } })` → **`sp-ip` 30/분 + `sp-key:session` 10/분**(대화 `ip`·`session` 비소비) | No.24·44·35 선례 · 30초 녹음 1회당 1요청 | §5.4 |
| **DD-122** | 동시 처리 상한 위치 | **API 비대기 세마포어(1차 · 기본 2) + ml-worker 비대기 세마포어(2차 · 기본 2)** · 둘 다 **대기열 0 — 초과 즉시 `503 SPEECH_BUSY`** | API 상한이 ml-worker 앞에서 바이트 전송까지 막는다 · ml-worker 상한은 API가 여러 개일 때·직접 호출 방어 | §5.3 · §8.6 |
| **DD-123** | 공개 설정 `voice` 키 구조·상태 캐시 | `voice?: { input, tts, autoReadToggle, rate }`(이 순서) · **응답의 마지막 키** · 입력·듣기 모두 거짓이면 **키 없음** · `input` = 챗봇 입력 켜짐 ∧ `SPEECH_ENABLED` ∧ 공급자 사용 가능(**상태 캐시 성공 30초·실패 10초 · 만료 시 직전 값 반환 + 백그라운드 갱신 · 프로세스 첫 조회만 최대 1초 대기**) · `tts` = 챗봇 듣기 켜짐만(서버 스위치 무관) | FR-VO1-1 · FR-VO3-1 · EX-VO-12 · No.35 `proactive` 선례 | §5.1 |
| **DD-124** | 응답 선택 키 `speech` 이름·위치·키 순서 | **`speech?: { text: string; tone: SpeechTone }` — 메시지 단위(출력 단위 아님) · 메시지 응답은 `feedback` 뒤 마지막 키 · 폴링 응답은 `sources` 뒤 마지막 키** · 조건부 전개로만 채움(없으면 바이트 동일) · 저장 0 | 위젯은 응답 1건을 한 번에 읽는다 · 출력 단위면 캐러셀·버튼 조각 읽기가 생긴다 · `feedback` 선례 | §5.2 |
| **DD-125** | 위젯 기능 선언 조건 | **`speech-v1`(4/5 사용)** — 위젯은 공개 설정 `voice.tts === true`일 때만 싣는다 · 서버는 선언 ∧ 챗봇 듣기 켜짐 ∧ **봇 답변 반환 지점(DD-136)** 일 때만 `speech`를 붙인다 | 구버전 위젯·직접 연동 클라이언트 응답 바이트 불변 · 대화 턴 색인 조회 0(C-14) · `rich-v1` 선례 | §5.2 · §9.6 |
| **DD-126** | 출력 강등 재사용 방식 | **함수 재사용 기각 · 구조만 재사용** — API 순수 함수 `buildSpeechText(outputs)`가 `DialogOutput` 판별 유니온을 전수 분기(`never` 검사 — 새 출력 타입 추가 시 컴파일 오류) | C-7 · 강등 함수 문구를 바꾸면 비WEB 채널 출력 바이트가 바뀐다 | §6.1 |
| **DD-127** | 말투 식별자·대응표 | 닫힌 4종 **`CALM`·`BRIGHT`·`APOLOGETIC`·`INFORMATIVE`**(화면 이름 차분함·밝게·사과·안내 — ui-designer 확정) · **응답 종류 3종**(`ANSWERED`·`UNANSWERED`·`SAFETY` — H-3으로 6 → 3) · 대응표·안전 구간·발화 매개변수 계산은 **zod 무의존 서브패스 `@chat-bot/shared-types/speech-voice`**(위젯·콘솔 들어보기 공용 1벌) | NFR-VOM2 · ADR-0012 서브패스 선례 · 말투 4종은 FR-VO4-5 닫힌 목록이라 응답 종류가 줄어도 유지(`INFORMATIVE`는 기본 말투·노드 꼬리표로 계속 쓰인다) | §4.2 · §6.2 |
| **DD-128** | 말투 꼬리표의 스냅샷·환경 포함 | **노드 출력 필드가 아니라 음성 설정 행의 `nodeTones`(노드 id → 말투)** — 스냅샷·버전 해시·복원·복사·토픽 분리·승격 **밖**(환경 밖 · 저장 즉시 반영) | 응답 1건 = 말투 1개라 출력 단위 지정은 의미가 없다 · `DialogOutputSchema` 14종 변경·해시 정규화·복원 적용기 변경을 피한다 · **H-2 PM 수용** | §3.1 · §6.2 |
| **DD-129** | 음성 설정 위치 · 일별 집계 | **1:1 `ChatbotVoiceSetting`(행 없음 = 전부 꺼짐)** + **`SpeechDailyStat`(챗봇 × KST 일)** · 마이그레이션 = `CREATE TABLE` 2만 · 런타임 조회는 **전역 색인(켜진 챗봇 id 집합 · TTL 60초) + 챗봇별 캐시**(No.36 패턴 · stale-on-error) | `WebChannelConfigSchema`(strict) 롤백 위험 회피(ADR-0045 §1) · C-14 | §3 |
| **DD-130** | 출구 클래스·데이터 종류 이름 | **`EgressExitId` +`SPEECH_LOCAL`(7 → 8 · 라벨 "음성 인식(ml-worker)")** · **`EgressDataKind` +`AUDIO_RAW`** · `exits[]` 행은 `SPEECH_ENABLED ∧ SPEECH_PROVIDER=local`일 때만 · 데이터 지도 선택 키 `speech?` | C-8 · FR-VO6-1·2 | §11.2 |
| **DD-131** | 숫자 표기 정규화·전사 정리 위치 | **API 후처리**(공급자 무관 · TS 순수 함수) — ml-worker는 디코딩·VAD·STT·공백 정리만 | 공급자를 바꿔도 같은 규칙 · 단위 시험 · 규칙 목록은 ml-engineer 제공 | §7.4 |
| **DD-132** | 오류 코드 | **신규 5종**: `SPEECH_UNAVAILABLE`(503) · `SPEECH_BUSY`(503 + `Retry-After`) · `SPEECH_AUDIO_INVALID`(400) · `SPEECH_AUDIO_TOO_LARGE`(413) · `SPEECH_FAILED`(502) | 위젯 문구 분기 · 내부 정보 미노출 | §5.5 |
| **DD-133** | 첫 사용 고지 자리 | 위젯 녹음 시작 직전 **단일 호출 지점 `ensureSpeechNoticeAcknowledged()`**(1차 = 즉시 통과 — 법무 확인 전 미구현) · 공개 설정 키·서버 경로는 이번에 만들지 않는다 · **법무 확인은 고객 개통 조건(H-5 PM 결정 — OC-1·OC-2)** — 코드로 강제하지 않는다 | FR-VO1-2 · P-13 | §9.3 · §17.5 |
| **DD-134** | 서비스 모듈 구성 | **`SpeechModule`**(`apps/api/src/speech/`) — export **2개**: `SpeechTranscriptionService`(공개 인식) · `VoicePublicService`(공개 설정 `voice` · 응답 `speech` 조립). 관리 컨트롤러 `VoiceController` 1개(3 핸들러). `conversation` → `speech` 단방향 | No.35 `ProactivePublicService` 선례 · 대화 경로 DI 그래프에 인식 호출이 들어오지 않게 둘로 나눈다(VO-5) | §2.3 |
| **DD-135** | **[개정 추가 — H-10] 운영 환경 판별 · `mock` 공급자 운영 차단** | ① **운영 판별 = `NODE_ENV`(앞뒤 공백 제거) === `'production'`**(대소문자 구분 · Node 관례 · 순수 함수 `isProductionRuntime(env)` 1곳 — `apps/api/src/config/runtime-env.ts` 신설) ② **`validate()` 교차 검사 1조건**: 운영 ∧ `SPEECH_ENABLED=true` ∧ `SPEECH_PROVIDER=mock`(명시·기본값 모두) → **API 기동 실패**(`throw` — 기존 `DATA_ENCRYPTION_ENABLED` 교차 검사 선례). 비운영이면 지금처럼 기동 + 경고 1회 ③ 같은 위험의 다른 입구 — API `local` ↔ ml-worker `STT_BACKEND=mock` — 는 기동 시점에 알 수 없으므로 **운영이면 `local` 공급자의 `healthy()`가 `/speech/health`의 `backend === 'mock'`을 사용 불가로 본다**(마이크 숨김 + 경고 1회 · R-17) ④ `NODE_ENV`는 스키마 키로 추가하지 않는다(원시 값 읽기 — `EnvConfig` 타입·선택 환경변수 수 불변) | 가짜 인식 결과("모의 인식 결과입니다")가 실제 사용자에게 나가는 것을 운영에서 원천 차단(PM H-10) · 저장소에 기존 운영 판별이 없어(C-17) 가장 널리 쓰이는 관례를 채택 · 새 전용 스위치(`SPEECH_ALLOW_MOCK` 등)는 기각 — 시연·개발 `.env`에 새 키를 강요하고 PM이 지정한 "운영 환경" 기준과 어긋난다 | §7.3 · §12.1 · §12.3 |
| **DD-136** | **[개정 추가 — H-3] 읽기 대상 경계** | **`speech`는 봇 답변에만** — ① 봇 답변 = 그 질문에 대해 **챗봇 콘텐츠**가 내놓은 답: 정상 턴 출력(노드 출력·챗봇 폴백 · 엔진 기본 폴백 포함) · 외부 RAG 최종 답(`READY`)과 그 실패 시 챗봇 폴백 문구(`FAILED`) · **No.36 안전 문구 대체(입구 318 · 출구 폴링 `safetyReplaced`)** ② 시스템 안내 = **제품 코드 상수로 박힌 처리 상태 안내 3종**(입구 금지어 안내 `BANNED_WORD_GUIDANCE_TEXT` · 일시 장애 `VERSION_UNAVAILABLE_FALLBACK_TEXT` · RAG 대기 `RAG_WAITING_TEXT`) → `speech` 0 ③ 상담원 메시지(상담 `HANDLED` · G-8 전치 출력) → `speech` 0 · 읽기 글자는 `outputs.slice(전치 개수)`에서 만든다(C-16) ④ 판정 단위는 **글자가 아니라 반환 지점**(같은 문장이라도 반환 지점으로 정한다 — 문구 비교 0) | 요구사항 FR-VO3-1·J-8 원문 유지(PM H-3) · **안전 문구 대체를 봇 답변으로 보는 근거**: (a) 대체 문구는 관리자가 규칙마다 쓴 챗봇 콘텐츠다(`replacementText` 1~300자 · 금지어 검사 통과 — `ai-guardrails-설계.md` §4 202행) (b) 질문에 대한 답의 자리를 차지한다 — 엔진 답·RAG 답을 **대신해** 나가며, 처리 상태를 알리는 안내가 아니다 (c) 대화 로그에 `rawBotResponse`·`isAnswered=false`로 폴백과 같은 층위에 적재된다(같은 문서 283·316행) (d) 요구사항 FR-VO4-4·AC-VO3-8이 "안전 문구 대체 = 차분함 고정"으로 **읽기 대상임을 전제**한다 (e) 출구 대체는 폴링의 최종 답 자리(`FAILED` 출력)로 나간다 — 시스템 안내 3종은 반대로 답의 자리가 아니라 "못 받았다/기다려라"는 상태 알림이다 | §5.2 · §6.4 · §6.5 |

> **이름 규칙**: **`voice` = 제품 기능·설정**(관리 경로 `/voice` · 공개 설정 키 `voice` · 테이블 `ChatbotVoiceSetting` · 콘솔 "음성"), **`speech` = 기술 구성요소**(API 모듈 `speech/` · 포트 `SpeechRecognitionProvider` · ml-worker 역할 `speech` · 공개 경로 `/speech/transcriptions` · 응답 키 `speech` · 출구 `SPEECH_LOCAL`).

### 1.3 요구사항 환류 PM 결정 (2026-10-01) — 요약 (상세 §20)

| # | PM 결정 | 이 문서 반영 |
|---|---|---|
| H-1 | 대체 통제 수용 · 서명 토큰 1차 미도입 | C-12 · K-1 · §5.4 · 요구사항 FR-VO2-2·FR-VO6-4·AC-VO2-9·EX-VO-10·19 정정 · 요구사항 R-13 |
| H-2 | 노드 꼬리표 = 음성 설정 행(설계안) 수용 | DD-128 · 요구사항 FR-VO4-6·§5.1 정정 |
| **H-3** | **봇 답변만 읽는다** — 시스템 안내 문구(금지어 안내·일시 장애·RAG 대기)에 `speech` 0 | **DD-136** · C-4 · C-16 · §4.1 · §5.2 · §6.2 · §6.4 · §6.5 · §9.5 · §14 VO-17 · §15 · K-16 |
| H-4 | 상담 연결 안내 말투 = 봇 응답 경로에 없음 수용 | §6.2 · 요구사항 FR-VO4-4·§1.7 정정 |
| **H-5** | **고객 개통 조건에 법무 확인 포함**(U-1·U-2) · 구현은 고지 자리만 | DD-133 · **§17.5 OC-1·OC-2** |
| H-6 | 듣기 버튼 = 응답마다 1개 수용 | §9.5 · 요구사항 FR-VO3-1 정정(말풍선 → 응답) |
| H-7 | 자동 읽기 토글 노출 기본 켬 수용 | §3.1 · 요구사항 FR-VO5-1 정정 |
| H-8 | `SPEECH_PROVIDER` 잘못된 값 = API 기동 실패 수용 | §12.1 · 요구사항 NFR-VOR3 정정 |
| H-9 | `durationMs` = 녹음 길이 수용 | §5.3 · 요구사항 FR-VO2-1 정정 |
| **H-10** | **운영 ∧ 서버 스위치 켜짐 ∧ `mock` = API 기동 실패** | **DD-135** · C-17 · §7.2 · §7.3 · §12.1 · §12.3 · §15 · K-17 · OC-5 |

---

## 2. 범위

### 2.1 바뀌는 것

| 영역 | 변경 | 절 |
|---|---|---|
| `apps/ml-worker` | 역할 `speech` · `speech/` 하위 패키지(디코더·VAD·전사기·경로) · 설정 12개 · 선택 의존성 묶음 `[speech]` · 평가 도구 · 시험 | §8 |
| `apps/api/src/speech/**` | **신설 모듈**(관리 컨트롤러 1 · 3 핸들러 · 공급자 포트·구현 2 · 공개 인식 서비스 · 응답 조립 서비스 · 캐시·세마포어·집계 기록기 · 순수 lib) | §2.3 |
| `apps/api/src/conversation/**` | 공개 컨트롤러 **맨 끝 핸들러 +1**(`transcribeSpeech`) · 서비스: `getConfig` 마지막 키 `voice` · `sendMessage` **봇 답변 반환 지점 2곳** `speech` + 보류 시작 시 말투 계획 저장 · `pollMessage` `speech` · `transcribeSpeech()` 신설 · 21번째 **선택** 생성자 인자 2개(→ 22) | §5 · §6.4 |
| `apps/api/src/rag/**` | `PendingAnswerStore` 인터페이스·구현에 **선택 필드**(`create` meta `speech?` · `complete` `safetyReplaced?` · 스냅샷 반환) · `rag-answer.service.ts` REPLACE 경로 1줄 | §6.5 |
| `apps/api/src/common/rate-limit` · `conversation/guards` | 버킷 kind +`SPEECH` · 표 +1행 | §5.4 |
| `apps/api/src/common/egress/egress-registry.ts` | 출구 +1(`SPEECH_LOCAL`) | §11.2 |
| `apps/api/src/governance/**` | 지도 선택 키 `speech?` · `exits[]` 조건부 행 · 기동 검사 1조건(`egress-boot-check.ts`) | §11 |
| `apps/api/src/chatbots/chatbots.service.ts` | 영구삭제 동반 삭제 +2(34 → 36테이블) | §3.3 |
| `apps/api/src/audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.Chatbot` +`'voice'` | §11.3 |
| `apps/api/src/config/env.validation.ts` · **`config/runtime-env.ts`(신설)** | 선택 환경변수 11개(`SPEECH_FAILURE_THRESHOLD` 포함 — I-2) · **교차 검사 1조건(운영 ∧ 켜짐 ∧ `mock` = 기동 실패 — DD-135)** · 운영 판별 순수 함수 | §12.1 · §12.3 |
| `apps/api/prisma` | 모델 2 신규 + `Chatbot` 역참조 2줄 · 마이그레이션 1(`CREATE`만) | §3 |
| `packages/shared-types` | 신설 `speech.ts`(zod) · 신설 `speech-voice.ts`(zod 무의존 서브패스) · `conversation.ts`(응답 선택 키 2 · 기능 선언 상수) · `common.ts`(오류 코드 +5) · `governance.ts`(출구·데이터 종류 +1 · 지도 선택 키) · `index.ts` · `package.json`(exports +1) | §4 |
| `apps/widget` | 녹음·읽기 코어 2 · 저장 1 · UI 3 · 클라이언트 함수 1 · 기능 선언 조건부 · 앱 조립 · 스타일 | §9 |
| `apps/web` | 챗봇 설정 "음성" 구역(설정·서버 상태·노드 말투·들어보기·인식 숫자) · 데이터 지도 절 | §10.3 |
| 문서 | 이 설계서 · ADR-0052 · `voice-ai-patches.md` · (deployment-engineer) `자동배포.md` §5.8 + **개통 전 체크리스트(§17.5 전재)** · (ui-designer) `docs/03-design/voice-ai-ui-spec.md` | §21 |

### 2.2 바뀌지 않는 것 (봉인 요약 — 정적 검사는 §14)

`packages/dialogue-engine` · `packages/pii-mask`(규칙 버전 3·골든 불변) · 채널 어댑터·팩토리 · `WebChannelConfigSchema` · 공개 메시지 **요청** 스키마 · `ConversationState` 봉투 · 대화 로그 스키마·적재 경로 · 미응답 수집 · 통계 대화 수 · 버전 스냅샷 봉투·해시 · 권한 18종·역할 · `RetentionTargetKind`·`EncryptedFieldId`·`AuditTargetType` · ml-worker `/embed`·`/health`·`/augment`·`/augment/health`·`/cluster-label` 계약 · 시뮬레이터·응답 테스트 · CORS 정책 · 새 백그라운드 루프 0(`jest.isolate-env.js` 변경 0) · **시스템 안내 응답 3종(BLOCK·버전 읽기 실패·보류 RAG 시작)의 응답 바이트 — 듣기 켜진 챗봇에서도 불변(H-3)**.

### 2.3 모듈 파일 구조 (`apps/api/src/speech/`)

```
speech.module.ts                         imports: PrismaModule · ConfigModule · AuditLogsModule · ChatbotsModule(ChatbotScopeService)
                                         controllers: [VoiceController] · exports: [SpeechTranscriptionService, VoicePublicService]
voice.controller.ts                      /chatbots/:chatbotId/voice — GET(설정+서버 상태) · PUT(전체 교체) · GET /stats
admin/
  voice-settings.service.ts              ★ ChatbotVoiceSetting 쓰기 유일 · 저장 검증(노드 소속) · 감사(UPDATE Chatbot 'voice') · 캐시 무효화
  voice-overview.service.ts              설정 조회(행 없음 = 기본값) · 서버 상태 · 일별 숫자 조회(읽기 전용)
core/
  voice-settings.cache.ts                전역 색인 1단(입력∨듣기 켜진 챗봇의 설정 자체를 담아 챗봇별 캐시를 겸함 — I-1) · TTL 60초 · 저장 시 즉시 무효화 · 세대 번호 · stale-on-error(실패 시 직전 값)
  speech-availability.service.ts         SPEECH_ENABLED + 공급자 healthy() 결과 캐시(성공 30초·실패 10초 · 만료 시 직전 값 + 백그라운드 갱신) · 인식 실패 보고(NETWORK 즉시 하락 · TIMEOUT·HTTP_5XX 연속 임계 · 성공 시 0 · 세대 번호 — I-2)
  speech-concurrency.ts                  비대기 세마포어(tryAcquire → release 함수 | null)
  speech-stat.writer.ts                  ★ SpeechDailyStat 쓰기 유일(upsert + increment · P2002 1회 재시도 · fire-and-forget · 실패는 경고 로그)
providers/
  speech-recognition-provider.port.ts    포트(Nest·Prisma 무의존 — 파일 이동만으로 승격 가능)
  speech-recognition-provider.factory.ts 교체 지점 1곳(mock | local) — 설정 오류·운영 mock은 기동 시 env 검증이 막는다(DD-135)
  mock-speech-recognition.provider.ts    결정적 결과(§7.3) — 네트워크 0
  local-speech-recognition.provider.ts   ★ 출구 SPEECH_LOCAL — assertEgressAllowed → fetch(raw bytes) · 리다이렉트 비추적
public/
  speech-transcription.service.ts        공개 인식 처리 순서(§5.3) — export
reply/
  voice-public.service.ts                공개 설정 voice 조립 · 응답 speech 계획(plan)·조립(build) — export
lib/                                     순수 — DB·Nest·시계 무의존
  read-bounded-body.ts                   요청 스트림 상한 읽기(바이트 상한 · 시간 상한 · 초과 즉시 중단)
  speech-text.ts                         출력 → 읽기용 글자(§6.1)
  speech-tone.ts                         응답 종류 + 설정 → 말투(§6.2)
  korean-digits.ts                       한글 숫자열 → 아라비아 숫자(§7.4)
  transcript-cleanup.ts                  공백·반복·상투 문장(§7.4)
  voice-settings-codec.ts                행 ↔ DTO(JSON 컬럼 안전 파싱 — 불량이면 해당 항목 기본값)
  speech-sealing.spec.ts                 §14 VO-1~VO-17(서버·공유 부분)
```

### 2.4 모듈 의존 방향

```
conversation → speech(SpeechTranscriptionService · VoicePublicService — export 2개뿐)
speech → chatbots(ChatbotScopeService) · audit-logs · prisma · config · common/egress
governance → Prisma 읽기(chatbotVoiceSetting count)·config — speech 모듈 import 0
rag → speech 0 (PendingAnswerStore는 계획 객체를 불투명 값으로 보관할 뿐)
engine · 채널 어댑터 · pii-mask → speech 심볼 0
```

- `speech`는 `conversation`을 import하지 않는다 — 슬러그 판정(`PublicAccessService.resolve`)은 `conversation`이 하고 챗봇 행을 넘긴다(No.35 선례 · 순환 없음).
- `VoicePublicService`는 공급자·세마포어·집계 기록기를 **주입받지 않는다** — 대화 턴 DI 그래프에 인식 호출 경로가 없다(VO-5).

### 2.5 실행 흐름

```
■ API 기동  ConfigModule validate()
  … 기존 검사 … → [DD-135] isProductionRuntime(env) ∧ SPEECH_ENABLED ∧ SPEECH_PROVIDER=mock → throw(기동 실패)
                  비운영 ∧ SPEECH_ENABLED ∧ mock → console.warn 1회("실제 인식 아님")

■ 위젯 열기  GET /public/chatbots/:slug/config
  가드(ip) → Origin → access.resolve → 기존 8키 조립 → (선택) proactive
  → VoicePublicService.buildConfigVoice(chatbotId)
       전역 색인에 없음 → undefined(쿼리 0) · 있음 → 챗봇 설정(캐시)
       input = inputEnabled ∧ SPEECH_ENABLED ∧ availability.isAvailable()(캐시)
       tts = ttsEnabled · 둘 다 거짓 → undefined
  → { ...기존 8키, (proactive), (voice) }   ← voice는 항상 마지막 키

■ 음성 질문  위젯: 마이크 → (고지 자리 — 1차 통과) → getUserMedia → MediaRecorder(≤30초)
  → POST /public/chatbots/:slug/speech/transcriptions   본문=녹음 바이트 · x-cb-session-id
     가드(sp-ip + sp-key:session) → Origin → 핸들러(§5.3 순서)
        SPEECH_ENABLED? → 세션 헤더 형식 → Content-Type·Content-Length 사전 검사(본문 안 읽음)
        → access.resolve(실패 = 503 UNAVAILABLE) → 챗봇 inputEnabled → availability
        → 본문 상한 읽기(1MB · 15초) → API 세마포어(초과 = 503 BUSY)
        → provider.transcribe(bytes) ── local: POST {ML_WORKER_SPEECH_URL}/speech/transcribe (원시 바이트)
              ml-worker(speech 역할): 상한 읽기 → 세마포어 → PyAV 메모리 디코딩(16kHz mono) → VAD
                                     → 말소리 없음 = empty · 있음 = STT(ko 고정) → { modelId, text, durationMs, empty }
        → API 후처리(정리·반복·상투 문장·한글 숫자) → 버퍼 참조 해제 → 일별 숫자 +1(응답 대기 0)
     ← { text, durationMs, empty? }
  위젯: 입력창에 채움(기존 글자 뒤에 붙임) · 포커스 → 사용자가 확인·수정 후 전송
  → 기존 POST …/messages (요청 바이트 = 지금과 같음 · features에 speech-v1은 듣기 켜진 챗봇에서만)

■ 답변 듣기  기존 대화 처리(변경 0) → 봇 답변 반환 직전 VoicePublicService.build(plan, kind, botOutputs, nodeId)
  → 응답 마지막 키 speech: { text, tone }
     봇 답변 = 정상 턴(ANSWERED/UNANSWERED) · 입구 안전 문구 대체(SAFETY)
     시스템 안내(금지어 안내 · 일시 장애 · RAG 대기)·상담 HANDLED → speech 없음(H-3)
     보류 RAG: POST 대기 응답엔 speech 없음(계획만 보류 저장소에) · 폴링 READY/FAILED에 최종 speech
  위젯: "듣기" 또는 자동 읽기(사용자가 켰을 때) → speechSynthesis(기기 안 ko 음성 · 대응표 rate/pitch/volume) — 서버 호출 0
```

### 2.6 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + `2026100100xxxx_voice_ai` | 모델 2(파일 끝) · `Chatbot` 역참조 2줄(DB 변화 0) | §3 |
| `conversation/public-conversation.controller.ts` | **맨 끝** `@Post('speech/transcriptions') @Public() @HttpCode(200) @Header('Cache-Control','no-store') @PublicRateBucket({ kind:'SPEECH', key:{ from:'header', name: SPEECH_SESSION_HEADER, ns:'session' }, perKeyLimit:{ env:'PUBLIC_SPEECH_RATE_LIMIT_SESSION_PER_MIN', fallback:10 } }) transcribeSpeech(@Param('slug'), @Headers(SPEECH_SESSION_HEADER), @Headers('content-type'), @Headers('content-length'), @Req() req)` · `getConfig` 반환 타입 → `PublicChatbotConfigResponse` · 클래스 주석 "9곳" → "10곳" | §5 |
| `conversation/public-conversation.service.ts` | `getConfig`: 두 반환 지점 모두 끝에 `...(voice ? { voice } : {})` · `sendMessage`: 진입 직후 `const speechPlan = await this.voicePublic?.plan(chatbot.id, dto.features)`(선언 없으면 동기 `undefined`) · **봇 답변 반환 2곳(입구 안전 문구 대체 · 정상)에만 `withSpeech()`** — 읽기 입력은 `outputs.slice(handoffPrependOutputs.length)`(C-16) · **BLOCK·버전 읽기 실패·보류 시작 반환문은 손대지 않는다(H-3)** · 보류 시작 시 `pendingStore.create(…, { …, speech: speechPlan })`(계획만 · 응답에는 `speech` 없음) · `pollMessage`: `speech` 조립 · `transcribeSpeech(slug, input)` 신설 · 21·22번째 **선택** 생성자 인자 `voicePublic?`·`speechTranscription?` | §5 · §6.4 · DD-136 |
| `conversation/conversation.module.ts` | imports +`SpeechModule` | §2.4 |
| `rag/pending-answer.store.ts` | `create(id, meta & { speech?: SpeechReplyPlan })` · `complete(id, result & { safetyReplaced?: true })` · `get()` 스냅샷에 두 선택 필드 · 구현 `StoredEntry` +2 필드 | §6.5 |
| `rag/rag-answer.service.ts` | REPLACE 분기의 `finishAsFallback` → `complete({ status:'FAILED', outputs, ...(override?.safety ? { safetyReplaced: true } : {}) })`(`override`에 `safety` 표식 1개 추가 — 출구 `FALLBACK` 판정은 표식 없음) | C-6 |
| `common/rate-limit/public-rate-bucket.decorator.ts` | `kind` +`'SPEECH'` | §5.4 |
| `conversation/guards/public-rate-limit.guard.ts` | `BUCKET_SPEC_BY_KIND` +`SPEECH: { ipPrefix:'sp-ip', keyPrefix:'sp-key', ipLimitEnv:'PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN', ipLimitFallback:30 }` — 기존 4행 바이트 불변 | §5.4 |
| `common/egress/egress-registry.ts` | `{ exitId:'SPEECH_LOCAL', files:['speech/providers/local-speech-recognition.provider.ts'], dataKind:'AUDIO_RAW', masked:'NO', label:'음성 인식(ml-worker)' }` | §11.2 |
| `governance/governance-map.service.ts` | `urlByExit.SPEECH_LOCAL` · `exits` 필터에 "`SPEECH_LOCAL`은 켜졌을 때만" · 선택 키 `speech?` 조립 | §11.2 |
| `governance/bootstrap/lib/egress-boot-check.ts` · `governance-bootstrap.service.ts` | 입력 +`speechEnabled`·`speechProvider`·`speechLocalBaseUrl` · 모드 ON ∧ 켜짐 ∧ `local`이면 호스트 허용 목록 검사 1조건 | §11.2 |
| `chatbots/chatbots.service.ts` | 영구삭제 트랜잭션 `speechDailyStat`·`chatbotVoiceSetting` `deleteMany` 2줄(`chatbot.delete` 직전 · 사전검사 409 대상 아님) | §3.3 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.Chatbot` +`'voice'` | §11.3 |
| `config/env.validation.ts` | §12.1의 11개 · **교차 검사 1조건(DD-135 ② — 운영 ∧ `SPEECH_ENABLED` ∧ `mock` → `throw`)** · 비운영 ∧ 켜짐 ∧ `mock` → `console.warn` 1회 | §12 |
| **`config/runtime-env.ts`(신설)** | `isProductionRuntime(env: Record<string, unknown>): boolean` = `String(env.NODE_ENV ?? '').trim() === 'production'` — **운영 판별의 유일한 정의**(`validate()`·`SpeechAvailabilityService`가 공용) | DD-135 |
| `app.module.ts` | imports 끝 `SpeechModule` | — |
| `apps/widget/src/*` · `apps/web/src/*` | §9 · §10.3 | — |
| `apps/ml-worker/src/ml_worker/{config.py, app.py}` + `speech/**` · `pyproject.toml` · 잠금 파일 · `.env.example` | §8 | — |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**` · `packages/pii-mask/**` · `apps/api/src/conversation/adapters/**` · `packages/shared-types/src/channel.ts` · `rich-degrade.ts` · `conversation-log.service.ts` · `learning/**`(미응답 수집) · `versions/**` · `environment/**` · `handoff/**` · `simulation/**` · `banned-words/**` · `apps/ml-worker`의 `embedder.py`·`generator.py`·`backend_guard.py`.

### 2.7 커밋 분리 단위

| 커밋 | 범위 | 게이트 |
|---|---|---|
| **① 계약·순수 함수(관측 불변)** | shared-types `speech.ts`·`speech-voice.ts`(+ 서브패스·단위 시험) · `conversation.ts` 선택 키·상수 · `common.ts` 오류 코드 · `governance.ts` · **도입 전 공개 설정·메시지·폴링 응답 본문 골든 캡처**(seed 챗봇 — 서버 코드 변경 전 · **BLOCK·버전 읽기 실패·보류 시작 응답 포함**) | 기존 시험 무수정 통과(X 목록 0건) |
| **② ml-worker `speech` 역할** | §8 전부 · 선택 의존성 · 시험(가짜 전사기·합성 오디오) · 평가 도구 | 기존 pytest 무수정 · `embed` 역할 계약 바이트 동일 |
| **③ API** | 마이그레이션·모듈·공개 경로·응답 키·관리 API·거버넌스·버킷·환경변수(+ 운영 mock 교차 검사)·영구삭제 +2·감사 화이트리스트·봉인 | **X-1~X-12 전부 이 커밋** · ①의 골든으로 음성 꺼짐 바이트 동일 + **듣기 켜짐 ∧ `speech-v1` 선언에서도 시스템 안내 3종 바이트 동일** 확인 |
| **④ 위젯** | §9 · 번들 크기 기록 | 기대값 변경 0 · gzip 증가 ≤7KB(PM 2026-10-01 상향 — 원안 5KB · 실측 +6.17KB · §9.7) |
| **⑤ 콘솔·문서** | 음성 구역 · 데이터 지도 절 · 운영 문서(개통 전 체크리스트 포함) · ui-spec 반영 | 기대값 변경 0 |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안 (파일 끝에 추가 · 기존 모델은 역참조만)

```prisma
// model Chatbot { ... } 안 — 역참조만(DB 컬럼 변화 0)
  /// [신규 No.32] 음성 설정·인식 일별 숫자(환경 밖 · 스냅샷·복사·토픽 분리·승격 대상 아님 · 영구삭제 동반 삭제). 컬럼 추가 0.
  voiceSetting       ChatbotVoiceSetting?
  speechDailyStats   SpeechDailyStat[]

/// [신규 No.32] 챗봇별 음성 설정(1:1 · 행 없음 = 전부 꺼짐 — ADR-0052 §5). 환경 밖(저장 즉시 반영 · 캐시 TTL 안 반영).
/// ★ 쓰기 = speech/admin/voice-settings.service.ts 1파일(+ chatbots.service.ts 동반 삭제) — VO-7.
model ChatbotVoiceSetting {
  chatbotId              String   @id
  chatbot                Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// 음성 입력(마이크) — 서버 스위치 SPEECH_ENABLED와 AND
  inputEnabled           Boolean  @default(false)
  /// 답변 듣기(브라우저 기기 음성) — 서버 스위치와 무관
  ttsEnabled             Boolean  @default(false)
  /// 위젯 "답변 소리로 듣기" 토글 노출 여부(토글 자체는 사용자가 켬 · 기본 꺼짐 — P-8). R-10 · H-7 PM 수용
  autoReadToggleVisible  Boolean  @default(true)
  /// 빠르기 배율 0.8~1.2(0.05 단위)
  rateMultiplier         Float    @default(1.0)
  /// 'CALM'|'BRIGHT'|'APOLOGETIC'|'INFORMATIVE' — 답한 턴(ANSWERED)의 기본 말투
  defaultTone            String   @default("CALM")
  /// JSON { UNANSWERED? } — 키 없음 = 내장 기본값(APOLOGETIC). H-3으로 지정 가능 종류는 UNANSWERED 1개(SAFETY는 고정).
  /// JSON 객체로 두는 이유: 읽기 대상 종류가 다시 늘 때(§22 재검토 트리거) 마이그레이션 없이 키만 더한다 — 허용 키는 zod strict가 통제.
  toneByKind             String   @default("{}")
  /// JSON [{ nodeId, tone }] ≤ 200 — 노드별 말투 꼬리표(DD-128 · FK 없음 · 없는 노드는 런타임에 무시)
  nodeTones              String   @default("[]")
  /// 마지막 변경자(FK 없음 — 사실 기록)
  updatedById            String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@map("chatbot_voice_settings")
}

/// [신규 No.32] 챗봇 × KST 일 음성 인식 숫자(P-15). ★ 오디오·글자·세션·IP·시각 원본 컬럼 없음(VO-8).
/// ★ 쓰기 = speech/core/speech-stat.writer.ts 1파일(+ 동반 삭제). 읽기 재생 수는 없다(FR-VO3-9).
model SpeechDailyStat {
  id         String   @id @default(uuid())
  chatbotId  String
  chatbot    Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// KST 'YYYY-MM-DD'(toKstDayBucket)
  dayBucket  String
  ok         Int      @default(0)
  empty      Int      @default(0)
  invalid    Int      @default(0)
  failed     Int      @default(0)
  busy       Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([chatbotId, dayBucket])
  @@map("speech_daily_stats")
}
```

- 요청 수 = 다섯 칸의 합(저장하지 않는다 — 합과 어긋날 여지를 없앤다). 집계 대상은 **챗봇 판정과 입력 켜짐 확인이 끝난 요청**뿐이다(꺼짐·없는 슬러그·서버 스위치 꺼짐은 세지 않는다 — 존재 탐지·스팸으로 행이 늘지 않게).
- 요구사항 §5.1의 종류 이름(`STT_OK`·`STT_EMPTY`·`STT_FAILED`·`STT_BUSY`)은 컬럼 `ok`·`empty`·`failed`·`busy`로, 형식·크기 거절은 **`invalid`** 로 분리했다(실패와 사용자 환경 문제를 구분 — §19 R-13).
- **H-3 개정은 마이그레이션에 영향이 없다** — 아직 적용 전 설계이고, `toneByKind`는 같은 JSON 컬럼에 허용 키만 줄었다(컬럼·기본값 불변).

### 3.2 마이그레이션 (1개 — `2026100100xxxx_voice_ai`, 번호는 생성 시점)

- `CREATE TABLE` 2 + `CREATE UNIQUE INDEX` 1 + FK 2(→ `chatbots`). **`ALTER TABLE`·`DROP`·기존 테이블 재정의 0.** **[구현 — I-9] 실제 마이그레이션 `20261001120000_voice_ai`는 `migrate dev` 생성 SQL을 쓰지 않고 CREATE TABLE 2 + CREATE UNIQUE INDEX 1(FK는 테이블 정의 안)만 직접 작성했다** — 원시 부분 인덱스에 대한 `DROP INDEX` 생성 위험을 원천 배제.
- ★ **원시 부분 유니크 인덱스 4개 보존**: `prisma migrate dev --create-only`로 만든 SQL을 반드시 열어 본다. schema.prisma에 표현되지 않는 기존 원시 부분 인덱스에 대해 Prisma가 `DROP INDEX`를 생성했으면 **그 줄을 지우고** 적용한다. 적용 뒤 `rich-message-sealing.spec.ts` RM-12(적용 DB 부분 인덱스 = 4)가 무수정 통과해야 한다. 통합 시험 DB는 `prisma migrate deploy`로 만든다(`db push`는 부분 인덱스를 만들지 않는다 — CLAUDE.md).
- 백필 0 · seed 변경 0(데모 챗봇 음성 켜기는 시연 하네스·수동으로 — 기본 seed가 마이크 권한 요청을 띄우지 않게).
- 롤백 = 두 테이블 DROP. 구버전 서버는 두 테이블을 모르므로 **남아 있어도 동작 영향 0**(WEB 설정·Origin 가드 무영향 — ADR-0045 §1과 같은 이득).

### 3.3 기존 데이터 호환성

| 대상 | 영향 |
|---|---|
| `channels.config`(WEB) | 0 |
| `chatbots` | 컬럼 0 · 영구삭제 동반 삭제 **34 → 36테이블**(X-11) |
| `conversation_logs` | 0 — 인식 요청은 로그를 만들지 않고, 전송된 인식 글자는 평범한 사용자 메시지다(구분 표시 0 — P-15) |
| 버전 스냅샷 · `contentHash` | 0 — 음성 설정·노드 말투는 스냅샷 밖(AC-VO3-11 자동 충족) |
| 감사 로그 | 새 `targetType` 0 · `UPDATE Chatbot`의 화이트리스트 필드 +`voice` |
| 대화 노드 · 출력 스키마 | 0(DD-128) |

---

## 4. shared-types 계약

### 4.1 `packages/shared-types/src/speech.ts` (zod — 서버·콘솔 공용)

| 심볼 | 내용 |
|---|---|
| `SPEECH_LIMITS` | `maxRecordSeconds 30` · `uploadDeadlineMs 15000` · `transcriptMaxChars 2000` · `speechTextMaxChars 2000` · `speechTextTail '나머지는 화면에서 확인해 주세요.'` · `nodeTonesMax 200` · `rateMultiplier { min 0.8, max 1.2, step 0.05 }` · `statsRangeDaysMax 90` · `statsRangeDaysDefault 7` · `voicesWaitMs 2000` · `previewTextMax 200` |
| `SPEECH_SESSION_HEADER` | `= HANDOFF_SESSION_HEADER`(`'x-cb-session-id'` — 같은 값의 별칭. 새 헤더 이름을 만들지 않는다 → CORS·프록시 설정 변경 0) |
| `SpeechResponseKind` | **`z.enum(['ANSWERED','UNANSWERED','SAFETY'])`** — 읽기 대상 봇 답변 종류 3종(H-3 · DD-136). 시스템 안내·상담 응답은 종류 자체가 없다(= `speech` 없음) |
| `VoiceToneByKindSchema` | **`z.object({ UNANSWERED: SpeechToneSchema.optional() }).strict()`** — `ANSWERED`(= `defaultTone`)·`SAFETY`(고정)는 지정 불가 · 모르는 키(예전 초안의 `BLOCKED`·`ERROR`)는 저장 거부 `400 VALIDATION_FAILED` |
| `VoiceNodeToneSchema` | `{ nodeId: uuid, tone: SpeechToneSchema }` `.strict()` |
| `VoiceSettingsInputSchema` | `.strict()` — `inputEnabled` · `ttsEnabled` · `autoReadToggleVisible` · `rateMultiplier`(0.8~1.2 · 0.05 배수) · `defaultTone` · `toneByKind` · `nodeTones`(0~200 · `nodeId` 유일). **전체 교체**(부분 병합 금지 — 채널 설정 선례) |
| `VoiceSettingsViewSchema` | 입력 필드 전부 + `nodeTones[].nodeName`(조회 시점 초안 이름 · 없는 노드는 `nodeMissing: true`) · `updatedAt`(행 없음 = `null`) |
| `VoiceServerStatusSchema` | `{ enabled: boolean, provider: 'mock'｜'local', inputAvailable: boolean, reason?: 'SERVER_DISABLED'｜'PROVIDER_UNAVAILABLE'｜'NOT_CONFIGURED' }` — **모델 이름·장치·주소는 싣지 않는다**(관리자에게도 — 운영 정보는 ml-worker `/speech/health`와 운영 문서). 운영에서 ml-worker 백엔드가 `mock`이라 사용 불가인 경우도 `PROVIDER_UNAVAILABLE`로 수렴(DD-135 ③ — 이유 세분은 서버 경고 로그) |
| `VoiceOverviewResponseSchema` | `{ settings: VoiceSettingsView, server: VoiceServerStatus, context: { webChannelEnabled, chatbotStatus }, limits: { nodeTonesMax } }` |
| `VoiceStatsQuerySchema` / `VoiceStatsResponseSchema` | 쿼리 `from?`·`to?`(KST · 기본 최근 7일 · ≤90일) · 응답 `{ from, to, totals: { requested, ok, empty, invalid, failed, busy }, daily: [{ day, requested, ok, empty, invalid, failed, busy }] }`(0인 날 채움) |
| `PublicVoiceConfigSchema` | `z.object({ input: z.boolean(), tts: z.boolean(), autoReadToggle: z.boolean(), rate: z.number() }).strict()` — **키 순서가 계약**(직렬화 순서 = 조립 순서) |
| `PublicChatbotConfigResponseSchema` | `PublicChatbotConfigWithProactiveSchema.extend({ voice: PublicVoiceConfigSchema.optional() })` — **기존 두 스키마는 수정하지 않는다**(No.35 선례) |
| `PublicSpeechTranscriptionResponseSchema` | `z.object({ text: z.string().max(2000), durationMs: z.number().int().nonnegative(), empty: z.literal(true).optional() }).strict()` — 말소리 없음 = `text: ''` + `empty: true` · **`durationMs` = 디코딩된 녹음 길이(ms)이며 처리 시간이 아니다**(H-9 PM 수용) |
| `SpeechReplyPlan`(타입만 · 서버 전용) | **`{ answeredTone, unansweredTone, nodeTones: ReadonlyMap<string, SpeechTone> }`** — 대화 턴 1회 계획(§6.4 · H-3으로 `blockedTone`·`errorTone` 삭제) |

### 4.2 `packages/shared-types/src/speech-voice.ts` (**zod 무의존 서브패스 `./speech-voice`** — 위젯·콘솔·서버 공용 1벌)

`package.json` `exports`에 `"./speech-voice": { "types": "./dist/speech-voice.d.ts", "default": "./dist/speech-voice.js" }`. 이 파일은 **다른 shared-types 파일을 import하지 않는다**(`output-view`·`contrast`·`proactive-eval` 선례 — VO-11). 위젯 `vite.config.ts` `optimizeDeps.include` +서브패스.

| 심볼 | 규격 |
|---|---|
| `SPEECH_TONES` | `['CALM','BRIGHT','APOLOGETIC','INFORMATIVE'] as const` · `type SpeechTone` |
| `SPEECH_TONE_PARAMS` | `Record<SpeechTone, { rate, pitch, volume }>` — 초안 `CALM {0.95,0.95,1.0}` · `BRIGHT {1.05,1.1,1.0}` · `APOLOGETIC {0.9,0.9,0.9}` · `INFORMATIVE {1.0,1.0,1.0}`(**ui-designer가 실제 기기 청취 후 값 확정** · 코드 분기 아님 — NFR-VOM2) |
| `SPEECH_PARAM_BOUNDS` | `rate [0.7, 1.3]` · `pitch [0.8, 1.2]` · `volume [0.8, 1.0]` |
| `computeUtteranceParams(tone, rateMultiplier)` | `rate = clamp(table.rate × clamp(rateMultiplier, 0.8, 1.2))` · pitch·volume clamp · 모르는 말투 → `CALM`(방어) |
| `isLocalKoreanVoice(v)` | `typeof v.lang === 'string' && v.lang.toLowerCase().startsWith('ko') && v.localService === true` — **`localService`가 `true`가 아닌 값(누락·`undefined` 포함)은 전부 제외**(판별 불확실 = 쓰지 않음 — FR-VO6-8) |
| `selectLocalKoreanVoice(voices)` | 조건 만족 중 `default === true` → 없으면 첫 번째 → 없으면 `null` |
| `splitForSpeech(text, maxChunk = 200)` | 문장 경계(`. ? ! 。 …` · 줄바꿈)로 나누고, 200자 초과 조각은 쉼표·공백에서 다시 자른다(공백 없으면 강제 절단) · 빈 조각 제거 |

### 4.3 기존 파일 수정

| 파일 | 변경 |
|---|---|
| `conversation.ts` | `WIDGET_FEATURE_SPEECH_V1 = 'speech-v1'` · `PublicSpeechReplySchema = z.object({ text: z.string().min(1).max(2100), tone: z.enum(SPEECH_TONES) })`(`speech-voice.ts`에서 상수 import — zod 무의존 파일 → zod 파일 방향만) · `PublicMessageResponseSchema` **맨 끝** `speech: PublicSpeechReplySchema.optional()` · `PendingAnswerPollResponseSchema` **맨 끝** 같은 키 |
| `common.ts` | `ApiErrorCode` +`SPEECH_UNAVAILABLE`·`SPEECH_BUSY`·`SPEECH_AUDIO_INVALID`·`SPEECH_AUDIO_TOO_LARGE`·`SPEECH_FAILED`(주석 "음성 AI(No.32) 그룹 추가 — 5종") |
| `governance.ts` | `EgressExitId` +`'SPEECH_LOCAL'` · `EgressDataKind` +`'AUDIO_RAW'` · `GovernanceMapResponseSchema` 선택 키 `speech?`(§11.2) |
| `index.ts` | export `speech`(※ `speech-voice`는 index에서도 재수출하되 위젯은 서브패스로만 import) · **[구현 — I-5] api는 서브패스(`@chat-bot/shared-types/speech-voice`)를 직접 import하지 않고 루트 index 재수출만 쓴다**(서브패스는 위젯·콘솔 전용 — api의 모듈 해석 경로를 늘리지 않는다) |

---

## 5. 공개 표면

### 5.1 공개 설정 `voice` 키 (`GET /public/chatbots/:slug/config`)

- **위치**: 응답의 **마지막 키**. 쿼리 없음 = `{ 기존 8키, voice? }` · `?proactive=1` = `{ 기존 8키, proactive, voice? }`. 선제 경로도 같은 객체를 쓴다(설정의 진실 1벌 — R-12).
- **값**: `{ input, tts, autoReadToggle, rate }` — `autoReadToggle = ttsEnabled ∧ autoReadToggleVisible` · `rate = rateMultiplier`(0.8~1.2).
- **키 없음 조건**: 전역 색인에 없음(행 없음·둘 다 꺼짐) 또는 계산 결과 `input`·`tts` 모두 거짓. → **음성 설정이 없는 챗봇은 바이트 동일 · 추가 쿼리 0**(색인 캐시 적중 시).
- **`input` 상태 판단**(DD-123): `inputEnabled ∧ SPEECH_ENABLED ∧ SpeechAvailabilityService.isAvailable()`.
  - `mock` 공급자 = 항상 사용 가능(**비운영에서만 기동된다** — 운영 ∧ 켜짐 ∧ `mock`은 기동 실패 · DD-135). `local` = `healthy()`(→ ml-worker `GET /speech/health` · 3초 제한) 결과를 **성공 30초·실패 10초**(`SPEECH_HEALTH_CACHE_MS` — 실패는 그 1/3) 캐시한다.
  - 캐시 만료 시: **직전 값을 즉시 돌려주고** 백그라운드로 1회 갱신(동시 갱신 1개 — in-flight 공유). 프로세스가 아직 값을 한 번도 갖지 못했으면 **최대 1초 기다려** 결과를 쓰고, 1초 안에 못 받으면 `false`(설정 조회 지연 상한 1초 · 음성 입력 켜진 챗봇만).
  - **[구현 반영 — I-2 · 코드 리뷰 M-3] 인식 요청 결과에 따른 가용성 하락**: `FAILED(NETWORK)`는 캐시를 즉시 `false`로 바꾼다. `FAILED(TIMEOUT｜HTTP_5XX)`는 **연속 `SPEECH_FAILURE_THRESHOLD`회(기본 3 · 1~20)에 이르렀을 때만** `false`로 바꾸고, 그 전에는 `healthy()` 재확인만 요청한다(느린 한 건이 모든 챗봇의 마이크를 숨기지 않게). 인식 성공(`OK`·`EMPTY`)은 연속 계수를 0으로 되돌린다. 하락 시 **세대 번호**를 올려, 하락 전에 시작된 상태 갱신의 결과가 캐시를 `true`로 되돌리지 못하게 한다(경합 방어). 그 밖의 원인(`INVALID_RESPONSE`·`EGRESS_BLOCKED`·`NOT_CONFIGURED`)은 가용성에 영향이 없다. → **다음 설정 조회부터 마이크 숨김**(EX-VO-12) — **위젯은 설정을 페이지당 1회(첫 열기)만 조회하므로 실제 반영은 새로고침 뒤**이고, 그 전까지 위젯은 `503 SPEECH_UNAVAILABLE`을 재시도 가능한 실패로 다룬다(§9.3 · I-11).
- **헤더**: `Cache-Control: no-store` 그대로(캐시 없음 — No.35 §5.5).

### 5.2 응답 선택 키 `speech` (메시지 · 보류 답변 폴링)

| 항목 | 결정 |
|---|---|
| 이름·모양 | `speech: { text: string; tone: SpeechTone }` (DD-124) |
| 단위 | **메시지(응답) 단위** — 응답 1건 = 읽기 1건. 출력 단위 지정은 하지 않는다 |
| 위치 | 메시지 응답: `messageId, outputs, state, stateReset, pendingAnswer?, handoff?, feedback?, **speech?**` · 폴링 응답: `status, outputs?, sources?, **speech?**` — **항상 마지막 키** · 조건부 전개(`...(speech ? { speech } : {})`)로만 채운다 |
| 붙는 조건 | ① 요청 `features`에 `speech-v1` ② 챗봇 `ttsEnabled` ③ **봇 답변 반환 지점**(DD-136 — 메시지: 입구 안전 문구 대체 · 정상 턴 / 폴링: `READY` · `FAILED`) ④ 봇 출력(전치 상담원 메시지 제외)에서 만든 읽기용 글자가 빈 문자열이 아님. **하나라도 아니면 키 없음 = 바이트 동일** |
| 붙지 않는 응답(H-3 · J-8) | 입구 금지어 안내(BLOCK) · 일시 장애(버전 읽기 실패 고정 문구) · **보류 RAG 시작 응답(대기 문구)** · 상담 `HANDLED` · 폴링 `PENDING`·만료(404) — **듣기 켜짐 ∧ `speech-v1` 선언이어도 응답 바이트가 듣기 꺼짐과 같다** |
| 채널 | 공개 경로 = WEB 위젯뿐(다른 채널 실연동 0) — 시뮬레이터·응답 테스트·다른 채널 경로에는 붙지 않는다(J-11) |
| 저장 | **0** — 대화 로그 `record()` 인자·보류 저장소 결과·감사·스냅샷 어디에도 `speech` 글자를 넣지 않는다(보류 저장소에는 **말투 계획**만 — 글자 아님) |

### 5.3 공개 인식 엔드포인트 — `POST /public/chatbots/:slug/speech/transcriptions`

**요청**: 본문 = 녹음 바이트 그대로 · `Content-Type`: `audio/*`(예: `audio/webm;codecs=opus`·`audio/mp4`·`audio/ogg`) 또는 `application/octet-stream` · 헤더 `x-cb-session-id: <UUID>`. 쿼리·JSON 본문 없음. **세션 헤더는 형식(UUID)만 검사하고 챗봇과의 결합은 검증하지 않는다**(C-12 · H-1 PM 수용 — 대체 통제는 §5.4·K-1).

**응답 200**: `{ text, durationMs, empty? }` · `Cache-Control: no-store`. `durationMs` = **디코딩된 녹음 길이**(처리 시간 아님 — H-9). 모델 이름·장치·처리 시간·VAD 구간을 싣지 않는다(NFR-VOS4).

**처리 순서**(`PublicConversationService.transcribeSpeech` → `SpeechTranscriptionService.transcribe`) — **앞 단계에서 끝날수록 비용이 작다**:

| # | 단계 | 실패 시 | 집계 |
|---|---|---|---|
| 0 | 가드: `sp-ip`·`sp-key:session` → Origin(`ORIGIN_NOT_ALLOWED` 403 — 기존 규약 · **공통 `PublicOriginGuard`가 슬러그로 챗봇·WEB 채널을 조회(최대 2쿼리)** — 없는 슬러그·채널 없음은 통과시키고 핸들러가 503으로 낸다 · I-3) | 429 · 403 | — |
| 1 | `speechTranscription` 미주입 또는 `SPEECH_ENABLED=false` | `503 SPEECH_UNAVAILABLE`(**음성 쪽 DB 조회 0** — 0단계 공통 Origin 가드의 챗봇·채널 조회 최대 2건은 이미 일어난 뒤다 · I-3) | — |
| 2 | 세션 헤더 없음·UUID 아님 | `400 VALIDATION_FAILED` | — |
| 3 | `Content-Type`이 `audio/`로 시작하지 않고 `application/octet-stream`도 아님 | `400 SPEECH_AUDIO_INVALID`(본문 안 읽음) | — |
| 4 | `Content-Length`가 있고 > `SPEECH_MAX_AUDIO_BYTES` | `413 SPEECH_AUDIO_TOO_LARGE`(본문 안 읽음) | — |
| 5 | `access.resolve(slug)` — 없음·비공개·WEB 꺼짐 | **`503 SPEECH_UNAVAILABLE`로 통일**(404/403을 내지 않는다 — R-8 · 단 Origin이 허용 목록 밖이면 0단계 가드가 존재하는 슬러그에만 `403`을 내므로 존재·부재 슬러그의 응답이 다를 수 있다 — 기존 공개 API 전체 동작 · 가드 순서는 바꾸지 않는다 · K-14 · I-3) | — |
| 6 | 음성 설정(캐시) `inputEnabled=false` | `503 SPEECH_UNAVAILABLE` | — |
| 7 | `availability.isAvailable()` 거짓 | `503 SPEECH_UNAVAILABLE` | — |
| 8 | `readBoundedBody(req, max, 15초)` — 초과 즉시 읽기 중단·연결 닫음 · 0바이트 | 413 `TOO_LARGE` · 400 `AUDIO_INVALID` | `invalid` |
| 9 | API 세마포어 `tryAcquire()` | `503 SPEECH_BUSY` + `Retry-After: 2` | `busy` |
| 10 | `provider.transcribe({ audio, contentType, language:'ko' }, { timeoutMs })` — 예외를 던지지 않는다 | 결과별(§7.1) | 결과별 |
| 11 | 후처리(§7.4) — 정리 후 빈 글자면 `empty` | — | `ok`/`empty` |
| 12 | `finally`: 세마포어 반환 · 오디오 버퍼 지역 변수 해제(클로저·캐시·로그에 남기지 않음) · 집계 기록(응답 대기 0) | — | — |

- **로그**: 단계 코드·바이트 수·지속 시간·결과 코드만. **오디오 바이트·인식 글자·세션 id 전체·Content-Type 원문 0**(VO-4 — 세션은 앞 8자 이하 허용 금지, 아예 싣지 않는다).
- **인식 결과 금지어·가림 0**(FR-VO2-9): 사용자 본인에게만 돌려주고, 전송 시 기존 대화 경로가 처리한다.
- **NFR-VOP4 "1초 안 거절"**: 9단계 `BUSY`는 본문 수신 완료 시점 기준 즉시(대기 0). 느린 업로드가 슬롯을 잡지 않도록 **본문을 먼저 다 받은 뒤** 세마포어를 잡는다(15초 수신 상한 — 슬로로리스 방어). **대가(DD-122 의도 · I-4)**: 읽는 동안에는 세마포어가 없으므로 **동시에 본문을 받는 요청 수 × 최대 1MB**(`SPEECH_MAX_AUDIO_BYTES`)가 메모리에 있을 수 있다 — 상한은 레이트 버킷(IP 30/분 · 세션 10/분)과 15초 수신 상한이 간접으로 건다. 동시 처리 슬롯을 업로드 대기에 묶지 않는 쪽을 택했다.

### 5.4 전용 레이트 버킷

| kind | IP축 | 키축 | 기본 |
|---|---|---|---|
| `SPEECH`(신규) | `sp-ip:{ip}` | `sp-key:session:{x-cb-session-id}` | IP 30/분(`PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN`) · 세션 10/분(`PUBLIC_SPEECH_RATE_LIMIT_SESSION_PER_MIN`) |

- 대화 `ip`(120/분)·`session`(30/분)·`poll-*`·`fb-*`·`pa-*`와 **접두가 겹치지 않는다**(VO-12). 세션 축은 위조 가능한 값이라 **분산 장치일 뿐** 실질 통제는 IP축·동시 처리 상한·길이·크기 상한·수신 시간·Origin이다(K-1 · **H-1 PM 수용 — 서명 토큰 1차 미도입**). 남은 위험(여러 IP에서 나눠 보내는 남용)은 요구사항 R-13에 기록하고, 관측되면 서명 토큰 도입을 재검토한다(§22).

### 5.5 오류 코드 (DD-132 — 신규 5종 · 공개 메시지는 내부 정보 0)

| 코드 | HTTP | 언제 | 위젯 문구(ui-designer 확정) |
|---|---|---|---|
| `SPEECH_UNAVAILABLE` | 503 | 서버 스위치 꺼짐 · 챗봇 없음·비공개·WEB 꺼짐 · 음성 입력 꺼짐 · 공급자 사용 불가 | "지금은 음성 입력을 쓸 수 없어요. 글자로 입력해 주세요." · **실패 상태(재시도 가능 · 포커스 말하기 버튼) — 마이크를 즉시 숨기지 않는다**(일시 장애일 수 있다 · 숨김은 다음 설정 조회 = 새로고침 뒤 · I-11). 마이크 제거는 `403`(위젯 분류 `DISABLED`)뿐 |
| `SPEECH_BUSY` | 503 + `Retry-After` | API·ml-worker 동시 처리 상한 | "음성 인식이 잠시 붐벼요. 글자로 입력하거나 잠시 뒤 다시 시도해 주세요." |
| `SPEECH_AUDIO_INVALID` | 400 | 형식 헤더 불량 · 빈 본문 · 디코딩 불가 | "녹음을 읽지 못했어요. 다시 말씀해 주세요." |
| `SPEECH_AUDIO_TOO_LARGE` | 413 | 바이트 상한 · 디코딩 뒤 길이 상한(32초) | "녹음이 너무 길어요. 30초 안으로 말씀해 주세요." |
| `SPEECH_FAILED` | 502 | 시간 초과 · ml-worker 오류·네트워크 · 응답 형식 불량 · 출구 차단 | "음성을 글자로 바꾸지 못했어요. 글자로 입력해 주세요." |

기존 재사용: `RATE_LIMITED`(429) · `ORIGIN_NOT_ALLOWED`(403) · `VALIDATION_FAILED`(400). 관리 API는 기존 `VALIDATION_FAILED`·`INVALID_REFERENCE`(노드 소속 불일치)·`NOT_FOUND`만 쓴다.

### 5.6 공개 핸들러 수 — `@Public()` 9 → **10**

10번째 = `PublicConversationController#transcribeSpeech`(컨트롤러 **맨 끝** — H-10·F-6·PA-7의 "핸들러 앞 N자" 창 검사 보존 · 여기서 H-10은 `handoff-sealing.spec.ts`의 봉인 번호다). 합성 공개 경로 0(P-3). 봉인 VO-2. **H-3 개정은 공개 표면에 영향이 없다** — 공개 경로 수(10)·`speech` 키가 붙을 수 있는 공개 응답(메시지 `POST` · 폴링 `GET` 2종)·키 위치 모두 그대로이고, 붙는 반환 지점만 줄었다.

---

## 6. 읽기용 글자 · 말투 (서버)

### 6.1 `lib/speech-text.ts` — `buildSpeechText(outputs: readonly DialogOutput[]): string`

**입력은 같은 응답에서 화면으로 보내는 최종 출력 중 봇 출력 부분**(출구 금지어 마스킹 · RAG 출구 가드레일·개인정보 가림 이후 — `public-conversation.service.ts` 387행 · `rag-answer.service.ts` 165·212행 · **앞에 붙은 G-8 상담원 미전달 메시지는 호출자가 `slice`로 뺀다 — C-16**). 화면에서 가려진 것은 소리로도 가려진다(FR-VO4-2). 함수 자신은 순수 변환만 하고, 무엇이 봇 출력인지는 호출 지점(§6.4)이 정한다.

| 출력 | 읽기 글자 |
|---|---|
| `TEXT` | 본문 |
| `CARD` | 제목 + ". " + 설명 + (버튼 있으면) " 선택지: A, B, C." |
| `CAROUSEL` | 머리글 + 카드마다 "N번, 제목. 설명." + 카드 버튼 선택지 |
| `BUTTON`(일반·바로연결) | 머리글 + " 선택지: A, B, C."(동작 종류 무관 라벨만) |
| `LINK` | 라벨(주소 읽지 않음) |
| `IMAGE` | `altText`가 공백 아님 → "이미지: " + 대체 글 · 없으면 생략 |
| `PHONE_CALL` | "전화 연결 버튼이 있습니다." |
| `PAUSE` | 문장 끊김(". ") |
| `CONTEXT_FORM`·`DIALOG_MOVE`·`SCENARIO`·`SURVEY`·`API_CONDITION`·`WORKFLOW` | 생략(표시용 아님) — **전수 `switch` + `never`**(새 타입 추가 시 컴파일 오류 — DD-126) |

**정리 규칙(서버 보장 — FR-VO4-3)** — 순서 고정, 정규식은 선형(역참조·중첩 반복 금지):

1. 가림 표시 → 읽기: 닫힌 목록 `[주민등록번호]`·`[카드번호]`·`[계좌번호]`·`[전화번호]`·`[이메일]` → "주민등록번호 가림" 등. **목록 표류 감시 시험**: 대표 개인정보 문장 묶음에 `maskPii()`(PARTIAL·FULL 두 방식)를 돌려 나온 `[...]` 표시가 전부 목록에 있는지 단언(C-13 · pii-mask 변경 0).
2. 부분 가림(별표 2개 이상 연속 — 전화·이메일 부분 마스킹·출구 금지어) → " 가림 ".
3. URL 제거(`https?://` · `www.` 로 시작하는 공백 없는 토큰).
4. 이모지 제거(`\p{Extended_Pictographic}` · 변형 선택자 `FE0F` · ZWJ `200D` · 피부색 수식자).
5. 장식 기호 제거(★☆●○◎■□▲△▶◀◆◇※→←↑↓•▪︎ 등 닫힌 목록 — 마침표·쉼표·물음표·느낌표·괄호·퍼센트·원 기호는 보존).
6. 전화번호 쉼: `\d{2,4}-\d{3,4}-\d{4}`의 하이픈 → ", "(1차 최소 규칙 — 그 밖의 숫자·금액·날짜 읽기는 기기 음성에 맡긴다 · 추가 규칙은 3050 청취 뒤 ui-designer·architect).
7. 공백 정리(연속 공백 1개 · 줄바꿈 → ". " 경계).
8. **상한**: 2,000자 초과면 2,000자 이전 마지막 문장 경계(없으면 공백, 없으면 2,000자)에서 자르고 " 나머지는 화면에서 확인해 주세요."를 붙인다(AC-VO3-13).
9. 결과가 빈 문자열이면 `speech` 키를 만들지 않는다.

### 6.2 `lib/speech-tone.ts` — 말투 결정 (판정 모델 0 · 글자 내용 변경 0)

| 응답 종류(`SpeechResponseKind`) | 반환 지점 | 기본 말투 | 관리자 지정 |
|---|---|---|---|
| `SAFETY` | 입구 가드레일 안전 문구 대체(318행) · RAG 출구 REPLACE(폴링 `FAILED` + `safetyReplaced`) | **`CALM` 고정** | 불가(최우선) |
| `ANSWERED` | 정상 턴 `judgeAnswered=true` · RAG `READY` | `defaultTone`(기본 `CALM`) | 기본 말투 + 노드 꼬리표 |
| `UNANSWERED` | 정상 턴 `judgeAnswered=false`(챗봇 폴백·미응답 · 엔진 기본 폴백) · RAG `FAILED`(대체 아님 — 챗봇 폴백 문구) | `APOLOGETIC` | `toneByKind.UNANSWERED` + 노드 꼬리표 |

**우선순위**: `SAFETY` 고정 > 노드 꼬리표(`ANSWERED`·`UNANSWERED`이고 엔진 결과 `matchedNodeId`가 `nodeTones`에 있을 때) > 종류 규칙(`UNANSWERED` → `toneByKind.UNANSWERED ?? APOLOGETIC`) > `defaultTone`. 결과는 닫힌 4종 식별자 중 하나만(VO-10).

- **[H-3 개정] 예전 초안의 `BLOCKED`(입구 금지어 안내 → `INFORMATIVE`)·`ERROR`(버전 읽기 실패 → `APOLOGETIC`)·`WAITING`(RAG 대기 → `INFORMATIVE` 고정) 종류는 삭제했다** — 세 반환 지점은 제품 고정 문구의 시스템 안내라 읽기 대상이 아니므로(DD-136) 말투를 고를 일이 없다. 이에 따라 관리자 종류별 지정은 `UNANSWERED` 1개만 남는다(콘솔 §10.3 ⑤). 말투 4종(`INFORMATIVE` 포함)은 기본 말투·노드 꼬리표로 계속 고를 수 있다.
- 요구사항의 "상담 연결 안내 = 차분함"은 **봇 응답 경로에 해당 종류가 없다** — 상담 관련 문구는 전부 상담 게이트 `HANDLED` 응답(`speech` 없음)·상담 폴링(상담원·시스템 메시지 — 읽기 대상 아님)으로 나간다(R-3 · **H-4 PM 수용** — 요구사항 FR-VO4-4·§1.7에서 삭제).

### 6.3 반영(위젯) — 서버는 말투 이름만, 매개변수는 공유 대응표

위젯은 `computeUtteranceParams(speech.tone, voice.rate)`로 `SpeechSynthesisUtterance`의 `rate`·`pitch`·`volume`을 정한다(§4.2). **서버는 숫자 매개변수를 보내지 않는다**(대응표가 바뀌어도 서버·응답 바이트 불변).

### 6.4 대화 턴 통합 (`public-conversation.service.ts`)

```
sendMessage():
  ① access.resolve
  ①.1 [신규] speechPlan = features에 'speech-v1' 없음 → undefined(동기 · 캐시 조회 0)
                         있음 → await voicePublic.plan(chatbotId) — 색인 미적중 → undefined · 듣기 꺼짐 → undefined
  ... 기존 단계 그대로 ...
  반환 지점별 처리(DD-136):
     BLOCK(221)        — 붙이지 않는다(시스템 안내 · 반환문 무수정)                       ← H-3
     HANDLED(251)      — 붙이지 않는다(상담 구간 · 상담원 메시지 제외 J-8)
     버전 실패(280)    — 붙이지 않는다(시스템 안내 · 반환문 무수정)                       ← H-3
     입구 대체(318)    return withSpeech(response, speechPlan, 'SAFETY', outputs.slice(prependCount))
     보류 시작(413)    응답에는 붙이지 않는다(대기 문구 = 시스템 안내 · 반환문 무수정)    ← H-3
                       + pendingStore.create(…, { speech: speechPlan })  ← 계획만 저장(폴링 최종 답용)
     정상(467)         return withSpeech(response, speechPlan, isAnswered ? 'ANSWERED' : 'UNANSWERED',
                                         outputs.slice(prependCount), result.matchedNodeId)
  prependCount = handoffPrependOutputs.length   (maskOutbound는 길이·순서 보존 map — C-16)
  withSpeech = speechPlan 없으면 response 그대로(같은 참조) · 있으면 { ...response, ...(speech ? { speech } : {}) }
```

- 모델 호출 0 · DB 조회 0(계획은 캐시) · 문자열 처리만 → NFR-VOP1(대화 P95 500ms) 영향은 시험으로 확인(§15).
- `logService.record()` 인자는 **불변**(`rawBotResponse`는 지금처럼 `buildBotResponseText(outputs)`) — `speech` 글자는 기록되지 않는다(VO-8).
- **판정은 반환 지점으로만 한다**(문구 비교 0). 예: 버전 읽기 실패 고정 문구와 비슷한 문장이 챗봇 폴백으로 나가면 그것은 정상 턴 `UNANSWERED`라 읽힌다 — 의도된 결과다(챗봇 콘텐츠).
- 전치 출력만 있고 봇 출력이 비는 경우(이론상 — 엔진은 항상 최소 1건 응답 · ADR-0008 §6)는 §6.1 ⑨에 따라 `speech` 없음.

### 6.5 보류 답변 폴링 통합

- 보류 시작 시 `pendingStore.create(id, { chatbotId, slug, expiresAt, speech?: SpeechReplyPlan })` — 계획 객체(말투 2개 + 노드 맵 — 글자 없음). **보류 시작 POST 응답 자체에는 `speech`가 없다**(대기 문구는 시스템 안내 — H-3).
- RAG 완료: 출구 `REPLACE` → `complete({ status:'FAILED', outputs, safetyReplaced: true })` · 그 밖 실패·출구 `FALLBACK` → 표식 없음 · 성공 → `READY`.
- `pollMessage()`: 스냅샷이 `READY`/`FAILED`이고 `speech` 계획이 있으면 `kind = READY ? ANSWERED : (safetyReplaced ? SAFETY : UNANSWERED)` · `buildSpeechText(snapshot.outputs)` → `{ status, outputs, sources, ...(speech ? { speech } : {}) }`. `PENDING`·만료(404)에는 붙지 않는다. 폴링 결과 출력에는 G-8 전치 출력이 없다(전치는 보류 시작 응답에만 실린다).
- 위젯은 폴링 완료 응답의 `speech`로 최종 말풍선에 듣기를 붙이고, 자동 읽기가 켜져 있으면 **최종 답 도착 시 읽는다**(대기 문구는 읽지 않으므로 대기 중에는 소리가 없다 — 진행 중인 이전 답 읽기가 있으면 `cancel()` 후 새 답 · EX-VO-16 · K-16).

---

## 7. STT Provider 포트 (API)

### 7.1 `providers/speech-recognition-provider.port.ts`

```ts
/** 'cloud'는 예약 자리(P-7 — 1차 미구현). 도입 시 별도 출구 클래스 + 거버넌스 모드 기본 차단(FR-VO6-3). */
export type SpeechRecognitionProviderId = 'mock' | 'local';
export interface SpeechRecognitionInput { readonly audio: Uint8Array; readonly contentType: string; readonly language: 'ko'; }
export type SpeechRecognitionFailureCause = 'TIMEOUT' | 'NETWORK' | 'HTTP_5XX' | 'INVALID_RESPONSE' | 'EGRESS_BLOCKED' | 'NOT_CONFIGURED';
export type SpeechRecognitionOutcome =
  | { readonly kind: 'OK'; readonly text: string; readonly durationMs: number }
  | { readonly kind: 'EMPTY'; readonly durationMs: number }
  | { readonly kind: 'INVALID_AUDIO' }
  | { readonly kind: 'TOO_LONG' }
  | { readonly kind: 'BUSY' }
  | { readonly kind: 'FAILED'; readonly cause: SpeechRecognitionFailureCause };
export interface SpeechRecognitionProvider {
  readonly providerId: SpeechRecognitionProviderId;
  /** 예외를 던지지 않는다. 오디오·글자를 로그에 남기지 않는다. */
  transcribe(input: SpeechRecognitionInput, opts: { readonly timeoutMs: number }): Promise<SpeechRecognitionOutcome>;
  /** 예외를 던지지 않는다. */
  healthy(): Promise<boolean>;
}
```

결과 → 공개 응답: `OK` → 200 · `EMPTY` → 200 `{ text:'', durationMs, empty:true }` · `INVALID_AUDIO` → 400 · `TOO_LONG` → 413 · `BUSY` → 503 BUSY · `FAILED` → 502(`NOT_CONFIGURED`는 503 UNAVAILABLE).

### 7.2 `local-speech-recognition.provider.ts` (★ 출구 `SPEECH_LOCAL`)

- `url = ${ML_WORKER_SPEECH_URL}/speech/transcribe` → `assertEgressAllowed('SPEECH_LOCAL', url)` → `fetch(url, { method:'POST', headers:{ 'Content-Type': 'application/octet-stream' }, body: audio, signal, redirect: egressRedirectMode() })` → `assertNoRedirectResponse` → 상태 매핑(200 → zod `{ modelId, text, durationMs, empty }` · 400 → `INVALID_AUDIO` · 413 → `TOO_LONG` · 503 `{detail:'BUSY'}` → `BUSY` · 그 밖 5xx/504 → `FAILED(HTTP_5XX)`). **`modelId`는 공개 응답으로 넘기지 않는다**(데이터 지도·관리 상태에도 넣지 않음 — 운영 확인은 ml-worker `/speech/health`).
- `healthy()` → `GET /speech/health`(3초) `status === 'ok'`. **[DD-135 ③] 운영(`isProductionRuntime(process.env)` — 공급자 생성 시 1회 평가)이면 추가로 `backend !== 'mock'`이어야 참**이다 — ml-worker가 `STT_BACKEND=mock`이면 운영에서는 사용 불가(마이크 숨김) + 경고 로그 1회("음성 인식 프로세스가 mock 백엔드입니다 — 운영에서는 사용하지 않습니다"). 비운영은 `status`만 본다(시연·개발에서 mock ml-worker 허용). `/speech/health` 응답의 `backend` 외 필드는 읽지 않는다.
- 회로차단은 두지 않는다 — 가용성 캐시(§5.1)가 실패 즉시 마이크를 숨기는 같은 역할을 한다(K-2 단일 인스턴스).
- `ML_WORKER_SPEECH_URL` 미설정이면 팩토리가 `transcribe` = `FAILED(NOT_CONFIGURED)`·`healthy` = `false`인 구현을 돌려준다(기동 실패 아님 · 기동 경고 1회 — 가짜 결과가 아니라 "사용 불가"로 안전하게 수렴하므로 운영에서도 기동 실패로 올리지 않는다 · R-16).

### 7.3 `mock-speech-recognition.provider.ts` (CI·시연 — 네트워크 0)

결정적 규칙: ① 바이트가 ASCII `MOCK:`로 시작 → 나머지를 UTF-8 글자로 반환(시험 주입 — AC-VO2-2·AC-VO2-10) ② 전부 0 바이트 → `EMPTY` ③ `MOCK-INVALID` → `INVALID_AUDIO` ④ `MOCK-BUSY` → `BUSY` ⑤ 그 밖 → `OK '모의 인식 결과입니다'`. `durationMs = 바이트 수 기반 결정값`.

**환경별 동작(DD-135 · H-10 PM 결정)**:

| 환경(`NODE_ENV`) | `SPEECH_ENABLED` | `SPEECH_PROVIDER` | 결과 |
|---|---|---|---|
| 무관 | `false`(기본) | `mock`(기본)·`local` | 기동 · 음성 입력 꺼짐(**기본 설치 동작 불변**) |
| `production` | `true` | **`mock`(명시 또는 미설정 기본값)** | **API 기동 실패** — 오류 문구 "운영 환경(NODE_ENV=production)에서 SPEECH_ENABLED=true이면 SPEECH_PROVIDER=local이 필요합니다(mock은 실제 음성 인식이 아닌 고정 결과를 돌려줍니다)." |
| `production` | `true` | `local` · 주소 없음 | 기동 + 경고 1회 + 입력 사용 불가(§7.2) |
| `production` | `true` | `local` · 주소 있음 | 정상 — ml-worker 백엔드가 `mock`이면 사용 불가 + 경고(§7.2 · DD-135 ③) |
| 그 밖(미설정·`development`·`test` 등) | `true` | `mock` | 기동 + **경고 1회**("SPEECH_PROVIDER=mock — 실제 인식 아님") · 데이터 지도 `speech.provider = 'mock'` 표시 |
| 무관 | 무관 | `mock｜local` 밖의 값(오타) | **API 기동 실패**(zod enum — 기존 규약 · H-8 PM 수용) |

- 시험(jest)은 `NODE_ENV=test`가 기본이라 기존 통합 시험·시연 하네스(DT-1)는 영향이 없다. 교차 검사 시험은 `validate()`에 설정 객체를 직접 넘겨 확인한다(동적 import 불필요 — §15.2).

### 7.4 후처리 (`lib/transcript-cleanup.ts` · `lib/korean-digits.ts` — DD-131)

1. 앞뒤 공백 · 연속 공백 1개 · 제어 문자 제거.
2. **반복 고리 축약**: 같은 구절(2~30자)이 연속 3회 이상 → 1회(무음 환각 고리 대응). **[구현 — 코드 리뷰 M-2 · I-13] 반복 단위가 숫자(아라비아 숫자·한글 숫자 음절)와 구분자(공백·하이픈)만으로 이뤄지면 축약하지 않는다**("일일일일 …"·"0000 0000"은 고리가 아니라 실제 번호일 수 있다). 검사 입력은 길이 상한을 둬 비용이 입력 길이에 선형으로 묶인다.
3. **상투 문장 목록**: 전사 전체가 목록 문장과 정규화 일치하면 `EMPTY`로 바꾼다. 1차 목록은 **비어 있다** — ml-engineer가 3050 동작 확인 결과로 제안하고(FR-VO2-10) 코드 상수로 넣는다(모델 교체 시 재검토).
4. **한글 숫자 정규화**(P-16): 공백·하이픈·"다시"(구두 하이픈)로 구분된 **토큰이 전부 숫자 음절**(`공·영·일·이·삼·사·오·육·륙·칠·팔·구`)로만 이루어진 연속 구간이고 **숫자 합계 6자리 이상**일 때만 아라비아 숫자로 바꾼다("다시" → `-`). 예: "구공공일일이 다시 일이삼사오육칠" → `900112-1234567`. "사이사이"(4자리)·"이사" 같은 일반 낱말은 바꾸지 않는다. 자릿값 읽기("천이백")·한글·숫자 섞임·"하나 둘" 계열은 바꾸지 않는다(알려진 한계 EX-VO-9 · K-6). **최종 규칙 목록·자리수 하한은 ml-engineer가 3050 결과로 확정**하고, 확정 목록을 단위 시험 표로 고정한다. **[구현 반영 — I-13 · 규칙은 "3050 실측 후 확정 대기"(코드 상수 `KOREAN_DIGITS_MIN_LENGTH`·`KOREAN_DIGIT_SYLLABLES`·`KOREAN_DIGITS_DASH_WORD`)]** ⓐ **구분 군집은 하이픈으로 이어 붙인다**: "공일공 일이삼사 오육칠팔" → `010-1234-5678` · "구공공일일이 다시 일이삼사오육칠" → `900112-1234567` ⓑ **낱글자(1글자 토큰)를 공백으로만 끊어 읽은 구간은 군집이 아니라 한 자리씩 읽은 것으로 보고 이어 붙인다**(코드 리뷰 M-1): "공 일 공 일 이 삼 사 오 육 칠 팔" → `01012345678` — 구간 안에 2글자 이상 토큰·하이픈 구분·"다시"가 하나라도 있으면 ⓐ를 따른다 ⓒ "다시"는 숫자 토큰 사이에서만 구분으로 인정(끝에 오면 일반 낱말) ⓓ **아라비아 숫자가 든 토큰과 맞닿은 구간은 바꾸지 않는다**(한글·숫자 혼합 — "010 일이삼사 오육칠팔" 그대로 · K-6) ⓔ 토큰 단위 판정이라 **조사·어미가 붙은 토큰**("…오육칠팔이에요")은 숫자 토큰이 아니어서 그 토큰부터 바뀌지 않는다(K-6). 비변환 예: "사이사이"(4자리)·"이사"·"일이삼사오"(5자리)·"오육십"(십은 숫자 음절 아님)·"천이백".
5. 2,000자 상한(`transcriptMaxChars`).

**금지어·개인정보 처리는 하지 않는다**(FR-VO2-9) — 전송 시 기존 경로.

---

## 8. ml-worker 음성 인식 프로세스 (ADR-0024 트리거 해소 — DD-116~118)

### 8.1 역할 구조

| `ML_WORKER_ROLE` | 적재 모델 | 등록 경로 |
|---|---|---|
| `embed`(기본) | 임베딩 | `/embed` · `/health` |
| `augment` | 생성 | + `/augment` · `/augment/health` · `/cluster-label` |
| `both` | 임베딩 + 생성(개발 편의) | 위 전부 |
| **`speech`(신규 · 배타)** | **STT 1종 + VAD**(임베딩·생성 적재 0) | **`/embed`·`/health`(역할 무관 계약 — 이 역할에서는 `loading`/503 · K-12) + `/speech/transcribe` · `/speech/health`** |

- **배타 이유**: STT는 공개(인증 없는) 경로가 부르는 **요청당 GPU 추론**이다. 대화 임베딩(300ms 예산)·증강 생성과 같은 프로세스에 두면 스레드 풀·GPU 메모리·BLAS 스레드를 다투고, 공개 폭주가 대화 매칭을 막는다(ADR-0024 §갱신 1-②의 원칙을 강제 수준으로 올린다). `both`에 음성을 넣는 조합(`all` 등)은 만들지 않는다.
- **같은 진입점 유지**: `ml_worker.app:app` 하나 · `apps/ml-worker/package.json` 스크립트에 `start:speech`(= `node ./scripts/start-speech.mjs` — `ML_WORKER_ROLE=speech ML_WORKER_PORT=8102`를 설정해 같은 진입점을 띄우는 **래퍼 스크립트**. `VAR=값 명령` 셸 문법이 Windows에서 동작하지 않아 래퍼로 바꿨다 — I-14) 추가. 별도 FastAPI 앱 모듈은 기각(운영 명령·설정 로더·시험 장치가 2벌이 된다).
- 알 수 없는 역할 값은 **기동 실패**(현재는 조용히 아무것도 적재하지 않는다 — 역할 검사 1줄 추가 · NFR-VOR3 · 기존 3값 동작 불변).
- `speech` 역할 ∧ `STT_BACKEND=mock`이면 **기동 경고 1회**("mock 전사기 — 실제 인식 아님 · 운영 API는 이 프로세스를 사용 불가로 봅니다"). ml-worker에는 운영 판별 개념을 두지 않는다 — 운영 차단은 API가 한다(DD-135 ③ · 판별 정의 1곳 유지).

### 8.2 파일 구조

```
apps/ml-worker/src/ml_worker/
├── config.py                # [수정] stt_* 설정 12개 · loads_speech 속성 · 역할 값 검사
├── app.py                   # [수정] lifespan: loads_speech면 _load_transcriber() · 역할 speech면 register_speech_routes(app)
└── speech/                  # [신규]
    ├── __init__.py
    ├── routes.py            # POST /speech/transcribe · GET /speech/health (raw Request · async 읽기 → run_in_threadpool)
    ├── body.py              # read_capped(request, max_bytes) — Content-Length 사전 검사 + stream 누적 상한
    ├── decoder.py           # decode_to_pcm16k(data, max_seconds, deadline) — PyAV + BytesIO · 프레임 루프 상한
    ├── vad.py               # VadBackend: SileroVad(faster_whisper.vad) | EnergyVad(numpy RMS) | NoVad
    ├── transcriber.py       # Transcriber 포트 · MockTranscriber · FasterWhisperTranscriber(지연 import) · _load_transcriber()
    └── limits.py            # BoundedSemaphore(blocking=False) · Deadline
apps/ml-worker/eval/stt_candidates.py   # [신규 · CI 밖] 후보별 CER·P50/P95·VRAM 기록(eval/report 형식)
apps/ml-worker/scripts/fetch_stt_model.py # [신규 · 수동] 모델 사전 내려받기(폐쇄망 반입용 — 기동 경로 아님)
apps/ml-worker/tests/test_speech_*.py   # [신규]
```

### 8.3 디스크 0 디코딩 (DD-117)

```
POST /speech/transcribe  (async def — 본문만 비동기로 읽고, 처리 전체는 run_in_threadpool)
 ① Content-Length > STT_MAX_AUDIO_BYTES → 413 {"detail":"TOO_LARGE"}
 ② async for chunk in request.stream(): 누적 > 상한 → 즉시 413 (bytearray — 메모리만)
 ③ semaphore.acquire(blocking=False) 실패 → 503 {"detail":"BUSY"}
 ④ deadline = monotonic() + STT_DEADLINE_S
 ⑤ decode_to_pcm16k(bytes(buf), max_seconds=STT_MAX_AUDIO_SECONDS, deadline)
      container = av.open(io.BytesIO(data), mode='r',   # 파일 경로·임시 파일 없음
                          options={ protocol_whitelist: 'pipe',            # 커스텀 IO 외 프로토콜 접근 0
                                    format_whitelist: 'matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,ogg,wav' })
      열린 뒤 container.format.name(쉼표 구분 이름 전부)이 허용 목록 안인지 다시 대조 — 아니면 닫고 INVALID
      (HLS·concat·data URI 등 외부 참조 형식 차단 — 코드 리뷰 M-5 · I-14) · 자동 탐지 실패 시 형식 힌트 재시도도 같은 옵션·대조
      오디오 스트림 1개 선택(없으면 INVALID) → AudioResampler(format='flt', layout='mono', rate=16000)
      for frame in container.decode(stream): 리샘플 → 누적 샘플 수 > max_seconds×16000 → TOO_LONG 중단
                                            monotonic() > deadline → DEADLINE 중단
      av 예외(형식·손상) → INVALID
 ⑥ VAD → 말소리 구간 0 → { text:'', durationMs, empty:true } (STT 호출 0)
 ⑦ transcriber.transcribe(pcm, language='ko', deadline) → 세그먼트 생성기를 돌며 세그먼트 사이마다 deadline 검사
 ⑧ finally: semaphore.release() · 지역 참조 해제(buf·pcm del)
 응답 200 { modelId, text, durationMs, empty }      ← durationMs = 디코딩된 녹음 길이(H-9)
```

- **금지**(VO-3 정적 검사): `speech/**`에서 `UploadFile`·`File(`·`Form(`·`tempfile`·`NamedTemporaryFile`·`open(`의 쓰기 모드·`subprocess`·`ffmpeg` 명령 실행·`write_bytes`·`.save(`·Pydantic 본문 모델(`BaseModel` 인자를 받는 POST 핸들러).
- **오류 본문은 코드 문자열만**(`{"detail": 코드}`) — 입력·예외 메시지·모델 정보를 싣지 않는다. **[구현 확정 — I-14] 코드 ↔ HTTP 상태**: `INVALID` 400 · `TOO_LARGE` 413 · `TOO_LONG` 413 · `BUSY` 503 · `DEADLINE` 504 · `LOADING` 503 · `FAILED` 500(예상 밖 예외). API 공급자 매핑(§7.2)은 400 → `INVALID_AUDIO` · 413 → `TOO_LONG` · 503 `BUSY` → `BUSY` · 그 밖 5xx(503 `LOADING`·504·500 포함) → `FAILED(HTTP_5XX)`. 처리 로그 = 바이트 수·지속 ms·결과 코드·처리 ms(글자·오디오 0).
- uvicorn 접근 로그는 경로·상태만이라 그대로 둔다(본문 미기록).
- **확인 필요(ml-engineer)**: PyAV가 MediaRecorder 산출물(WebM/Opus · Safari MP4/AAC 조각형)을 `BytesIO`에서 탐지·디코딩하는지(AC-VO5-4 ①), PyAV 휠에 동봉된 FFmpeg의 라이선스(LGPL 빌드 여부 — U-4). 실패하는 형식이 있으면 **형식 힌트(`format=`) 재시도까지만** 허용하고 디스크·하위 프로세스 대안은 쓰지 않는다(불가하면 해당 브라우저 마이크 비지원으로 기록).

### 8.4 VAD

- `STT_VAD=auto`(기본): 백엔드가 `faster-whisper`면 **Silero**(faster-whisper 패키지 동봉 — 별도 모델 반입 0 · CPU · `faster_whisper.vad.get_speech_timestamps`), `mock`이면 **에너지 기반**(넘파이 RMS 임계 — CI가 onnxruntime 없이 돈다). `silero｜energy｜off` 명시 가능.
- 말소리 구간만 이어 붙여 STT에 넣는다(무음 환각 감소 — R-4).
- **[구현 확인 — I-14]** Silero VAD 추론 세션은 프로세스 안에서 공유하며, 동시 요청(`STT_MAX_CONCURRENCY`)에서 **스레드 안전함을 확인**했다(요청마다 세션을 새로 만들지 않는다).

### 8.5 STT 후보 선택 구조 (DD-118)

- 교체 지점 `_load_transcriber()` 1곳: `STT_BACKEND=mock` → `MockTranscriber`(결정 글자 · 모델 0) · `faster-whisper` → `FasterWhisperTranscriber(model=STT_MODEL_ID, device, compute_type, cpu_threads, num_workers=STT_MAX_CONCURRENCY, download_root=STT_MODEL_DIR or None, local_files_only=True)` + 워밍업 1회(무음 1초). 그 밖 값 → 기동 실패.
- `STT_MODEL_ID`가 비어 있으면 기동 실패(기본 모델을 두지 않는다 — 우발적 대형 모델 적재·내려받기 방지).
- **기동 중 외부 내려받기 0**: `local_files_only=True` 고정(설정으로 끌 수 없다). 반입은 `scripts/fetch_stt_model.py`(수동 · 인터넷 되는 장비) → 폐쇄망 복사(FR-VO7-2).
- 전사 옵션 기본: `language='ko'`(자동 감지 0) · `task='transcribe'` · `condition_on_previous_text=False`(반복 고리 억제) · `without_timestamps=True` · `beam_size=STT_BEAM_SIZE` · 그 밖 임계값은 ml-engineer가 3050 결과로 제안(**미실측**).
- 장비 등급별 권장(초안 — 전부 미실측 · `자동배포.md` §5.8 음성 열): 등급 0 = `small` int8 CPU · 등급 1(3050) = `small`~`large-v3-turbo` int8 GPU(**이번 "동작 확인" 대상**) · 등급 2 = `large-v3-turbo`/`large-v3` · 등급 3(L40S) = `large-v3` float16 + 동시 처리(운영 실측 대기).
- **3050 동작 확인 결과(2026-10-02, `apps/ml-worker/eval/report/stt-3050-dongjak-hwakin.md`, 합격 판정 아님)**: `small` int8·`large-v3-turbo` int8 모두 RTX 3050 4GB에서 CUDA 적재·전사, 임베딩(KURE-v1)과 동시 적재 가능(turbo 합계 약 3.3GB·잔여 약 0.8GB — 생성 모델 동시 적재는 불가로 봄). **PM 결정(2026-10-02)**: 시연 기본 모델 = `large-v3-turbo` int8 · K-7 환각 상투 문장 목록은 **빈 목록 유지**(관찰 후보 2건 '시청해주셔서 감사합니다.'·'다음 영상에서 만나요.'는 L40S 실소음 재관찰 뒤 확정) · **`STT_VAD=off`(VAD 끄기)는 사실상 금지 구성**(VAD 끄면 turbo가 상투 문장을 지어냄 — VAD가 1차 방어선) · 3050 Windows의 GPU 사용은 코드 변경 없이 **절차만 문서화**(ml-worker가 pip의 `nvidia-*` DLL 경로를 자동 탐색하지 않으므로 `.venv\Lib\site-packages
vidia\{cublas,cudnn,cuda_nvrtc}in`을 기동 환경 `PATH` 앞에 추가 — `nvidia-cublas-cu12` 12.9.2.10·`nvidia-cudnn-cu12` 9.27.0.42·`nvidia-cuda-nvrtc-cu12` 12.9.86 확인 버전, 운영 L40S·Linux 해당 없음).
- `GET /speech/health` → `{ status:'ok'｜'loading', backend, modelId, device, computeType, vad, maxConcurrency, maxAudioSeconds, warmedUp }` — 실제 적재값(No.37 FR-ED6-1 교훈 · **`device`·`computeType`은 전사기가 실제 적재한 값을 보고**하고 적재 전에는 설정값 — `mock`은 `cpu`·`none` · I-14). API는 `status`를 읽고, **운영이면 `backend`도 읽는다**(DD-135 ③).

### 8.6 동시성 · 시간 제한 (DD-122 · No.37 P-9 원칙)

| 항목 | API | ml-worker |
|---|---|---|
| 동시 처리 | `SPEECH_MAX_CONCURRENCY` 2 · 비대기 | `STT_MAX_CONCURRENCY` 2 · 비대기(`num_workers`와 같은 값) |
| 시간 | `SPEECH_STT_TIMEOUT_MS` 10,000(요청 전체 · `AbortController`) | `STT_DEADLINE_S` 8.0(디코딩·VAD·세그먼트 사이 검사) — **API보다 짧게**(9초 초과 설정은 기동 경고) |
| 크기 | `SPEECH_MAX_AUDIO_BYTES` 1MB | `STT_MAX_AUDIO_BYTES` 1MB(같은 값 권장 — 직접 호출 방어) |
| 길이 | (위젯 30초 상수) | `STT_MAX_AUDIO_SECONDS` 32(30 + 여유 2 — 디코딩 뒤에만 알 수 있다 · R-4) |

- 세그먼트 디코딩 중간에는 끊을 수 없다(K-11) — 최악 초과는 세그먼트 1개.

### 8.7 의존성 · 설치

- `pyproject.toml` 선택 묶음 **`[speech]`** = `faster-whisper`(CTranslate2 · onnxruntime 포함) + `av`(PyAV) — 버전 범위는 ml-engineer가 원문 확인 후 확정. 기본 설치(`embed`)에는 들어가지 않는다(R-6 — 반입 부담 격리).
- 잠금: `requirements-lock.txt`(기존)는 그대로 두고 **`requirements-speech-lock.txt`** 를 별도로 둔다(D-1 선례 — 임베딩 설치를 부풀리지 않는다).
- GPU 실행의 CUDA·cuDNN 조건(CTranslate2 빌드별)은 **확인 필요** — 3050 동작 확인 기록에 버전을 남긴다.
- 라이선스(FR-0-331 · U-4): faster-whisper · Whisper 가중치 · CTranslate2 · PyAV · FFmpeg 빌드 · Silero VAD — 이름·조건·확인일을 `eval/report` 보고서 부록에 기록. 상업 이용 불가 항목은 올리지 않는다.
- `.env.example`(ml-worker) 음성 절: `STT_*` 12개 + 주석 "`STT_BACKEND=mock`은 시험·시연 전용 — 운영 API(`NODE_ENV=production`)는 mock 백엔드 프로세스를 사용 불가로 본다(DD-135)" · 프로세스 분리 예시에 `음성: ML_WORKER_ROLE=speech ML_WORKER_PORT=8102 STT_BACKEND=faster-whisper` 1줄.

### 8.8 3050 "동작 확인" · 운영 실측 (FR-0-330 · FR-VO8-3)

- 3050 기록 항목: 장비(GPU·VRAM·CPU/GPU 분산)·일자·명령·모델 이름/리비전·`compute_type`·VRAM 사용·임베딩 프로세스와 동시 적재 여부·시연 브라우저/기기/음성 이름 · **결과 표기는 "동작 확인"뿐**(CER·지연 수치를 합격 판정에 쓰지 않는다).
- 운영 실측(L40S · **No.17 실측과 한 번에**): CER(한국어 평가 세트 — 출처·라이선스는 ml-engineer 제안) · 10초 발화 서버 처리 P50/P95 · 동시 N 처리량 · VRAM(임베딩 + STT + No.17 생성 합계) · **임베딩 P95 영향**. 그때까지 고객 개통 대기(U-6 · OC-3).

---

## 9. 위젯 (`apps/widget`)

### 9.1 파일 구조

```
apps/widget/src/
├── api/public-client.ts            # [수정] transcribeSpeech(blob, sessionId, signal) · sendMessage(payload, opts) — opts.speech===true면 features 끝에 'speech-v1'
├── core/speech-capture.ts          # [신규] 녹음 상태기계(주입: getUserMedia · MediaRecorder 생성자 · 타이머 · 문서 가시성) — DOM 무의존
├── core/speech-playback.ts         # [신규] 읽기 제어(주입: speechSynthesis · Utterance 생성자) — 음성 판별·대기 상한·조각 재생·cancel·실패 1회 안내
├── core/speech-autoread-storage.ts # [신규] sessionStorage `cb.vo.ar.{slug}` = '1'(메모리 폴백 — session.ts 방식)
├── ui/mic-button.ts                # [신규] 마이크 버튼(44×44 · 레이블 · aria-pressed/aria-disabled)
├── ui/speech-button.ts             # [신규] 응답 단위 듣기/멈추기 버튼
├── ui/autoread-toggle.ts           # [신규] 패널 머리 "답변 소리로 듣기" 토글 + 비활성 이유 글자
├── ui/composer.ts                  # [수정] 선택 슬롯 setMicSlot(strip, mic)(상태 줄 = 폼 맨 위 · 말하기 = 전송 바로 앞) · insertTranscript(text)(기존 글자 뒤 공백 1개 + 이어 붙임) · setInputHook(fn)(기존 input 리스너가 호출 — 새 리스너 0)
├── ui/message-list.ts              # [수정] addBotOutputs/addBotAnswer 끝 선택 인자 speech?: SpeechBinding
├── ui/app.ts                       # [수정] CONFIG_LOADED 뒤 voice 조립(조건부) · 응답·폴링 speech 전달 · 정지 규칙
├── constants/speech.ts             # [신규] 문구 · 기능 선언 상수 재수출 · 30초 · 1MB · 2초
└── styles.ts                       # [수정] 마이크·녹음 상태·듣기 버튼·토글 · prefers-reduced-motion
```

> **[구현 반영 — I-12] 위 목록에 더해 바뀐 파일**: `ui/panel.ts`(**`setEscapeGuard(fn)`** 추가 — 기존 `keydown` 핸들러가 Esc에서 가드가 참이면 닫기를 건너뛴다 · 새 캡처 리스너 0 · 가드는 마이크가 조립될 때만 설정) · `core/session.ts`(`getItem`/`setItem` export — 자동 읽기 저장소가 메모리 폴백을 재사용) · `ui/dom.ts`(신규 — `el()` DOM 헬퍼 · 번들 크기) · `scripts/check-bundle-size.mjs`(음성 증가분 기록 — 기준선 19,760B · 예산 7KB · 초과는 경고만, 100KB 게이트만 빌드 실패). `public-client.ts`의 오류 분류는 9종(`SESSION` 추가 — §9.6).

### 9.2 조립 조건 (NFR-VOP5 — 꺼짐이면 실행 0)

- `config.voice` 없음 → 음성 모듈을 **조립하지 않는다**(리스너·`getVoices()`·권한 요청 0 · `features` 3개 그대로 — 요청 바이트 불변).
- `voice.input === true` ∧ `window.isSecureContext` ∧ `navigator.mediaDevices?.getUserMedia` ∧ `typeof MediaRecorder === 'function'` → 마이크 버튼. 아니면 버튼을 만들지 않는다(FR-VO1-1 · EX-VO-1).
- `voice.tts === true` → 읽기 컨트롤러 + `sendMessage`에 `speech-v1` 선언. `speechSynthesis` 없음·기기 안 `ko` 음성 없음 → 듣기 버튼·토글 `aria-disabled` + 이유 글자 1줄(FR-VO3-2 · AC-VO3-2/3).
- `E-10` 봉인: 위젯 코드에 `environment` 토큰 금지(식별자·문자열).

### 9.3 녹음 (`core/speech-capture.ts`)

```
IDLE ─마이크 클릭→ ensureSpeechNoticeAcknowledged()   ← DD-133 고지 자리(1차 = 즉시 resolve · 법무 확인은 개통 조건 OC-1)
     → 진행 중 읽기 cancel() (FR-VO1-11)
     → REQUESTING: getUserMedia({ audio: true })
          NotAllowedError → "마이크 권한이 꺼져 있어요" + 이 페이지 수명 동안 재요청 안 함(EX-VO-3)
          권한 정책·보안 오류 → "이 사이트에서는 음성 입력을 쓸 수 없어요"(EX-VO-2)
     → RECORDING: MediaRecorder(mimeType = 첫 지원: 'audio/webm;codecs=opus' → 'audio/mp4' → 기본, audioBitsPerSecond 32000)
          #cb-status(polite): 시작 1회 "듣고 있어요" · 남은 10초 1회 · 화면 글자는 매초 "남은 시간 N초"
          종료: 버튼 재클릭 · 30초 자동 · Esc = 취소(버림 · 요청 0 · 패널 유지 — 아래 Esc 우선순위) · 창 닫기·탭 숨김 = 취소(EX-VO-18)
          녹음 누적 > 1MB → 자동 종료(서버 413 예방)
     → 트랙 즉시 stop()(모든 종료·취소 경로 — FR-VO6-7) 
     → UPLOADING: "글자로 바꾸는 중" · 취소 가능(AbortController) · 버튼 aria-disabled · 위젯 대기 상한 15초(SPEECH_LIMITS.uploadDeadlineMs — 초과 = 중단 → FAILED "음성을 글자로 바꾸지 못했어요…")
          OK → composer.insertTranscript(text) · 입력창 포커스 · 자동 전송 0
          empty → "말소리가 들리지 않았어요"
          오류 코드별 문구(§5.5) · 503 UNAVAILABLE = FAILED(재시도 가능 · 마이크 유지 · 포커스 말하기 버튼 — I-11) · 403(DISABLED)만 마이크 제거(포커스 입력창) · 400 VALIDATION_FAILED(세션 헤더 불량)는 녹음 버림 + "다시 시도해 주세요"(EX-VO-10)
     → IDLE
```

- 가시성 리스너는 **녹음 중에만** 등록·해제한다(부팅 리스너 추가 0).
- **[구현 확정 — I-12 · 화면 명세 F-1] Esc 우선순위**: 준비(REQUESTING)·녹음(RECORDING)·인식(UPLOADING) 중 Esc = **음성만 취소 · 패널 유지**(`stopPropagation`). 그 밖 상태(IDLE·FAILED·BLOCKED)의 Esc는 기존대로 패널 닫기. 구현은 `panel.ts`의 기존 `keydown` 핸들러에 가드(`setEscapeGuard`)를 두는 방식(새 캡처 리스너 0) — 음성이 꺼진 위젯은 가드가 없어 Esc 동작이 지금과 같다.
- **위젯 인식 대기 상한 15초**(화면 명세 F-4 · UIUX §8 무한 대기 금지) — 서버 제한 10초 + 업로드 여유.
- **포커스 이동 규칙**(화면 명세 F-8): 취소·종료·실패(무음 포함) 뒤 → **말하기 버튼** · 인식 성공 → **입력창**(이어 붙인 글자 끝) · 마이크 제거(403) → **입력창**. 포커스가 `body`로 떨어지는 경로가 없어야 한다.
- 녹음 바이트는 `Blob` 메모리에만 있고 업로드·취소 직후 참조를 끊는다. 저장소(`localStorage`·`sessionStorage`·IndexedDB)에 쓰지 않는다.

### 9.4 읽기 (`core/speech-playback.ts`)

- **음성 판별**: `speechSynthesis.getVoices()` → `selectLocalKoreanVoice()`. 빈 목록이면 `voiceschanged`를 최대 2초 기다린 뒤 판정. 판정 뒤에도 `voiceschanged`가 오면 다시 판정해 **활성화만** 한다(EX-VO-14 · 비활성화로 되돌리지 않음).
- **재생**: `cancel()` → `splitForSpeech(speech.text)` 조각마다 `new SpeechSynthesisUtterance(조각)` · `voice` = 선택 음성 · `lang` = 그 음성의 `lang` · `computeUtteranceParams(tone, voice.rate)` → 차례로 `speak()`. 한 번에 한 응답만(FR-VO3-7).
- **멈춤**: 멈추기 · 녹음 시작 · 입력창 입력 · 창 닫기 · 탭 숨김 · 새 답 읽기 → `cancel()`.
- **실패**: `error` 이벤트 → "지금은 소리로 들려드릴 수 없어요" 1회 · 재시도 0 · 답 글자 유지(AC-VO3-12).
- **자동 읽기**: 토글(기본 꺼짐 · 사용자 조작으로만 켬 · `sessionStorage` 기억). 토글을 켜는 **클릭 처리기 안에서** **볼륨 0의 공백 한 칸 발화 1회**로 재생 권한을 확보한다(iOS 류 · EX-VO-22 — 구현 확정 · I-12). 새 봇 응답의 `speech`가 오면 자동 재생 · 보류 RAG는 최종 답 도착 시. **[구현 확정 — I-12 · 화면 명세 F-3] 최신 답 우선**(읽는 중 새 `speech` 답 = `cancel()` 후 최신 답 · 대기열 0) · **창이 닫혀 있거나 탭이 숨겨진 동안, 그리고 녹음(마이크 준비 포함) 중에 도착한 답은 읽지 않는다**(돌아와서 그 답의 "듣기"로 듣는다). **`speech`가 없는 응답(시스템 안내 3종 등)이 오면 아무것도 읽지 않고, 진행 중인 이전 답 읽기도 끊지 않는다**(새 답 읽기 시작만 `cancel()` 계기 — H-3 · EX-VO-25).
- **송신 0**: 이 모듈은 `fetch`·`XMLHttpRequest`·`sendBeacon`을 쓰지 않는다(VO-9 · AC-VO3-1).
- **교체 단위**(NFR-VOM4): 재생부는 `SpeechPlayer` 인터페이스(`speak(text, params)`·`cancel()`·`available`) 1개로 감싼다 — 훗날 서버 합성 재도입 시 구현만 바꾼다.

### 9.5 듣기 버튼 위치

**응답 단위 1개**(그 응답 묶음의 마지막 말풍선 뒤 · 평가 막대와 같은 줄 — 배치는 ui-designer · R-2 · **H-6 PM 수용**). `speech` 키가 없는 응답 — 사용자 메시지 · 상담원 메시지 · **서버 시스템 안내(금지어 안내 · 일시 장애 · RAG 대기 문구 — H-3)** · 위젯 자체 안내·오류 문구 — 에는 만들지 않는다. 위젯은 `speech` 키 유무만 보고 판단한다(응답 종류를 해석하지 않는다).

### 9.6 클라이언트

- `transcribeSpeech(blob, sessionId, signal)`: `fetch(base + '/speech/transcriptions', { method:'POST', credentials:'omit', headers:{ 'Content-Type': blob.type || 'application/octet-stream', 'x-cb-session-id': sessionId }, body: blob, signal })`. 실패 시 본문 `code`를 읽어 `SpeechClientError(kind: 'UNAVAILABLE'|'BUSY'|'INVALID'|'TOO_LARGE'|'FAILED'|'RATE_LIMITED'|'DISABLED'|'NETWORK'|'SESSION')`로 분류(C-10 · `SESSION` = `400 VALIDATION_FAILED` 세션 헤더 불량 — 구현 추가 · `DISABLED` = `403` — 마이크 제거는 이것뿐 · 코드 없는 503도 `UNAVAILABLE` = 재시도 가능 실패 · I-11).
- `sendMessage(payload, opts)`: `opts.speech === true`일 때만 `features: [handoff-v1, feedback-v1, rich-v1, speech-v1]` — 아니면 **지금 배열 그대로**(요청 바이트 불변 · 기존 `public-client.spec.ts` 무수정).

### 9.7 번들 예산

현재 gzip 약 19.3KB(CHANGELOG 502행). 증가분 **≤ 7KB**(**PM 2026-10-01 결정 — 원안 5KB에서 상향**. 원안의 추정 3~4KB가 낮았다 — 실측 +6,315B(+6.17KB): 기준선 19,760B(19.30KB) → 26,075B(25.46KB) · 구성 추정 문구 약 1.0KB · 코드 약 4.8KB · CSS 약 0.34KB · 공유 대응표 약 0.4KB · I-10). 빌드 로그에 증가분 기록(`check-bundle-size.mjs` — 7KB 초과는 경고만) · 100KB 게이트 유지 · **Preact 재검토 트리거 미발동**(vanilla 흡수 — ADR-0012 갱신 각주).

---

## 10. 관리 API · 콘솔 인계

### 10.1 경로 (`VoiceController` — `chatbots/:chatbotId/voice` · 신규 권한 0)

| 메서드 | 경로 | 권한 | 내용 |
|---|---|---|---|
| `GET` | `/chatbots/:chatbotId/voice` | `channel:read` | `VoiceOverviewResponse`(설정 — 행 없음 = 기본값 · 서버 상태 · 맥락) |
| `PUT` | `/chatbots/:chatbotId/voice` | `channel:write` | `VoiceSettingsInput` 전체 교체 → 저장 → 캐시 무효화(이 인스턴스 즉시 · 다른 인스턴스는 TTL) → 감사 |
| `GET` | `/chatbots/:chatbotId/voice/stats?from=&to=` | `channel:read` | `VoiceStatsResponse` |

- 권한은 선제 안내(No.35)와 같은 `channel:*` — 음성은 위젯 표시·동작 설정이다(FR-0-333).
- 저장 검증: `nodeTones[].nodeId`가 **이 챗봇의 초안 노드**인지 1쿼리(`dialogNode.findMany({ where: { chatbotId, id: { in } } })`) — 아니면 `400 INVALID_REFERENCE`. `toneByKind`는 `UNANSWERED` 키만 허용(strict — §4.1). `inputEnabled=true` 저장은 서버가 꺼져 있어도 **허용**하고 응답 `server.reason`으로 알린다(콘솔이 켜기 컨트롤을 비활성 표시 — FR-VO5-2. 서버가 나중에 켜지면 그대로 동작).
- 노드 삭제는 막지 않는다 — 조회 시 `nodeMissing: true` 배지(No.35 노드 삭제 경고 선례). 런타임은 없는 노드 꼬리표를 무시한다.
- 들어보기 API 없음(FR-VO5-3 — 서버 호출·감사 0).

### 10.2 감사

`PUT` = `UPDATE Chatbot` 1건 · 화이트리스트 필드 `voice`(전후 값: 스위치 3 · 배율 · 말투 · 미응답 말투 · 노드 꼬리표 **개수**(노드 id 목록 원문은 넣지 않음)). 새 `AuditTargetType` 0.

### 10.3 콘솔 (ui-designer → frontend-implementer)

- **위치**: 챗봇 설정 › "음성"(선제 안내·채널 설정과 같은 층). 화면 명세 `docs/03-design/voice-ai-ui-spec.md`(ui-designer 산출).
- **구성**: ① 서버 상태 배너(꺼짐·사용 불가 이유 — 글자) ② 음성 입력 켜기(서버 불가 시 비활성 + 이유 · **옆에 "음성 처리 고지 문구는 법무 확인 전입니다 — 고객 개통 전 확인 필요" 경고 글자**(H-5 · OC-1)) ③ 듣기 켜기 · 자동 읽기 토글 노출 ④ 빠르기(슬라이더 + 숫자 입력 — 둘 다 레이블) ⑤ 기본 말투 · **미응답(폴백) 안내 말투**(라디오 그룹 `fieldset/legend` · 안내 1줄 "금지어 안내·일시 장애·답변 대기 같은 시스템 안내는 읽지 않습니다 · 안전 문구 대체는 항상 차분함" — H-3) ⑥ 노드별 말투(노드 선택 콤보박스 + 말투 + 삭제 · 없는 노드 배지) ⑦ **들어보기**(문장 ≤200자 · 말투 · 재생/멈춤 — 관리자 브라우저 기기 음성 · `@chat-bot/shared-types/speech-voice` 공용 함수 · "이 브라우저에서 쓸 수 있는 기기 안 한국어 음성: N개" · "사용자 기기마다 목소리가 다르고, 말투는 빠르기·높낮이·크기만 바뀝니다" 고지) ⑧ 인식 숫자(최근 7일 표 — 요청·성공·말소리 없음·형식 오류·실패·혼잡).
- **UIUX 준수**: 모든 입력에 `<label>` · 아이콘 단독 버튼 금지 · 상태는 글자 + `aria-live` · 키보드 조작 · 44×44 · 색 단독 구분 금지(`docs/03-design/UIUX_준수기준.md`).
- 데이터 지도 화면: `speech?` 절(§11.2) 표시 · `exits[]`의 `SPEECH_LOCAL` 행.

---

## 11. 거버넌스 · 개인정보 · 감사

### 11.1 데이터 흐름 판정 (요구사항 §1.6)

| 데이터 | 저장 | 서버 디스크 | 외부 전송 | 로그·감사·오류 |
|---|---|---|---|---|
| 음성 원본 | **0** | **0**(API 요청 스트림 → 메모리 버퍼 → ml-worker 원시 본문 → 메모리 디코딩) | 사내 ml-worker만(`SPEECH_LOCAL`) | 0(바이트 수만) |
| 인식 글자 | 전송 시에만 기존 대화 로그 규약 | — | 기존 경로 | 0 |
| 읽기용 글자(`speech`) | 0 | — | 위젯 응답(화면용과 같은 내용 · 봇 답변만) | 0 |
| 일별 숫자 | `SpeechDailyStat` | — | — | — |

### 11.2 출구 · 데이터 지도 (DD-130)

- `EGRESS_REGISTRY` +`SPEECH_LOCAL`(파일 `speech/providers/local-speech-recognition.provider.ts` · `dataKind: 'AUDIO_RAW'` · `masked: 'NO'` · 라벨 "음성 인식(ml-worker)"). G-1·G-2가 자동 검사한다.
- `exits[]`: `SPEECH_LOCAL` 행은 **`SPEECH_ENABLED=true ∧ SPEECH_PROVIDER=local`일 때만** 포함(URL = `ML_WORKER_SPEECH_URL` · 판정 = 기존 규칙). 그 밖에는 행 자체를 빼서 **기본 설치 지도 바이트 동일**(C-8).
- 선택 키 `speech?` — `SPEECH_ENABLED=true` 또는 입력∨듣기 켜진 음성 설정 행 ≥1일 때만(**판정에 `chatbotVoiceSetting.count` 2건 — 기본 설치에서도 실행되나 결과 0이면 키가 없어 응답 바이트 불변 · I-6**):
  `{ serverEnabled, provider: 'mock'｜'local', chatbotsInputEnabled, chatbotsTtsEnabled, audioStored: false, audioDiskWrite: false, transcriptStored: 'ONLY_WHEN_SENT', ttsLocation: 'USER_DEVICE', ttsServerEgress: false, onlineVoicesExcluded: true, counters: 'CHATBOT_DAILY_COUNTS_ONLY' }` — 화면 문구 "음성 원본 — 저장 0 · 사내 음성 인식 프로세스로만 · 가림 불가" · "답변 읽기 — 사용자 기기 안에서 처리(기기 안 음성만) · 서버 전송 0"(FR-VO6-2). `provider: 'mock'`은 비운영 설치에서만 보일 수 있다(운영은 기동 실패 — DD-135) — 화면은 "모의 인식(실제 인식 아님)"으로 표시.
- **거버넌스 모드 ON**: 기동 검사 `checkEgressBootUrls`에 1조건 — `SPEECH_ENABLED ∧ provider=local ∧ ML_WORKER_SPEECH_URL` 호스트가 허용 목록 밖이면 **기동 실패**(기존 출구와 같은 규칙 · AC-VO4-4). 런타임은 `assertEgressAllowed`가 차단 → `FAILED(EGRESS_BLOCKED)` → 502.
- 클라우드 공급자(미구현)가 생기면 새 출구 클래스 + 모드 ON 기본 차단(음성 원본은 마스킹 조건 허용 경로 없음 — FR-VO6-3).
- 보존 종류·암호화 대상 추가 **0**(저장하지 않으므로 · No.45 정합).

### 11.3 감사 · 권한

- 감사: §10.2. 공개 인식 요청은 감사 대상이 아니다(사용자 행위 · 대화 로그와 같은 층위 — 숫자만).
- 권한: 신규 0(`Permission` 18 · 역할 불변 — VO-13).

---

## 12. 설정 키

### 12.1 `apps/api/.env` — 전부 선택(기본값에서 동작 불변 · boolean은 `envBoolean()`)

| 이름 | 기본 | 범위 | 뜻 |
|---|---|---|---|
| **`SPEECH_ENABLED`** | `false` | — | 서버 음성 인식 스위치. **읽기(듣기)에는 영향 없음** |
| **`SPEECH_PROVIDER`** | `mock` | `mock｜local` | STT 공급자(`z.enum` — 잘못된 값은 기존 enum 규약대로 **기동 실패** · R-15 · H-8 PM 수용). **운영(`NODE_ENV=production`) ∧ `SPEECH_ENABLED=true` ∧ `mock` = 기동 실패**(DD-135 · H-10) — 비운영은 경고 |
| **`ML_WORKER_SPEECH_URL`** | (없음) | URL | 음성 인식 프로세스 주소(끝 `/` 제거). `local`인데 없으면 사용 불가 + 기동 경고(운영에서도 — R-16) |
| **`SPEECH_STT_TIMEOUT_MS`** | `10000` | 2000~60000 | API → ml-worker 요청 전체 제한 |
| **`SPEECH_MAX_AUDIO_BYTES`** | `1048576` | 65536~4194304 | 공개 인식 본문 상한 |
| **`SPEECH_MAX_CONCURRENCY`** | `2` | 1~32 | API 동시 인식 상한(초과 즉시 503) |
| **`SPEECH_HEALTH_CACHE_MS`** | `30000` | 5000~600000 | 공급자 상태 캐시(실패는 이 값의 1/3) |
| **`SPEECH_FAILURE_THRESHOLD`** | `3` | 1~20 | 인식 요청의 `TIMEOUT`·`HTTP_5XX`가 **연속** 이 횟수에 이르면 가용성을 하락(임계 미만은 `healthy()` 재확인만 · `NETWORK`는 즉시 하락 · 성공(`OK`·`EMPTY`) 시 0 · 하락 시 세대 번호를 올려 진행 중이던 이전 갱신이 되돌리지 못함 · 그 밖 원인은 영향 없음) — 코드 리뷰 M-3 · §5.1 · I-2 |
| **`SPEECH_SETTINGS_CACHE_TTL_MS`** | `60000` | 1000~600000 | 음성 설정 전역 색인·챗봇별 캐시 TTL(다중 인스턴스 반영 지연 상한) |
| **`PUBLIC_SPEECH_RATE_LIMIT_IP_PER_MIN`** | `30` | — | `sp-ip` |
| **`PUBLIC_SPEECH_RATE_LIMIT_SESSION_PER_MIN`** | `10` | — | `sp-key:session` |
| (기존 관례) `NODE_ENV` | (없음) | 문자열 | **이 기능이 읽기만 한다**(스키마 키 추가 0 · 새 환경변수 아님). 앞뒤 공백 제거 후 정확히 `production`이면 운영(DD-135). **운영 설치는 반드시 설정**(OC-5) |

- 새 백그라운드 루프 0(상태 갱신은 요청이 일으키는 지연 갱신) → `jest.isolate-env.js` 변경 0. `SPEECH_ENABLED=true` 통합 시험은 **동적 import**(`CLAUDE.md` 규약) — 단, 운영 mock 교차 검사는 `validate()` 단위 시험으로 본다.
- 요구사항 가칭 `SPEECH_MAX_AUDIO_SECONDS`는 API에 두지 않는다(길이는 디코딩 뒤에만 안다 → ml-worker `STT_MAX_AUDIO_SECONDS` · R-4).
- `apps/api`에는 `.env.example` 파일이 없다(C-17) — API 환경변수의 정본 표는 이 절과 `개발명세서.md` §5.1(패치 A-12)이다. 새 `.env.example`은 만들지 않는다(기존 그룹들과 같은 관행).

### 12.2 `apps/ml-worker/.env` — 전부 선택(`speech` 역할에서만 읽힘)

| 이름 | 기본 | 뜻 |
|---|---|---|
| `ML_WORKER_ROLE` | `embed` | 값 +`speech`(배타) |
| **`STT_BACKEND`** | `mock` | `mock｜faster-whisper`(`mock`은 시험·시연 전용 — 운영 API가 사용 불가로 본다 · DD-135 ③) |
| **`STT_MODEL_ID`** | (빈 값) | `faster-whisper`면 필수 — 캐시 이름(예: `large-v3-turbo`) 또는 로컬 경로 |
| **`STT_MODEL_DIR`** | (빈 값) | 모델 캐시 디렉터리(`download_root`) — 기동 중 내려받기 0 |
| **`STT_DEVICE`** | `cpu` | `cpu｜cuda`(조용한 CPU 대체 금지 — CUDA 적재 실패는 기동 실패) |
| **`STT_COMPUTE_TYPE`** | `int8` | `int8｜int8_float16｜float16｜float32` |
| **`STT_BEAM_SIZE`** | `5` | 1~10(ml-engineer 실측 후 조정) |
| **`STT_CPU_THREADS`** | `0` | 0 = 라이브러리 기본 |
| **`STT_MAX_CONCURRENCY`** | `2` | 비대기 세마포어 · `num_workers` |
| **`STT_MAX_AUDIO_BYTES`** | `1048576` | 본문 상한 |
| **`STT_MAX_AUDIO_SECONDS`** | `32` | 디코딩 뒤 길이 상한(초 · **실수 허용** — 예: `30.5` · I-14) |
| **`STT_DEADLINE_S`** | `8.0` | 처리 상한(API 제한보다 짧게 — 9초 초과 경고) |
| **`STT_VAD`** | `auto` | `auto｜silero｜energy｜off` |

요구사항 가칭 `STT_MODEL_ID=mock`·`SPEECH_VAD_ENABLED`는 각각 `STT_BACKEND=mock`·`STT_VAD`로 정리했다(R-5·R-6).

### 12.3 설정 오류 처리 정리 (NFR-VOR3 정정 · H-8·H-10)

| 설정 오류 | 어디서 | 결과 |
|---|---|---|
| `SPEECH_PROVIDER` 오타(`mock｜local` 밖) | API | **API 기동 실패**(기존 enum 규약 — `AUGMENTATION_PROVIDER` 선례 · H-8) |
| 운영 ∧ `SPEECH_ENABLED=true` ∧ `SPEECH_PROVIDER=mock` | API | **API 기동 실패**(DD-135 ② · H-10) |
| 비운영 ∧ `SPEECH_ENABLED=true` ∧ `mock` | API | 기동 + 경고 1회 |
| `local` ∧ `ML_WORKER_SPEECH_URL` 없음 | API | 기동 + 경고 1회 + 입력 사용 불가(안전 수렴 — R-16) |
| 거버넌스 모드 ON ∧ 켜짐 ∧ `local` ∧ 주소가 허용 목록 밖 | API | **API 기동 실패**(기존 출구 규칙) |
| 운영 ∧ ml-worker `STT_BACKEND=mock` | API 런타임 | 입력 사용 불가(마이크 숨김) + 경고 1회(DD-135 ③) |
| `ML_WORKER_ROLE` 오타 · `STT_BACKEND` 오타 · `STT_MODEL_ID` 비어 있음(`faster-whisper`) · CUDA 적재 실패 | ml-worker | **음성 인식 프로세스만 기동 실패** + 원인 로그(조용한 대체 0 — No.37 원칙) |

> 요구사항 NFR-VOR3 원안("설정 오류는 음성 인식 프로세스만 기동 실패")은 위 표대로 정정됐다 — API 쪽 enum 오타와 운영 mock은 API 기동 실패다(PM 결정 H-8·H-10).

---

## 13. 성능 예산 · 대화 경로 격리

| 항목 | 예산 | 확인 |
|---|---|---|
| 공개 대화 P95(500ms · 캐시 적중) | **불변** — `speech-v1` 미선언 턴은 추가 연산 0 · 선언 턴은 봇 답변 반환 지점에서만 문자열 변환(목표 ≤1ms, 출력 10개·각 1,000자) · 시스템 안내 3종 반환은 추가 연산 0 | 기존 성능 시험 + 2,000자·캐러셀 10장 변환 시간 단위 시험 |
| 공개 대화 첫 턴 쿼리 수(17) | **불변** — 음성 미사용 챗봇 0 추가 · 선언 턴도 색인 캐시 적중이면 0 | 기존 3개 쿼리 수 시험 무수정 + 신규 "speech-v1 선언·음성 꺼진 챗봇 = 17" |
| 공개 설정 조회 | 음성 미사용 = 0 추가 · 음성 입력 켜진 챗봇의 프로세스 첫 조회만 ≤1초 대기 | 단위 + 통합 |
| 인식 요청(운영) | **10초 발화 서버 처리 P95 2초 — 제안 · L40S 실측**(NFR-VOP2) | 운영 실측 |
| 혼잡 거절 | 본문 수신 뒤 즉시(≤1초 — NFR-VOP4) | 통합(세마포어 가득 · mock 지연) |
| 메모리 | API 요청당 ≤1MB(+ 디코딩 0 — API는 디코딩하지 않는다) · ml-worker 요청당 원본 ≤1MB + PCM 32초×16k×4B ≈ 2MB | 상한 시험 |
| VRAM | 서버 GPU 모델 = STT 1종 · 3050에서 임베딩(CPU 권장)과 동시 적재 여부 기록 · Ollama 생성과 4GB 공유 불가 가능성(K-10) | 동작 확인 기록 |
| 임베딩 P95 영향 | 프로세스 분리로 0 목표 · 같은 GPU 공유 시 운영 실측(FR-VO8-3) | 운영 실측 |

---

## 14. 봉인 · 정적 검사 (`apps/api/src/speech/lib/speech-sealing.spec.ts` · 위젯 `core/speech-sealing.spec.ts` · ml-worker `tests/test_speech_sealing.py`)

| # | 봉인 | 방법 |
|---|---|---|
| **VO-1** | `packages/dialogue-engine/**`·`conversation/adapters/**`·`shared-types/src/channel.ts`·`rich-degrade.ts`·`packages/pii-mask/**`에 `speech`·`voice`·`SpeechTone` 심볼 0 | 파일 스캔 |
| **VO-2** | `@Public()` 총 10 · 10번째 = `transcribeSpeech`(컨트롤러 마지막 핸들러) · 앞 600자에 `@PublicRateBucket(`·`kind: 'SPEECH'` · 합성 관련 경로 문자열(`synthes`·`/tts`) 0 | 스캔 |
| **VO-3** | API `speech/**`: `writeFile`·`createWriteStream`·`fs.promises.write`·`appendFile`·`multer`·`FileInterceptor`·`diskStorage`·`os.tmpdir` 0 · ml-worker `speech/**`: `UploadFile`·`File(`·`Form(`·`tempfile`·`NamedTemporaryFile`·`subprocess`·`write_bytes`·쓰기 모드 `open(` 0 | 스캔 + ml-worker 시험에서 `tempfile`·`open` 쓰기 감시(AC-VO2-8) |
| **VO-4** | `speech/**`·`public-conversation.service.ts`의 `transcribeSpeech` 안 `Logger` 호출 인자에 `text`·`transcript`·`audio`·`buffer`·`bytes`(변수)·`sessionId` 식별자 0 · ml-worker `logger.*` 인자에 `text`·`data`·`pcm` 0 | 스캔 |
| **VO-5** | **[구현 구체화 — I-7]** 공급자 호출 `provider.transcribe(` = `speech/public/speech-transcription.service.ts` **1곳** · `public-conversation.service.ts`의 `.transcribe(` 호출 = `transcribeSpeech` 메서드 본문 **1곳**(→ `SpeechTranscriptionService.transcribe`) · `.transcribe(` 호출 파일 = `speech/public/speech-transcription.service.ts` + 공급자 구현뿐 · `public-conversation.service.ts`의 `sendMessage`·`pollMessage` 본문에 `speechTranscription` 0 · `VoicePublicService`가 공급자·세마포어를 주입받지 않음 | 스캔(AC-VO1-4 정적 보완) |
| **VO-6** | `SPEECH_LOCAL` 레지스트리 파일 = 실제 `fetch(` 파일 1개 · `fetch(` 앞 `assertEgressAllowed(` | G-1·G-2(무수정 · 레지스트리 기반) |
| **VO-7** | `chatbotVoiceSetting` 쓰기 호출 파일 ⊆ {`admin/voice-settings.service.ts`, `chatbots/chatbots.service.ts`(deleteMany)} · `speechDailyStat` 쓰기 ⊆ {`core/speech-stat.writer.ts`, `chatbots.service.ts`} | 스캔 |
| **VO-8** | `SpeechDailyStat`에 글자·세션·IP·시각 원본 컬럼 0(스키마 모델 블록 컬럼 화이트리스트) · `logService.record(` 인자 객체에 `speech` 키 0 · `PendingAnswerStore` 결과 타입에 `speech` 글자 필드 0(계획만) | 스키마·스캔 |
| **VO-9** | 위젯: `SpeechRecognition`·`webkitSpeechRecognition` 토큰 0 · `getUserMedia` 호출 파일 = `core/speech-capture.ts` 1개 · `core/speech-playback.ts`에 `fetch`·`XMLHttpRequest`·`sendBeacon` 0 · `getVoices` 결과 사용은 `selectLocalKoreanVoice` 경유만 | 스캔 |
| **VO-10** | `speech.tone` 값을 만드는 함수 = `lib/speech-tone.ts` 1개 · 반환형 `SpeechTone` | 타입 + 스캔 |
| **VO-11** | `shared-types/src/speech-voice.ts`에 `import` 0(zod·다른 파일 반입 금지) | 스캔 |
| **VO-12** | 버킷 접두 `sp-ip`·`sp-key`가 기존 접두와 겹치지 않음 · 기존 4행 바이트 불변 | 단위 |
| **VO-13** | `Permission` 18 · 역할 불변 · `voice.controller.ts` `@RequirePermission` 인자 ⊆ {`channel:read`,`channel:write`} | 기존 단언 + 스캔 |
| **VO-14** | `RetentionTargetKind`·`EncryptedFieldId`·`AuditTargetType`·`PII_MASK_RULES_VERSION`(3) 불변 · 가림 표시 표류 감시(§6.1) | 단언 |
| **VO-15** | 위젯 `features`: `voice.tts` 거짓이면 3개 그대로(기존 시험) · 참이면 4개(신규) | 위젯 단위 |
| **VO-16** | ml-worker: `speech` 역할 외에서 `/speech/*` 404 · `speech` 역할에서 `/augment`·`/cluster-label` 404 · `speech/**`에 `httpx`·`requests`·`urllib.request`·`socket` 사용 0(외부 송신 0) · DB 드라이버 import 0 | pytest |
| **VO-17** | **[개정 추가 — H-3 · DD-135]** ① `public-conversation.service.ts`의 `withSpeech(` 호출 = **정확히 2개**(입구 안전 문구 대체 · 정상 반환) · 두 호출의 출력 인자는 `.slice(` 를 포함(전치 제외 — C-16) · `BANNED_WORD_GUIDANCE_TEXT`·`VERSION_UNAVAILABLE_FALLBACK_TEXT`·`RAG_WAITING_TEXT`를 쓰는 반환문 블록에 `withSpeech`·`speech` 토큰 0 ② `SpeechResponseKind` 값 = 정확히 `ANSWERED`·`UNANSWERED`·`SAFETY` ③ `NODE_ENV` 값 읽기(`.NODE_ENV`·`['NODE_ENV']` 접근) 파일 = `config/runtime-env.ts` 1개(운영 판별 정의 1곳 — 오류·경고 문구 안의 글자는 대상 아님) | 스캔 + 단언 |

---

## 15. 시험 전략 (test-automation 인계)

### 15.1 원칙

- **GPU·실제 모델·실제 브라우저 음성 없이 전부 통과**(FR-0-329): API = `mock` 공급자 · ml-worker = `STT_BACKEND=mock` + 합성 오디오(PyAV로 생성한 WAV/Opus 사인파·무음 · 손상 바이트) · 위젯 = 가짜 `MediaRecorder`·`getUserMedia`·`speechSynthesis`(jsdom — 호출 인자 기록).
- 상대 시각 · 동적 import로 `SPEECH_ENABLED=true` · 통합 DB는 `migrate deploy`.
- **골든 바이트 비교**: 커밋 ①에서 캡처한 공개 설정·메시지·폴링 응답 본문 = 음성 꺼짐·선언 없음 상태에서 문자열 동일. **시스템 안내 3종(BLOCK·버전 읽기 실패·보류 시작) 응답은 듣기 켜짐 ∧ `speech-v1` 선언 상태에서도 골든과 문자열 동일**(H-3).

### 15.2 층별 핵심

| 층 | 대상 |
|---|---|
| shared-types 단위 | 대응표 clamp · `isLocalKoreanVoice`(`localService` `false`/누락 제외) · 분할 · 스키마(키 순서·strict · `VoiceToneByKindSchema`가 `BLOCKED`·`ERROR` 키를 거부) |
| API 순수 | `buildSpeechText` 전 타입 · 정리 9단계 · 2,000자 · **말투 우선순위 3종**(SAFETY 고정 · 노드 꼬리표 · UNANSWERED 지정/기본 · ANSWERED 기본 말투) · 한글 숫자(확정 표) · 반복·상투 · 본문 상한 읽기(초과 중단·시간 초과) · **`isProductionRuntime`**(`'production'` · `' production '` → 참 · `'Production'`·`'prod'`·미설정 → 거짓) |
| API 설정 단위(`env.validation` — 동적 import 불필요) | **운영 mock 교차 검사**: `{NODE_ENV:'production', SPEECH_ENABLED:'true'}`(공급자 미설정) → `validate()` throw · `SPEECH_PROVIDER:'mock'` 명시 → throw · `'local'` → 통과 · `SPEECH_ENABLED` 미설정/`'false'` + `production` → 통과(기본 설치 불변) · `NODE_ENV:'development'`/미설정 + 켜짐 + mock → 통과 + 경고 1회 · `SPEECH_PROVIDER:'cloud'`·오타 → throw(H-8) |
| API 통합 | 공개 인식 처리 순서 12단계 · 오류 코드 5종 · 버킷 · 세마포어 · 집계 · `voice` 키 · **`speech` 키 2지점(입구 안전 문구 대체 = `CALM` · 정상 = ANSWERED/UNANSWERED)** · **비대상 3지점(BLOCK·버전 읽기 실패·보류 시작) = 듣기 켜짐 ∧ 선언에서도 `speech` 키 없음 + 골든 바이트 동일** · **G-8 전치 출력이 있는 턴의 `speech.text`에 상담원 메시지 글자 없음** · 폴링 READY·FAILED(폴백 = `APOLOGETIC`)·FAILED+`safetyReplaced`(= `CALM`) · 쿼리 수 · 관리 API(`toneByKind` 허용 키) · 감사 · 지도 · 거버넌스 기동 검사 · 영구삭제 · **운영 ∧ local ∧ ml-worker 상태 `backend:'mock'` → `voice.input=false`**(가짜 fetch) |
| ml-worker | 역할 경로 존재 · 상한 413 · 혼잡 503 · 손상 400 · 무음 empty · 길이 초과 · 데드라인 · 디스크 감시 · 로그 무글자 · `speech` ∧ `mock` 기동 경고 |
| 위젯 | 상태기계 · 트랙 종료 · Esc · 30초 · 문구 · 판별·대기 · 조각 재생 · cancel 규칙 · 자동 읽기(**`speech` 없는 응답 도착 시 `speak()`·`cancel()` 0**) · 네트워크 0 · features |
| 수동 게이트(CI 밖) | AC-VO5-1(3050 동작 확인) · AC-VO5-4(브라우저·기기 표) · 실제 PyAV 형식 처리 · **AC-VO5-5(개통 전 체크리스트 — §17.5)** |

### 15.3 ★ 의도된 기존 시험 기대값 변경 — 닫힌 목록 (FR-0-334 확정)

| # | 파일 | 변경 |
|---|---|---|
| **X-1** | `apps/api/src/common/auth/public-decorator-count.spec.ts` | `@Public()` 9 → 10 · `isPublic(PublicConversationController.prototype,'transcribeSpeech')` 추가 · 전수 컨트롤러 목록에 `VoiceController` import·추가(개수 +1) · 제목·주석 |
| **X-2** | `feedback/lib/feedback-sealing.spec.ts` F-6 | 9 → 10 |
| **X-3** | `deploy-schedules/lib/deploy-schedule-sealing.spec.ts` D-5 | 9 → 10 |
| **X-4** | `handoff/lib/handoff-sealing.spec.ts` H-10 | 총 9 → 10(7·8·9번째 위치 검사는 그대로) |
| **X-5** | `validation/lib/validation-sealing.spec.ts` 7) | 9 → 10 |
| **X-6** | `versions/lib/version-sealing.spec.ts` V-8 | 9 → 10 |
| **X-7** | `proactive/lib/proactive-sealing.spec.ts` | PA-7 총 9 → 10 · 95행 `EgressExitId` 7 → 8 |
| **X-8** | `guardrails/lib/guardrail-sealing.spec.ts` 98행 | `EgressExitId` 7 → 8 |
| **X-9** | `utterance-analysis/lib/utterance-analysis-sealing.spec.ts` 381행 | `EGRESS_REGISTRY` 7 → 8 |
| **X-10** | `rich-messages/lib/rich-message-sealing.spec.ts` 197행 | `EgressExitId` 7 → 8 |
| **X-11** | `chatbots/chatbots.service.spec.ts` 142행 | 동반 삭제 34 → 36테이블 |
| **X-12** | `topics/lib/topic-sealing.spec.ts` 공개 스키마 목록 | **[구현 중 추가 2026-10-01 — I-8]** 공개 응답 스키마 전수 목록에 `PublicSpeechReplySchema`(응답 선택 키 `speech:{text,tone}`)를 12번째 기대값 변경으로 추가 — 목록이 공개 스키마를 전수로 고정하는 시험이라 새 공개 스키마는 목록에 들어가야 한다. 단언 규칙·기존 행은 불변 |

> **목록 밖 변경 금지.** 제목 문자열만 "9"를 언급하고 개수를 단언하지 않는 시험(예: `topic-sealing.spec.ts` T-9 제목 "총 8", `rich-message-sealing.spec.ts` RM-7 제목)은 **수정하지 않는다**. 구현 중 목록 밖 시험이 깨지면 고치지 말고 architect에게 되돌린다(설계 결함 신호). ml-worker·위젯·web 기존 시험 기대값 변경 **0건**. **PM 환류 개정(H-3·H-10)은 이 목록을 바꾸지 않는다** — 시스템 안내 응답은 바이트 불변이고, 운영 mock 교차 검사는 `NODE_ENV=production`을 넣는 기존 시험이 없어(C-17) `env.validation.spec.ts`·`env.validation.guardrails.spec.ts` 기존 단언에 영향이 없다.

### 15.4 AC ↔ 시험 매핑(요약)

| AC | 시험 |
|---|---|
| AC-VO1-1/2/3 | 전체 스위트 + 골든 바이트 + VO-1 |
| AC-VO1-4 | 통합: 음성 켜짐·`mock` 공급자 스파이 → 메시지 턴 `transcribe` 호출 0 + VO-5 + 기존 P95 시험 |
| AC-VO1-5 | 위젯 빌드 크기 · 의존성 목록 |
| AC-VO1-6 | X-1 + VO-2 |
| AC-VO2-1~4·11 | 위젯 단위(가짜 장치) |
| AC-VO2-5~7 | API 통합(mock 규칙 ②·`MOCK-BUSY`·세마포어) + ml-worker(무음·손상·상한) |
| AC-VO2-8 | API 통합: 로그 캡처·DB 행 수(대화 로그 0 증가 · 일별 +1) + VO-3/4 + ml-worker 디스크 감시 |
| AC-VO2-9 | **(요구사항 정정 반영 — H-1)** 없는 슬러그·비공개·WEB 꺼짐·음성 입력 꺼짐·서버 꺼짐 → 전부 같은 `503 SPEECH_UNAVAILABLE`(본문 동일) |
| AC-VO2-10 | `MOCK:구공공일일이 다시 일이삼사오육칠` → 입력 글자 `900112-1234567` → 전송 → 로그 마스킹 확인 |
| AC-VO3-1~3·9·10·12 | 위젯 단위 |
| AC-VO3-4·5·8·13 | API 통합(상담원·상담 HANDLED·선언 없음 · 폴링 · 말투 · 상한) |
| AC-VO3-6·7 | 순수(`[카드번호]` → "카드번호 가림" · 캐러셀) + 통합(RAG 가림) |
| AC-VO3-11 | 스냅샷 해시 불변(스키마 변경 0 — 기존 시험) |
| **AC-VO3-14** | **API 통합: 시스템 안내 3종 + 듣기 켜짐 + 선언 → `speech` 없음 · 골든 바이트 동일 + 위젯 단위: 듣기 버튼 0 · 자동 읽기 `speak()` 0 + VO-17 ①** |
| AC-VO4-1~5 | 관리 API·감사·콘솔(들어보기 네트워크 0 — web vitest)·거버넌스 기동(동적 import)·지도 |
| **AC-VO4-6** | **API 설정 단위(운영 mock 교차 검사 표 — §15.2) + 통합(운영 ∧ local ∧ ml-worker `backend:'mock'` → 입력 불가)** |
| **AC-VO4-7** | **API 설정 단위(`SPEECH_PROVIDER` 오타 → throw — H-8)** |
| AC-VO5-1~4 | 수동 게이트 |
| **AC-VO5-5** | **수동 게이트: §17.5 OC-1~OC-8 체크 기록(고객 개통 건별)** |

---

## 16. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-322)

| 대상 | 기본 구성(서버 스위치 꺼짐 · 음성 설정 없음) | 근거 |
|---|---|---|
| 공개 설정 응답 | 바이트 동일(`voice` 없음) · 추가 쿼리 0(색인 캐시) | §5.1 |
| 메시지 응답·요청 | 바이트 동일 · 위젯 `features` 3개 그대로 | §5.2 · §9.6 |
| 폴링 응답 | 바이트 동일(계획 없음) | §6.5 |
| 평가·선제 응답 | 변경 0 | — |
| 공개 경로 수 | 10(새 경로는 꺼짐이면 항상 503 — 음성 쪽 DB 조회 0 · 공통 Origin 가드의 챗봇·채널 조회 최대 2건은 다른 공개 경로와 같이 남는다 · I-3) | §5.3 ① |
| 대화 로그·통계·미응답 | 변경 0 | §3.3 |
| 데이터 지도 | 바이트 동일(`speech?` 없음 · `SPEECH_LOCAL` 행 없음) | §11.2 |
| ml-worker 기존 역할 | `/embed`·`/health`·`/augment`·`/cluster-label` 계약 바이트 동일 · 음성 의존성 미설치 | §8.1 · §8.7 |
| 위젯 동작 | 음성 코드 미조립(리스너·권한·`getVoices` 0) | §9.2 |
| API 기동 | 운영 설치라도 `SPEECH_ENABLED` 미설정(기본 `false`)이면 운영 mock 교차 검사가 걸리지 않는다(기동 동작 불변) | §12.3 · DD-135 |

---

## 17. 구현 체크리스트 · 역할 분담

### 17.1 `ml-engineer` (`apps/ml-worker` · 순서대로)

1. 라이선스 원문 확인(faster-whisper · Whisper 가중치 · CTranslate2 · PyAV · FFmpeg 빌드 · Silero VAD) → 보고서 부록(U-4).
2. `config.py` 설정 12개 · 역할 검사 · `speech/` 패키지(§8.2) · `_load_transcriber()` · 경로 등록 조건 · `speech` ∧ `mock` 기동 경고.
3. PyAV 메모리 디코딩 — WebM/Opus · MP4/AAC · Ogg 표본 확인(실패 형식은 기록).
4. pytest: §15.2 ml-worker 행 + VO-3·VO-16.
5. `[speech]` 선택 묶음 · `requirements-speech-lock.txt` · `start:speech` 스크립트 · `.env.example`(§8.7 음성 절 · mock 운영 불가 주석).
6. **3050 "동작 확인"**: 후보(`small`·`large-v3-turbo` int8) 적재·VRAM·임베딩 동시 적재·무음 환각 관찰 → `eval/report/`에 "동작 확인"으로만 기록.
7. 제공물: **한글 숫자 정규화 규칙 표**(§7.4 ④ 확정) · **상투 문장 목록**(§7.4 ③) · 전사 옵션 권고 · 장비 등급표 음성 열 초안 · 운영 실측 계획(평가 세트 출처·라이선스·CER · No.17과 묶음).

### 17.2 `backend-implementer` (`apps/api` · `packages/shared-types`)

1. 커밋 ①: shared-types 전부(§4) + 골든 캡처(시스템 안내 3종 응답 포함).
2. 마이그레이션(§3.2 — 부분 인덱스 4 확인).
3. `speech` 모듈(§2.3) — 포트·구현 2·팩토리 · 캐시 · 가용성(운영 mock 백엔드 판정 포함) · 세마포어 · 집계 기록기 · 순수 lib.
4. 공개 경로·서비스 통합(§2.6 표 그대로 — **`withSpeech`는 2지점만 · 전치 출력 `slice`**) · 버킷 · 오류 코드.
5. `PendingAnswerStore`·`RagAnswerService` 선택 필드(§6.5).
6. 관리 API·감사·영구삭제·지도·기동 검사·환경변수 · **`config/runtime-env.ts` + `validate()` 운영 mock 교차 검사(DD-135)**.
7. 시험: §15.2 API 행 · VO-1~VO-17 · X-1~X-12(이 커밋에서만).
8. 숫자 정규화·상투 목록은 ml-engineer 표를 받아 상수·시험 표로 고정(받기 전에는 §7.4의 제안 규칙 + "확정 대기" 주석).

### 17.3 `ui-designer` → `frontend-implementer`

- ui-designer: `docs/03-design/voice-ai-ui-spec.md` — 위젯 마이크·녹음 상태·인식 중·듣기/멈추기·자동 읽기 토글·비활성 이유·오류 문구 8종(§5.5 초안) · 첫 사용 고지 자리(미구현 표기) · 콘솔 음성 구역(§10.3 — **미응답 말투 1종 · 시스템 안내 미낭독 안내 1줄 · 법무 확인 전 경고 글자**) · **말투 4종 화면 이름 · 대응표 값(실제 기기 청취 후 — `SPEECH_TONE_PARAMS` 갱신)** · 자동 재생 제한 조항 번호 · `UIUX_준수기준.md` 패턴 추가 제안.
- frontend-implementer: 위젯 §9 · 콘솔 §10.3 · 서브패스 소비 · VO-9·VO-15 · 번들 증가분 기록.

### 17.4 `test-automation` · `deployment-engineer`

- test-automation: §15 · 수동 게이트 결과 문서(`docs/04-test/`) — 브라우저·기기별 기기 안 한국어 음성 표(U-5).
- deployment-engineer: `docs/05-ops/자동배포.md` §5.8 음성 인식 열·모델 반입·설치 점검(스위치·프로세스 분리·라이선스·동시 처리·HTTPS)·고객사 삽입 안내(HTTPS·`Permissions-Policy: microphone`·아이프레임 `allow="microphone"`·듣기 기기 조건) · **§2 Compose 구성(안)의 `api` 서비스에 `NODE_ENV=production` 명시**(DD-135 — 운영 판별 기준) · **§17.5 개통 전 체크리스트를 운영 문서에 전재**. 실 배포 착수 금지(사용자 지시 전).

### 17.5 ★ 고객 개통 전 체크리스트 (H-5·H-10 PM 결정 — OC-1~OC-8)

> **대상**: 고객 설치에서 **서버 음성 입력(`SPEECH_ENABLED=true`)을 켜기 전**. 항목이 하나라도 미완이면 `SPEECH_ENABLED=false`를 유지하고 챗봇 음성 입력을 켜지 않는다. **코드로 강제하지 않는다**(법무 확인 여부는 시스템이 알 수 없다 — DD-133 · 운영 절차 게이트). 단 OC-5의 운영 mock은 코드가 막는다(DD-135). 답변 듣기(`ttsEnabled` — 서버 자원·음성 수집 0)는 OC-1·OC-2·OC-3의 대상이 아니다(OC-7만 해당).

| # | 항목 | 확인 방법 · 근거 | 미완 시 |
|---|---|---|---|
| **OC-1** | **법무 확인 — 음성 처리 첫 사용 고지**(문구·필요성 · No.36 P-11 AI 답변 고지와 함께) | 법무 회신 기록(일자·담당) · 필요로 판정되면 고지 구현(위젯 단일 호출 지점 `ensureSpeechNoticeAcknowledged()` — DD-133 · 별도 요청) 후 개통 · 요구사항 U-1 · FR-VO1-2 | 음성 입력 개통 불가 |
| **OC-2** | **법무 확인 — 음성 원본의 법적 성격**(생체인식정보 해당 여부 · 식별에 쓰지 않음 · 저장 0·디스크 0 근거 제시) | 법무 회신 기록 · 요구사항 U-2 · §11.1 | 음성 입력 개통 불가 |
| **OC-3** | STT 운영 합격 실측(L40S · No.17과 함께 — CER·10초 발화 P95) | `eval/report/` 운영 실측 기록 · 요구사항 U-6 · §8.8 | 음성 입력 개통 불가(3050 "동작 확인"은 근거 아님) |
| **OC-4** | 모델·디코더·VAD 라이선스 원문 기록(상업 이용 가능) | 보고서 부록 · 요구사항 U-4 · FR-0-331 | 개통 불가 |
| **OC-5** | **운영 설정**: API `NODE_ENV=production` · `SPEECH_PROVIDER=local` · `ML_WORKER_SPEECH_URL` · ml-worker `ML_WORKER_ROLE=speech`(별도 프로세스) · `STT_BACKEND=faster-whisper` · `STT_MODEL_ID` | API 기동 성공(운영 mock이면 기동 실패 — DD-135) · `GET /speech/health` `backend`·`modelId` 확인 · 콘솔 음성 구역 서버 상태 "사용 가능" · **`NODE_ENV=production`이 배포 설정(Compose `api` 서비스 `environment` · 서비스 단위 파일 · 설치 점검 목록)에 명시돼 있는지 확인 — 빠지면 운영 mock 차단이 기동 경고로만 내려간다(fail-open · 코드 리뷰 L-6 · K-17 · I-15)** | 기동 실패 또는 입력 불가로 수렴(`NODE_ENV` 누락 시에는 경고만 — 체크리스트로 막는다) |
| **OC-6** | 거버넌스 모드 ON 설치면 `ML_WORKER_SPEECH_URL` 호스트를 허용 목록에 등록 · 데이터 지도 `SPEECH_LOCAL` 행·`speech` 절 확인 | 기동 검사 · 데이터 지도 화면 | 기동 실패 |
| **OC-7** | 고객사 삽입 조건: HTTPS · `Permissions-Policy: microphone` · 아이프레임 `allow="microphone"` · 듣기는 기기 한국어 음성 필요(일부 PC 비활성) 안내 전달 | 고객사 삽입 안내 문서 전달 기록(FR-VO7-5) | 마이크 버튼 미노출(기능 저하) |
| **OC-8** | 동시 처리 상한·요청 한도 값을 장비 등급에 맞게 설정(`SPEECH_MAX_CONCURRENCY`·`STT_MAX_CONCURRENCY`·`PUBLIC_SPEECH_RATE_LIMIT_*`) · 남용 위험(요구사항 R-13) 고지 | `.env` 확인 · 등급표 §5.8 | 혼잡 거절 증가 |

---

## 18. 알려진 제한 (K)

| # | 제한 |
|---|---|
| K-1 | 세션 결합은 검증 불가(C-12) — 세션 id를 바꿔 가며 보내면 세션 축은 무력. 실질 통제 = IP 30/분 · 동시 2 · 1MB · 32초 · 15초 수신 · Origin. **PM 수용(H-1 — 서명 토큰 1차 미도입)** · 남은 위험은 요구사항 R-13 |
| K-2 | 단일 인스턴스 전제(세마포어·가용성·설정 캐시는 프로세스별). 다중 인스턴스면 동시 상한이 인스턴스 수만큼 곱해진다 — ml-worker 2차 상한이 최종 방어 |
| K-3 | 읽기 목소리·음질·숫자 읽기는 기기 의존 · 한국어 기기 음성 없는 PC는 듣기 불가(R-11) |
| K-4 | Android 등에서 `localService` 값 신뢰성 미확인 — 값이 틀리면 온라인 음성이 쓰일 수 있다(U-5 수동 게이트로 확인) |
| K-5 | 기기 음성이 pitch·volume을 무시할 수 있다(EX-VO-21) — 말투가 빠르기 차이만으로 들릴 수 있다 |
| K-6 | 한글 숫자 정규화는 숫자 음절 열·6자리 이상만 — 자릿값 읽기·섞임 표기·짧은 숫자는 그대로(기존 마스킹이 못 잡을 수 있음 — EX-VO-9) · **아라비아 숫자 토큰과 맞닿은 구간은 바꾸지 않는다**("010 일이삼사 오육칠팔") · **조사·어미가 붙은 토큰**("…오육칠팔이에요")은 숫자 토큰이 아니라 그 토큰부터 바뀌지 않는다 · 규칙 전체는 3050 실측 후 확정 대기(§7.4 ④ · I-13) |
| K-7 | 상투 문장(환각) 목록 1차 비어 있음 — 사용자 확인 후 전송(P-2)이 유일한 흡수 장치 |
| K-8 | 기능 선언 4/5 사용 — 다음 기능 선언 1개 뒤에는 상한(`max(5)`) 상향이 필요(서버가 먼저 배포돼야 한다) |
| K-9 | 노드 말투 꼬리표는 환경·스냅샷 밖 — 스테이징 변경이 운영에 즉시 적용 · 복원해도 꼬리표는 돌아가지 않는다(말투만 영향 · H-2 PM 수용) |
| K-10 | 3050 4GB에서 STT GPU와 Ollama 생성 GPU 동시 적재는 불가할 수 있다 — 시연은 한쪽을 CPU로 |
| K-11 | 세그먼트 디코딩 중간 중단 불가 — 데드라인 초과는 세그먼트 1개만큼 늘 수 있다(API 10초 제한이 최종 상한) |
| K-12 | `speech` 역할 프로세스의 `/health`는 `loading`(역할 무관 계약) — 운영 감시는 `/speech/health`로 해야 한다 |
| K-13 | 첫 사용 고지 미구현(법무 전 — U-1) · **법무 확인은 개통 조건(OC-1·OC-2)이나 코드로 강제하지 않는다** — 운영자가 체크리스트 없이 켜면 고지 없이 동작한다(콘솔 경고 글자로만 알림) |
| K-14 | 공개 인식 경로는 503으로 통일하지만 Origin 거절(403)·설정 조회(404/403)로 챗봇 존재는 이미 드러난다 — 이 경로가 새로 여는 탐지 정보는 "음성 입력 켜짐 여부"뿐이고 그것도 503 통일로 가린다 · **[구현 확인 — I-3] 공통 Origin 가드가 음성 경로에서도 핸들러보다 먼저 돌아, Origin이 허용 목록 밖이면 존재하는 슬러그는 `403`·없는 슬러그는 `503`으로 응답이 갈린다**(R-8 한계) — 기존 공개 API 전체와 같은 동작이고 설정 조회로도 이미 드러나는 정보라 가드 순서는 바꾸지 않는다 |
| K-15 | 노드 꼬리표는 엔진 결과 `matchedNodeId`(최종 노드) 기준 — 대화 이동(`DIALOG_MOVE`) 체인 중간 노드의 꼬리표는 쓰이지 않는다 |
| **K-16** | **[개정 추가 — H-3] 자동 읽기 사용자는 시스템 안내를 소리로 듣지 못한다** — 금지어 안내·일시 장애 문구에는 소리가 없고, 외부 RAG 대기 중(최대 90초)에는 침묵한 뒤 최종 답만 읽힌다. 화면 글자와 기존 메시지 목록의 스크린리더 낭독은 그대로다. 소리만 쓰는 사용자가 "왜 대답이 없지"를 겪을 수 있다(PM 수용 — 재검토 트리거 §22) |
| **K-17** | **[개정 추가 — H-10] 운영 판별은 `NODE_ENV=production`에 의존한다** — 운영 설치가 이 값을 넣지 않으면 판별되지 않아 `mock`이 경고만으로 기동된다(fail-open). 보완 = 개통 전 체크리스트 OC-5 · 기동 경고 · 데이터 지도 "모의 인식" 표시 · deployment-engineer Compose 안에 명시(§17.4) |

---

## 19. 요구사항 대비 해석 · 조정 (R)

| # | 요구사항 | 해석·조정 | 이유 |
|---|---|---|---|
| R-1 | FR-VO4-6 "노드 **출력**의 선택 필드 `tone?`" · §5.1 DB "노드 출력의 선택 필드" | **노드 단위 꼬리표 · 음성 설정 행(`nodeTones`)** — **H-2 PM 수용 · 요구사항 정정 완료** | 응답 1건 = 말투 1개 · 출력 스키마 14종·해시·복원 변경 회피(DD-128) |
| R-2 | FR-VO3-1 "말풍선마다 듣기" | **응답(묶음)마다 1개** — **H-6 PM 수용 · 요구사항 정정 완료** | 응답 하나가 여러 말풍선(캐러셀·버튼)으로 그려진다 · 읽기 단위 = 응답 |
| R-3 | §1.7 "상담 연결 안내 = 차분함" | 해당 응답 종류 없음 → 종류별 지정은 `UNANSWERED` 1종(H-3으로 `BLOCKED`·`ERROR`도 사라짐) — **H-4 PM 수용 · 요구사항에서 삭제 완료** | §6.2 |
| R-4 | §5.2 `SPEECH_MAX_AUDIO_SECONDS`(api) | ml-worker `STT_MAX_AUDIO_SECONDS`(32) · 위젯 상수 30 | 길이는 디코딩 뒤에만 안다 |
| R-5 | `SPEECH_VAD_ENABLED` | `STT_VAD=auto｜silero｜energy｜off` | CI(onnxruntime 없음)와 운영 구분 |
| R-6 | `STT_MODEL_ID` 기본 `mock` | `STT_BACKEND=mock` 기본 · `STT_MODEL_ID`는 실제 모델에서 필수 | 백엔드와 모델을 한 칸에 섞지 않는다(No.37 선례) |
| R-7 | FR-VO2-4 숫자 정규화 "STT 단계" | API 후처리 | 공급자 무관(DD-131) |
| R-8 | FR-VO2-2 "존재 탐지가 안 되는 일관된 응답" | 인식 경로 안의 모든 "처리할 수 없음" = `503 SPEECH_UNAVAILABLE` — **단 핸들러 앞 공통 가드(Origin 불허 `403` · 요청 한도 `429`)는 이 통일 밖**(I-3) | K-14 |
| R-9 | FR-VO3-1 "시스템 안내 등에는 버튼 없음" | **원문대로(H-3 PM 결정)** — 서버 시스템 안내 3종(금지어 안내·일시 장애·RAG 대기)에 `speech` 0 · **No.36 안전 문구 대체는 봇 답변으로 본다**(DD-136 근거 a~e). 초안의 "봇 말풍선 안내도 읽는다" 해석은 **철회** | 요구사항 J-8·FR-VO3-1 원문 · PM 결정 |
| R-10 | FR-VO5-1 "기본 전부 꺼짐" | 기능 스위치 2개(입력·듣기)는 꺼짐 · **토글 노출 여부는 기본 노출**(토글 자체는 꺼짐) — **H-7 PM 수용 · 요구사항 정정 완료** | 노출만으로 소리가 나지 않는다 · 사용자가 찾을 수 있어야 한다 |
| R-11 | AC-VO2-9 "세션·슬러그 불일치" | 세션 불일치 판정 불가(C-12) → 슬러그·상태 불일치의 단일 503으로 재정의 — **H-1 PM 수용 · 요구사항 정정 완료** | C-12 |
| R-12 | FR-0-243류 — 선제 조회 경로의 `voice` | 선제 조회(`?proactive=1`) 응답에도 같은 `voice`를 붙인다 | 설정 객체 1벌 · 별도 분기 비용 |
| R-13 | §5.1 일별 종류 4개 | +`invalid`(형식·크기 거절) 분리 | 서버 실패와 사용자 환경 문제를 구분 |
| R-14 | FR-VO1-5 Esc | 녹음 중 Esc = 버림 · 인식 중에도 취소(FR-VO1-8과 합침) | — |
| R-15 | NFR-VOR3 "설정 오류는 음성 인식 프로세스만 기동 실패" | ml-worker 쪽은 그대로 · **API의 `SPEECH_PROVIDER` 잘못된 값은 기존 enum 규약대로 API 기동 실패** · 단 `local`의 주소 누락은 기동 경고 + 사용 불가 — **H-8 PM 수용 · 요구사항 정정 완료(§12.3)** | 모든 API enum 환경변수의 기존 규약(`AUGMENTATION_PROVIDER` 선례) |
| **R-16** | (H-10 결정의 범위) "운영 ∧ 켜짐 ∧ mock = 기동 실패" | **`local` ∧ 주소 누락은 운영에서도 기동 실패로 올리지 않는다**(경고 + 사용 불가) | 결정의 취지는 "가짜 인식 결과의 사용자 노출" 차단 — 주소 누락은 가짜 결과가 아니라 마이크 숨김으로 안전하게 수렴한다 · 기동 실패 확대는 PM 결정 범위 밖 |
| **R-17** | (H-10 결정의 다른 입구) | **운영이면 ml-worker `STT_BACKEND=mock` 프로세스를 사용 불가로 본다**(API `healthy()` — 런타임 · 기동 실패 아님) | 같은 가짜 결과가 `local` 경로로도 나갈 수 있다 · ml-worker 상태는 API 기동 시점에 알 수 없어 기동 실패로 만들 수 없다 · 판별 정의 1곳(API) 유지 — **architect 확장 · PM 결정 취지의 적용**(이견 시 되돌리기 쉬움: `healthy()` 1조건) |

---

## 20. ★ 요구사항 환류 — PM 결정 (2026-10-01 · 전부 결정됨)

| # | 쟁점 | 설계의 처리(초안) | **PM 결정** | **반영** |
|---|---|---|---|---|
| **H-1** | **FR-VO2-2·AC-VO2-9 "세션이 그 챗봇 것일 때만"은 지금 구조로 검증할 수 없다**(세션 = 클라이언트 생성 UUID · 서버 등록부 없음 — ADR-0009). 공격자는 임의 UUID로 호출할 수 있다 | 세션은 레이트 축 분산 키로만 쓰고, 실질 통제는 IP 30/분·동시 2·크기·길이·수신 시간·Origin(K-1). 서버 발급 단기 토큰은 **기각** | **대체 통제 수용 · 서명 토큰 1차 미도입** | 설계 변경 0(C-12·K-1·§5.3·§5.4 문구) · 요구사항 FR-VO2-2·FR-VO6-4·AC-VO2-9·EX-VO-10·EX-VO-19·R-2·§1.4·§5.1 정정 · **요구사항 R-13(남은 위험) 신설** · 재검토 트리거 §22 |
| **H-2** | "노드 출력별 말투"가 **노드별 꼬리표(음성 설정 안)** 로 바뀌었다 · 스냅샷·환경 밖 | DD-128 · K-9 | **설계안 수용** | 요구사항 FR-VO4-6·§1.7 ②·§2.1·§5.1·AC-VO3-11 정정 |
| **H-3** | FR-VO3-1 "시스템 안내에는 듣기 버튼 없음"과 충돌 — 초안은 금지어 안내·일시 장애·RAG 대기 문구를 읽기 대상으로 넣었다(구 R-9) | (초안) 말투 각각 안내·사과·안내 | **봇 답변만 읽는다 — 시스템 안내 문구에 `speech` 0 · FR-VO3-1 원문 유지** | **DD-136 신설** · 응답 종류 6 → 3(`BLOCKED`·`ERROR`·`WAITING` 삭제) · `toneByKind` 허용 키 `UNANSWERED`만 · `SpeechReplyPlan` 말투 4 → 2 · 반환 지점 5 → 2(+보류 계획 저장) · C-4·C-16 · §6.2·§6.4·§6.5·§9.4·§9.5·§10.3 · VO-17 · 시험(§15) · K-16 · 콘솔 안내 1줄 · **안전 문구 대체 = 봇 답변(근거 DD-136 a~e)** · `@Public()` 영향 0(§5.6) · 요구사항 FR-VO4-1·FR-VO4-4·§1.7·§5.1·AC-VO3-5·AC-VO3-14(신설)·EX-VO-25(신설) 정정 |
| **H-4** | §1.7의 "상담 연결 안내 = 차분함"은 **봇 응답 경로에 대응 종류가 없다** | 종류별 지정만(R-3) | **설계안 수용** — J-8 확대 안 함 | 요구사항 §1.7 ③·FR-VO4-4에서 "상담 연결 안내" 삭제 + 사유 각주 |
| **H-5** | **U-1 첫 사용 고지가 미구현인 채로 고객 개통이 가능**하다 | 위젯 단일 호출 지점만(DD-133) · 콘솔 경고 글자 | **고객 개통 조건에 법무 확인(첫 사용 고지·음성 원본 법적 성격 U-1·U-2) 포함 · 구현은 고지 자리만** | **§17.5 개통 전 체크리스트 OC-1~OC-8 신설** · DD-133 · K-13 · §10.3 ② · §17.4(운영 문서 전재) · 요구사항 U-1·U-2·FR-VO1-2·FR-VO7-4·AC-VO5-5(신설) 정정 |
| **H-6** | "말풍선마다 듣기" → **응답마다 1개**(R-2) | — | **설계안 수용** | 요구사항 FR-VO3-1 "말풍선마다" → "봇 답변 응답마다 1개" |
| **H-7** | "기본 전부 꺼짐" 중 **자동 읽기 토글 노출만 기본 켬**(R-10) | 토글 자체는 꺼짐 · 자동 재생 0 | **설계안 수용** | 요구사항 FR-VO5-1 각주 |
| **H-8** | NFR-VOR3과 API enum 규약 충돌(R-15) | `SPEECH_PROVIDER` 오타 = API 기동 실패 | **기존 enum 규약대로 기동 실패 수용** | §12.3 · 요구사항 NFR-VOR3 정정 · AC-VO4-7 신설 |
| **H-9** | `durationMs`는 "녹음 길이"(처리 시간 아님) | §5.3 | **설계안 수용** | §4.1·§5.3·§8.3 문구 · 요구사항 FR-VO2-1·§5.1 정정 |
| **H-10** | `SPEECH_ENABLED=true`인데 `SPEECH_PROVIDER`가 기본값(`mock`)이면 **가짜 인식 결과가 실제 사용자에게 나간다** | (초안) 기동 경고 + 데이터 지도 표시 + 설치 점검 목록 | **운영 환경(`NODE_ENV=production` 등 기존 판별 기준)에서 서버 음성 스위치 켜짐 ∧ `mock` = API 기동 실패** | **DD-135 신설**(기존 판별 기준이 없어 `NODE_ENV=production`을 처음 도입 — C-17) · §7.2·§7.3 환경별 동작 표 · §12.1·§12.3 · §15 시험·AC-VO4-6 · K-17 · OC-5 · R-16·R-17 · ml-worker `.env.example` 주석 · 요구사항 NFR-VOR3·FR-VO7-4·§5.2 정정 |

---

## 21. 상위 문서 반영 — `docs/02-spec/voice-ai-patches.md` (⏳ 적용 대기 — 2026-10-01 구현 반영으로 내용 갱신)

개발명세서 §1·§2·§2.2·§3·§4·§5.1·§6(결정 51 · 결정 16·17·29 갱신 각주)·§7, 기능요구사항 74행(구현 완료 시), ADR-0024(재검토 트리거 해소 + §갱신)의 찾기/바꾸기 항목. 각 "찾을 원문"은 2026-10-01 작업 트리에서 **1회 매칭을 확인**했다(대상 파일 CRLF). `CLAUDE.md`는 대상이 아니다. **PM 환류 결정 반영으로 A-7·A-9·A-12·A-13·A-17·A-18·A-19의 "바꿀 내용"을 갱신했다**(찾을 원문은 불변). **구현 반영(2026-10-01)으로 A-5·A-6·A-9·A-12·A-13·A-15·A-16·A-17·A-18·B-1·C-2의 "바꿀 내용"을 다시 갱신했다**(찾을 원문 불변 · 22건 앵커 1회 매칭 재확인 · B-1은 "구현 완료(수동 게이트 남음)"로 적용 조건 충족). 이 설계서·요구사항·화면 명세(LF)의 구현 반영 패치도 같은 파일 §D·§E·§F에 있다. ADR-0052는 architect가 직접 갱신했다(§12).

## 22. 재검토 트리거

| 트리거 | 다시 정할 것 |
|---|---|
| 고객이 기기별 목소리 편차·한국어 음성 없는 PC를 실제로 제기 / 감정 표현 강한 음성 요구 | 서버 사내 합성(TTS 모델 · 합성 공개 경로 · 결합 검증 · 출구 클래스) — 요구사항 §10 |
| U-5 수동 게이트 결과 듣기 가능 사용자 비율이 낮음 | 같음 + PM 판단 |
| **공개 인식 경로 남용 관측**(일별 `busy`·`invalid` 급증 · 다수 IP 분산 호출 — 요구사항 R-13) | **세션 서명 토큰**(설정 조회 시 발급 → 인식 요청 첨부 — H-1에서 1차 미도입) · IP 축 한도 하향 · 서버 스위치 즉시 끄기 |
| **자동 읽기 사용자의 "무응답" 불만**(시스템 안내·RAG 대기 침묵 — K-16) | 읽기 대상에 시스템 안내 포함(H-3 재결정 — `toneByKind` JSON에 키 추가로 마이그레이션 0) 또는 위젯 자체 짧은 알림음 |
| 운영 판별 기준을 프로젝트 공통으로 도입(예: 배포 환경 변수 표준화) | `isProductionRuntime()` 정의 교체(1곳 — DD-135) |
| 실시간 스트리밍(규모 B) 확정 | 공개 API 첫 상시 연결 ADR · `speech` 역할의 스트리밍 경로 |
| 전화 채널(규모 C) 확정 | 새 채널 종류 `PHONE` · 8kHz 모델 · No.39 재개 판단 |
| 다중 인스턴스 전환 | 동시 상한·캐시를 공유 저장소로(K-2) |
| 기능 선언 6번째 필요 | `features.max(5)` 상향(서버 선배포 — K-8) |
| No.33(멀티모달) 착수 | `SpeechRecognitionProvider` 재사용 · 비전 모델은 **별도 배타 역할**(이 ADR의 방식 그대로) |
| 클라우드 STT 요구(구독형) | 새 출구 클래스 + 거버넌스 모드 기본 차단 + 원본 벤더 전송 고지 |

## 23. 구현 편차 기록 (구현 후 작성 — I-n)

> 2026-10-01 구현·코드 리뷰 결과. 각 항목은 본문 해당 절에도 반영했다(본문 표기 "I-n"). **결정·계약(공개 경로 수·응답 키·오류 코드·말투 식별자·권한·읽기 대상 경계)을 바꾼 항목은 없다** — 위젯 증가 예산(I-10)만 PM 결정으로 수치가 바뀌었다.

| # | 구분 | 설계 원안 | 구현·확정 | 반영 절 |
|---|---|---|---|---|
| **I-1** | 단순화 | 설정 캐시 = 전역 색인(켜진 챗봇 id 집합) + 챗봇별 캐시 2단 | **1단** — 색인이 켜진 챗봇의 설정 자체를 담는다(켜진 행만 적재 · 쿼리 1 · TTL `SPEECH_SETTINGS_CACHE_TTL_MS` 60초 · 저장 시 같은 인스턴스 즉시 무효화(세대 번호로 진행 중 적재 결과 폐기) · 적재 실패 시 직전 값 유지 + 5초 뒤 재시도 · 한 번도 못 받았으면 꺼짐으로 본다). 음성 미사용 챗봇 추가 쿼리 0(C-14)은 그대로 | §2.3 |
| **I-2** | 보강(코드 리뷰 M-3) | 인식 `FAILED(NETWORK｜TIMEOUT｜HTTP_5XX)` 즉시 가용성 하락 | `NETWORK` 즉시 · `TIMEOUT`·`HTTP_5XX`는 **연속 `SPEECH_FAILURE_THRESHOLD`회(기본 3 · 1~20)** · 임계 미만은 `healthy()` 재확인 · 성공 시 0 · 세대 번호 경합 방어 · API 선택 환경변수 10 → 11 | §5.1 · §12.1 |
| **I-3** | 사실 확인(한계) | 1단계 서버 꺼짐 = "DB 0" · 인식 경로 상태 불일치 = 단일 503 | 공통 `PublicOriginGuard`가 음성 경로에도 **핸들러보다 먼저** 돌아 슬러그로 챗봇·WEB 채널을 조회한다(최대 2쿼리 · 서버 꺼짐이어도). "DB 0"은 **음성 쪽 조회 0**으로 정정. Origin 불허면 존재하는 슬러그만 `403`이라 존재·부재 슬러그 응답이 다를 수 있다(R-8 한계) — 기존 공개 API 전체 동작이고 설정 조회로도 드러나는 정보라 **가드 순서는 바꾸지 않는다** | §5.3 · §16 · K-14 · R-8 |
| **I-4** | 의도 명시 | 본문을 다 받은 뒤 세마포어(DD-122) | 대가 기록 — 읽는 동안 **동시 수신 요청 수 × 최대 1MB**가 메모리에 있을 수 있다(레이트 버킷·15초 수신 상한이 간접 상한) | §5.3 |
| **I-5** | 구현 결정 | (언급 없음) | api는 shared-types 서브패스를 import하지 않고 **루트 index 재수출**만 쓴다(서브패스는 위젯·콘솔 전용) | §4.3 |
| **I-6** | 사실 확인 | 지도 `speech?`는 켜졌을 때만 | 판정을 위해 `chatbotVoiceSetting.count` **2건이 매 지도 조회마다** 실행된다(기본 설치 포함) — 결과 0이면 키 없음 → 응답 바이트 불변 | §11.2 |
| **I-7** | 봉인 구체화 | VO-5 "`.transcribe(` 호출 파일" | 공급자 `provider.transcribe(` = 공개 인식 서비스 1곳 · 대화 서비스의 `.transcribe(` = `transcribeSpeech` 메서드 1곳 | §14 VO-5 |
| **I-8** | 기대값 변경 추가 | 닫힌 목록 X-1~X-11 | **X-12** — `topic-sealing.spec.ts` 공개 스키마 전수 목록에 `PublicSpeechReplySchema` 추가(닫힌 목록 12번째). 다른 목록 밖 변경 0 | §15.3 |
| **I-9** | 구현 결정 | `migrate dev --create-only` 생성 후 `DROP INDEX` 줄 확인 | `20261001120000_voice_ai`를 **직접 작성**(CREATE TABLE 2 + CREATE UNIQUE INDEX 1 · ALTER·DROP 0) | §3.2 |
| **I-10** | **PM 결정** | 위젯 gzip 증가 ≤5KB(추정 3~4KB) | **≤7KB**(PM 2026-10-01) — 실측 +6,315B(+6.17KB) · 100KB 게이트 통과 · `check-bundle-size.mjs`가 증가분 기록(초과는 경고만) · **Preact 재검토 트리거 미발동 유지** | §2.7 · §9.7 |
| **I-11** | 보강(코드 리뷰) | `503 SPEECH_UNAVAILABLE` → 마이크 숨김 | 위젯은 `503`을 **재시도 가능 실패(FAILED)** 로 둔다(일시 장애일 수 있다 · 포커스 말하기 버튼 · 문구 "지금은 음성 입력을 쓸 수 없어요. 글자로 입력해 주세요.") · **마이크 제거는 `403`(분류 `DISABLED`)만**. 위젯은 설정을 페이지당 1회만 조회하므로 EX-VO-12의 "다음 설정 조회" = **새로고침** | §5.1 · §5.5 · §9.3 · §9.6 |
| **I-12** | 화면 명세 확정 반영 | §9.1 파일 목록 · Esc·포커스·대기 상한·자동 읽기 세부 미정 | 변경 파일 +4(`ui/panel.ts` `setEscapeGuard` · `core/session.ts` `getItem`/`setItem` export · `ui/dom.ts` 신규 · `scripts/check-bundle-size.mjs`) · `composer.setMicSlot(strip, mic)`·`setInputHook(fn)` · Esc 우선순위 · 대기 상한 15초 · 포커스 규칙 · 자동 읽기(최신 답 우선 · 창 닫힘·탭 숨김·녹음 중 도착 답 미낭독 · 볼륨 0 공백 발화로 재생 권한 확보) | §9.1 · §9.3 · §9.4 |
| **I-13** | 보강(코드 리뷰 M-1·M-2) | 한글 숫자 = 6자리 이상 숫자 음절 구간 변환 · 반복 3회 축약 | 낱글자 공백 읽기 = 이어 붙임 · 군집 = 하이픈 · 아라비아 숫자 맞닿음 비변환 · 조사 붙은 토큰 한계 · 숫자·구분자만의 반복 단위는 축약 제외 · **규칙은 3050 실측 후 확정 대기** | §7.4 · K-6 |
| **I-14** | 보강(코드 리뷰 M-5 외) | 디코더 = `av.open(BytesIO)` | `protocol_whitelist="pipe"` · `format_whitelist`(matroska·webm·mov·mp4·m4a·3gp·3g2·mj2·ogg·wav) · 열린 뒤 `container.format.name` 대조 → 불허 `INVALID` · 오류 HTTP 상태 확정(INVALID 400 · TOO_LARGE 413 · TOO_LONG 413 · BUSY 503 · DEADLINE 504 · LOADING 503 · FAILED 500) · `STT_MAX_AUDIO_SECONDS` 실수 · `start:speech` 래퍼(Windows) · `/speech/health` 실제 device·computeType · VAD 세션 공유 스레드 안전 확인 | §8.1 · §8.3 · §8.4 · §8.5 · §12.2 |
| **I-15** | 운영 절차 보강(코드 리뷰 L-6) | OC-5 운영 설정 | `NODE_ENV=production` 미설정 시 운영 mock 차단이 경고로만 내려가므로(K-17) **배포 설정·체크리스트에 명시 확인 항목** 추가 | §17.5 OC-5 |
| **I-16** | 화면 보강(코드 리뷰 L-5) | 인식 글자로 1,000자 초과 시 남은 글자 음수 표시 | 위젯 공통 입력창이 "N자 초과 · 줄여 주세요"(문구 제안)를 남은 글자 영역에 보이고 전송 `aria-disabled` — 음성 전용 문구가 아니다 | 화면 명세 §4.2.1·§8.1 |
