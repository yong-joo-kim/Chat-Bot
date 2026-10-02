# 시연 하네스 확장(DT-2) 설계 — 풀 투어 프리셋 · 모델 장면 선택 플래그

> **작성**: system-architect · 2026-10-02
> **입력**: 요구사항 `docs/requirements/demo-harness-expansion.md`(FR-0-349~353 · 접두 DX · §14 P-DX-1~14) · PM 결정(2026-10-02): **P-DX-1 = C** · **P-DX-2 = DT-1 3단계 완료 후(지금)** · **P-DX-7 = 로컬 생성 모델은 플래그를 켰을 때만 고객 시연 허용** · **P-DX-3·P-DX-10 = STT 장치 `auto`·모델이 없으면 고객 시연은 해당 장면 생략+이유 표시·모의 인식은 내부 점검에서만** · 나머지 P-DX-4~6·8~9·11~14는 요구사항 권고안 채택
> **선행 설계(상속)**: `docs/02-spec/demo-harness-설계.md`(DT-1 · DHD-1~16 · §0.1 정정 13건) · ADR-0051 · DT-1 요구사항 `docs/requirements/demo-harness.md`
> **근거로 읽은 코드(DT-1 3단계 작업 트리 포함)**: `tools/demo-harness/src/scenario/{types,runner,definition-check,pacing,badges}.ts` · `scenarios/{index,opening,s4,s5,s7,closing,helpers}.ts`(s1~s3·s6은 단계 ID·예산·생략 순서) · `presets/{index,customer-onprem-10m}.ts` · `orchestrator/{index,show-phase}.ts` · `env/api-env.ts`(FR-DX0-2 반영분·`EGRESS_EXIT_COVERAGE`) · `data/{roadmap,dataset}.ts` · `servers/stage-server.ts` · `stage/facts.ts` · `report/schema.ts` · `cli/args.ts` · `selectors/widget.ts` · `browser/session.ts`(43~53행) · `docs/05-ops/시연_하네스.md` · 제품: `apps/api/src/augmentation/providers/augmentation-provider.factory.ts`(74~123행) · `augmentation.service.ts`(64~108행) · `augmentation.controller.ts`(경로) · `apps/ml-worker/src/ml_worker/{app.py(84~251·304~442행),config.py,generator.py(275~442행)}` · `apps/widget/src/constants/{speech,proactive}.ts` · `apps/widget/src/ui/{mic-button,speech-button,proactive-bubble}.ts` · `apps/web/src/pages/chatbot-detail/channels/ChannelCard.tsx`(155~196행) · `proactive/ProactiveSection.tsx`(19~22행) · `apps/web/src/constants/messages.ts`(voice 4819~4987 · proactive 4990~ · 발화 분석 내보내기 5183·5366~5368) · `apps/web/src/App.tsx`(175·207~222행) · `packages/shared-types/src/{proactive,guardrails}.ts` · 문서 `voice-ai-설계.md` §5·§8·§9·§10·§11·§12 · `proactive-messaging-설계.md` §5 · `apps/ml-worker/eval/report/stt-3050-dongjak-hwakin.md`
> **결정 기록**: `docs/02-spec/decisions/ADR-0053-demo-harness-expansion-full-tour-preset-plan-context-model-scene-flags-and-local-llm-in-customer-demo.md`(신규)
> **상위 문서 패치**: `docs/02-spec/demo-harness-expansion-patches.md`(적용 대기 — 대상 3개가 CRLF 파일이고 이 세션에는 부분 편집 도구가 없어 바이트 보존 적용을 하지 않았다)
> **범위 원칙**: 코드를 쓰지 않는다. **제품 코드(`apps/*`·`packages/*`) 변경 0 · `data-testid` 0 · 마이그레이션 0 · 새 제품 환경변수 0 · 새 권한 0 · 제품 의존성 변경 0 · 루트 설정 4개(`pnpm-workspace.yaml`·루트 `package.json`·`pnpm-lock.yaml`·`.gitignore`) 변경 0 · 하네스 의존성 추가 0 · CI·실 배포 0.** 바뀌는 것은 `tools/demo-harness/**`와 문서뿐이다(§18).
> **실행 한계**: 이 설계 세션은 셸을 실행하지 않았다. Edge 154의 가짜 미디어 인자·Ollama 적재/해제 API·Windows `nvidia-smi --query-compute-apps`·SAPI 합성 명령·헤드리스 `speechSynthesis` 음성 목록은 **도구·공식 문서 지식 기반**이며, 구현 첫 작업으로 §17.4의 **실기동 확인 X-1~X-10**을 둔다(DT-1이 §21.2 6건으로 한 방식과 같다).

---

## 0. 한눈에 보기

| # | 결정 | 내용 | 근거 |
|---|---|---|---|
| **DXD-1** | 프리셋 | 새 프리셋 **`customer-onprem-full`**(풀 투어). `--preset customer-onprem-full`로 고른다. **`customer-onprem-10m`은 정의·단계 ID·예산·검증 기대값·결과 키 집합 변경 0**(FR-0-349) — 10분판 파일은 손대지 않고, 풀 투어는 DT-1 단계 객체를 **얕은 복사(`derive`)로 재사용**한다 | §3.6 · NFR-DXM1 |
| **DXD-2** | 계획 문맥 | 실행 전 **계획 문맥(`PlanContext`)** 을 확정한다 — `voiceInput: off｜real｜mock` · `sttDevice: cuda｜cpu｜null` · `localLlm` · `liveClustering` · `voiceOmittedReason?`. 단계·구간은 `when(plan)` 술어로 **활성/비활성**이 정해지고, 예산은 **활성 단계 합**으로 계산한다(FR-DX1-4) | §3.1~§3.3 |
| **DXD-3** | 구간·ID | 구간 키 +3: `voice`(⑧)·`proactive`(⑨)·`edge`(⑩). 단계 ID 접두는 **글자 코드** `SV-`·`SP-`·`SE-`(숫자 8·10·11 대신 — 끝 구간 `S9`와 순서가 뒤섞이는 혼동 방지). 전역 순서 = `opening, s1..s7, voice, proactive, edge, closing`, 프리셋은 이 순서의 부분열만 허용(⑩ 뒤 음성 장면 금지가 구조로 강제됨) | §3.4 |
| **DXD-4** | 플래그 | `--with-voice-input` · `--with-local-llm` · `--live-clustering` · `--stt-device auto｜cuda｜cpu`(기본 `auto`) · `--voice-mock-check`(무인 점검 전용). 모두 **풀 투어 전용** — 10분판에 주면 시작 전 오류 | §4 |
| **DXD-5** | 프로세스 | 자식 2개(DT-1) → 최대 4개: **음성 인식 자식 `speech`(8102)** · **생성 자식 `augment`(8101)**. 임베딩 자식은 DT-1 그대로(CPU · `CUDA_VISIBLE_DEVICES=-1`). GPU 노출은 **음성 자식(cuda일 때)뿐** — 생성 자식도 `-1`(연산은 Ollama가 함) | §6 |
| **DXD-6** | 3050 순차 적재 | P4-L: 생성 자식 기동(워밍업이 Ollama 모델 적재) → 사전 생성 1회 → **Ollama 해제(`keep_alive:0`)·회수 확인** → P4-V: STT 기동 → 공연 ⑧⑨(STT 상주) → **⑩ 진입 시 STT 종료·VRAM 회수 확인 → Ollama 적재(빈 요청)** → 생성 → 해제·생성 자식 종료 | §5 · §11 |
| **DXD-7** | `PATH` 주입 | 음성 자식이 `cuda`일 때만 `PATH` **앞에** `.venv\Lib\site-packages\nvidia\{cublas,cudnn,cuda_nvrtc}\bin`(있는 폴더만 · 순서 고정). 다른 자식의 `PATH`는 부모 값 그대로. 시스템 허용 키의 값을 바꾸는 **유일한 예외**(단위 시험·정적 검사로 1파일 한정) | §6.3 |
| **DXD-8** | 증강 공급자 | **코드 확인: 증강 공급자는 프로세스 전역 1종**(`AugmentationProviderFactory.configuredProviderId` = `AUGMENTATION_PROVIDER` · 요청 본문에 공급자 선택 없음). → `--with-local-llm`이면 ④ **S4-03(규칙 기반 예문 늘리기)을 비활성**(같은 기능을 ⑩에서 로컬 생성으로 보인다) | §2 C-DX-1 · §9.4 |
| **DXD-9** | Ollama 제어 | 하네스는 Ollama를 설치·기동·종료하지 않는다. **적재 = `POST /api/generate {model}`(프롬프트 없음) · 해제 = `{model, keep_alive:0}` · 확인 = `GET /api/ps`**(Ollama 공식 API — 저장소 사용 선례 0 → 실기동 확인 X-4). ml-worker는 `keep_alive`를 보내지 않아 Ollama 기본 보존 시간 동안 VRAM에 남으므로 **해제는 선택이 아니라 필수** | §11 · C-DX-2 |
| **DXD-10** | 가짜 마이크 | 영속 컨텍스트 기동 인자 `--use-fake-device-for-media-stream` + `--use-file-for-fake-audio-capture=<WAV>%noloop` · **권한은 `grantPermissions(['microphone'], {origin: 고객사 모형 출처})` 1곳** · **한 실행 한 문장 · 한 번 녹음**(예열·사전 점검은 별도 브라우저로) · WAV = SAPI 합성 48kHz mono 16bit + 앞뒤 무음 0.5초 | §8 |
| **DXD-11** | 음성 확인 | 일치율 = `1 − 편집거리/최대 길이`(공백·문장부호 제거 후 글자 단위) **≥ 0.8 또는 핵심어 전부 포함**, **그리고** 전송 시 기대 의도 답. 정확도 판정 아님 — 원문·비율은 보고서에만 | §9.8 · FR-DX4-6 |
| **DXD-12** | 선제 안내 | 전용 챗봇 **D**. **코드 확인: 선제 코드는 삽입 코드에 `data-proactive="on"`이 있을 때만 초기화**되고 API 삽입 코드에는 이 속성이 없다 → 하네스가 콘솔이 예시로 보여 주는 것과 **같은 변환**(`ProactiveSection.tsx` 19~22행)으로 D의 모형 페이지 스니펫에만 넣는다 | §2 C-DX-3 · §7.2 |
| **DXD-13** | 정직성·배지 | "CPU 동작" 배지 증거에 **"지금 GPU를 쓰는 자식·서비스 0"** 조건 추가 — 3050에서 STT가 GPU로 뜨면 ①~⑨ 동안 이 배지는 나오지 않는다(대신 시작 카드·자막이 "문장 분석 CPU · 음성 인식 GPU"를 사실대로). 출구 개수·프로세스 수·GPU 사용 문구는 **계획 문맥에서 계산**(DT-1의 "출구 1곳" 고정 문구는 풀 투어에서 쓰지 않음) | §12 |
| **DXD-14** | 보고서 | `result.json` **스키마 v1 유지 + 선택 필드**(`plan`·`models`·`vram`·`speech`·`localLlm`·`downloads`·`proactive`). 단 **`machine.gpuUsedByHarness`를 `z.literal(false)` → `z.boolean()`으로 넓힌다**(10분판 값은 항상 `false` — 키 집합·값 불변) | §13 · 환류 R-7 |
| **DXD-15** | 의존성 0 | 엑셀 내보내기 검증은 **새 의존성 없이**: 다운로드 파일(확장자·크기·`PK` 시그니처) + 제품 감사 로그의 내보내기 행. 편집거리·WAV 헤더·`nvidia-smi` CSV·Ollama 호출은 하네스 자체 코드(Node 표준) | §13.4 · §16 |
| **DXD-16** | 점검 범위 | `pnpm demo:check`(인자 없음)는 **10분판만**(P-DX-14). 풀 투어 무인 점검은 `pnpm demo:check -- --preset customer-onprem-full [플래그]`. 루트 스크립트 추가 0 | §4.3 |

**시간 예산(제안 · 미실측 — 리허설 보정)**: 기본 투어 **830초(13분 50초)** · 플래그 전부 **1,035초(17분 15초)**(§10). PM 목표 "약 14분 / 약 18분" 범위.

---

## 1. 원칙과 요구사항에서 조정한 부분

### 1.1 원칙(상속)

FR-0-310~321(DT-1) + FR-0-349~353(DT-2) 전부. 하네스가 제품 결함을 만나면 우회하지 않고 결함 후보로 남긴다(DT-1 J-2 · 예: 브라우저 녹음물을 서버가 디코딩하지 못하면 `bug-triage`로 — R-DX-9). DT-1 3단계 구현에서 이미 반영된 정합 수정 2건은 **확인만** 한다.

| 항목 | 상태(코드) |
|---|---|
| FR-DX0-1 로드맵 No.32 정정 | 반영됨 — `data/roadmap.ts` 29행(`IMPLEMENTED_DEMO_LATER` "구현됨 · 확장판에서 시연 예정") · 대조 시험 H-T18(`test/roadmap.test.ts`) |
| FR-DX0-2 출구 키 빈 값·`SPEECH_ENABLED=false` | 반영됨 — `env/api-env.ts` 107·120행 · `EGRESS_EXIT_COVERAGE`(183~192행)와 `EgressExitId` 대조 시험 |

### 1.2 요구사항과 달라진 점(조정 · 이유)

| # | 요구사항 | 이 설계 | 이유 |
|---|---|---|---|
| A-DX-1 | §8.1 구간 예산(기본 805 · 전부 1,005) | **기본 830 · 전부 1,035**(§10) | ⑥에 "기록만" 비교와 가드레일 현황(각 15), ⑦에 내보내기(20)·실시간 분석(60), ⑩ 모델 적재 대기(미실측)를 넉넉히. DT-1 구간(①~⑤)은 **10분판과 같은 예산**을 그대로 쓴다 — 같은 단계가 프리셋마다 다르게 시간 관리되지 않게(리허설에서 상시 시간 생략이 보이면 풀 투어 쪽만 조정) |
| A-DX-2 | FR-DX2-1 "플래그를 켰는데 조건이 안 되면 차단" | **장치·모델 부재는 보이는 시연에서 경고 + 장면 생략(이유 자막)**, 무인 점검에서는 차단(종료 2). 사용자가 명시한 것(`--stt-device cuda`·`cpu`)이 불가하면 양쪽 모두 차단 | PM P-DX-10("모델이 아예 없으면 고객 시연은 해당 장면 건너뛰고 이유 표시")이 FR-DX2-1과 충돌 — PM 결정을 따르되, 발견 시점은 여전히 **사전 점검**(공연 중에 알게 되는 일 없음 — FR-DX2-1의 취지 유지). 무인 점검에서 생략을 "통과"로 세면 개발자가 속으므로 차단 · 환류 R-1 |
| A-DX-3 | §6.2 "준비 P3 이전 로컬 생성" | **P4(데이터) 뒤 P4-L**에서 사전 생성 | 생성 대상 의도가 데모 데이터(챗봇 A)에 있어야 한다. 요점("STT를 띄우기 전")은 그대로 |
| A-DX-4 | FR-DX3-5 "④ S4-03 처리는 확인 필요" | **비활성 확정**(DXD-8) | 코드 확인(C-DX-1) |
| A-DX-5 | FR-DX5-4 "안내 끄기 → 새로고침 후 다시 안 뜸" | 검증 = **`OPTED_OUT` 일별 집계 +1 · 말풍선 닫힘 · 포커스 런처** | 세션당 표시 상한 1이면 끄지 않아도 같은 세션에서 다시 뜨지 않아 "새로고침 재표시 0"이 끄기 효과를 구분하지 못한다 · 부재 확인은 고정 대기가 필요해 NFR-DXR2와도 맞지 않는다 |
| A-DX-6 | FR-DX3-6 챗봇 D | + **모형 페이지 스니펫에 `data-proactive="on"`** | 코드 확인(C-DX-3) — 요구사항에 빠진 필수 조건 |
| A-DX-7 | FR-DX8-5 "v1 필드 불변" | `machine.gpuUsedByHarness`만 **타입을 넓힘**(`false` 고정 → `boolean`) | 풀 투어에서 GPU를 쓰면 `false`는 사실이 아니다. 10분판 값은 그대로 `false` |
| A-DX-8 | FR-DX4-8 같은 WAV를 스피커로 재생 | 무대 최상위의 하네스 소유 버튼을 **Playwright 클릭(신뢰 입력)** 으로 눌러 `<audio>` 재생 | 브라우저 전역 자동 재생 정책 인자(`--autoplay-policy=…`)는 위젯의 듣기·자동 읽기 동작까지 바꿀 수 있어 2순위 대안으로만 둔다(X-8) |
| A-DX-9 | FR-DX4-1 기본 투어 "듣기 1회" ① 안 | **⑧ 안에서만** | 10분판과 ①의 화면·예산을 같게 유지 |
| A-DX-10 | FR-DX7-2 엑셀 행 수 검증 | **제품 감사 로그의 내보내기 행(받은 사람·시각·행 수)** 과 대조 · 파일은 형식만 | 새 의존성 0(DXD-15). 감사 행에 행 수 필드가 있다는 근거는 콘솔 문구(`messages.ts` 5183행 "받은 사람·시각·행 수가 감사로그에 항상 기록")이며 필드 이름은 X-10에서 확정 |

---

## 2. 코드 확인 결과 — 요구사항의 "확인 필요" 해소표

| # | 질문 | 확인 결과(근거) | 판정 |
|---|---|---|---|
| **C-DX-1** | 챗봇별 증강 공급자 선택(FR-DX3-5) | **불가.** `AugmentationProviderFactory.getProvider()`는 `ConfigService`의 `AUGMENTATION_PROVIDER` 1값으로만 고른다(`augmentation-provider.factory.ts` 74~123행). 생성 요청 DTO는 `count`만(`augmentation.service.ts` 100행). 후보 0건이면 같은 Job에서 G1 폴백(`providerId='rule'`·`degraded`·`fallbackFrom`) | DXD-8 — S4-03 비활성 |
| **C-DX-2** | Ollama 해제(`keep_alive:0`) 사용 가능 여부(FR-DX3-9) | 저장소에 사용 선례 **0건**(전체 grep). ml-worker `OllamaGenerator._generate`는 `/api/generate`에 `model·prompt·stream·options`만 보내고 **`keep_alive`를 보내지 않는다**(`generator.py` 391~404행) → Ollama 서비스 기본 보존 시간 동안 모델이 VRAM에 남는다. 생성 자식은 **기동 시 워밍업 요청 1회**로 모델을 올린다(`app.py` 181행 · `generator.py` 368~378행 — 워밍업 상한 120초). 해제·적재·적재 목록은 Ollama 공식 API(`/api/generate`의 `keep_alive`·빈 프롬프트, `/api/ps`)로 한다 | DXD-9 · **X-4로 이 PC 버전 확인** |
| **C-DX-3** | 선제 안내 표시 조건 | 위젯은 **삽입 속성 `data-proactive="on"`일 때만 선제 코드를 초기화**한다(`apps/widget/src/constants/proactive.ts` 14행 · `loader.ts` 40행). API 삽입 코드(`GET /chatbots/:id/embed-code`)에는 이 속성이 없고, 콘솔은 `snippet.replace('></script>', ' data-proactive="on"></script>')`로 **예시만** 보여 준다(`ProactiveSection.tsx` 19~22행). 체류 최소 5초(`proactive.ts` 24행) · 트리거 1종 `PAGE_DWELL` · 버튼 동작 `NODE｜MESSAGE｜LINK`(118행) | DXD-12 |
| C-DX-4 | 콘솔 음성·선제 구역 진입 경로 | 라우트 `/chatbots/:id/channels`(`App.tsx` 175행) → WEB 채널 카드의 펼침 버튼 **"음성"**(`aria-expanded` · 닫기 "음성 닫기")·**"선제 안내"**(닫기 "선제 안내 닫기")(`ChannelCard.tsx` 155~196행 · `messages.ts` 4821~4822·4992~4993). 별도 라우트 없음 | §9.9 선택자 |
| C-DX-5 | 위젯 마이크·듣기 버튼 이름 | 말하기 버튼 = **보이는 글자가 상태별로 바뀜**: `말하기`(IDLE) → `마이크 준비 중…` → `말하기 끝내기`(RECORDING) → `글자로 바꾸는 중…`(UPLOADING) → `말하기`/`다시 말하기`(FAILED) (`mic-button.ts` 41~58행). 상태 줄 글자 클래스 `cb-voice-text`. 듣기 버튼 = `aria-label` **`이 답변 듣기` ↔ `듣기 멈추기`**(`speech-button.ts` 44행 · `constants/speech.ts` 63~66행) · 자동 읽기 = `role=switch` 이름 **`답변 소리로 듣기`** | §9.9 |
| C-DX-6 | 선제 말풍선 DOM | 루트 클래스 `cb-pa-bubble` · 버튼 라벨 = 규칙 버튼 라벨 · 꼬리 버튼 **`안내 닫기`**·**`이번 방문 동안 안내 끄기`** · 버튼 0개면 문구 영역이 `aria-label "대화 열기"` 버튼 · 패널 밖 `role=status` 낭독 "챗봇 안내: {문구}"(`proactive-bubble.ts` 37~146행) · 중복 억제 저장소 `sessionStorage` 키 `cb.pa.{slug}` | §9.9 |
| C-DX-7 | 음성 공개 표면 | 인식 `POST /public/chatbots/:slug/speech/transcriptions`(본문 = 녹음 바이트 · `Content-Type audio/*` · 헤더 `x-cb-session-id` UUID · Origin 가드) · 마이크 버튼 조건 = `voice.input`(= `inputEnabled ∧ SPEECH_ENABLED ∧ 가용성`) ∧ 보안 컨텍스트 ∧ `getUserMedia` ∧ `MediaRecorder` · **위젯은 설정을 페이지당 1회(첫 열기) 조회**(`voice-ai-설계.md` §5.1·§5.3·§9.2) · 가용성 캐시 성공 30초·실패 10초 | §7.4 G-DX-1 · §9.8 |
| C-DX-8 | ml-worker 음성 역할 기동 | 같은 진입점(`ml_worker.app`) · `ML_WORKER_ROLE=speech`(배타) · `/speech/health` = `status·backend·modelId·device·computeType·vad·warmedUp`(실제 적재값) · `STT_MODEL_ID`는 로컬 경로 허용·`local_files_only` 고정 · CUDA 적재 실패 = 음성 프로세스만 기동 실패(`config.py` 83~97행 · `app.py` 227~251행 · `voice-ai-설계.md` §8.5·§12.3) | §6.2 |
| C-DX-9 | ml-worker 생성 역할 기동 | `ML_WORKER_ROLE=augment` · `GENERATION_BACKEND=ollama` · 기동 시 `/api/tags`로 서버·모델 존재를 확인하고 **없으면 기동 실패**(조용한 대체 없음) · 백엔드 주소 검사(`GENERATION_BACKEND_ALLOWED_HOSTS` · `GENERATION_BACKEND_REQUIRE_ALLOWLIST`) · 상태 `/augment/health`(`device:'external'`·`backend`·`profile:'lightweight'`·`targetCap`) · 경량 1회 상한 기본 `min(20, 60)` · 요청 제한 25초(`config.py` 43~68행 · `app.py` 84~192·384~401행) | §6.2 |
| C-DX-10 | 발화 분석 엑셀 내보내기 | 상세 화면 버튼 **`엑셀로 받기`**(진행 중 `파일을 만드는 중…`) · 완료 알림 **`엑셀을 내려받았습니다. 받은 기록이 남습니다.`** · 안내 "엑셀로 받으면 받은 사람·시각·행 수가 감사로그에 항상 기록됩니다." (`UtteranceAnalysisDetailPage.tsx` 291~302·426~429행 · `messages.ts` 5183·5366~5368) | §9.7 |
| C-DX-11 | 가드레일 현황·"기록만" | 라우트 `/chatbots/:id/guardrails/overview`·`events`(`App.tsx` 207~222행) · 동작 enum `MONITOR`(="기록만")·`REPLACE`·`NO_RAG` · 분류에 `FINANCIAL_ADVICE` 등(`guardrails.ts` 11~43행) | §9.6 |
| C-DX-12 | DT-1 3단계 구현이 이미 가진 것 | `StepDef.dynamicDisclosure`·`promoteIfSkipped`·`waitMaxMs` · `StepContext.facts` · `LAG_TOLERANCE_SEC=4`(`runner.ts` 110행) · S5-07은 환경 전환 이력 화면(DHX-5 회피) · `--resume`·`--appendix-llm` 미구현 · 진행 막대가 **전역 `SEGMENT_KEYS` 9칸**에 맞춰져 있다(`runner.ts` 226~239행) | §3.6 — 진행 막대는 프리셋 구간 기준으로 바꾼다 |
| C-DX-13 | 결과 스키마 제약 | `machine.gpuUsedByHarness: z.literal(false)` · `tool: z.literal('DT-1')` · `appendix.llm: z.null()`(`report/schema.ts` 63·45·92행) | DXD-14 — `tool`은 그대로 `'DT-1'`(같은 도구) |

---

## 3. 프리셋 구조 — 계획 문맥 · 조건부 단계 · 활성 예산

### 3.1 계획 문맥(`src/scenario/plan.ts` 신설)

```ts
type VoiceInputPlan = 'off' | 'real' | 'mock';
interface PlanContext {
  presetId: string;
  mode: 'visible' | 'headless-check';
  voiceInput: VoiceInputPlan;            // real = --with-voice-input · mock = --voice-mock-check(무인 전용)
  sttDevice: 'cuda' | 'cpu' | null;      // voiceInput=real일 때만 값(§5.2 결정표 결과)
  sttModel: 'large-v3-turbo' | 'small' | null;
  localLlm: boolean;
  liveClustering: boolean;
  /** 플래그는 켰지만 이 PC에서 불가해 생략한 이유(보이는 시연 · P-DX-10). 있으면 voiceInput='off'. */
  voiceOmittedReason?: string;
}
```

- 확정 시점: **사전 점검(P0) 직후 1차 확정** → **음성 자식 기동(P4-V) 뒤 최종 확정**(`auto`의 cuda 실패 → cpu 재기동이 있으면 `sttDevice` 갱신) → "준비 완료" 요약·드라이런·보고서는 최종 계획을 쓴다. 공연 중에는 바꾸지 않는다.
- 10분판은 계획 문맥을 만들되 `voiceInput='off'·localLlm=false·liveClustering=false` 고정(플래그 거부 — §4.2) → 해석 결과가 지금의 정적 정의와 **동일**해야 한다(H-T19).

### 3.2 조건부 단계·구간(형식 확장 — `src/scenario/types.ts`)

```ts
interface StepDef {
  /* DT-1 필드 전부 그대로 */
  /** 활성 조건. 없으면 항상 활성. */
  when?: (p: PlanContext) => boolean;
  /** 비활성일 때 보고서 처리: 'variant' = 같은 ID의 다른 변형이 대신 활성(보고하지 않음) · 'option' = SKIPPED(OPTION)로 남김. 기본 'option'. */
  inactive?: 'variant' | 'option';
  /** 'option' 비활성일 때 보고서·로드맵에 쓰는 사유(예: "음성 입력 — 음성 인식 모델 필요"). */
  inactiveReason?: (p: PlanContext) => string;
}
interface SegmentDef { /* … */ when?: (p: PlanContext) => boolean; inactiveReason?: (p: PlanContext) => string; }
interface PresetDef {
  /* … */
  /** 이 프리셋이 받는 플래그(없으면 플래그 거부 — 10분판). */
  flags?: ('voiceInput' | 'localLlm' | 'liveClustering')[];
  /** 대표 계획별 총 예산 선언(정의 검사가 해석 결과와 대조). 키 = planKey(p). */
  expectedTotals?: Record<string, number>;
  /** true면 해석기가 장면 구간 칩을 "장면 i/N"(N = 활성 장면 수)으로 채운다. */
  autoChips?: boolean;
}
```

- **해석기 `resolvePreset(preset, plan) → ResolvedPreset`**: 활성 구간·단계만 남기고, 구간 예산 = **활성 단계 예산 합**, 총 예산 = 활성 구간 합. 비활성 `option` 단계·구간은 `inactiveRows[]`로 따로 돌려준다(오케스트레이터가 결과에 `SKIPPED · skipReason:'OPTION'` + 사유로 순서대로 끼워 넣는다 — FR-DX1-4).
- **실행기(`runner.ts`)는 해석된 구간만 받는다** — 실행기 자체의 생략·유지 알고리즘은 바꾸지 않는다(DT-1 §11.2 그대로). 바뀌는 곳은 ① 진행 막대를 **입력 구간 순서** 기준으로 그린다(C-DX-12 — 10분판은 9칸 그대로) ② `step.site`에 `'D'` 추가 ③ 배지 증거가 동적 사실(§12.1)을 읽는다.
- `skipOrder`: 비활성 단계 ID가 들어 있어도 무시한다. 활성이면 반드시 생략 가능 단계여야 한다.

### 3.3 정의 검사 일반화(`definition-check.ts`)

| 프리셋 | 검사 |
|---|---|
| `when`이 하나도 없는 프리셋(10분판) | **DT-1 규칙 그대로**(구간 키 9개·순서 고정 · 구간 예산 합 = 총 예산 · 단계 예산 합 = 구간 예산 · 자막·기호·읽기 시간 규칙) — 결과·오류 문구 불변 |
| 조건부 프리셋(풀 투어) | **모든 대표 계획**(아래 16개)에 대해 해석 후: ① 구간 키가 전역 순서의 부분열이며 `opening` 처음·`closing` 끝 ② 활성 단계 ID 유일(`variant` 묶음은 계획마다 정확히 1개 활성) ③ 활성 단계마다 `core xor skippable` ④ 자막·안내 줄 규칙(DT-1) ⑤ `skipOrder` 규칙(§3.2) ⑥ `expectedTotals[planKey]`가 있으면 해석 총 예산과 일치 — 기본·전부는 **필수 선언** ⑦ **`voice` 구간 이후 구간에 `voiceInput` 의존 단계 0**(⑩ 뒤 STT 장면 금지 — FR-DX6-2) |

대표 계획 열거(`PLAN_MATRIX`): `voiceInput ∈ {off, real·cuda, real·cpu, mock}` × `localLlm ∈ {F,T}` × `liveClustering ∈ {F,T}` = 16개(`mock`은 무인 점검 전용이지만 정의 검사 대상). `voiceOmittedReason`이 있는 계획은 `off`와 같은 모양.

- `dynamicDisclosure`·`dynamicNarration`이 없는 대신, **사실에 따라 바뀌는 문구는 순수 함수로 분리**해 단위 시험이 계획·사실 조합 전부에서 40자·기호 규칙을 검사한다(H-T19 ④).

### 3.4 구간 키 · 단계 ID 체계

| 구간 키 | 단계 접두 | 칩(풀 투어 · 자동) | 비고 |
|---|---|---|---|
| `opening` | `S0-` | 시작 | |
| `s1`~`s7` | `S1-`~`S7-` | 장면 1/N ~ 7/N | DT-1 단계 재사용 + ⑥⑦ 확장 |
| **`voice`** | **`SV-`** | 장면 8/N | 신설 |
| **`proactive`** | **`SP-`** | 장면 9/N | 신설 |
| **`edge`** | **`SE-`** | 장면 10/N | 신설 · `localLlm`일 때만 활성(비활성이면 N=9) |
| `closing` | `S9-` | 마무리 | |

- 형식: `StepId = \`S${0-7|9|'V'|'P'|'E'}-${string}\``. 인자 검사 정규식 `^S[0-79VPE]-\d{2}$`(`--skip`·`--inject-delay`). `--only` 값에 `voice`·`proactive`·`edge` 추가 — **그 프리셋에 없는 구간이면 시작 전 오류**(10분판에 `--only voice` → 오류).
- 숫자 대신 글자를 쓴 이유: 끝 구간이 이미 `S9`라 `S8`·`S10`·`S11`은 순서·자릿수가 섞인다(ADR-0053 대안 2).

### 3.5 프리셋 파일

```
src/presets/customer-onprem-full.ts      # id · audience ONPREM · flags 3 · expectedTotals · autoChips · segments(아래)
src/scenarios/full/opening-full.ts        # S0-01(변형 2) · S0-02(변형 — 출구 N곳)
src/scenarios/full/s4-full.ts             # DT-1 s4 단계 재사용 · S4-03에 when(!localLlm)
src/scenarios/full/s6-full.ts             # DT-1 S6-01~06(S6-05는 변형) + S6-07 · S6-08
src/scenarios/full/s7-full.ts             # DT-1 S7-01~05(+ S7-01 실시간 변형) + S7-07(실시간 분석) · S7-06(엑셀)
src/scenarios/full/voice.ts               # SV-01~08
src/scenarios/full/proactive.ts           # SP-01~04
src/scenarios/full/edge.ts                # SE-01~04
src/scenarios/full/closing-full.ts        # S9-01(풀 투어 로드맵) · S9-02(DT-1 재사용)
src/scenarios/full/derive.ts              # derive(step, patch) — 얕은 복사(원본 불변)
```

- ①②③⑤는 DT-1 `s1Segment`·`s2Segment`·`s3Segment`·`s5Segment`를 **그대로** 쓴다(같은 객체 — 변경하지 않으므로 공유 안전).

### 3.6 10분판 불변 보장

| 보장 | 방법 |
|---|---|
| 정의 불변 | `presets/customer-onprem-10m.ts`·`scenarios/{opening,s1..s7,closing,index}.ts` **파일 변경 0**(diff 확인). 풀 투어 모듈은 이 파일들을 import만 한다 |
| 객체 불변 | `derive()`는 새 객체를 만든다 · 시험(H-S7)이 풀 투어 모듈을 import하기 전후로 10분판 단계 정의의 구조 직렬화(함수 제외 필드)가 같음을 단언 |
| 실행 불변 | 10분판 계획은 플래그 0 → 자식 2개 · 환경 키·값 **DT-1과 바이트 동일**(H-T21 스냅숏) · `result.json` 키 집합 동일(H-T28) · 진행 막대 9칸 |
| 명령 불변 | `pnpm demo`·`pnpm demo:check` 인자 없음 = 10분판(FR-0-349 · P-DX-14) |

---

## 4. 명령 인터페이스

### 4.1 새 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--with-voice-input` | 끔 | ⑧ 음성 입력 단계 활성 · 음성 인식 자식(8102) 기동 · 가짜 마이크 · 합성 음성 |
| `--stt-device auto｜cuda｜cpu` | `auto` | STT 장치(§5.2). `--with-voice-input`이 없으면 오류 |
| `--with-local-llm` | 끔 | ⑩ 활성 · 생성 자식(8101) · Ollama 사용 · ④ S4-03 비활성 |
| `--live-clustering` | 끔 | ⑦ 보이는 시연에서 실제 분석을 돌리고 완료까지 대기 |
| `--voice-mock-check` | 끔 | **무인 점검 전용** — API `SPEECH_PROVIDER=mock`으로 위젯→API 파이프만 점검(음성 자식 없음 · 보고서 "모의 인식 — STT 미검증"). 보이는 시연이면 시작 전 거부(P-DX-10) |

### 4.2 조합 오류(시작 전 · 무엇/왜/어떻게)

| 조합 | 오류 |
|---|---|
| 10분판(또는 `flags`가 없는 프리셋) + 위 5개 중 하나 | "이 옵션은 풀 투어 프리셋에서만 씁니다" · 어떻게: `--preset customer-onprem-full` |
| `--stt-device` without `--with-voice-input` | 음성 입력을 켜지 않으면 STT를 띄우지 않는다 |
| `--voice-mock-check` + `--mode visible`(기본) | 고객 앞 가짜 인식 금지(P-DX-10) · 어떻게: `pnpm demo:check -- --preset customer-onprem-full --voice-mock-check` |
| `--voice-mock-check` + `--with-voice-input` | 둘 중 하나만 |
| `--only edge`인데 `--with-local-llm` 없음 | 활성 구간이 없다 |
| `--appendix-llm`(기존 · 미구현) + 풀 투어 | "풀 투어에서는 `--with-local-llm`을 쓰세요"(부록과 장면이 겹침) |

### 4.3 명령 예

```
pnpm demo                                                         10분판(변경 없음)
pnpm demo -- --preset customer-onprem-full                        풀 투어 기본(약 13분 50초 · 모델 0)
pnpm demo -- --preset customer-onprem-full --with-voice-input --with-local-llm --live-clustering
                                                                  플래그 전부(약 17분 35초 · 3050)
pnpm demo -- --preset customer-onprem-full --with-voice-input --stt-device cpu
                                                                  "GPU 없이" 메시지를 지켜야 하는 고객(§12.1)
pnpm demo:check                                                   10분판 무인 점검(변경 없음)
pnpm demo:check -- --preset customer-onprem-full --with-voice-input --with-local-llm --live-clustering
pnpm demo:check -- --preset customer-onprem-full --voice-mock-check   STT 모델 없는 PC의 파이프 점검
```

- 루트 `package.json`에 스크립트를 추가하지 않는다(루트 변경 0 — §18).
- `--dry-run`: 계획 문맥·활성 구간/단계표·활성 예산·비활성 사유·자식 프로세스 목록·환경 공개표(계획별)·선택자 문구를 출력. 장치 결정은 사전 점검 없이 "auto(실행 시 결정)"으로 표시.

---

## 5. 실행 단계(풀 투어 · 플래그별)

```
P0 사전 점검(+PC-DX) ─▶ P1 실행 폴더·격리 DB ─▶ P2 빌드 ─▶ P3 기동(임베딩 ∥ API ∥ 정적 서버 3)
 ─▶ P4 데모 데이터(DT-1 + 풀 투어 추가분) ─▶ [llm] P4-L 생성 자식·사전 생성·Ollama 해제·회수 확인
 ─▶ [voice] P4-V 음성 자식 기동(장치 결정·대체)·G-DX-1·G-DX-2 ─▶ P5 보정(DT-1 G-1~4 + G-DX-3·4)·예열·선택자 점검
 ─▶ 이력 예약 대기 ─▶ 준비 완료(엔터) ─▶ T0 ─▶ 공연(시작·①~⑦·⑧·⑨·[⑩]·끝) ─▶ 보고서 ─▶ 정리(+Ollama 해제 보장)
```

| 단계 | 풀 투어 추가 내용 | 실패 시 | 시간(제안 · 미실측) |
|---|---|---|---|
| P0 | PC-DX-1~12(§5.1) · `[voice]` **합성 음성 생성**(실행 폴더 `audio/utterance.wav` — §7.3)과 **가짜 마이크 점검**(별도 헤드리스 브라우저) · `[voice·llm]` GPU 기준 VRAM 기록 | 표 §5.1 | +5~15초 |
| P3 | 포트 8101·8102 예약 확인만(기동은 P4-L·P4-V) | — | 0 |
| P4 | 풀 투어 추가 데이터(§7) — 챗봇 D · A 음성 설정 · A "기록만" 규칙 | 종료 2 | +5~10초 |
| **P4-L** | ① 생성 자식 기동(`/augment/health` `ok` · 상한 150초 — 워밍업 120초 포함) ② 사전 생성 1회(A/회원정보 · 목표 20건 · 상한 60초) → 결과 기록 ③ **Ollama 해제** → `/api/ps`에서 모델 사라짐 + VRAM 하락 확인(상한 20초) ④ 생성 자식은 **유지**(VRAM 0 — 연산은 Ollama) | 생성 자식 기동 실패·G-DX-4 실패 → visible: ⑩ 비활성 + 이유(로드맵 1줄) · headless: 종료 2 | +40~120초(미실측 — 첫 적재) |
| **P4-V** | ① 장치 결정(§5.2) ② 음성 자식 기동 · `/speech/health` `ok`·`warmedUp`·`backend=faster-whisper` 확인(상한 60초) ③ `auto` + cuda 기동 실패 → 트리 종료 → `small`·cpu로 **1회 재기동**(공개) ④ G-DX-1(합성 WAV 직접 인식)·G-DX-2(그 글자로 기대 의도) | 표 §5.2 · 게이트 실패 → visible: 음성 입력 단계 비활성 + 이유 · headless: 종료 2 | +10~20초 |
| P5 | DT-1 + 새 화면 예열(콘솔 음성·선제 구역 · 데이터 지도 음성 절 · 가드레일 현황 · 모형 D) — **위젯 말하기 버튼은 존재만 확인하고 누르지 않는다**(가짜 오디오 파일 1회 소비 — §8.4) | 선택자 실패 → 종료 2 | +15~30초 |
| 공연 | §9 · ⑩ 진입 시 순차 적재(§11) | 대체 표 §14 | §10 |
| 정리 | DT-1 정리 + 하네스가 적재한 Ollama 모델 해제(상태 플래그 `ollamaLoadedByHarness`) + 8101·8102 포트 확인 | 해제 실패 = 경고(Ollama 서비스는 끄지 않음) | +1~5초 |

준비 증가분 목표(NFR-DXP2 · 제안): voice +1분 · llm +2분. DT-1 하한(이력 예약 약 6분)과 **겹쳐 진행**하므로 실제 증가는 더 작을 수 있다.

### 5.1 사전 점검 추가(PC-DX)

| # | 항목 | 방법 | 대상 | 결과 |
|---|---|---|---|---|
| PC-DX-1 | 음성 선택 의존성 | `.venv` 파이썬으로 `import faster_whisper, av`(하위 프로세스 1회 · 10초) | voice | 없으면 → 음성 입력 **불가**(visible: 경고+생략 / headless: 차단) · 안내 `pip install -c requirements-lock.txt -c requirements-speech-lock.txt -e ".[speech]"` |
| PC-DX-2 | STT 모델 캐시 | `apps/ml-worker/.cache/stt-models/{large-v3-turbo,small}` 존재(폴더 + `model.bin`) | voice | §5.2 결정표 입력 · 둘 다 없으면 불가(같은 처리) · `fetch_stt_model.py` 반입 안내(자동 내려받기 0) |
| PC-DX-3 | GPU | `nvidia-smi -L`(종료 코드·줄 수) | voice(auto·cuda) | 결정표 입력 |
| PC-DX-4 | CUDA DLL 폴더 | `.venv\Lib\site-packages\nvidia\{cublas,cudnn,cuda_nvrtc}\bin` 존재 | voice(auto·cuda) | 결정표 입력 |
| PC-DX-5 | VRAM 여유 | `nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits` → 여유 ≥ **1,300MiB**(turbo 관찰 상한 1,053 + 여유) | voice(auto·cuda) · llm | 결정표 입력 · llm은 여유 < 2,600MiB면 경고(Ollama 관찰 2.3GB) |
| PC-DX-6 | 가짜 마이크 | 별도 헤드리스 브라우저(같은 인자)로 **임시 루프백 서버**(`127.0.0.1:<임시 포트>/probe` — 보안 컨텍스트)에서 `getUserMedia({audio:true})` → `MediaRecorder` 1.5초 → 바이트 > 0 · `mimeType` 기록 · 같은 페이지에서 `speechSynthesis.getVoices()` 중 `lang` `ko*`·`localService` 수 기록(PC-DX-8 겸용) | voice | 실패 → 불가(같은 처리) |
| PC-DX-7 | 합성 음성 | SAPI 한국어 음성 존재 + WAV 생성 성공(§7.3) · WAV 길이 1.5~12초 · 바이트 기록 | voice | 실패 → 불가 |
| PC-DX-8 | 기기 안 한국어 음성(듣기) | PC-DX-6 페이지(헤드리스) 결과 · 보이는 시연은 P5 예열에서 위젯 듣기 버튼의 `aria-disabled`로 재확인 | 풀 투어 전부 | 0개면 **경고**("듣기 버튼이 비활성으로 보입니다") — 생략 아님 |
| PC-DX-9 | Ollama | `GET http://127.0.0.1:11434/api/tags`(3초) → 서버 응답 · `qwen3:4b-instruct-2507-q4_K_M` 존재 · `GET /api/ps` → 이미 적재된 모델 목록 | llm | 미기동·모델 없음 → visible: 경고 + ⑩ 비활성 + 이유 / headless: 차단. **다른 모델이 적재 중**이면 경고(VRAM 경쟁 — 하네스는 남이 올린 모델을 내리지 않음 · EX-DX-8) · 같은 모델이 이미 적재돼 있으면 "하네스가 공연 뒤 이 모델을 내립니다" 정보 |
| PC-DX-10 | 포트 8101·8102(+오프셋) | DT-1 PC-8 방법 | voice·llm | 차단(점유 PID 출력) |
| PC-DX-11 | RAM | DT-1 PC-11b(가용 2GiB)에 플래그별 추가 경고 기준: voice +1GiB · llm +2GiB(제안·미실측) | voice·llm | 경고 |
| PC-DX-12 | Ollama 실행 중(llm 끔) | DT-1 PC-10 그대로 | 풀 투어 llm 끔 | 경고(DT-1과 같음) — llm 켬이면 PC-10은 "필요 — 사용함" 정보로 바뀐다 |

- "불가" 판정의 처리 원칙(A-DX-2): **보이는 시연 = 경고 + 해당 장면 비활성 + 이유 자막(진행자 확인 후 진행)** · **무인 점검 = 차단(종료 2)** · **사용자가 장치를 명시(`--stt-device cuda｜cpu`)했는데 그 장치가 불가 = 양쪽 모두 차단**.

### 5.2 STT 장치 결정표(`--with-voice-input`)

| `--stt-device` | 조건 | 결정 |
|---|---|---|
| `auto` | GPU 있음 ∧ DLL 3폴더 ∧ VRAM 여유 ≥ 1,300MiB ∧ turbo 캐시 | **`large-v3-turbo` · int8 · cuda**(PM 시연 기본 모델) |
| `auto` | 위가 아니고 small 캐시 있음 | **`small` · int8 · cpu**(공개: "음성 인식 CPU · 이 PC는 GPU 조건 미충족") |
| `auto` | cuda로 정했으나 **기동 실패**(자식 종료·상한 60초 초과·`/speech/health`의 `device≠cuda`) | 트리 종료 → small 캐시 있으면 **small·cpu 1회 재기동** + 공개(`DEVICE_FALLBACK`) · 없으면 불가 |
| `auto` | small·turbo 모두 없음, 또는 PC-DX-1/6/7 실패 | 불가(A-DX-2 처리) |
| `cuda` | GPU·DLL·VRAM·turbo 중 하나라도 없음, 또는 기동 실패 | **차단(종료 2)** — 대체하지 않는다 |
| `cpu` | small 캐시 없음 | **차단** — CPU로 turbo는 쓰지 않는다(미실측 · `STT_DEADLINE_S` 8초 초과 위험) |
| `cpu` | small 있음 | `small` · int8 · cpu |

- CPU 결정 시 STT 지연 관찰값 5초 발화 약 2.1초(보고서 §4.3) — 위젯 대기 상한 15초 안.
- 결정·대체 이유는 준비 완료 요약·시작 카드·보고서 모델 구성표에 같은 문장으로.

---

## 6. 프로세스 · 환경

### 6.1 구성과 포트

| 구성 | 실행 | 포트(기본) | 플래그 | 헬스 |
|---|---|---|---|---|
| API | DT-1 그대로(환경은 §6.4) | 3000 | 항상 | `/api/health` |
| 임베딩 ml-worker | DT-1 그대로(CPU · `CUDA_VISIBLE_DEVICES=-1`) | 8100 | 항상 | `/health` `warmedUp` |
| **음성 ml-worker** | `<venv>\Scripts\python.exe -X cbdemo_run=<runId> -m ml_worker.app` · **작업 폴더 `<실행 폴더>/ml-speech/`**(빈 폴더 — 개발자 `.env` 미적재 · DT-1 C-19) | **8102** | voice(real) | `/speech/health` `status=ok ∧ warmedUp ∧ backend=faster-whisper` · 실제 `device`·`computeType` 기록 |
| **생성 ml-worker** | 같은 진입점 · 작업 폴더 `<실행 폴더>/ml-augment/` | **8101** | llm | `/augment/health` `status=ok`(`warmedUp=false`는 경고 — 기동은 계속되는 제품 동작) |
| 정적 서버 3 | DT-1 그대로 + 무대 서버 `/audio/utterance.wav` 경로(voice일 때만 · 고정 경로 1개) | 5173·5174·5180 | 항상 | |

- `--port-offset`은 8101·8102도 함께 옮긴다(`Ports`에 `mlAugment`·`mlSpeech` 추가). Ollama 주소는 **`http://127.0.0.1:11434` 고정**(사용자 서비스 · 오프셋 대상 아님).
- 표식·정리: DT-1 규약 그대로(`-X cbdemo_run=<runId>` · venv 런처+자식 2단 · `taskkill /T /F` · `pids.json`에 역할별 PID). 음성 자식은 공연 중 ⑩에서 **하네스가 먼저 종료**하므로 `pids.json`의 그 항목에 `stoppedAt`을 기록한다.

### 6.2 자식 환경(백지 시작 · 시스템 허용 키 + 아래)

**음성 자식**(`src/env/ml-speech-env.ts`)

| 키 | 값 | 이유 |
|---|---|---|
| `ML_WORKER_ROLE` · `ML_WORKER_HOST` · `ML_WORKER_PORT` | `speech` · `127.0.0.1` · 8102(+오프셋) | 배타 역할 · 루프백 |
| `STT_BACKEND` | `faster-whisper` | 고객 시연 모의 0 |
| `STT_MODEL_ID` | **`<저장소>/apps/ml-worker/.cache/stt-models/<large-v3-turbo｜small>` 절대 경로(슬래시)** | 로컬 경로 · 작업 폴더가 실행 폴더라 상대 경로 불가 |
| `STT_MODEL_DIR` | 설정 안 함(빈 값) | 로컬 경로를 쓰므로 불필요 |
| `STT_DEVICE` · `STT_COMPUTE_TYPE` | `cuda｜cpu` · `int8` | §5.2 |
| `STT_VAD` | **`auto`** | `off` 금지(PM 2026-10-02 · H-T21이 단언) |
| `CUDA_VISIBLE_DEVICES` | cuda → `0` · cpu → `-1` | GPU 노출은 cuda일 때만 |
| `PATH` | cuda → **`<cublas\bin>;<cudnn\bin>;<cuda_nvrtc\bin>;` + 부모 `PATH`**(존재하는 폴더만 · 이 순서) · cpu → 부모 값 그대로 | DXD-7 · 부모 키 표기(`Path`/`PATH`) 보존 |
| `HF_HUB_OFFLINE` · `TRANSFORMERS_OFFLINE` · `HF_HUB_DISABLE_TELEMETRY` · `PYTHONUTF8` · `PYTHONIOENCODING` | `1`·`1`·`1`·`1`·`utf-8` | DT-1과 같음(`local_files_only`는 제품이 고정) |

나머지 `STT_*`(빔 5 · 동시 2 · 1MB · 32초 · 마감 8초)는 **제품 기본값**(공개표에 "기본" 표기).

**생성 자식**(`src/env/ml-augment-env.ts`)

| 키 | 값 | 이유 |
|---|---|---|
| `ML_WORKER_ROLE` · HOST · PORT | `augment` · `127.0.0.1` · 8101 | |
| `GENERATION_BACKEND` · `OLLAMA_BASE_URL` · `OLLAMA_MODEL` | `ollama` · `http://127.0.0.1:11434` · `qwen3:4b-instruct-2507-q4_K_M` | 경량 설치 구성(ADR-0046) |
| `OLLAMA_TARGET_CAP` | `20` | 경량 상한(명시 — 공개표) |
| `GENERATION_BACKEND_ALLOWED_HOSTS` · `GENERATION_BACKEND_REQUIRE_ALLOWLIST` | `127.0.0.1:11434` · `true` | 백엔드 주소 통제를 거버넌스 설치 권장값으로(루프백도 목록 필수) |
| `CUDA_VISIBLE_DEVICES` | `-1` | 이 프로세스는 GPU를 쓰지 않는다(연산 = Ollama · `/augment/health.device='external'`) |
| 오프라인·인코딩 5키 | 임베딩 자식과 같음 | |

요청 제한(`OLLAMA_REQUEST_TIMEOUT_S` 25)·워밍업 상한(120)·최대 토큰은 제품 기본값.

### 6.3 `PATH` 주입 규칙(시스템 허용 키 값 변경의 유일한 예외)

1. 위치: `src/env/ml-speech-env.ts` **1파일**(정적 검사 H-S8 — 다른 파일에서 `PATH` 값을 바꾸는 코드 0).
2. 대상: 음성 자식 ∧ `STT_DEVICE=cuda`일 때만.
3. 값: 폴더 존재 확인 후 절대 경로를 **앞에** 붙인다(뒤에 붙이면 시스템의 다른 CUDA DLL이 먼저 잡힐 수 있다).
4. 기록: 공개표에 "음성 인식 프로세스 PATH 앞 3경로 추가(Windows GPU DLL — 제품 코드 변경 없이 운영 문서 절차 재현)".
5. 제품 쪽 해결(`add_dll_directory` 자동 탐색)은 이번 범위 밖(요구사항 §12) — 하네스는 문서화된 운영 절차(`voice-ai-설계.md` §8.5)를 재현할 뿐 우회가 아니다(DT-1 `NODE_PATH`와 같은 논리 · ADR-0053 §3).

### 6.4 API 환경 — 계획별(`buildApiEnv(input, plan?)`)

`plan`이 없으면(10분판) **지금 출력과 바이트 동일**(H-T21 스냅숏). 풀 투어 추가분:

| 키 | 기본 투어 | `voiceInput=real` | `voiceInput=mock`(무인) | `localLlm` |
|---|---|---|---|---|
| `SPEECH_ENABLED` | `false`(DT-1과 같음) | `true` | `true` | — |
| `SPEECH_PROVIDER` | 설정 안 함 | `local` | `mock` | — |
| `ML_WORKER_SPEECH_URL` | `''`(DT-1과 같음) | `http://127.0.0.1:8102` | `''` | — |
| `AUGMENTATION_PROVIDER` | `rule` | — | — | `local` |
| `AUGMENTATION_LOCAL_BASE_URL` | `''` | — | — | `http://127.0.0.1:8101` |
| `DATA_EGRESS_ALLOWED_HOSTS` | `127.0.0.1:8100` | + `127.0.0.1:8102` | (추가 없음) | + `127.0.0.1:8101` |
| `PROACTIVE_ENABLED` | **`true` 명시**(공개표용 · 기본과 같음) | 같음 | 같음 | 같음 |
| `NODE_ENV` | **전달 안 함** | 전달 안 함 | 전달 안 함 | 전달 안 함 |

- **`NODE_ENV` 미설정 = 비운영**: 시스템 허용 목록에 없어 부모 셸 값도 넘어가지 않고(①), 개발자 `.env` 값은 선적재가 지운다(③). 결과: `mock`이면 경고 1회만(`voice-ai-설계.md` §12.3) — **시연은 "운영 mock 차단"(DD-135)을 재현하지 않는다**(보고서 알려진 한계). `NODE_ENV=production`을 넣는 안은 쿠키 `Secure` 등 다른 운영 분기를 바꾸므로 쓰지 않는다(H-T21이 모든 계획에서 부재를 단언).
- **4중 방어와의 정합**: 새 키는 모두 하네스 명시값이라 ① 백지 ② `CHATBOT_API_IGNORE_ENV_FILE` ③ 선적재(하네스가 넘긴 키는 지우지 않음) ④ 빈 값 명시 어느 것과도 충돌하지 않는다. 기본 투어에서 개발자 `.env`의 `SPEECH_PROVIDER=local`·`ML_WORKER_SPEECH_URL=…`은 ③·④로 차단된다(AC-DX0-3과 같은 시험을 풀 투어 기본에도 — §17.3).
- **출구 커버리지 표의 계획별화**: `EGRESS_EXIT_COVERAGE`를 `egressCoverage(plan)`으로 — `SPEECH_LOCAL`은 voice(real)이면 `LOOPBACK`, 아니면 `BLANK` · `AUGMENT_LOCAL`은 llm이면 `LOOPBACK`, 아니면 `BLANK`. 대조 시험(`EgressExitId` 전부 커버)은 16개 계획 모두에서.
- **기대 출구(데이터 지도 · 기동 로그)**: 허용 = `{EMBEDDING} ∪ {SPEECH_LOCAL | voice real} ∪ {AUGMENT_LOCAL | llm}` · 차단 0. 거버넌스 기동 로그 "출구 허용=N개"의 N과 같아야 한다(누락 시 API 기동 실패로 드러남 — 정상 실패).
- 외부 주소 개수(`externalAddresses` — "외부 송신 없음" 배지 증거)는 **값이 있는 출구 키 중 호스트가 루프백(`127.0.0.1`·`localhost`·`::1`)이 아닌 것의 수**로 계산한다(지금은 상수 0 — `orchestrator/index.ts` 328·359행). 모든 계획에서 0.

### 6.5 정리

- DT-1 정리 순서에 **역할 2개 추가**(생성·음성 — 공연 중 이미 종료됐으면 건너뜀) · 포트 확인 대상 7개(+8101·8102).
- `ollamaLoadedByHarness=true`면 해제 요청 1회(실패해도 경고만 · Ollama 서비스는 종료하지 않음 — FR-0-353).
- 비정상 종료 시 동기 정리(`process.on('exit')`)는 자식 트리 종료만(HTTP 해제 요청은 비동기라 불가 — 다음 실행의 P0가 `/api/ps`에서 그 모델을 보면 "이전 실행이 적재한 모델일 수 있음" 정보 + 해제 안내).

---

## 7. 데모 데이터 추가(풀 투어 · 제품 API)

10분판 데이터는 **바꾸지 않는다**(챗봇 A의 의도·예문 불변 — 10분판 보정 게이트 G-1 점수 보호). 추가분은 풀 투어에서만 생성한다(`src/data/dataset-full.ts` · `generator-full.ts`).

### 7.1 챗봇 A 추가 설정

| 자산 | 내용 | API |
|---|---|---|
| 음성 설정 | 기본 투어: `inputEnabled:false · ttsEnabled:true · autoReadToggleVisible:true · rate 1.0` · 기본 말투 `INFORMATIVE` · 미응답 말투 `APOLOGETIC` · 노드 말투 1개(환불문의 응답 노드 = `CALM`) / voice(real·mock): `inputEnabled:true` | `PUT /chatbots/:id/voice`(필드 이름은 `VoiceSettingsInput` 그대로 — 구현 시 shared-types로 확인) |
| 위험 응답 규칙 2번 "투자 권유 문의" | 분류 `FINANCIAL_ADVICE` · 표현 `주식 추천` · 포함 · `INBOUND` · **`MONITOR`(기록만)** | 가드레일 규칙 생성 API(DT-1 1번 규칙과 같은 경로) |

- 영향: 음성 설정 때문에 풀 투어 ①②⑥의 위젯 A 답 끝에 **듣기 버튼이 보이고**(voice면 말하기 버튼도) 응답에 `speech` 키가 붙는다. 말풍선 선택자·검증 문구(`.cb-msg-bot .cb-msg-text`)에는 영향이 없다 — 리허설 확인 항목(R-DX-20). 10분판은 음성 설정을 만들지 않으므로 무관.
- 2번 규칙은 DT-1 질문(S6-01·S6-03)에 걸리지 않는다(표현 불일치) → S6-04 검증("1건") 불변.

### 7.2 챗봇 D "가온마켓 주문 도우미"(⑨ 전용 · 가칭)

| 자산 | 내용 |
|---|---|
| 그룹 | "가온마켓" |
| 의도(2) · 노드 | **배송조회**(예문 3 — A와 같은 문장 계열) · **영업시간**(예문 3) · 시작·폴백·응답 노드 2 |
| WEB 채널 | 켬 · `allowedOrigins:['http://localhost:5180'(+오프셋)]` |
| 선제 안내 설정 | 켬 · 세션당 최대 1 · 최소 간격 30초 · 전송 뒤 조용한 시간 60초(허용 범위 최소값 — `messages.ts` 5012~5014) |
| 선제 규칙(1) | 이름 "배송 안내" · 포함 경로 `/site` · **머문 시간 5초**(허용 최소) · 문구 "주문하신 상품의 배송 상황이 궁금하신가요?" · 버튼 2: `배송 조회`(`MESSAGE` "배송 조회하고 싶어요") · `영업시간`(`MESSAGE` "영업시간 알려 주세요") · 기기 데스크톱 · 목적 확인 체크(이용 도움 안내) |
| 모형 페이지 스니펫 | API 삽입 코드에 **`data-proactive="on"`** 을 콘솔과 같은 변환으로 넣어 무대 서버에 등록(`isSafeSnippet` 통과 확인) — **D만**. A·B·C는 그대로(선제 규칙 0 · EX-DH-16 유지) |
| 음성 설정 | 없음 |

### 7.3 합성 음성(P-DX-4 (a) · 커밋 0)

| 항목 | 결정 |
|---|---|
| 문장(P-DX-6) | 기본 **"환불 규정이 어떻게 되는지 알려 주세요"**(3050 보고서 §4.2에서 두 모델 모두 사실상 정확 전사된 문장 계열) · 핵심어 `["환불","규정"]` · 기대 의도 환불문의 · 대체 문장(게이트 실패 시 리허설로 교체) "주문 취소하면 환불은 언제 되나요"(A의 기존 예문 — 규칙 매칭) |
| 생성 | P0에서 `powershell.exe -NoProfile -NonInteractive -EncodedCommand <UTF-16LE base64>` 1회 — `System.Speech.Synthesis.SpeechSynthesizer` · 한국어 음성(`ko-KR` 중 첫 번째, 이 PC = `Microsoft Heami Desktop`) · `SetOutputToWaveFile(path, SpeechAudioFormatInfo(48000, Sixteen, Mono))` · 문장 앞뒤 **무음 0.5초**(SSML `<break>` 또는 PCM 덧붙임). **`-EncodedCommand`를 쓰는 이유**: 스크립트 파일 BOM 문제(보고서 §4.2 사고)·실행 정책(`.ps1` 차단)·인자 인코딩을 한 번에 피한다 · 사용자 설정 변경 0 |
| 산출 | `<실행 폴더>/audio/utterance.wav` · 길이·바이트·형식(RIFF 헤더 파싱)을 기록 · 정리 단계에서 지우지 않는다(실행 폴더 보존 규칙 — 커밋 대상 아님 · `.demo-runs/` 무시 목록) |
| 경로 공백 | 실행 폴더 경로에 공백·마침표가 있다. 가짜 오디오 인자가 공백 경로를 못 받으면(X-1) `%TEMP%\cbdemo-<runId>\utterance.wav`로 복사해 쓰고 정리 때 지운다 |

### 7.4 보정 게이트 추가(P5 — "될 장면인지" 공연 전 확인)

| # | 확인 | 방법 | 실패 시(visible / headless) |
|---|---|---|---|
| **G-DX-1** | 합성 음성 전사가 기대 문장과 대략 일치 | `POST /public/chatbots/<A>/speech/transcriptions`(본문 = WAV · `Content-Type: audio/wav` · `x-cb-session-id` 새 UUID · `Origin` = 모형 출처) → §9.8 판정 | 음성 입력 단계 비활성 + 이유 / 종료 2("데모 데이터 보정 필요 — 합성 음성") |
| **G-DX-2** | 그 글자가 기대 의도로 답함 | 관리자 시뮬레이터에서 **의미 매칭 켬** 상태로(G-1과 같은 켜고 끄기) 1위 = 환불문의 확정 | 같음 |
| **G-DX-3** | 챗봇 D 공개 설정에 선제 규칙 포함 | `GET /public/chatbots/<D>/config?proactive=1` → `proactive.rules` 1개 · 버튼 2 · `dwellSec` 5 | 종료 2(양쪽 — 기본 투어 장면) |
| **G-DX-4** | 사전 로컬 생성 | P4-L 결과 `providerId='local'` ∧ 후보 ≥ 1(`degraded`·폴백이면 실패) | ⑩ 비활성 + 이유(대체 결과가 없으므로 생략) / 종료 2 |

- G-DX-1의 인식 1회는 음성 일별 숫자(요청·성공)를 1 올린다 → ⑧ 인식 숫자 단계는 **공연 직전 기준값 대비 +1**로 검증(§9.8 SV-08).
- G-DX-2는 감사 로그에 "AI 답변 설정 변경" 2행을 더 남긴다(DT-1 G-1과 같은 공개 문구).

---

## 8. 브라우저 구성 추가

### 8.1 기동 인자·권한(`browser/fake-media.ts` · `session.ts` 확장)

| 항목 | 기본 투어 | voice(real) |
|---|---|---|
| 기동 인자 | DT-1 그대로 | + `--use-fake-device-for-media-stream` · `--use-file-for-fake-audio-capture=<WAV 절대 경로>%noloop` |
| 권한 | 없음 | `context.grantPermissions(['microphone'], { origin: 'http://localhost:<모형 포트>' })` **1곳**(무대·모형이 같은 출처 · 콘솔 출처에는 부여하지 않음 · `--use-fake-ui-for-media-stream`은 쓰지 않는다 — NFR-DXS3) |
| 무대 모형 `iframe` | 그대로 | `allow="microphone"` 속성(템플릿 값 `{{SITE_IFRAME_ALLOW}}` — voice일 때만 채움 · 같은 출처라 기본 허용으로 보이나 불확실성 제거) |
| 다운로드 | `acceptDownloads:false`(DT-1) | **풀 투어는 `true`**(모든 계획) · 저장 위치 = `<실행 폴더>/downloads/` · `page.on('download')`로 받은 파일만 저장(DT-1 §8.6 변경점 — 10분판은 `false` 그대로) |
| 실제 마이크 | — | 열지 않는다(가짜 장치가 대체) |

- 보안 컨텍스트: `http://localhost`는 잠재적으로 신뢰되는 출처라 무대(최상위)·모형(같은 출처 `iframe`) 모두 보안 컨텍스트 → 위젯이 마이크 버튼을 만든다(C-DX-7 조건). X-2에서 확인.
- **`--voice-mock-check`**: 녹음 바이트는 서버에서 버려지지만 위젯이 실제로 녹음해야 하므로 가짜 미디어 인자·권한은 real과 같다.

### 8.2 관객용 스피커 재생(P-DX-5 · 보이는 시연만)

- 무대 최상위에 하네스 소유 `<audio id="voice-audio" src="/audio/utterance.wav" preload="auto">`와 화면 밖 버튼 `#voice-play`(`aria-hidden`·`tabindex=-1` · 제품 DOM 밖).
- SV-03에서 녹음 상태를 확인한 직후 Playwright가 `#voice-play`를 **클릭(신뢰 입력 → 자동 재생 허용)** → `audio.play()`. 실패(`NotAllowedError` 등)면 경고 1줄 + 정직성 "현장 스피커 재생 실패 — 가상 마이크 입력은 정상"(공연은 계속).
- 대안(X-8 실패 시만): 기동 인자 `--autoplay-policy=no-user-gesture-required`. 위젯 듣기·자동 읽기의 사용자 동작 조건까지 느슨하게 할 수 있어 1순위로 두지 않는다.
- 가짜 마이크와 스피커는 별개 경로(실제 마이크를 쓰지 않음) → 되먹임 0.

### 8.3 녹음 시간(연출 시간 — `pacing.ts` 예외 추가)

- 녹음 유지 = **WAV 길이 + 1.0초**(요구 0.8~1.2초 범위 중앙 · WAV 자체에 앞뒤 무음 0.5초).
- 이 대기는 결과 대기가 아니라 **매체가 실제 시간으로 재생되는 시간**이라 보이는 시연·무인 점검 모두에서 필요하다 → `pacing.ts`에 `holdForMedia(ms, signal)` 추가(NFR-DHR2 허용 예외 3번째 · 정적 검사 H-S2 갱신).
- 녹음 시작 시각 = 말하기 버튼 이름이 `말하기 끝내기`로 바뀐 순간(조건 대기 상한 5초). 가짜 파일 재생은 `getUserMedia` 시점에 시작하므로 앞 0.5초 무음이 그 차이를 흡수한다.

### 8.4 한 실행 한 문장(FR-DX4-4)

- 가짜 오디오 파일은 기동 인자라 실행 중 바꿀 수 없고, 두 번째 녹음에서 처음부터 다시 재생되는지는 미확인(X-1) → **공연 브라우저에서 마이크를 정확히 1회만 연다**.
- 그래서 ① 사전 점검의 가짜 마이크 확인은 **별도 브라우저** ② P5 예열은 말하기 버튼의 **존재만** 확인 ③ G-DX-1은 브라우저가 아니라 API 직접 ④ 무인 점검도 1회.

---

## 9. 시나리오 상세 — 프리셋 `customer-onprem-full`

표기: 선택자 출처 ✓ = 상수 파일에서 문구 확인 · △ = 역할·연결을 P5 선택자 점검으로 확정. **(V)** = `voiceInput≠off`일 때만 활성 · **(B)** = `voiceInput=off`일 때만 활성(변형) · **(L)** = `localLlm` · **(C)** = `liveClustering` · **(G)** = `sttDevice=cuda`. 자막 문구는 ui-designer가 다듬되 줄당 40자·2줄·기호 금지 규칙을 지킨다.

### 9.1 시작(40)

| 단계 | 예산 | 구분 | 동작·검증 | 캡처 | 자막(요지) · 안내 줄 | 핵심/생략 |
|---|---|---|---|---|---|---|
| S0-01 구성 카드 | 20 | UI | 무대 `/system` — DT-1 사실 + **프로세스 목록(2~4 + 정적 3 · 포트·바인드)** · **GPU 사용: 없음 / 음성 인식만 / ⑩ 생성 장면만 / 음성 인식·생성(⑩)** · 출구 허용 N곳 · 음성 인식 모델·장치 · 생성 모델(경량 구성). 검증 = 카드 값 = `/__facts`(DT-1 방식 + 새 칸) | ✓ | 변형 (¬G): DT-1과 같은 2줄 / 변형 (G): "이 노트북 한 대를 사내 서버로 가정했습니다" · "문장 분석은 CPU, 음성 인식은 이 노트북 GPU" · 안내 줄(동적): 시연용 설정 또는 장치 대체 사실 | 핵심 |
| S0-02 데이터 지도 | 20 | UI | DT-1 S0-02 + 검증을 **계획별 기대 출구 집합**으로(§6.4) | — | "데이터가 나가는 출구는 모두 이 PC 안입니다" · 안내 줄(동적): "출구 허용 N곳: 문장 분석·음성 인식·소형 생성" | 생략 가능(→ S6-05로 이월 · `promoteIfSkipped` DT-1 그대로) |

### 9.2 ①②③⑤ — DT-1 그대로

`s1Segment`(90)·`s2Segment`(80)·`s3Segment`(55)·`s5Segment`(95)를 같은 객체로 쓴다(단계·예산·검증·대체·생략 순서 불변). 라이브 예약 C-2 시각 계산은 §10.3.

### 9.3 ④ 학습 개선 루프(95 · (L)이면 75)

DT-1 단계 그대로 + **S4-03에 `when: !localLlm`(`inactive:'option'` · 사유 "예문 늘리기는 장면 10에서 사내 생성 모델로 보입니다")**. 생략 순서 `[S4-03, S4-06]`(비활성이면 S4-06만).

### 9.4 ⑥ 개인정보와 안전(100)

| 단계 | 예산 | 동작·검증 | 캡처 | 자막(요지) | 핵심/생략 |
|---|---|---|---|---|---|
| S6-01~S6-04 · S6-06 | 12·15·12·10·10 | DT-1 그대로 | DT-1 | DT-1 | DT-1 |
| S6-05 데이터 지도 | 11 | DT-1 동작 · **변형**: 자막 "외부 출구는 모두 이 PC 안의 서버뿐입니다" · 검증 = 계획별 기대 출구 | — | (변형 문구) | 생략 가능(S0-02 생략 시 핵심 승격 — DT-1 그대로) |
| **S6-07 "기록만" 규칙** | 15 | `split`(위젯 A · 같은 세션) · "포인트로 주식 추천도 받을 수 있나요?" → 답이 **대체 문구가 아님**(정상 답 또는 폴백) · API `GET A/guardrails/events`에 `MONITOR` 1건 추가 | — | "기록만 하는 규칙은 답을 막지 않고 남기기만 합니다" | 생략 가능 |
| **S6-08 가드레일 현황** | 15 | `console` · `A/guardrails/overview` · 현황 집계 영역 표시 △ · 검증 = API 현황(규칙 2 · 이번 공연 이벤트 수 = 1 + S6-07 실행 여부) | ✓ | "모델 판정 없이 정해 둔 규칙으로만 동작합니다" | **핵심** |

- 순서: DT-1 S6-01~06 뒤에 S6-07 → S6-08(현황이 두 동작을 함께 보이도록). 위기·자해 분류 미사용(FR-DH4-9). 생략 순서 `[S6-07, S6-06, S6-04, S6-05]`.

### 9.5 ⑦ 발화 묶음 분석(90 · (C)이면 150)

| 단계 | 예산 | 동작·검증 | 캡처 | 자막(요지) · 안내 줄 | 핵심/생략 |
|---|---|---|---|---|---|
| S7-01 (¬C) | 15 | DT-1 그대로(보이는 시연은 검사까지 · 무인은 실제 분석 — DT-1 headless) | — | DT-1 | 생략 가능 |
| S7-01 (C · 변형) | 15 | 업로드·검사까지(모드 무관 — 분석은 S7-07) | — | DT-1 | **핵심**(실시간 분석의 입력) |
| **S7-07 실시간 분석 (C)** | 60 | "분석 시작"✓ 클릭 → 새 분석 ID 확인 → 상세에서 완료 조건 대기(상한 120초 · `waitMaxMs` 180초) → `scratch['s7-analysis-id']` 설정(S7-02가 이 분석을 보인다 — DT-1 코드 경로) | — | "사내 CPU로 지금 문장을 묶는 중입니다" · 안내 줄(동적): "앞서 같은 파일은 약 n초 걸렸습니다"(사전 분석 실측) | **핵심** · 대체: 상한 초과 → `scratch` 비움 → S7-02가 사전 분석을 보임 + 자막 "분석이 길어져 미리 같은 파일로 실행해 둔 결과를 보여 드립니다"(FALLBACK) |
| S7-02~S7-05 | 15·15·15·10 | DT-1 그대로 | DT-1 | DT-1 | DT-1 |
| **S7-06 엑셀로 받기** | 20 | 상세 화면 "엑셀로 받기"✓ → `download` 이벤트로 `downloads/`에 저장(상한 30초) → 알림 "엑셀을 내려받았습니다. 받은 기록이 남습니다."✓ · 검증: 확장자 `.xlsx` · 크기 > 0 · 앞 4바이트 `PK\x03\x04` · 감사 로그에 내보내기 행 1건(받은 사람 = 관리자 1 · 행 수 = 분석 발화 수 △ — X-10) | — | "결과를 엑셀로 받으면 받은 사람과 행 수가 기록됩니다" | 생략 가능 · 대체: 다운로드가 막히면 하네스가 API(`GET …/:analysisId/export`)로 같은 파일을 받아 형식만 확인(EX-DX-11 — FALLBACK) |

- 순서: S7-01 → [S7-07] → S7-02 → S7-03 → S7-04 → S7-05 → S7-06. 생략 순서 `[S7-06, S7-01, S7-05]`(활성·생략 가능한 것만 적용).
- 서버 전체 분석 1건 직렬 — 사전 분석은 P4에서 끝나 있어 겹치지 않는다(DT-1 A-13).
- 다운로드 파일은 **고객 전달판 보고서에 링크하지 않는다**(AC-DX5-1).

### 9.6 ⑧ 음성 AI(95 · (V)이면 140)

| 단계 | 예산 | 구분 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) · 안내 줄 | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| **SV-01 콘솔 음성 구역** | 20 | UI | `console` · admin1 · `A/channels` → WEB 카드 "음성"✓(`aria-expanded`) → 서버 상태 배너 · "답변 듣기 사용"✓ 켜짐 · 말투 영역. **사전 처리(화면 변화 없음)**: A 의미 매칭이 꺼져 있으면(①을 `--only`로 건너뛴 실행) API로 켜고 보고서 "준비 보정"에 기록 · 인식 숫자 기준값 저장 | 배너 문구 = 기본: "서버에서 음성 인식이 꺼져 있습니다. …"✓ / (V real): "음성 인식 서버를 사용할 수 있습니다."✓ / (V mock): "시험용 모의 인식으로 동작 중입니다. …"✓ · API `GET A/voice`의 서버 상태 일치 | ✓ | "답변 듣기와 음성 입력을 챗봇별로 켭니다" · 안내 줄(동적): 기본 "이 PC 구성에서는 서버 음성 인식을 켜지 않았습니다"(플래그를 켰으나 불가였다면 그 이유) / real "음성 인식 {모델} · {이 노트북 GPU｜CPU}" | **핵심** |
| SV-02 글자로 질문 (B) | 15 | UI | `split`(위젯 A **새 세션**) · 기대 문장을 타이핑 → 전송 | 마지막 봇 말풍선 = 환불문의 답 | — | "고객이 환불 규정을 묻습니다" | **핵심** |
| **SV-03 말하기 → 글자 (V)** | 30 | UI | `split`(위젯 A **새 세션**) → 패널 열기 → **"말하기"✓(정확 일치) 클릭** → 버튼 이름 "말하기 끝내기"✓ 대기(5초) → (visible) 무대 스피커 재생(§8.2) → `holdForMedia(WAV 길이 + 1.0초)` → "말하기 끝내기" 클릭 → (선택) "글자로 바꾸는 중…" 관찰 → 입력창 값이 비지 않을 때까지 대기(상한 15초 = 위젯 대기 상한) | ① §9.8 일치 판정 ② **자동 전송 0**(봇 말풍선 수 불변) ③ 상태 줄(`cb-voice-text`) = "글자로 바꿨어요. …"✓ | ✓ + GIF | "눌러서 말하면 글자로 바꿔 입력창에 넣습니다" · "음성은 저장하지 않고 사내에서만 처리합니다" · 안내 줄: (real) "합성 음성 파일을 가상 마이크로 넣었습니다" / (mock — 무인만) "모의 인식입니다 · 음성 인식 미검증" | **핵심** · 대체: 권한·0바이트·15초 초과·오류 문구 표시 → 같은 문장 타이핑 + 자막 "음성 인식이 지연되어 같은 문장을 글자로 입력합니다"(FALLBACK — FR-DX4-9) |
| SV-04 확인 후 전송 (V) | 15 | UI | "전송"✓ | 봇 말풍선 = 환불문의 답(FR-DX4-6 ②) | — | "사용자가 확인한 뒤에만 보냅니다" | **핵심** |
| **SV-05 답변 듣기** | 20 | UI | 마지막 응답 묶음의 "이 답변 듣기"✓(`aria-label`) 클릭 → 이름 "듣기 멈추기"✓ 대기(5초) → "이 답변 듣기" 복귀 대기(상한 25초 — 읽는 시간) | 위와 같음 · 버튼이 `aria-disabled=true`면 이유 글자("이 기기에는 한국어 읽기 음성이 없어…"✓) 확인 후 **통과 + 정직성 기록**(실패 아님 — FR-DX4-7) · 무인 점검: API 공개 메시지(`features`에 `speech-v1`)로 `speech.text`·`tone` 존재(AC-DX2-4) + 버튼 존재 | ✓(멈추기 상태 순간) | "답변을 고객 기기 안의 음성으로 읽어 줍니다" · "서버로 보내는 소리는 없습니다" | **핵심** · 대체: `error` 문구 표시 → 화면 유지 + 자막 "이 PC에서는 소리 재생을 할 수 없습니다" |
| SV-06 자동 읽기 | 20 | UI | 스위치 "답변 소리로 듣기"✓(`role=switch`) 켬 → "영업시간 알려 주세요" 타이핑·전송 → 새 답의 듣기 버튼이 **누르지 않아도** "듣기 멈추기"로 바뀜 → 복귀 | 위 상태 전환 · 스위치 `aria-checked=true` | — | "켜 두면 새 답을 자동으로 읽어 줍니다" | 생략 가능 |
| **SV-07 데이터 지도 음성 절** | 20 | UI | `console` · `/settings/data-governance/map` · 음성 절 제목 "음성(눌러서 말하기 · 답변 듣기)"✓ | 문구 "답변 읽기: 사용자 기기 안에서 처리(기기 안 음성만) · 서버 전송 0"✓ · (V real) + "음성 원본: 저장 0 · 디스크 기록 0 · 사내 음성 인식 프로세스로만 전송 · 가림 불가"✓ · 출구 표에 음성 인식 행 · API `GET /governance/map`의 `speech.audioStored=false`·`ttsServerEgress=false` | ✓ | "음성 원본은 저장하지 않습니다" · "읽기는 고객 기기 안에서 합니다" | **핵심** |
| SV-08 인식 숫자 (V) | 15 | UI | `A/channels` → "음성" → 인식 숫자 표(캡션 "일별 음성 인식 숫자"✓) | API `GET A/voice/stats?from=오늘&to=오늘` 요청·성공이 SV-01 기준값 대비 **+1** | — | "숫자만 기록하고 목소리와 글자는 남기지 않습니다" | 생략 가능 |

- 활성 묶음: 기본 = SV-01·02·05·06·07(95) · (V) = SV-01·03·04·05·06·07·08(140). 생략 순서 `[SV-06, SV-08]`.
- 위젯 새 세션은 DT-1 `freshWidgetSession`(무대 출처 저장소 비움 — 자동 읽기 저장 키 `cb.vo.ar.{slug}`도 초기화).
- 갤러리 고정 문구: "영상에는 소리가 없습니다 — 현장 스피커로만 들립니다"(FR-DX4-8 · SV-03·SV-05·SV-06 캡처 옆).

### 9.7 ⑨ 선제 안내(70)

| 단계 | 예산 | 동작 · 선택자 | 검증 | 캡처 | 자막(요지) · 안내 줄 | 핵심/생략 |
|---|---|---|---|---|---|---|
| **SP-01 말풍선 표시** | 25 | `split`(**모형 D**) · `freshWidgetSession(D)` → 말풍선 `.cb-pa-bubble`(안정 클래스 — DT-1 `cb-msg-*`와 같은 근거) 표시 조건 대기(상한 15초 = 체류 5초 + 설정 조회 + 판정 주기 + 여유) | 말풍선 문구 = 규칙 문구 · 버튼 "배송 조회"·"영업시간"✓ · **패널 자동 열림 0**(입력창 "메시지 입력" 비표시) | ✓ + GIF | "고객이 페이지에 머물자 챗봇이 먼저 말을 겁니다" · 안내 줄: "시연을 위해 머문 시간을 5초로 줄였습니다" | **핵심** · 대체: 15초 초과 → 콘솔 D 선제 구역의 "미리보기"✓ 화면 + 자막 "말풍선이 뜨지 않아 관리자 미리보기로 대신 보여 드립니다"(EX-DX-10) |
| **SP-02 버튼으로 대화** | 15 | "배송 조회" 클릭 → 패널 열림 → 사용자 말풍선 "배송 조회하고 싶어요" → 봇 답 | 봇 답 = D 배송조회 답(데이터셋) | — | "창은 고객이 누를 때만 열립니다" | **핵심** |
| **SP-03 콘솔 규칙·집계** | 20 | `console` · `D/channels` → "선제 안내"✓ → 규칙 표(캡션 "선제 안내 규칙 (…)"✓) → 해당 행 "통계 보기"✓ | API `GET D/proactive/stats?from=오늘&to=오늘`의 표시 ≥ 1 · 클릭 ≥ 1(수집이 비동기라 조건 대기 10초) | ✓ | "개인을 식별하지 않고 규칙별 숫자만 저장합니다" | **핵심** |
| SP-04 이번 방문 동안 끄기 | 10 | `split`(모형 D) · 새 세션 → 말풍선 → "이번 방문 동안 안내 끄기"✓ | 말풍선 닫힘 · 포커스 = 런처 "상담 시작하기" · API 집계 `OPTED_OUT` +1(A-DX-5) | — | "고객이 끄면 이번 방문 동안 다시 뜨지 않습니다" | 생략 가능 |

- 생략 순서 `[SP-04]`. AC-DX3-2(①②⑤⑥에 말풍선 0)는 A·B 모형 스니펫에 `data-proactive`가 없어 구조적으로 보장되고, P5 예열에서 A 모형 15초 체류 뒤 말풍선 0을 1회 확인한다(준비 단계 — 공연 시간 밖).

### 9.8 음성 확인 판정(FR-DX4-6 · `src/voice/match.ts`)

```
norm(s) = NFC(s) → 소문자 → 공백·문장부호·기호(\p{P}\p{S}\s) 제거
ratio   = 1 − levenshtein(norm(expected), norm(actual)) / max(len 둘, 1)
keywordsOk = 모든 핵심어 k: norm(actual).includes(norm(k))
통과 = (ratio ≥ 0.8 ∨ keywordsOk) ∧ intentOk(전송 → 기대 의도 답)
```

- 한글 숫자 정규화는 하지 않는다(제품 후처리에 맡김 — 문장에 숫자 없음). 0.8은 **제안·미실측**(리허설 보정 · 보고서에 원문·비율 그대로).
- 예: 보고서 §4.2 "환불규정"(띄어쓰기만 다름) → ratio 1.0.

### 9.9 ⑩ 엣지 추론((L) · 140)

| 단계 | 예산 | 구분 | 동작 | 검증 | 캡처 | 자막(요지) · 안내 줄 | 핵심/생략 |
|---|---|---|---|---|---|---|---|
| **SE-01 GPU 전환** | 45 | UI(카드) | 무대 `card` · `/system?view=gpu`(하네스 카드 — §12.3) 표시 → (음성 자식이 있으면) **음성 자식 트리 종료 → 회수 조건 대기**(§11.2 · 상한 15초) → **Ollama 적재 요청**(상한 60초) → `/api/ps`에 모델 표시 · 카드가 단계마다 상태 갱신 | 회수 조건 충족 · 적재 확인 · 사실 갱신(`gpu.ollamaActive=true`) | ✓ | "음성 인식을 내리고 사내 소형 생성 모델을 올립니다" · 안내 줄: "4B 소형 모델 · 이 노트북 GPU · 동작 확인 수준" | **핵심** · 대체: 회수 실패·적재 실패 → SE-02를 사전 결과 모드로 전환(아래) |
| **SE-02 예문 늘리기(로컬)** | 60 | UI | `console` · admin1 · `A/dialogue/intents` · "주문변경" 의도 대화상자 → "예문 증강"(DT-1 S4-03 선택자) → "새로 생성하기" → "생성이 완료되었습니다" 대기(상한 50초 = API 증강 제한 30초 + 여유) | API 목록 `runResult.providerId='local'` ∧ `degraded=false` ∧ 후보 ≥ 1 → PASS / `providerId='rule'`·`degraded`·`fallbackFrom='local'` → **FALLBACK** + 자막 "소형 모델이 이번에는 후보를 만들지 못해 규칙 기반 후보로 대신했습니다"(사실 그대로 — FR-DX6-4) | ✓ | "사내 소형 모델이 예문 후보를 만듭니다" · 안내 줄: "문장 품질은 보증하지 않습니다(경량 구성)" | **핵심** · 대체(시간 초과·SE-01 실패): "회원정보" 의도의 **사전 생성 결과** 화면 + 자막 "미리 같은 모델로 만들어 둔 결과입니다"(FALLBACK · `source:'PREPARED'`) |
| **SE-03 사람이 고르기** | 25 | UI | 후보 표에서 **형식 검사를 통과한 앞의 2개**(빈 값 아님 · 60자 이하 · 기존 예문과 중복 아님)를 "승인"✓ — DT-1 A-9 허용 목록은 쓰지 않는다(비결정적) | 승인 수 = min(2, 통과 후보 수) ≥ 1 · API 예문 수 증가 | — | "사람이 확인한 문장만 예문으로 넣습니다" | **핵심** |
| SE-04 모델 내리기 | 10 | API | Ollama 해제(`keep_alive:0`) → `/api/ps`에서 사라짐 확인(상한 20초) → 생성 자식(8101) 트리 종료 → 사실 갱신(`gpu.ollamaActive=false`) | 해제·종료 확인(실패는 경고 + 정리 단계 재시도 · 단계는 통과) | — | (API — 직전 자막 유지) | **핵심** |

- 이 구간 동안 "CPU 동작" 배지는 나오지 않는다(§12.1 — 증거 조건 불충족).
- SE-03은 대체 모드(사전 결과)에서도 같은 동작을 그 의도에 적용한다.
- `voiceInput=off`(STT 없음)이면 SE-01은 회수 단계 없이 적재만.

### 9.10 끝(20)

| 단계 | 예산 | 동작 | 검증 | 자막 | 핵심/생략 |
|---|---|---|---|---|---|
| S9-01 로드맵(풀 투어 변형) | 17 | `/roadmap?preset=full` — "오늘 시연한 장면" = **활성 장면 목록**(9 또는 10) · 로드맵 행 = `ROADMAP`에서 **오늘 시연한 기능 번호 제외**(⑧이 항상 활성이므로 No.32 행 제외) · **"이 PC 구성에서 생략한 장면" 줄**(비활성 `option` 구간·단계의 사유 — 예: "사내 소형 생성 모델 장면 — GPU와 생성 모델 설치가 필요해 생략했습니다", "음성으로 묻기 — 음성 인식 모델이 없어 생략했습니다") | 목록 수 = 활성 장면 수 + 로드맵 행 수 + 생략 줄 수 · 상태 칩 = 데이터(H-T18 확장) | DT-1 문구 | **핵심** |
| S9-02 예약 재확인 | 3 | DT-1 그대로 | | | 생략 가능 |

- 고객용 생략 사유에는 명령 옵션 이름을 쓰지 않는다(보고서 내부판에만 `--with-local-llm` 등).

### 9.11 선택자 추가(`selectors/widget.ts`·`console.ts` — 단일 출처)

| 대상 | 선택자 | 문구 원천(H-T9 대조) |
|---|---|---|
| 말하기 | `getByRole('button', { name: '말하기', exact: true })` · 녹음 중 `{ name: '말하기 끝내기', exact: true }` · 인식 중 `'글자로 바꾸는 중…'` | `apps/widget/src/constants/speech.ts` `micLabel`·`micLabelStop`·`micLabelBusy` |
| 음성 상태 줄 | `.cb-voice-text`(안정 클래스) | `mic-button.ts` 27행 · 문구 `done` |
| 듣기 | `getByRole('button', { name: '이 답변 듣기' })`(마지막) ↔ `'듣기 멈추기'` | `listenAria`·`stopAria` |
| 자동 읽기 | `getByRole('switch', { name: '답변 소리로 듣기' })` | `autoReadLabel` |
| 선제 말풍선 | `.cb-pa-bubble` · 버튼 `getByRole('button', { name: <라벨> })` · `'이번 방문 동안 안내 끄기'` · `'안내 닫기'` | `constants/proactive.ts` |
| 콘솔 음성·선제 | WEB 카드 범위 `getByRole('button', { name: '음성', exact: true })`·`'선제 안내'` △(카드 범위 한정 방법 — 카드 제목) · 배너·표 캡션·"통계 보기" | `messages.ts` `voice.*`·`proactive.*` |
| 데이터 지도 음성 절 | 제목 `'음성(눌러서 말하기 · 답변 듣기)'` · 줄 문구 | `messages.ts` `voice.governance.*` |
| 엑셀 | `getByRole('button', { name: '엑셀로 받기' })` · 알림 문구 | `messages.ts` 5366~5368 |
| 가드레일 현황 | 현황 제목·집계 영역 △ | `guardrails.messages.ts`(구현 시 확인) |

`data-testid` 추가 0. 위젯 Shadow DOM은 열린 모드라 DT-1처럼 관통한다.

---

## 10. 시간 예산

### 10.1 구간 예산(초 · 제안 · 미실측)

| 구간 | 기본 | (V) | (C) | (L) | 전부 | 핵심만(기본/전부) | 생략 순서 |
|---|---|---|---|---|---|---|---|
| 시작 | 40 | 40 | 40 | 40 | 40 | 20/20 | S0-02 |
| ① | 90 | 90 | 90 | 90 | 90 | 45/45 | DT-1 |
| ② | 80 | 80 | 80 | 80 | 80 | 58/58 | DT-1 |
| ③ | 55 | 55 | 55 | 55 | 55 | 40/40 | DT-1 |
| ④ | 95 | 95 | 95 | **75** | 75 | 65/65 | S4-03 → S4-06 |
| ⑤ | 95 | 95 | 95 | 95 | 95 | 82/82 | S5-07 |
| ⑥ | 100 | 100 | 100 | 100 | 100 | 54/54 | S6-07 → S6-06 → S6-04 → S6-05 |
| ⑦ | 90 | 90 | **150** | 90 | 150 | 45/120 | S7-06 → S7-01 → S7-05 |
| ⑧ | 95 | **140** | 95 | 95 | 140 | 75/105 | SV-06 → SV-08 |
| ⑨ | 70 | 70 | 70 | 70 | 70 | 60/60 | SP-04 |
| ⑩ | — | — | — | **140** | 140 | —/140 | (없음) |
| 끝 | 20 | 20 | 20 | 20 | 20 | 17/17 | S9-02 |
| **합** | **830**(13:50) | 875(14:35) | 890(14:50) | 930(15:30) | **1,035**(17:15) | 561/806 | |

- `expectedTotals` 필수 선언: 기본 830 · 전부 1,035(+ 위 표의 조합 · V+L 975 · V+C 935 · C+L 990).
- NFR-DXP1: 보이는 시연 총 시간 = **해석된 총 예산 ± 30초**(일시정지 제외).
- 시간 관리 알고리즘은 DT-1 §11.2 그대로(`LAG_TOLERANCE_SEC=4` 포함). 핵심만 합 대비 여유 = 기본 약 4분 29초 · 전부 약 4분 9초.

### 10.2 무인 점검(NFR-DXP3)

예산·유지 없음 · 타이핑 즉시. 목표(제안): 기본 투어 약 6~8분 · 플래그 전부 약 8~10분(실시간 분석·모델 적재 대기 포함 · 미실측). 녹음 유지(§8.3)·말풍선 체류(조건 대기)는 무인 점검에서도 실제 시간이 든다.

### 10.3 라이브 예약 C-2 시각(일반화)

`offsetMin = max(5, floor(start(S5-07) / 60) − 1)` — `start`는 해석된 예산 기준 S5-07 시작 시각(초). 10분판 432초 → 6분(DT-1과 같음) · 풀 투어 452초 → 6분. 풀 투어에서는 S5-07 도달 시 대개 **이미 실행된 예약**을 보인다 — DT-1 §7.6이 대체가 아니라고 정한 경우와 같다.

---

## 11. 3050 순차 적재 · Ollama 제어 · VRAM 관찰

### 11.1 동시 적재 원칙(요구사항 §6.1 확정)

| 조합 | 허용 |
|---|---|
| 임베딩 CPU + STT turbo GPU(≈1GB) | 허용 — ①~⑨ |
| 임베딩 CPU + STT small CPU | 허용(GPU 0) |
| 임베딩 CPU + Ollama 4B(관찰 2.3GB + CPU 분산) | 허용 — ⑩ · P4-L |
| STT GPU + Ollama | **금지** — 순차 적재(§5 · §9.9) |
| 임베딩 GPU | 범위 밖 |

### 11.2 VRAM 회수 판정(`src/gpu/`)

| 시점 | 조건(모두 만족 · 상한) |
|---|---|
| STT 종료 뒤(SE-01) | ① 음성 자식 PID(런처·인터프리터)가 `nvidia-smi --query-compute-apps=pid --format=csv,noheader`에 없음 ② `memory.used ≤ 종료 직전 값 − 0.7 × STT 적재 증분`(증분 = P4-V 기동 전후 차) — 증분을 모르면 ①만 · 상한 15초 |
| Ollama 해제 뒤(P4-L·SE-04) | ① `GET /api/ps`에 그 모델 없음 ② `memory.used` 하락(적재 증분의 70%) · 상한 20초 |

- Windows WDDM에서 `--query-compute-apps`가 PID를 보고하지 않으면(X-5) ②만으로 판정하고 보고서에 "판정 근거: 메모리 하락만"을 적는다.
- **관찰은 판정이 아니다**(FR-0-352): VRAM 수치는 보고서 표에만 쓰고 합격 판정에 쓰지 않는다. 위 조건은 "다음 동작을 해도 되는가"의 운영 게이트일 뿐이다.

### 11.3 Ollama 호출(`src/llm/ollama-client.ts` — 루프백 고정)

| 목적 | 호출 | 근거 |
|---|---|---|
| 서버·모델 확인 | `GET /api/tags` | 제품 생성기와 같은 확인(`generator.py` 337행) |
| 적재 목록 | `GET /api/ps` | Ollama 공식 API(X-4) |
| 적재(미리 올리기) | `POST /api/generate {"model": M, "keep_alive": "10m"}`(프롬프트 없음 · 스트림 끔 · 상한 60초) | 공식 API "빈 프롬프트 = 모델 적재"(X-4) |
| 해제 | `POST /api/generate {"model": M, "keep_alive": 0}` | 공식 API "keep_alive 0 = 해제"(X-4) |

- 적재를 하네스가 따로 하는 이유: 해제된 모델의 **첫 생성 요청이 적재 시간까지 떠안으면** ml-worker 요청 제한(25초)을 넘길 수 있다 — 적재를 SE-01(자막으로 공개되는 대기)로 분리하면 SE-02는 생성 시간만 쓴다.
- 하네스는 **자기가 쓰는 모델(M) 1개만** 적재·해제한다. 다른 모델은 건드리지 않는다(EX-DX-8). Ollama 서비스 기동·종료·모델 내려받기 0(FR-0-353).
- 호출 위치는 이 파일 1곳(정적 검사 H-S6) · 주소 상수 `http://127.0.0.1:11434`.

### 11.4 VRAM 관찰기

- 대상 실행: `sttDevice=cuda` 또는 `localLlm`. 아니면 P0 1회 기록만(DT-1 PC-12).
- 주기 **2초**(`nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits` — CSV라 코드 페이지 무관) · 이벤트 표시: `P0`·`P4-L 워밍업 후`·`사전 생성 후`·`해제 후`·`STT 적재 후`·`T0`·`⑧ 최대`·`STT 종료 후`·`Ollama 적재 후`·`⑩ 최대`·`해제 후`.
- 관찰기 비용(프로세스 1개/2초)은 공연 지연에 영향이 없도록 비동기·겹침 금지(이전 호출이 끝나지 않았으면 건너뜀).

---

## 12. 구축형 강조 · 배지 · 정직성

### 12.1 배지 증거(`badges.ts` 확장)

| 배지 | DT-1 증거 | 풀 투어 추가 조건 |
|---|---|---|
| CPU 동작 | `device=cpu ∧ gpuHidden` | **∧ `gpuActive.length === 0`** — `gpuActive` = 지금 살아 있는 GPU 노출 자식(음성 cuda) + 하네스가 적재한 Ollama 모델. 사실 객체는 공연 중 갱신(SE-01·SE-04) |
| 외부 송신 없음 | `externalAddresses === 0` | 계산 방식만 §6.4(루프백 제외) — 모든 계획 0 |
| 출구 통제 | 거버넌스 ON | 그대로 |

- 결과: 3050 + `auto`(→ cuda)면 **①~⑨ 동안 "CPU 동작" 배지가 나오지 않는다**. "GPU 없이"가 중요한 고객 시연은 `--stt-device cpu` 또는 음성 입력 없이(§4.3 예) — 사용법 문서에 안내(환류 R-11).
- 10분판: `gpuActive`가 항상 빈 배열 → DT-1과 같은 결과(H-T29).

### 12.2 정직성 표기 추가(`honesty[]`·자막 안내 줄)

| 종류(`HonestyKind` 추가) | 언제 | 문구(요지) |
|---|---|---|
| `SYNTHETIC_INPUT` | SV-03(real) | 합성 음성 파일을 가상 마이크로 넣음 · 실제 사람 음성 아님 |
| `MOCK`(기존) | SV-03(mock · 무인만) | 모의 인식 — STT 미검증 |
| `GPU_USED` | S0-01(G) · SE-01~03 | 이 노트북 GPU 사용 구간 |
| `QUALITY_UNVERIFIED` | SE-02 · 보고서 STT 절 | 동작 확인 수준 · 품질 미보증 · 3050 결과는 영업·합격 판정에 쓰지 않음 |
| `NO_AUDIO` | SV-03·05·06 캡처 | 영상·GIF에는 소리가 없음 |
| `DEVICE_FALLBACK` | STT cuda → cpu 재기동 | 장치 자동 대체 사실·이유 |
| `PREPARED_RESULT`(기존) | S7-02(사전 분석) · SE-02 대체 | 미리 같은 파일/모델로 만든 결과 |
| `DEMO_SETTING`(기존) | SP-01(체류 5초) · 듣기 음성 0개 | 시연용 설정 · 이 PC 한계 |
| `SKIPPED`(기존) | 플래그·장치 부재로 비활성 | 생략 사유 |

### 12.3 카드(하네스 자산 — ui-designer 명세 추가 대상)

- `/system`: 프로세스 표(역할·포트·바인드·장치) · "GPU 사용" 1줄 · 출구 허용 N곳 · 음성 인식 모델/연산 형식 · 생성 모델(경량 구성).
- `/system?view=gpu`(⑩ 전환 카드): 음성 인식 프로세스 상태 · GPU 메모리 사용(최근 관찰값 / 총량) · 생성 모델 적재 상태 — `/__facts`에서 읽어 단계마다 갱신. 수치 옆 "관찰값 · 판정 아님".
- `/roadmap?preset=full`: §9.10.
- 무대: 모형 `iframe` `allow` 값 · `<audio>`·`#voice-play`(voice일 때만).

---

## 13. 캡처 · 보고서

### 13.1 핵심 캡처 · GIF

- 핵심 캡처 추가: S6-08 · SV-01 · SV-03(입력창 채워진 순간 — real) 또는 SV-05(멈추기 상태 — 기본) · SV-07 · SP-01 · SP-03 · SE-01 · SE-02 · (C) S7-07 완료 뒤 S7-02.
- 구간 대표(갤러리 첫 줄)에 ⑥ S6-08 대신 DT-1 S6-02 유지 · ⑧ SV-03(없으면 SV-05) · ⑨ SP-01 · ⑩ SE-02 추가.
- GIF: DT-1 4개 + **SV-03(real) 또는 SV-05** + **SP-01** = 최대 6개(P-DX 제안 상한).

### 13.2 `result.json`(스키마 v1 · 선택 필드 추가 — `report/schema.ts`)

```jsonc
{
  // v1 필수 필드 그대로. 변경 1건: machine.gpuUsedByHarness  z.literal(false) → z.boolean()  (10분판 값 false 고정)
  "plan": { "voiceInput": "real", "sttDevice": "cuda", "sttModel": "large-v3-turbo", "sttRequested": "auto",
            "localLlm": true, "liveClustering": true, "voiceOmittedReason": null,
            "inactive": [ { "id": "S4-03", "reason": "…" } ] },
  "models": [ { "role": "embed",  "port": 8100, "backend": "sentence-transformers", "modelId": "nlpai-lab/KURE-v1@main", "device": "cpu" },
              { "role": "speech", "port": 8102, "backend": "faster-whisper", "modelId": "large-v3-turbo", "device": "cuda", "computeType": "int8", "fallbackFrom": null },
              { "role": "augment","port": 8101, "backend": "ollama", "modelId": "ollama:qwen3:4b-instruct-2507-q4_K_M", "device": "external", "profile": "lightweight", "targetCap": 20 } ],
  "vram": [ { "at": "…+09:00", "event": "T0", "usedMiB": 0, "totalMiB": 4096 } ],
  "speech": { "expected": "…", "keywords": ["환불","규정"], "gateTranscript": "…", "transcript": "…", "matchRatio": 1.0,
              "keywordsOk": true, "intentOk": true, "wavSec": 4.8, "wavBytes": 0, "recordedMime": "audio/webm;codecs=opus",
              "source": "BROWSER", "listen": "PLAYED" },          // source: BROWSER | TYPED_FALLBACK | MOCK · listen: PLAYED | NO_VOICE | ERROR
  "localLlm": { "prepared": { "providerId": "local", "degraded": false, "candidates": 0, "elapsedMs": 0 },
                "live": { "providerId": "local", "degraded": false, "fallbackFrom": null, "candidates": 0, "elapsedMs": 0, "source": "LIVE" },
                "loadMs": 0, "unloaded": true },
  "downloads": [ { "stepId": "S7-06", "file": "downloads/…xlsx", "bytes": 0, "via": "BROWSER", "auditRows": 0 } ],
  "proactive": { "shown": 0, "clicked": 0, "optedOut": 0 }
}
```

- 10분판 결과에는 위 선택 키가 **하나도 없다**(키 집합 = 지금 v1과 같음 — AC-DX0-1 · H-T28).
- `HonestyKind` enum 값 추가(§12.2) — 풀 투어 결과에서만 나타난다.

### 13.3 보고서 HTML 추가 절

모델 구성표 · VRAM 관찰표(이벤트별 + 구간 최대) · 음성 확인(기대 문장·게이트 전사·위젯 전사·일치율·핵심어·의도 · "정확도 판정 아님") · 로컬 생성 요약(사전·실시간·폴백·적재/해제) · 선제 집계 · 내려받은 파일(내부판만) · 정직성 표 확장 · 갤러리 소리 없음 문구 · 알려진 한계 추가(§20.2). 외부 자원 0 · `lang="ko"`(DT-1 규칙).

### 13.4 엑셀 검증(새 의존성 0)

파일: 확장자·크기·`PK\x03\x04` 시그니처. 행 수: 제품 감사 로그(`GET /audit-logs?chatbotId=A&…`)의 내보내기 행에서 행 수 필드(필드 이름 X-10) = 분석 상세의 발화 수. 파일 내부(시트) 파싱은 하지 않는다.

---

## 14. 실패 · 대체 장면 표

| 상황 | 단계 | visible | headless | 상태 |
|---|---|---|---|---|
| 녹음 권한·0바이트·15초 초과·`SPEECH_*` 오류 문구 | SV-03 | 같은 문장 타이핑 + "음성 인식이 지연되어 같은 문장을 글자로 입력합니다" → SV-04 계속 | 실패 · `ml-speech.log` 꼬리 · 위젯 오류 문구 | FALLBACK / FAIL |
| 브라우저 녹음물 디코딩 불가(`SPEECH_AUDIO_INVALID`) | SV-03 | 위와 같음 | 실패 + **제품 결함 후보**(우회 금지 — R-DX-9) | 같음 |
| 무음 판정(`empty`) | SV-03 | 위와 같음 + 보고서 "VAD가 합성 음성을 무음으로 판정" | 실패 | 같음 |
| 기기 안 한국어 음성 없음 | SV-05·06 | `aria-disabled`·이유 글자 확인 → 통과 + 정직성 | 같음 | PASS(정직성) |
| 소리 재생 `error` | SV-05 | 화면 유지 + "이 PC에서는 소리 재생을 할 수 없습니다" | 실패 | FALLBACK / FAIL |
| 말풍선 미표시(창 최소화·체류 미누적) | SP-01 | 콘솔 "미리보기" + 자막 | 실패 | FALLBACK / FAIL |
| 실시간 분석 상한 초과 | S7-07 | 사전 분석으로 + 자막 | 실패 | FALLBACK / FAIL |
| 다운로드 차단 | S7-06 | API로 같은 파일 수신 · 형식 확인 | 같음 | FALLBACK |
| VRAM 회수 실패·Ollama 적재 실패 | SE-01 | SE-02를 사전 결과 모드로 | 실패 | FALLBACK / FAIL |
| 로컬 0건 → G1 폴백 | SE-02 | 폴백 사실 자막 | 같음 | FALLBACK |
| 생성 시간 초과 | SE-02 | 사전 결과 + "미리 같은 모델로 만들어 둔 결과입니다" | 실패 | FALLBACK / FAIL |
| 해제 실패 | SE-04 | 경고 · 정리 단계 재시도 | 같음 | PASS(경고) |
| 플래그를 켰으나 장치·모델 부재(사전 점검) | — | 장면 비활성 + 이유(시작 전 진행자 확인) | 종료 2 | SKIPPED(OPTION) / PREPARE_FAILED |

- 무인 점검의 실패는 DT-1 규칙(그 구간 중단 · 다음 구간 계속 · `--fail-fast`).

---

## 15. 보안 · 데이터 원칙(추가)

| # | 원칙 | 구현 |
|---|---|---|
| S-DX-1 | 음성 원본 저장 0 확인(NFR-DXS1 · AC-DX2-2) | 정리 직전 **매직 바이트 검사**: 실행 폴더(제외: `audio/utterance.wav`·`browser-profile/`·`video/`·`downloads/`)와 `demo.db` 파일 바이트에서 `RIFF….WAVE`·`OggS`·EBML(`1A 45 DF A3`) 시그니처 0 · 서버 로그(`api.log`·`ml-speech.log`)에 기대 문장·전사 글자 0. 휴리스틱임을 보고서에 명시 |
| S-DX-2 | 마이크 권한 범위 | 모형 출처 1곳 · 실제 장치 미사용 · 전역 자동 수락 인자 미사용 |
| S-DX-3 | 사용자 장치 상태 | Ollama·모델 목록·HF 캐시·STT 캐시·`.venv` 읽기·호출만(FR-0-353) · Ollama는 하네스가 쓴 모델만 적재/해제 · 사용자 `PATH`·실행 정책·SAPI 설정 변경 0(`-EncodedCommand`는 프로세스 단위) |
| S-DX-4 | 외부 송신 | Ollama·자식 3종 모두 루프백 · 모델 내려받기 0(`local_files_only`·`HF_HUB_OFFLINE`) · 브라우저 외부 요청 감시 그대로(DHD-13) |
| S-DX-5 | 비밀 | 새 비밀 0(Ollama·STT 인증 없음) · 전사 글자는 비밀이 아니나 고객 전달판에도 실린다(합성 문장) |

---

## 16. 의존성 · 폐쇄망 반입

| 항목 | 변경 | 반입 |
|---|---|---|
| 하네스 npm 의존성 | **추가 0**(편집거리·WAV·CSV·HTTP는 Node 표준으로) | 변경 없음 |
| 제품 의존성·잠금 파일 | 변경 0 | — |
| 음성(선택 · voice) | `.venv`의 `[speech]` 묶음(`requirements-speech-lock.txt`) · STT 모델 폴더 `apps/ml-worker/.cache/stt-models/{large-v3-turbo(1.6GB),small(464MB)}` · (Windows GPU) pip `nvidia-cublas-cu12`·`nvidia-cudnn-cu12`·`nvidia-cuda-nvrtc-cu12`(잠금 파일 밖 — 보고서 §2 버전) | `자동배포.md` §5.13 반입 목록에 추가(패치) |
| 생성(선택 · llm) | Ollama 설치본 + 모델 `qwen3:4b-instruct-2507-q4_K_M`(사용자 장치 — 하네스는 설치·내려받기 0) | 같음 |
| SAPI 한국어 음성 | Windows 음성 팩(`Microsoft Heami Desktop` 등) | 반입 대상 아님(OS 기능) — 없으면 voice 불가 |

---

## 17. 시험 설계(하네스 자체 · `harness:test` — CI 미편입)

### 17.1 단위 시험 추가(H-T19~)

| # | 대상 |
|---|---|
| H-T19 | 계획 해석·정의 검사 일반화: ① 16개 계획 전부 규칙 통과 ② `expectedTotals`(기본 830 · 전부 1,035 · 조합) ③ 활성 ID 유일·`variant` 묶음 정확히 1개 활성 ④ 동적 문구 함수(안내 줄·카드 줄)의 모든 계획·사실 조합 출력이 40자·기호 규칙 통과 ⑤ ⑧ 이후 음성 의존 단계 0 ⑥ **10분판 해석 결과 = 정적 정의**(구간 9·예산 600·단계 ID 목록 동일) |
| H-T20 | 인자: 새 옵션 5종 · §4.2 조합 오류 전부 · `--only voice` 10분판 오류 · `--skip SV-06`·`--inject-delay SE-01:5` 정규식 · 단독 `--` 무시 유지 |
| H-T21 | 환경: **10분판 API·임베딩 환경 = DT-1 스냅숏(키·값 동일)** · 풀 투어 기본(`SPEECH_ENABLED=false`·`ML_WORKER_SPEECH_URL=''`·`PROACTIVE_ENABLED=true`) · voice real/mock · llm(`DATA_EGRESS_ALLOWED_HOSTS` 정확 문자열) · **모든 계획·모든 자식에 `NODE_ENV` 부재** · 음성 자식 cuda(`PATH` 앞 3경로 순서·존재 필터·부모 키 표기 보존 · `CUDA_VISIBLE_DEVICES=0`) / cpu(`PATH` = 부모 · `-1`) · `STT_VAD`는 항상 `auto` · 생성 자식(허용 목록·필수 플래그·`-1`) · 다른 자식 `PATH` = 부모 · `egressCoverage(plan)` × `EgressExitId` 16계획 |
| H-T22 | STT 장치 결정표(§5.2) 전 행 — `auto`/`cuda`/`cpu` × GPU·DLL·VRAM·캐시 조합 → 결정·차단·불가 · visible/headless 처리 차이 |
| H-T23 | 일치 판정: 정규화(공백·문장부호·NFC) · 경계 0.79/0.80 · 핵심어 · "환불규정" 사례 1.0 · 빈 문자열 |
| H-T24 | WAV RIFF 헤더 파서(길이·표본율·채널·비트) · SAPI 명령 생성: `-EncodedCommand` 문자열이 UTF-16LE base64 왕복 시 한글 문장 보존 · 출력 경로 따옴표 처리 |
| H-T25 | `nvidia-smi` CSV 파서(정상 · `[N/A]` · 빈 출력 · 여러 GPU) · 회수 판정 함수(PID 조건·메모리 조건·증분 미상) |
| H-T26 | Ollama 클라이언트: 루프백 외 주소 거부 · `/api/tags`·`/api/ps` 해석 · 적재·해제 본문(`keep_alive: "10m"`·`0`) — 로컬 모의 HTTP 서버 |
| H-T27 | 풀 투어 로드맵: 시연한 기능 번호 제외(No.32) · 생략 줄(플래그별) · 목록 수 공식 · 고객용 문구에 옵션 이름 0 |
| H-T28 | `result.json`: 10분판 키 집합 = v1(선택 키 0 · `gpuUsedByHarness=false`) · 풀 투어 왕복(선택 키 전부 · `true` 허용) · 고객 전달판에 `downloads` 링크 0 |
| H-T29 | 배지: `gpuActive` 비면 DT-1과 같음 · 음성 cuda 살아 있음/Ollama 적재 중이면 "CPU 동작" 0 |
| H-T30 | 선제 스니펫 변환: 콘솔과 같은 결과(`' data-proactive="on"></script>'`) · 이미 있으면 그대로 · 변환 뒤 `isSafeSnippet` 통과 · D에만 적용 |

### 17.2 정적 검사 추가·갱신

| # | 단언 |
|---|---|
| H-S2(갱신) | `setTimeout`/`sleep` 허용 위치에 `pacing.ts`의 `holdForMedia` 포함(파일 2개 원칙 유지) |
| H-S6 | Ollama 호출은 `src/llm/ollama-client.ts`에만 · `nvidia-smi` 실행은 `src/gpu/`에만 |
| H-S7 | 10분판 정의 불변: 풀 투어 모듈 import 전후 10분판 단계 정의 직렬화 동일 · `scenarios/full/**`이 DT-1 단계 객체에 대입(`step.x =`)하지 않음 |
| H-S8 | 자식 `PATH` 값 변경 코드는 `src/env/ml-speech-env.ts`에만 |

### 17.3 AC ↔ 시험 매핑(test-automation)

| AC | 방법 | 자동/수동 |
|---|---|---|
| AC-DX0-1 | `pnpm demo:check`(인자 없음) — 단계 ID·결과·검증 수치가 DT-1과 같음 · 자식 2개 · 선택 키 0(H-T28) · **10분판 연속 5회**(NFR-DHR1 회귀) | 반자동 |
| AC-DX0-2 | H-T18 · H-T27 | 자동 |
| AC-DX0-3 | `apps/api/.env`에 `SPEECH_ENABLED=true`·`SPEECH_PROVIDER=local`·`ML_WORKER_SPEECH_URL=http://127.0.0.1:<수신 서버>`(백업·복원) → 10분판 **및 풀 투어 기본** 실행 → 수신 0 · 공개표 키 표시 | 반자동(.env 원복 규약) |
| AC-DX1-1~5 | 모델 캐시 폴더 임시 이름 변경 · Ollama 종료 · 10분판+플래그 · DLL 폴더 임시 이름 변경(auto → cpu) · 플래그 없는 풀 투어 — 기대: §5.1·§5.2 처리(A-DX-2 반영: visible 경고+생략 / headless 종료 2) | 반자동 |
| AC-DX2-1~6 | SV 단계 검증 · 인식 숫자 +1 · 지도 · 매직 바이트 검사 · 공연 중 음성 자식 `taskkill`(시험 스크립트 — AC-DX2-5) · `--voice-mock-check` visible 거부 | 자동+반자동 |
| AC-DX3-1·2 | SP 단계 · 예열 말풍선 0 확인 | 자동 |
| AC-DX4-1~3 | VRAM 표 순서(STT 종료 → 회수 → 적재) · SE-02 판정 · 정리 뒤 생성 자식 0·Ollama 서비스 생존·해제 기록 | 반자동 |
| AC-DX5-1~6 | S7-06 · S7-07 · 보고서 절 · **visible 리허설(플래그 전부) 총 시간 1,035 ± 30초** · **풀 투어 무인 점검(플래그 전부) 연속 3회**(NFR-DXR1) · 비밀 검색 0 | 수동/반자동 |

### 17.4 구현 첫 작업 — 실기동 확인 X-1~X-10(이 PC · 제품 변경 0)

| # | 확인 | 실패 시 |
|---|---|---|
| X-1 | Edge 154 + `playwright-core 1.63.0`에서 `--use-fake-device-for-media-stream`·`--use-file-for-fake-audio-capture=<공백 경로>%noloop` 동작 · `MediaRecorder` 산출 `audio/webm;codecs=opus` · 두 번째 `getUserMedia`의 재생 위치 · 헤드리스·헤드풀 | 공백 없는 `%TEMP%` 복사 → Chrome 채널 → 안 되면 음성 입력은 API 경로만(R-DX-8) |
| X-2 | 영속 컨텍스트 `grantPermissions(['microphone'], {origin})` · 같은 출처 `iframe`에서 마이크 버튼 생성(`isSecureContext`)·권한 프롬프트 0 · `allow` 유무 | `--use-fake-ui-for-media-stream`(범위 넓음 — 공개표 기록) |
| X-3 | 위젯 webm/opus → API → PyAV → turbo/cuda 전사 → 입력창(**첫 브라우저 종단**) | 결함 후보로 `bug-triage`(우회 금지) |
| X-4 | 이 PC Ollama 버전의 `/api/ps` · 빈 프롬프트 적재 · `keep_alive:0` 해제 · 해제 후 VRAM 하락 시간 | 해제 불가 → ⑩ 직전 순서를 "Ollama 적재 전 STT 종료"만으로 유지하고 P4-L 사전 생성을 생략(대체 결과 없음 — PM 확인) |
| X-5 | Windows WDDM에서 `--query-compute-apps` PID 보고 · STT `taskkill` 뒤 VRAM 회수 시간 | 메모리 조건만(§11.2) |
| X-6 | `powershell -EncodedCommand`로 SAPI 48kHz mono 16bit WAV · Heami 선택 · 앞뒤 무음 · G-DX-1 일치율 | 16kHz로 · `.ps1`(BOM) + `-ExecutionPolicy Bypass`(프로세스 범위) |
| X-7 | 헤드리스/헤드풀 Edge의 `speechSynthesis.getVoices()` 한국어 기기 음성 · 듣기 버튼 전환 | 정직성 처리(§14) |
| X-8 | 무대 `<audio>`를 신뢰 클릭으로 재생(헤드풀) | `--autoplay-policy=no-user-gesture-required`(A-DX-8) |
| X-9 | STT 종료 → Ollama 냉적재 → API 경유 20건 생성 시간(3050) — SE-01·SE-02 예산 보정 | 예산 조정(풀 투어만) |
| X-10 | 콘솔 `iframe` 안 blob 다운로드의 `download` 이벤트 · 파일 이름 · 감사 로그 내보내기 행의 행 수 필드 이름 | API 수신 대체 · 행 수 검증 생략(형식만) |

결과는 `tools/demo-harness/docs/실기동확인.md`에 "DT-2" 절로 추가하고, 설계와 다르면 이 문서에 `[정정 DX-#n]`으로 반영한다(DT-1 관례).

---

## 18. 제품 코드 변경 0 확인

| 범위 | 변경 |
|---|---|
| `apps/*`·`packages/*` 소스·설정·시험·의존성 | **0** — 선택자는 기존 접근성 이름·안정 클래스, 선제 속성은 하네스 모형 페이지 스니펫에서만, STT GPU DLL은 하네스 자식 환경에서만 |
| 마이그레이션·Prisma 스키마 | **0**(데이터 모델 변경 없음 → 기존 데이터 호환성 영향 없음) |
| 제품 환경변수·권한·API 경로 | **0**(새 엔터티·API 없음 — `개발명세서.md` §3·§4 추가 항목 없음) |
| 루트 설정 4개 | **0**(새 루트 스크립트 없음 · 하네스 의존성 추가 없음 → 잠금 파일 불변) |
| `tools/demo-harness/**` | 변경(§3.5 파일 + `scenario/{types,plan,definition-check,runner,pacing,badges}` · `cli/args` · `env/{api-env,ml-speech-env,ml-augment-env}` · `preflight` · `proc`(역할 2) · `browser/{session,fake-media}` · `gpu/*` · `llm/*` · `voice/{synth,match,wav}` · `data/{dataset-full,generator-full}` · `servers/stage-server`(오디오 경로·템플릿 값) · `stage/{facts,roadmap-html}` · `assets/*` · `report/*` · 시험) |
| 결과 스키마 | v1 유지 · `gpuUsedByHarness` 타입 확장 1건(A-DX-7) |

UIUX: 제품 화면 변경 0 → `UIUX_준수기준.md` 영향 없음. 하네스 화면(무대·카드·자막·보고서)은 DT-1 ui-spec 규칙(자막 24px·대비 4.5:1·2줄·`lang="ko"`·표 캡션)을 따르며 추가분은 ui-designer가 `demo-harness-ui-spec.md`에 절로 더한다.

---

## 19. 문서 갱신 목록

### 19.1 사용법 문서 `docs/05-ops/시연_하네스.md`(구현자가 갱신 — 구현 단계 산출물)

1. §1 한눈에 보기: 풀 투어 프리셋 행 · 플래그 3종 · 시간(기본 약 14분 · 전부 약 17분 35초)
2. §2 시연 전 확인: **Ollama 규칙이 플래그에 따라 반대**(10분판·풀 투어 llm 끔 = 끄기 / `--with-local-llm` = 켜 두기 + 모델 확인 `ollama list`) · 스피커 켜기·볼륨 · SAPI 한국어 음성 확인(설정 → 시간 및 언어 → 음성) · "GPU 없이"가 중요한 고객은 `--stt-device cpu` · 다른 GPU 프로그램 종료 · 창 최소화 금지(선제 체류 시간이 멈춤)
3. §3 명령: §4.1~§4.3
4. §4 흐름: 풀 투어 단계표(§9 요약) · 순차 적재 설명 · 준비 시간 증가
5. §5 산출물: `audio/`·`downloads/`·`logs/ml-speech.log`·`ml-augment.log` · 보고서 새 절
6. §7 문제 해결: 마이크 버튼 없음(보안 컨텍스트·가용성 캐시) · `SPEECH_AUDIO_INVALID`(결함 후보) · cuda 기동 실패 → cpu 대체 · 말풍선 안 뜸 · Ollama 해제 실패 · 엑셀 다운로드 실패
7. §9 남은 수동 확인: M-6 풀 투어 visible 리허설(플래그 전부 · 총 시간 · 소리 · 캡처) · M-7 GPU 없는 노트북에서 풀 투어 기본 · M-8 폐쇄망 반입(STT 모델·nvidia pip·Ollama 모델)
8. §10 알려진 한계: §20.2

### 19.2 상위 문서 — `docs/02-spec/demo-harness-expansion-patches.md`(적용 대기)

| 패치 | 대상 | 내용 |
|---|---|---|
| X-P1 | `docs/01-requirements/기능요구사항.md` §4-2(CRLF) | DT-2 1행 |
| X-P2 | `docs/02-spec/개발명세서.md` §2(CRLF) | `tools/demo-harness` 상태 행에 DT-2 한 문장 · 링크 |
| X-P3 | `docs/05-ops/자동배포.md` §5.13(CRLF) | 항목 10(풀 투어 명령·사전 조건·반입 목록) |
| X-P4 | `docs/02-spec/demo-harness-설계.md`(LF) | 머리 블록·§8.6·§9.1·§10.9·§25에 DT-2 참조 4줄 |
| X-P5 | `docs/requirements/demo-harness.md`(LF) | 변경 이력 1줄(J-13·AC-DH7-2의 풀 투어 예외 — ADR-0053) |
| X-P6 | `docs/04-test/시험데이터.md` | 합성 음성 문장·핵심어 · 챗봇 D · "기록만" 규칙 문장 |
| X-P7 | `docs/04-test/자동시험_전략.md` | 위젯 마이크 → 서버 STT 종단을 하네스 무인 점검이 실행(선택 플래그) |

`CLAUDE.md` 상태 줄은 사용자 승인 시에만(요구사항 §13).

---

## 20. 위험 · 한계

### 20.1 위험(요구사항 R-DX-1~15 대응 + 신규)

| # | 위험 | 통제 |
|---|---|---|
| R-DX-2 | "GPU 없이" 메시지 훼손 | 배지 증거 조건(§12.1) · 카드·자막 사실 표기 · `--stt-device cpu` 안내 |
| R-DX-3 | 순차 적재 시간 | SE-01 45초 예산·대체 · X-9 실측 후 조정 |
| R-DX-6 | `.env` 4중 방어 | §6.4 — 충돌 없음 · AC-DX0-3을 풀 투어 기본에도 |
| R-DX-8·9 | 가짜 미디어·디코딩 | X-1·X-3 · 실패 시 결함 후보(우회 금지) |
| R-DX-10 | 로컬 생성 품질·0건 | 정직성 자막 · 폴백 공개 · 사람이 고르는 연출(P-DX-7) |
| **R-DX-16** | ①의 위젯 A에 듣기 버튼·말하기 버튼이 보여 DT-1 장면 화면이 10분판과 다르다 | 풀 투어만의 의도된 차이 · 말풍선 선택자 불변 · 리허설 확인(R-DX-20) |
| **R-DX-17** | 하네스가 사용자 Ollama에 모델을 올리고 내린다(상태 일시 변경) | FR-0-353 범위(서비스 API로만 · 자기 모델 1개만) · 사전 점검이 기존 적재 목록을 기록·안내 · 정리 단계 해제 보장 |
| **R-DX-18** | 생성 자식이 기동 워밍업으로 모델을 올린 뒤 해제 전까지 VRAM 점유 — 해제 API가 이 PC 버전에서 다르면 STT와 충돌 | X-4 · 해제 실패면 P4-V에서 VRAM 여유 부족 → `auto`는 cpu로(공개) |
| **R-DX-19** | 감사 로그·보정 행 증가(G-DX-2 2행 · 엑셀 내보내기 1행 · 음성 설정 저장) | 정직성 "준비 단계 보정" · 감사 화면(S5-06)은 대상 필터라 영향 없음 |
| **R-DX-20** | 응답 `speech` 키·듣기 버튼이 DT-1 검증의 "마지막 봇 말풍선" 계산에 영향 | 듣기 버튼은 말풍선 밖 요소(`speech-button.ts`) — X-3 리허설에서 ①②⑥ 검증 통과 확인 |
| **R-DX-21** | 풀 투어 ⑤ S5-07이 대개 "이미 실행된 예약"이 됨 | DT-1 §7.6 규정대로 대체 아님 · 자막 문구는 실행 결과 화면에 맞음 |

### 20.2 알려진 한계(보고서 고정 문구 추가)

합성 음성·가상 마이크(실제 사람 음성·실제 마이크 아님) · 영상·GIF 무음 · 3050 결과 = 동작 확인(STT 정확도·생성 품질 판정 아님) · VRAM 수치는 관찰 · 브라우저 화면 그리기의 GPU 사용 가능 · 시연은 비운영(`NODE_ENV` 미설정) — 운영 모의 인식 차단은 재현하지 않음 · 음성 원본 저장 0 확인은 매직 바이트 휴리스틱 · 엑셀 행 수는 감사 기록 기준(파일 내부 미파싱) · 녹음은 실행당 1회.

---

## 21. 요구사항 환류(requirements-analyst · PM 인계)

| # | 대상 | 내용 | 제안 |
|---|---|---|---|
| R-1 | FR-DX2-1 · AC-DX1-1 | PM P-DX-10("모델 없으면 고객 시연은 생략+이유")과 FR-DX2-1("차단")이 충돌 | **visible = 경고+생략(사전 점검에서 알림) · headless = 차단 · 장치 명시 시 차단**(A-DX-2)으로 FR·AC 문구 정정 |
| R-2 | §8.1 예산 합 | "805 · 1,005"는 S4-03 제외를 반영한 값과 아닌 값이 섞여 읽힌다 | 이 설계 §10 표(830 · 1,035 · 조합별)로 교체 |
| R-3 | FR-DX3-5 | "확인 필요" 해소 — 공급자 전역(C-DX-1) | S4-03 비활성 확정 문구로 |
| R-4 | FR-DX3-9 · FR-DX6-5 | `keep_alive` 근거는 저장소에 없고 Ollama 공식 API다 · ml-worker가 `keep_alive`를 보내지 않아 **해제는 필수** | "확인 필요" → X-4 실기동 확인 항목 · 해제 불가 시 처리(X-4 실패 열)를 PM이 수용 |
| R-5 | FR-DX3-6 | 선제 코드는 `data-proactive="on"`이 필수(C-DX-3) | 챗봇 D 요구사항에 추가 |
| R-6 | FR-DX5-4 | "새로고침 후 다시 안 뜸"은 세션당 1회 상한 때문에 끄기 효과를 구분하지 못함 | 검증을 `OPTED_OUT` 집계로(A-DX-5) |
| R-7 | FR-DX8-5 | `gpuUsedByHarness`가 `false` 고정이라 "v1 필드 불변"을 문자 그대로 지키면 거짓 기록 | 타입 확장 1건 예외 명시(10분판 값 불변) |
| R-8 | FR-DX4-1 | 기본 투어 "①에 듣기 1회" 선택안 | ⑧에만 둔다(A-DX-9) — 10분판과 ① 동일성 |
| R-9 | P-DX-12 문구 | 구현 문구는 "구현됨 · 확장판에서 시연 **예정**" — PM 결정 문구("확장판에서 시연")와 2글자 차이 | PM 확인(현행 유지 권고 — 10분판 시점엔 "예정"이 사실) |
| R-10 | AC-DX2-2 | "DB에 오디오 흔적 0"의 판정 방법 미정 | 매직 바이트 휴리스틱(S-DX-1)으로 정의 |
| R-11 | S-DX-1 · P-DX-3 | 3050 + `auto` = cuda → 풀 투어 ①~⑨에서 "CPU 동작" 배지가 사라진다 | PM 인지 사항(정보) — 고객별 `--stt-device cpu` 선택을 사용법에 |
| R-12 | FR-DX7-2 | 엑셀 행 수를 파일에서 읽으려면 새 의존성이 필요 | 감사 로그 행 수로 대체(A-DX-10) |
| R-13 | G-DX-4 실패 처리 | 요구사항은 "기본: 플래그 장면 대체" — 사전 결과가 없으면 대체할 화면이 없음 | visible = ⑩ 생략+이유 · headless = 종료 2 |
| R-14 | §6.2 순서 | "준비 P3 이전" → 데이터가 필요해 P4-L | 문구 정정(A-DX-3) |

---

## 22. 구현 분할 제안

하네스는 TypeScript 단일 패키지이고 DT-1 구현은 **범용 구현자**가 맡았다. 같은 사람이 이어 맡는 것이 일관성에 유리하다(오케스트레이션·자식 프로세스·Playwright 장면·보고서가 서로 물려 있음). `backend-implementer`·`frontend-implementer`는 제품 코드를 바꾸지 않으므로 불필요하다.

| 커밋(권고 순) | 내용 | 담당 | 규모 |
|---|---|---|---|
| D | 이 설계 + ADR-0053 + 패치 문서 + (ui-designer) `demo-harness-ui-spec.md` DT-2 절(카드·GPU 전환 카드·자막·로드맵 변형·보고서 절) | architect · ui-designer | 문서 |
| **K0** | 실기동 확인 X-1~X-10(스파이크 — 제품 변경 0 · 결과를 실기동확인.md에) | 범용 구현자 + **ml-engineer 검토**(X-3·X-4·X-5·X-6·X-9) | 소~중 |
| K1 | 프레임: `plan.ts`·해석기·정의 검사 일반화·구간 키/ID 확장·인자·드라이런·진행 막대·풀 투어 골격(DT-1 재사용 + 빈 SV/SP/SE) · H-T19·20 · H-S7 · **10분판 회귀(무인 5회)** | 범용 구현자 | 중 |
| K2 | 프로세스·환경: 음성/생성 자식 환경·`PATH` 규칙·장치 결정·재기동 · Ollama 클라이언트 · `nvidia-smi`·관찰기·회수 판정 · PC-DX · 포트·정리 · H-T21·22·25·26 · H-S6·S8 | 범용 구현자(+ml-engineer 값 검토) | 중 |
| K3 | 데이터·보정: 풀 투어 데이터(D·음성 설정·기록만 규칙)·선제 스니펫 변환·SAPI 합성·일치 판정·G-DX-1~4·사전 생성·해제 · H-T23·24·30 | 범용 구현자 | 중 |
| K4 | 장면: ⑥⑦ 확장 · ⑧ · ⑨ · ⑩ · 시작·끝 변형 · 가짜 미디어·권한·다운로드·스피커 재생 · 선택자 + H-T9 확장 · H-T27·29 | 범용 구현자 | 중~대 |
| K5 | 캡처·보고서(선택 필드·새 절·GIF·고객판) · 사용법 문서 갱신(§19.1) · H-T28 | 범용 구현자 | 중 |
| R | code-reviewer → test-automation(§17.3 · 10분판 5회 + 풀 투어 3회 · AC-DX0-3) → 사용자 승인 시 git-manager | — | — |

예상 규모(추정): 새 파일 약 25~30 · 수정 약 20 · TS 약 3,500~5,000줄 + 시험 약 10파일.

---

## 23. PM 확인(정보성 — 기본안으로 구현 착수 가능)

| # | 질문 | 기본안 |
|---|---|---|
| Q-DX-1 | R-1(생략 vs 차단) 해석 | visible 생략 · headless 차단 |
| Q-DX-2 | R-11 — 3050 `auto`에서 "CPU 동작" 배지가 ①~⑨에 안 나오는 것 수용 | 수용 · 고객별 `--stt-device cpu` |
| Q-DX-3 | X-4 실패(이 PC Ollama가 해제 API를 지원하지 않음) 시 | P4-L 사전 생성 생략(⑩ 대체 화면 없음 — 실패 시 ⑩ 생략+이유) |
| Q-DX-4 | 챗봇 D 이름 "가온마켓 주문 도우미"·선제 문구 | 사용(ui-designer가 바꿔도 됨) |

---

## 24. 변경 이력

- **2026-10-02 작성** — system-architect. 요구사항 `demo-harness-expansion.md`(PM P-DX-1=C · P-DX-2 · P-DX-7 · P-DX-3/10 · 나머지 권고안)와 DT-1 3단계 작업 트리를 받아 작성. **코드로 확정한 것**: 증강 공급자 프로세스 전역(→ S4-03 비활성) · ml-worker는 Ollama에 `keep_alive`를 보내지 않음(→ 해제 필수) · 생성 자식 기동 워밍업이 모델 적재 · 선제 코드는 `data-proactive="on"` 필수(API 삽입 코드에 없음) · 콘솔 음성·선제 구역은 `channels` 탭 WEB 카드의 펼침 버튼 · 위젯 말하기 버튼 이름이 상태별로 바뀜 · 결과 스키마 `gpuUsedByHarness` 리터럴 · 진행 막대가 전역 구간 9칸 기준 · FR-DX0-1·2는 DT-1 3단계에 이미 반영. **결정**: DXD-1~16(계획 문맥·조건부 단계·글자 코드 구간·순차 적재·`PATH` 주입 1파일·Ollama 공식 API·가짜 마이크 1회·일치 판정·배지 증거 확장·스키마 선택 필드·새 의존성 0). **조정** A-DX-1~10 · 환류 R-1~14 · 실기동 확인 X-1~10. 신규 ADR-0053.

---

## 25. K0 실기동 확인 정정(DX-1~13) — 구현은 설계 본문보다 이 절을 따른다

> **일자**: 2026-10-02 · **근거**: `tools/demo-harness/docs/실기동확인-dt2.md`(X-1~X-10 · Edge 154 · RTX 3050 4GB · Ollama 0.35.0 · 이 PC 1대의 관찰). 이 절은 설계 본문(§1~§24)을 **고치지 않고** 덧붙인 정정이며, 충돌하는 곳은 아래 항목이 이긴다. 구현 결과 달라진 점(DT-2 K1~K5)은 보고서(작업 결과 보고)에 적었다.

| # | 대상(본문) | 정정 | 구현 반영 |
|---|---|---|---|
| **DX-1** | §8.4 한 실행 한 문장 · R-DX-8 | 가짜 오디오 파일은 **새 `getUserMedia`마다 처음부터 재생**된다(스트림이 모두 닫힌 경우). 위젯은 녹음 종료 때 트랙을 닫으므로 한 브라우저에서 반복 녹음이 된다. 제약은 "스트림을 닫지 않은 채 다시 열면 무음"과 "파일은 한 개(= 한 문장)"뿐이다 | 사전 점검 마이크 확인은 계속 별도 브라우저(공연 브라우저는 SV-03에서 한 번만 연다 — 보수 유지). 마이크 사용 횟수는 보고서에 기록 |
| **DX-2** | §8.1 권한 · NFR-DXS3 | 권한은 **출처 정확 일치**다. 무대·모형이 `http://localhost:<포트>`이므로 부여 출처도 `localhost`다(`127.0.0.1`로 접속하면 프롬프트가 떠 헤드풀에서 무기한 대기). `allow="microphone"`은 필수가 아니다(같은 출처 iframe 기본 허용). `--use-fake-ui-for-media-stream` 폴백은 쓰지 않는다 | `grantPermissions(['microphone'], {origin: 'http://localhost:<무대 포트>'})` 1곳 · 모든 장면 출처 `localhost`(콘솔·위젯·모형) · `allow` 속성은 불확실성 제거용으로만 유지 |
| **DX-3** | §7.3 · P-DX-6 · G-DX-1·2 | 기본 문장 "환불 규정이 어떻게 되는지 알려 주세요"를 `small`/CPU가 "반불 규정이"로 오인식한다(3회 재현). **기본 문장 = "주문 취소하면 환불은 언제 되나요"**(핵심어 `["환불"]` · 두 모델 모두 정확 · A의 기존 예문), 대체 문장 "반품하고 싶은데 환불은 며칠 걸리나요". 판정은 **띄어쓰기·문장부호 정규화** + 핵심어 | `data/dataset-full.ts`의 `VOICE_PHRASE` · `voice/match.ts` 정규화 |
| **DX-4** | §8.2 `#voice-play` | 화면 밖(`left:-9999px`) 버튼은 Playwright 클릭이 실패한다(`force:true` 포함). **뷰포트 안 고정 위치 1px 투명 버튼**으로 정정 | `stage.css` `#voice-play{position:fixed;left:2px;top:2px;width:1px;height:1px;opacity:.01}` |
| **DX-5** | A-DX-10 · S7-06 | 감사 `EXPORT`의 행 수는 **묶음 수 + 발화 수**(`after.rows`)이며 분석 "발화 수"와 다르다. 필드 `after.rows·utterances·clusters`는 **상세 `GET /audit-logs/:id`에만** 있다(목록에는 `summary` 문자열 `(N행)`). 검증 = `rows == clusters + utterances` ∧ `utterances == counts.validCount`. 발화 분석 화면 경로 `/chatbots/:id/stats/utterance-analyses/:analysisId` | `scenarios/full/s7-full.ts` `latestExportAudit` |
| **DX-6** | §11.2 회수 판정 ① · X-5 | `nvidia-smi --query-compute-apps`는 WDDM에서도 PID를 주지만 **실제 인터프리터 PID**(venv 런처 아님)이고 `used_memory`는 `[N/A]`다. 조건 ①은 **종료 전에 구한 프로세스 트리 전체(런처+인터프리터)** 가 GPU 앱 목록에 없음으로 구현한다. **② 전체 `memory.used` 하락이 실질 판정**이며 실측 회수는 ≤0.3초라 상한 15초는 과대(유지하되 첫 표본에서 끝나는 것이 정상) | `proc/system.ts` `listProcessTree` · `gpu/nvidia-smi.ts` `judgeReclaim` |
| **DX-7** | §10 예산 SE-01 45초 · A-DX-1 | 실측: 회수 0.3초 + Ollama 적재 4.1~6.4초 → **SE-01 예산 25초**(상한은 유지). 총 예산이 20초 줄어 **전부 1,035초(17분 15초) · V+L 975 · C+L 990 · L 930**(기본 830 · V 875 · C 890 · V+C 935). SE-02 60초는 유지(생성 체감 15~20초 + UI 조작). 디스크 냉 상태 첫 적재는 미측정이라 상한(적재 60초 · 생성 자식 기동 150초)은 유지 | `presets/customer-onprem-full.ts` `FULL_EXPECTED_TOTALS` |
| **DX-8** | §5.1 PC-DX-4 · §5.2 · AC-DX1-4 | 이 PC는 **시스템 PATH에 CUDA 12.8·cuDNN 9.7**이 있어 venv `nvidia\…\bin` 없이도 cuda가 적재된다. PC-DX-4는 "venv 폴더 **또는** 시스템 PATH의 `cublas64_12.dll`"이며 **판정은 기동 시도 결과가 권위**(cuda 기동 실패 → small·cpu 1회 재기동 · 실제 `device`를 카드·보고서에 기록). AC-DX1-4("DLL 폴더 이름 변경 → cpu 대체") 시험은 이 PC에서 venv 폴더 이름 변경만으로 일어나지 않아 **자식 `PATH`에서 CUDA 항목을 제거한 환경**으로 한다(시험 전용 환경 구성 — 하네스 자식 `PATH` 주입 규칙은 그대로) | `preflight/full-checks.ts` `findOnPath` · `orchestrator/full-prepare.ts` `bringUpSpeech` |
| **DX-9** | §7.3 합성 명령 | `-EncodedCommand` 호출의 stderr에 PowerShell 진행 메시지(CLIXML)가 섞인다. 스크립트 앞에 `$ProgressPreference='SilentlyContinue'`를 넣고 **성공 판정은 종료 코드와 WAV 헤더**(stderr 비어 있음 가정 금지) | `voice/synth.ts` |
| **DX-10** | §8.3 | 말하기 클릭 → "말하기 끝내기" 전환 첫 호출 0.84~0.89초(가짜 장치 지연 포함) · 인식 대기 turbo 1.1초 / small·cpu 2~2.5초(위젯 대기 상한 15초 안). `holdForMedia`는 그 시작 신호 뒤부터 센다 | SV-03 대기 상한 5초 · 18초 |
| **DX-11** | C-DX-5 | 입력창은 `<textarea>`(`getByLabel('메시지 입력')`) · 마이크 `#cb-mic`(보이는 글자 "말하기") · 인식 뒤 상태 줄 "글자로 바꿨어요…"(`.cb-voice-text`). **인식 결과는 자동 전송되지 않고 입력창에만 채워진다** — 시연이 "전송"을 눌러야 한다 | SV-03(자동 전송 0 검증) → SV-04(전송) |
| **DX-12** | §6.2 환경표 | 거버넌스 ON에서 `DATA_EGRESS_ALLOWED_HOSTS`에 음성 자식(`127.0.0.1:8102`)이 없으면 API가 기동을 거부한다(설계 355행이 맞음을 실측). 쉼표 구분 문자열 `127.0.0.1:8100,127.0.0.1:8102,127.0.0.1:8101` 동작 | `env/api-env.ts` |
| **DX-13** | §6.1 · §11.3 | ml-worker `/augment` 요청 본문은 `locale:"ko"`가 필수다(없으면 422). 생성 자식 단독 8101 기동은 정상(`CUDA_VISIBLE_DEVICES=-1`) | 하네스는 API 경유로만 생성을 요청한다(직접 `/augment` 호출 0) |

- **한계(K0 미수행)**: 실제 스피커 청취 · 디스크 냉 상태 Ollama 첫 적재 시간 · 생성 자식 허용 목록 미허용 시 거부 · 전사 중 생성의 동시 부하 · 헤드풀 권한 프롬프트를 실제로 닫는 동작. 구현 검증에서도 이 항목들은 수동 게이트로 남는다.
