# 시연 하네스 확장(DT-2) K0 실기동 확인 X-1~X-10 결과 (설계 §17.4)

> **일자**: 2026-10-02 · **수행**: K0 스파이크(범용 구현자) · **장비**: Windows 11 Pro 10.0.26200 · RTX 3050 Laptop 4GB(`nvidia-smi -L` 1장) · Edge 154.0.4258.37 · `playwright-core@1.63.0`(Node v24.19.0) · Ollama 0.35.0(서비스 실행 중이었음) · Python venv 3.10.11(`apps/ml-worker/.venv`) · STT 모델 캐시 `apps/ml-worker/.cache/stt-models/{small,large-v3-turbo}`
> **범위**: 제품 코드(`apps/*`·`packages/*`)·하네스 소스·설계서 수정 0. 임시 스크립트·산출물은 전부 세션 스크래치 폴더(저장소 밖)에 두었다. 설계서는 고치지 않고 아래 **설계 정정 필요 목록**으로 환류한다.
> **판정 기호**: 동작 / 조건부 / 불가. 수치는 **이 노트북 1대의 관찰값**이며 영업 수치가 아니다(FR-0-317·FR-0-352).
> **방법**: X-3·X-9·X-10은 하네스 `--prepare-only` 실행(격리 DB·API·임베딩·무대 서버)을 띄운 뒤 그 API만 **음성·로컬 생성 환경으로 재기동**(`buildApiEnv` 결과에 키 추가)해 실제 위젯·콘솔을 구동했다. 하네스가 실제로 만들 환경과 같은 형태이지만 하네스 DT-2 코드가 아직 없어 하네스 자체의 종단 실행은 아니다.

## 결과 요약

| # | 확인 | 결과 | 핵심 관찰값 | 폴백 판단 |
|---|---|---|---|---|
| X-1 | 가짜 마이크 인자·`%noloop`·공백 경로·`MediaRecorder`·두 번째 `getUserMedia`·헤드리스/헤드풀 | **동작** | 공백·마침표가 든 경로(`...\sp ace. dir\u48.wav%noloop`)가 그대로 동작(`%TEMP%` 복사 불필요). `MediaRecorder` 기본 산출 `audio/webm;codecs=opus`(`isTypeSupported` webm/opus 참, ogg 거짓, mp4 참). **새 `getUserMedia`는 열린 스트림이 없으면 매번 파일을 처음부터 재생**(헤드리스 3회·헤드풀 4회 전부 같은 52,008바이트·같은 전사). 이전 스트림이 열려 있으면(트랙 미종료) 공유 소스라 무음(1,865바이트·`empty:true`). 헤드리스·헤드풀 차이 없음 | Chrome·`%TEMP%` 복사 폴백 불필요. **정정 DX-1(§8.4 "마이크 1회" 완화 가능)** |
| X-2 | `grantPermissions`·같은 출처 `iframe`·보안 컨텍스트·권한 프롬프트·`allow` | **동작(조건 있음)** | `grantPermissions(['microphone'],{origin})`는 **출처(스킴·호스트·포트) 정확 일치**만 허용 — `localhost:<p>`에 부여해도 `127.0.0.1:<p>`는 별개(미부여). `http://localhost`·`http://127.0.0.1` 모두 `isSecureContext` 참. **미부여 시 헤드리스는 즉시 `NotAllowedError`, 헤드풀은 권한 프롬프트가 무기한 대기(8초 경쟁에서 전부 HANG)**. 같은 출처 `iframe`은 `allow="microphone"` 유무와 무관하게 허용(`perm=granted`·`getUserMedia` 성공·장치 레이블 `Fake Default Audio Input`) | `--use-fake-ui-for-media-stream` 폴백 불필요. **정정 DX-2** |
| X-3 | 위젯 webm/opus → API → PyAV → turbo/cuda → 입력창(첫 브라우저 종단) | **동작** | 무대(`/stage`) 안 모형 `iframe`에서 위젯 `#cb-mic` 생성 → "말하기" 클릭 → 녹음 → "말하기 끝내기" → 요청 `POST /api/v1/public/chatbots/gaon-support/speech/transcriptions`(`Content-Type: audio/webm;codecs=opus`) → 200 `{"text":"환불 규정이 어떻게 되는지 알려주세요.","durationMs":4920~4980}` → 입력창(`getByLabel('메시지 입력')`, textarea)에 글자 채워짐, 상태 줄 "글자로 바꿨어요. 내용을 확인하고 고친 뒤 전송해 주세요." **헤드리스·헤드풀 모두 성공. 서버 PyAV가 브라우저 webm/opus를 디코딩**(제품 결함 없음). 종료 클릭 → 입력창 채움 **1.06~1.10초**. 한 세션에서 연속 2회 녹음도 둘 다 성공 | 결함 후보 없음 |
| X-4 | Ollama `/api/ps`·빈 프롬프트 적재·`keep_alive:0` 해제·VRAM 하락 | **동작** | `/api/version` 0.35.0. 적재 `POST /api/generate {model,keep_alive:"10m",stream:false}` → 200 `done_reason:"load"` **4.1~6.4초**(OS 캐시 따뜻한 상태), `/api/ps`에 모델 표시(`size` 3,525,081,824 · `size_vram` 2,345,297,510 · `expires_at` +10분 · `context_length` 4096), VRAM **2,321MiB**. 해제 `{keep_alive:0}` → 200 `done_reason:"unload"` **7~24ms**, `/api/ps` 비고 VRAM 0이 **첫 폴링(≤0.23초)에 확인**. 2회 반복 동일 | 폴백 불필요 |
| X-5 | WDDM `--query-compute-apps` PID 보고·STT 종료 뒤 VRAM 회수 | **조건부(동작)** | `--query-compute-apps=pid,process_name,used_memory`가 **PID를 보고한다**(WDDM에서도). 단 보고 PID는 spawn한 venv **런처가 아니라 실제 인터프리터**(`D:\Program Files\Python310\python.exe`), `used_memory`는 항상 `[N/A]`(프로세스별 VRAM 불가 — 전체 `memory.used`만 가능). Ollama 적재 시 `llama-server.exe`(ollama.exe 자식) PID가 목록에 나타남. `taskkill /PID <런처> /T /F`는 0.16초에 반환, **첫 샘플(≈0.3초)에 이미 0MiB·앱 없음**(2회: 324ms·308ms) | 메모리 조건 폴백 불필요(보조로 유지). **정정 DX-6** |
| X-6 | `-EncodedCommand`로 SAPI 48kHz mono 16bit WAV·Heami·앞뒤 무음·일치율 | **동작(문장 선택 조건)** | PowerShell `-NoProfile -NonInteractive -EncodedCommand`(UTF-16LE base64 약 2.4KB)로 **한글 깨짐 없이** 합성(스크립트 파일·BOM 불필요). 음성 `Microsoft Heami Desktop`(ko-KR 첫 번째), 48,000Hz·mono·16bit·RIFF PCM 정상, 호출 0.7~1.0초. `PromptBuilder.AppendBreak(500ms)` 앞뒤 → 앞 구간 peak 5(무음), 발화 시작 0.635초, 끝 무음 0.50초, 총 3.79초. 16kHz도 가능(turbo 3회 정확). **일치율**: turbo/cuda 5문장 전부 정확, **small/cpu는 "환불 규정이…"(S1)을 "반불 규정이…"(3회 재현), "안녕하세요 환불 규정이…"(S3)를 "한불 규정이…"로 오인식** — "주문 취소하면 환불은 언제 되나요"(S2)·"반품하고 싶은데 환불은 며칠 걸리나요"(S4)는 두 모델 모두 정확 | `.ps1`(BOM) 폴백 불필요. **정정 DX-3(기본 문장·핵심어)** |
| X-7 | `speechSynthesis.getVoices()` 한국어 기기 음성·듣기 버튼 전환 | **동작** | 헤드리스·헤드풀 동일: `getVoices()` 첫 호출은 0개, `voiceschanged` 후(13~20ms) **총 1개** — `Microsoft Heami - Korean (Korean)`·`lang ko-KR`·`localService:true`·`default:true`(SAPI 이름 `Microsoft Heami Desktop`과 **다름**). `speak()`는 사용자 입력 없이도 start→end(≈3.7초) 이벤트 정상. 위젯: 봇 답변 뒤 "이 답변 듣기" 버튼 표시·`aria-disabled="false"`, 클릭 후 `aria-label` "듣기 멈추기" 전환, 자동 읽기 스위치("답변 소리로 듣기") `aria-checked="false"` 존재 | 정직성 처리(§14) 필요 없음(이 PC) — 단 다른 PC에서는 0개 가능 |
| X-8 | 무대 `<audio>` 신뢰 클릭 재생(헤드풀) | **동작** | 신뢰 클릭(`page.click`) 뒤 `audio.play()` 성공·`currentTime` 진행·3.79초 후 `ended`(헤드리스·헤드풀 동일). **이 환경(자동화 Edge·새 프로필·localhost)에서는 사용자 활성화 없이 `play()`를 호출해도 성공**(`--autoplay-policy` 인자 불필요). **화면 밖(`left:-9999px`) 버튼은 `force:true`로도 `page.click`이 "Element is outside of the viewport"로 실패** — 뷰포트 안 1px·불투명도 0.01 고정 위치 버튼은 성공 | 자동 재생 인자 폴백 불필요. **정정 DX-4** |
| X-9 | STT 종료 → Ollama 냉적재 → API 경유 20건 생성(3050) | **동작** | STT 종료 → VRAM 0(0.3초) → 생성 자식(`ML_WORKER_ROLE=augment`·`GENERATION_BACKEND=ollama`) 기동 **8.5초**(`/augment/health` `status ok`·`warmedUp true`·`device external`·`profile lightweight`·`targetCap 20`, 워밍업 적재 포함) → **API 경유**(`POST …/intents/:id/augmentations {count:20}`·`AUGMENTATION_PROVIDER=local`): **냉(해제 직후) 총 20.2초**(`resultSummary` `generated 20`·`accepted 15`·`providerId local`) · **사전 적재 뒤 14.8초**(적재 4.7초 별도·`generated 20`·`accepted 12`). ml-worker 직접 `/augment`(시드 5·20건) 14.3~17.5초(냉·온 차이 작음). 모델은 VRAM 2,323MiB(요청 중에도 동일) | 예산 조정(정정 DX-7) |
| X-10 | 콘솔 `iframe` 안 blob 다운로드 `download` 이벤트·파일 이름·감사 행 수 필드 | **동작** | 발화 분석(64행 CSV → 4묶음 SUCCEEDED) 상세에서 "엑셀로 받기" → `page.waitForEvent('download')` **76~124ms**, `url()`은 `blob:http://localhost:5173/…`, `suggestedFilename()` = `utterance-analysis-20261002-a98ea913.xlsx`(`utterance-analysis-<YYYYMMDD>-<id 앞 8자>.xlsx`), `saveAs` 11,144바이트·앞 4바이트 `504b0304`·`failure()` null, 알림 "엑셀을 내려받았습니다. 받은 기록이 남습니다." 헤드리스·헤드풀 동일. 감사: 목록 항목 `action:"EXPORT"`·`summary:"발화 묶음 분석 결과 내보내기(68행)"`, **상세 `GET /audit-logs/:id`의 `after` = `{"clusters":4,"utterances":64,"rows":68}`** | 폴백 불필요. **정정 DX-5(행 수 = 묶음+발화)** |

## 확인별 상세

### X-1·X-2 가짜 마이크와 권한
- 기동: `chromium.launchPersistentContext(<임시 프로필>, {channel:'msedge', headless, args:[ '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=<WAV>%noloop' ]})`. 기동 0.59~0.65초. 사용자 Edge(이미 실행 중)와 별개 프로필로 동시 기동 문제 없음. WAV 경로는 백슬래시 절대 경로(`C:\Users\…\sp ace. dir\u48.wav`)로 시험했다.
- 가짜 장치 `getUserMedia({audio:true})`는 5~650ms(첫 호출 13~17ms·재호출 100~650ms 변동), 트랙 레이블 `Fake Default Audio Input`.
- 녹음 6초(WAV 3.79초) → 모두 52,008바이트·`audio/webm;codecs=opus`. ml-worker `/speech/transcribe` 전사: 3회 모두 "환불 규정이 어떻게 되는지 알려주세요."(`durationMs 6000`).
- 재생 위치 실험(헤드풀 5회): r1 최초 · r2 직후(트랙 종료 뒤) · r3 8초 유휴 뒤 · r4(트랙 유지) · r5(r4 스트림 유지 중 신규 호출). r1~r4 모두 처음부터 재생된 정상 전사, **r5만 무음**(`empty:true`, 1,865바이트). 즉 한계는 "두 번째 녹음"이 아니라 "마이크 스트림을 닫지 않은 채 다시 여는 것"이다. 위젯은 녹음 종료 때 `stopTracks`로 즉시 닫으므로(`speech-capture.ts` `finishRecording`) 위젯 경유 연속 녹음도 성공(X-3 2회).
- 권한: X-2 표 참조. 헤드리스에서 미부여 → `permissions.query`는 `prompt`→`getUserMedia` 즉시 거부, `iframe`은 `denied`. 헤드풀 미부여 → 프롬프트가 떠서 영구 대기(공연 화면에 노출될 수 있음).

### X-3 위젯 종단
- 구성: 하네스 `--prepare-only`(격리 DB·데이터 보정) 뒤 API만 `SPEECH_ENABLED=true`·`SPEECH_PROVIDER=local`·`ML_WORKER_SPEECH_URL=http://127.0.0.1:8102`·`DATA_EGRESS_ALLOWED_HOSTS=127.0.0.1:8100,127.0.0.1:8102`로 재기동, 챗봇 A에 `PUT /chatbots/:id/voice`(`defaultTone:'INFORMATIVE'` — enum은 `CALM|BRIGHT|APOLOGETIC|INFORMATIVE`), 음성 자식 8102(turbo·int8·cuda).
- 공개 설정 `voice = {input:true, tts:true, autoReadToggle:true, rate:1}` → 위젯이 마이크 버튼 생성. 타이밍: 말하기 클릭 → "말하기 끝내기" 전환 **0.84~0.89초(첫)·0.21초(두 번째)**, 종료 클릭 → 입력창 채움 1.06~1.10초(turbo, 녹음 4.9초).
- 무대에서 모형 `iframe`을 쓰려면 `__stage.setReady(false)`+`setLayout('site')`가 먼저 필요(대기 오버레이가 덮고 있으면 위젯 설정 조회 자체가 일어나지 않는 것을 관찰 — 하네스는 이미 처리하는 부분).
- `Origin` 가드·`x-cb-session-id`(UUID) 포함 직접 호출(G-DX-1 형식)도 200: `{"text":"주문 취소하면 환불은 언제 되나요?","durationMs":3564}`.

### X-4·X-5·X-9 GPU 순서와 시간
| 단계 | 관찰 |
|---|---|
| STT(turbo·int8·cuda) 기동 → `warmedUp` | **6.1~8.3초**(기동 직후 폴링 기준), VRAM **989MiB** |
| STT(small·int8·cpu) 기동 → `warmedUp` | 4.4초, VRAM 0, 6초 webm 전사 1.89~2.14초 |
| STT turbo 전사(WAV 3~4.6초 / webm 6초) | 0.47~0.65초 |
| STT 종료(`taskkill /T /F` 런처) → VRAM | 0.16초 반환, 첫 샘플(≈0.3초) 0MiB |
| Ollama 적재(`qwen3:4b-instruct-2507-q4_K_M`) | 4.1~6.4초, VRAM 2,321~2,323MiB |
| Ollama 해제 | 7~24ms 응답, ≤0.23초에 VRAM 0 |
| 생성 자식 기동(워밍업 적재 포함) | 8.5초 |
| 생성 20건(ml-worker 직접, 시드 5) | 14.3~17.5초 |
| 생성 20건(API 경유 job, 냉) | 20.2초(accepted 15) |
| 생성 20건(API 경유 job, 사전 적재 뒤) | 14.8초(+적재 4.7초) |
| **STT turbo + Ollama 동시 적재(관찰만)** | **3,310MiB / 4,096MiB**(80.8%, 여유 786MiB). 둘 다 완전 적재(`size_vram` 동일)·전사 0.49~0.65초 변동 없음. 생성과 전사를 동시에 부하 주지는 않았다 — **설계의 "동시 금지 기본"은 유지 권고**(여유 약 0.8GB) |
- Ollama 기본 보존: 생성 자식(`keep_alive` 미전송)이 호출한 뒤 `expires_at`이 마지막 사용 +5분 → 해제 없이는 5분간 VRAM 점유(설계 DXD-9 "해제는 필수" 사실 확인).
- 생성 `/augment` 요청 본문은 `locale:"ko"`가 필수(없으면 422).
- 냉 20.2초는 ml-worker 요청 제한(25초)·API 증강 제한(30초) 안이지만 여유 5~10초뿐이다. 사전 적재로 생성 자체를 14.8초로 줄이는 설계(적재 분리)가 타당하다. 첫 적재 시간은 이번에 모델 파일이 OS 캐시에 이미 있었던 값이며(재부팅 직후 디스크 냉 상태는 미측정) 그보다 길 수 있다.

### CUDA DLL(설계 PC-DX-4·§5.2에 영향)
- 이 PC는 **사용자 PATH에 시스템 CUDA 12.8(`D:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin`)·cuDNN 9.7(`D:\Program Files\NVIDIA\CUDNN\v9.7\bin`)이 있다**(2026-10-02 `apps/ml-worker/eval/report/stt-3050-dongjak-hwakin.md` §2의 "시스템 전역 CUDA 없음"과 다르다 — 그 뒤에 설치됐거나 다른 세션 환경이었다).
- 그 결과 **venv의 `nvidia\{cublas,cudnn,cuda_nvrtc}\bin` 주입 없이도** 자식(PATH 상속)이 `STT_DEVICE=cuda`를 7.4초에 적재했다.
- PATH에서 `nvidia|cuda|cudnn` 항목을 제거하고 주입도 없으면: 워밍업 중 `RuntimeError: Library cublas64_12.dll is not found or cannot be loaded` → `Application startup failed. Exiting.` → **프로세스가 6.9초 만에 종료**(자식 종료로 감지 가능, 설계 §5.2 3행 `DEVICE_FALLBACK` 입력으로 쓸 수 있음).

### X-7·X-8 소리
- 헤드리스에서도 `speechSynthesis` 이벤트·`<audio>` 재생 상태가 정상이라 값만으로는 소리가 실제로 스피커에 나오는지 구분할 수 없다. 헤드풀 실행 중 이 PC 스피커로 소리가 나갔을 것이나 사람이 듣고 확인하지는 않았다(**수동 확인 1회 필요**).
- 헤드풀 실행 중 Edge 창이 사용자 화면에 잠깐 떴다(임시 프로필).

### X-10 엑셀·감사
- 분석 생성: `POST /chatbots/:id/utterance-analyses`(multipart `file`+`conditions`) → 202 `{analysisId,status:'QUEUED'}` → 폴링 `SUCCEEDED`. 상세 화면 라우트는 **`/chatbots/:id/stats/utterance-analyses/:analysisId`**(통계 탭 아래).
- 행 수 계산: `rows = clusters.length + utterances.length`(`utterance-analysis-export.service.ts`) — 엑셀의 두 시트(`묶음`·`발화`) 행 합이다. 감사 로그 목록 응답(`GET /audit-logs?chatbotId=…`)에는 `before`·`after`가 없고(요약 문자열 `…(68행)`만), 상세에 `after.clusters`·`after.utterances`·`after.rows`가 있다. 감사 시각은 UTC(`2026-10-02T00:05:40Z`).
- `acceptDownloads:true` 필요(이번 시험 설정). 파일은 `download.saveAs()`로 저장해야 보존된다.

## 설계 정정 필요 목록 (system-architect 전달용 — 설계서는 수정하지 않았다)

| # | 대상 | 정정 내용 | 근거 |
|---|---|---|---|
| **DX-1** | §8.4 "한 실행 한 문장"·"마이크를 정확히 1회만 연다"·R-DX-8 | 가짜 오디오 파일은 **새 `getUserMedia`마다 처음부터 재생**된다(스트림이 모두 닫힌 경우). 위젯은 녹음 종료 시 트랙을 닫으므로 한 브라우저에서 위젯으로 **반복 녹음 가능**(2회 연속 확인). 제약은 "스트림을 닫지 않은 채 다시 열면 무음". 따라서 ① P5 예열·리허설에서 실제 녹음해도 된다(단 일별 음성 숫자 +1 → SV-08 기준값 재계산) ② "1회만" 제한은 선택 사항(보수 유지도 가능) ③ 같은 파일 한 문장이라는 제약은 그대로(파일은 기동 인자) | X-1 r1~r5, X-3 2회 |
| **DX-2** | §8.1 권한 · NFR-DXS3 · §14 | ① 권한은 **출처 정확 일치** — 무대·모형이 `http://localhost:5180`이므로 부여 출처도 `localhost`로 맞추고 `127.0.0.1`로 접속하면 프롬프트가 뜬다(헤드풀은 무기한 대기 → 공연 화면 노출). 모든 장면이 `localhost` 출처임을 정적 검사에 추가 권고 ② `allow="microphone"` 속성은 필수 아님(같은 출처 `iframe` 기본 허용) — "불확실성 제거" 용도로만 유지 ③ `--use-fake-ui-for-media-stream` 폴백은 필요 없다 | X-2 |
| **DX-3** | §7.3 문장·핵심어(P-DX-6) · G-DX-1·G-DX-2 · §5.2 | 기본 문장 "환불 규정이 어떻게 되는지 알려 주세요"(핵심어 `["환불","규정"]`)는 **small/cpu가 "반불 규정이"로 오인식**(3회)하고 "안녕하세요 …"는 "한불 규정이"로 오인식 — G-DX-1이 `auto`→cpu 대체 경로에서 **실패**한다. **기본 문장을 "주문 취소하면 환불은 언제 되나요"(S2, 핵심어 `["환불"]` 또는 `["취소","환불"]`) 또는 "반품하고 싶은데 환불은 며칠 걸리나요"(S4)로 바꾼다**(두 모델 모두 정확). 설계가 "대체 문장"으로 둔 S2를 기본으로 승격. 일치 판정은 **띄어쓰기·문장부호 정규화**가 필요("알려 주세요"→전사 "알려주세요."). turbo는 5문장 모두 정확. 기대 의도가 S2로 "환불문의"에 매칭되는지는 G-DX-2(K3)에서 확인 | X-6 표 |
| **DX-4** | §8.2 `#voice-play` | 화면 밖 `left:-9999px`+`aria-hidden` 버튼은 Playwright 클릭이 실패(`force:true` 포함, "outside of the viewport"). **뷰포트 안 고정 위치(예: `position:fixed;left:2px;top:2px;width:1px;height:1px;opacity:.01`)** 로 정정. 자동 재생 대안(A-DX-8 2순위)은 이 환경에서 필요 없었다 — 다만 이는 자동화 브라우저에서의 관찰이므로 신뢰 클릭 방식을 유지 | X-8 |
| **DX-5** | A-DX-10 · S7-06 · AC · §9.7 행 수 검증 | 감사 `EXPORT`의 행 수는 **묶음 수 + 발화 수**(`after.rows`)이며 분석 "발화 수"와 다르다. 필드: **`after.rows`·`after.utterances`·`after.clusters`**(상세 `GET /audit-logs/:id`에만 — 목록에는 `summary` 문자열 `(N행)`만). 검증식 = `rows == clusters + utterances` 및 `utterances ==` 분석 발화 수(`counts.validCount`와 일치 확인). 파일 이름 패턴 `utterance-analysis-<KST YYYYMMDD>-<id 앞 8자>.xlsx`. 화면 경로 `/chatbots/:id/stats/utterance-analyses/:analysisId` | X-10 |
| **DX-6** | §11.2 STT 종료 뒤 회수 조건 ①·X-5 | `--query-compute-apps`는 WDDM에서도 PID를 주지만 **실제 인터프리터 PID**(런처 아님)다. 조건 ①은 `Win32_Process` 자식 트리의 모든 PID(런처·인터프리터)가 목록에 없음으로 구현해야 의미가 있다(런처 PID는 처음부터 없어 항상 참). `used_memory`는 `[N/A]`이므로 프로세스별 증가분은 불가 — **②(전체 `memory.used` 하락)가 실질 판정**, "판정 근거: 메모리 하락만" 문구는 쓰지 않아도 되나 ②를 필수로 둘 것. 실측 회수 ≤0.3초 → 상한 15초는 과대(5초로 줄여도 안전) | X-5 |
| **DX-7** | §10 예산(SE-01 45초·SE-02 60초)·A-DX-1 · P4-L 150초 상한 | 실측: 회수 0.3초 + Ollama 적재 4.1~6.4초 → **SE-01 45초는 20~25초로 단축 가능**. 생성 대기(UI)는 API 경유 14.8초(사전 적재)~20.2초(냉) → SE-02 60초 중 생성 체감 15~20초(+UI 조작) — 단축 여지. P4-L 상한 150초(워밍업 120초 포함)에 비해 생성 자식 기동 8.5초. 단 **모델 파일이 디스크 냉 상태(재부팅 직후)일 때의 첫 적재는 미측정**이라 상한(60초·120초)은 유지하고 연출 예산만 조정(실측 후 리허설 확정). 이 PC 값이며 다른 PC 가정 금지 | X-4·X-9 |
| **DX-8** | §5.1 PC-DX-4 · §5.2 결정표 · AC-DX1-4 시험 방법 | 이 PC에는 **시스템 PATH에 CUDA 12.8·cuDNN 9.7이 있어** venv `nvidia\…\bin` 없이도 cuda가 적재된다 → PC-DX-4(venv 3폴더 존재)를 `auto`·`cuda`의 **필수 조건으로 두면 시스템 CUDA만 있는 PC를 불필요하게 cpu로 떨어뜨린다**. 권고: PC-DX-4를 "venv 폴더 **또는** 시스템 PATH의 `cublas64_12.dll`·cudnn 탐색(`where cublas64_12.dll`)" 중 하나로 정정하고, **실제 판정은 기동 시도(3행 `DEVICE_FALLBACK`)가 권위**. 기동 실패는 **6.9초 안에 자식 종료**(`cublas64_12.dll is not found`)로 확인되므로 60초 상한 대비 빠른 감지 가능. AC-DX1-4("DLL 폴더 이름 변경 → auto가 cpu로")는 이 PC에서 **venv 폴더 이름 변경만으로는 cpu 대체가 일어나지 않는다**(시스템 CUDA가 살아 있음) — 시험은 자식 `PATH`에서 CUDA 항목을 제거하는 시험 전용 인자 또는 설계가 자식 PATH를 정리하는 방식이 필요(미결: 설계가 하네스 자식에 시스템 PATH를 그대로 상속시킬지 — DT-1 `pickSystemEnv`는 `PATH`를 그대로 넘긴다) | CUDA DLL 절 |
| DX-9 | §7.3 합성 명령 | `-EncodedCommand` 호출의 **stderr에 PowerShell 진행 메시지 CLIXML**(`#< CLIXML … 모듈을 처음 사용하기 위해 준비하는 중입니다`)이 섞인다(종료 코드 0·WAV 정상). 합성 스크립트 앞에 `$ProgressPreference='SilentlyContinue'`를 넣고, 성공 판정은 종료 코드·WAV 헤더로(stderr 비어 있음 가정 금지). `Add-Type -AssemblyName System.Speech` 필요 | X-6 |
| DX-10 | §8.3 녹음 시작 대기 | 말하기 클릭 → "말하기 끝내기" 전환은 첫 호출 0.84~0.89초(가짜 장치 `getUserMedia` 지연 포함)·두 번째 0.21초 — 상한 5초 안. `holdForMedia(WAV 길이+1.0초)`는 그 시작 신호 뒤부터 센다는 설계 그대로 유효. 전사 대기: 종료 클릭 뒤 입력창 채움 1.1초(turbo) — small/cpu는 2~2.5초(위젯 대기 상한 15초 안) | X-3 |
| DX-11 | C-DX-5 위젯 선택자 | 입력창은 `<textarea>`(`getByLabel('메시지 입력')`), 마이크 `#cb-mic`(보이는 글자 "말하기"), 인식 뒤 상태 줄 "글자로 바꿨어요. 내용을 확인하고 고친 뒤 전송해 주세요."(`.cb-voice-text`). 인식 결과는 **자동 전송되지 않고 입력창에만 채워진다** — 시연은 "전송" 버튼 클릭이 필요(설계 §9.8 SV-06 확인) | X-3 |
| DX-12 | §6.2 환경표(확인) | 거버넌스 ON에서 `DATA_EGRESS_ALLOWED_HOSTS`에 음성 자식(`127.0.0.1:8102`)이 없으면 **API가 기동 자체를 거부**(`[데이터 거버넌스] 외부 전송 허용 목록(DATA_EGRESS_ALLOWED_HOSTS)에 없는 호스트입니다 — 음성 인식(ml-worker)`). 설계 355행(추가 `127.0.0.1:8102`)이 맞음을 실측 확인. 생성(8101)도 같은 형태일 것(이번엔 허용한 채 시험 — 미허용 시 거부는 미확인). 쉼표 구분 문자열 `127.0.0.1:8100,127.0.0.1:8102,127.0.0.1:8101` 동작 | 확인 |
| DX-13 | §6.1 포트·§11.3 생성 요청 | ml-worker `/augment` 요청은 `locale:"ko"` 필수. 생성 자식은 `ML_WORKER_ROLE=augment`로 기동 후 임베딩 CPU 자식(8100)과 별개 — 이번 확인에서 생성 자식 단독 8101로 정상 동작(`CUDA_VISIBLE_DEVICES=-1`·`GENERATION_BACKEND=ollama`·`OLLAMA_BASE_URL=http://127.0.0.1:11434`) | X-9 |

## 구현(K1~K5)에 영향 주는 사실
1. **가짜 마이크는 Edge 154에서 바로 동작**(공백 경로·`%noloop`·webm/opus) — 폴백 사다리 없이 구현하면 된다(K1·K2).
2. **위젯이 만든 브라우저 녹음(webm/opus)은 서버 PyAV가 그대로 디코딩**한다. 제품 결함 후보 없음 → R-DX-9 우회 로직 불필요.
3. 음성 자식 PID는 **런처+인터프리터 2개**이고 `nvidia-smi`는 인터프리터를 보고한다. 종료·회수 판정(`src/gpu/`)은 CIM 자식 트리와 `memory.used`를 같이 본다(DX-6).
4. **Ollama 적재·해제·확인 3종 API가 정상**(적재 4~6초·해제 즉시·`/api/ps`). 해제 뒤 VRAM이 즉시 0이라 STT→Ollama 순차 전환이 현실적이다.
5. STT turbo(989MiB)+Ollama(2.3GB) **동시 적재는 가능했지만 여유 약 0.8GB** — 설계의 순차 원칙 유지(관찰이지 보증 아님).
6. **기본 합성 문장 교체 필요**(DX-3) — K3 착수 시 S2를 기본으로, 판정은 정규화+핵심어 `["환불"]` 계열.
7. `#voice-play`는 뷰포트 안 고정 위치(DX-4) · 입력창/마이크 선택자(DX-11) · 감사 행 수 필드(DX-5) · 거버넌스 허용 목록(DX-12) · 증강 요청 `locale`(DX-13)은 K2~K4 구현에 그대로 반영.
8. **시스템 PATH의 CUDA 유무에 따라 cuda 가능 여부가 달라진다**(DX-8) — 사전 점검은 파일 존재 대신 기동 시도·`where`로 보는 편이 이 PC에 맞다.
9. 하네스 `--prepare-only`는 기본으로 이력 예약 실행(약 7분)을 기다린다 — K 단계 스파이크는 `--no-history-schedule`로 줄일 수 있다.

## 불가 항목과 대체안
- **불가로 판정된 항목은 없다.** 조건부: X-2(출처 정확 일치·헤드풀 프롬프트 대기), X-5(프로세스별 VRAM `[N/A]` → 전체 `memory.used`로 대체).
- **미수행·한계**: ① 실제 스피커 청취(X-7·X-8)는 자동화로 확인 불가 — 수동 1회 ② 디스크 냉 상태(재부팅 직후) Ollama 첫 적재 시간 ③ 생성 자식 8101의 거버넌스 허용 목록 미허용 거부(이번엔 허용한 채 시험) ④ 하네스 DT-2 코드 없이 구성한 스택이라 하네스 종단 실행·AC 시험은 K1 이후 ⑤ STT와 생성의 **동시 부하**(전사 중 생성) 관찰 없음 ⑥ headed 권한 프롬프트를 실제로 닫는 동작은 시험하지 않음(미부여 자체를 막는 설계로 충분).

## 남은 위험
- 기본 문장을 바꾸지 않으면 `auto`가 cpu로 대체되는 PC에서 G-DX-1이 실패한다(DX-3, 3회 재현) — 가장 먼저 반영.
- 시스템 CUDA PATH 의존(DX-8): 시연 PC마다 `PATH`가 다르면 같은 하네스가 PC에 따라 cuda/cpu로 갈린다 — 보고서 모델 구성표·시작 카드에 실제 `device`를 적는 설계(§5.2)를 유지해야 하고, 사전 점검만 믿지 말고 기동 결과가 권위.
- 3050 4GB 여유: 동시 적재 가능했으나 여유 약 786MiB — 다른 GPU 앱(브라우저 가속·화면 녹화)이 겹치면 Ollama가 CPU로 더 넘길 수 있고 생성 시간이 늘 수 있다(`size_vram` 감시 권고).
- 냉 생성 20.2초는 API 제한 30초·ml-worker 25초 대비 여유가 얇다 — 디스크 냉 적재 시 초과 가능. 사전 적재(SE-01)와 폴백 G1이 그 완충이다.
- 이번 시험 중 하네스 `--prepare-only` 실행이 `keepRuns=5` 정책으로 **이전 실행 폴더 2개**(`.demo-runs/20261002-072051-i5nw`·`…072208-03my`, gitignored)를 정리했다 — 보존이 필요했다면 복구 불가(생성물이라 재생성 가능).
