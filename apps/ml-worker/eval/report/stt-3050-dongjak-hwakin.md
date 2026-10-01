# No.32 음성 인식(STT) RTX 3050(4GB) 동작 확인 — 2026-10-02

> **이 문서는 "동작 확인"이다. 정확도(CER)·지연의 합격 판정이 아니다.** 설계서 `docs/02-spec/voice-ai-설계.md` §8.5·§8.8·§17,
> 요구사항 AC-VO5-1의 3050 수동 게이트를 수행한 기록이다. 합격 판정용 실측(CER·10초 발화 P50/P95·동시 N 처리량·VRAM 합계·
> 임베딩 P95 영향)은 **운영 L40S에서 No.17 실측과 함께** 수행한다(No.37·No.32 선례). 아래 수치는 합성 음성 1~3개·소수 반복의
> 관찰값이며 운영 성능으로 일반화하지 않는다.

## 1. 장비·버전

| 항목 | 값 |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| GPU | NVIDIA GeForce RTX 3050 Laptop (4096MiB), 드라이버 576.88(CUDA 12.9 호환), 측정 시작 시 사용 0MiB |
| Python / 패키지 | 3.10.11, faster-whisper 1.2.1, ctranslate2 4.8.2, av 17.1.0, onnxruntime 1.23.2(Silero VAD) |
| torch(.venv) | 2.14.0+cpu (CUDA 없음 — STT에는 불필요, 임베딩 GPU 실험은 §6) |
| 모델 | `small`(464MB 반입), `large-v3-turbo`(1.6GB 반입) — `fetch_stt_model.py`로 `apps/ml-worker/.cache/stt-models/<이름>` (`.gitignore`의 `.cache/` 규칙으로 제외, 커밋 대상 아님) |
| 내려받기 시간 | small 약 48초, large-v3-turbo 약 3분(이 회선 기준) |
| 연산 | `STT_COMPUTE_TYPE=int8`(두 모델 모두), `STT_VAD=auto`(=silero), `STT_BEAM_SIZE=5` 기본 |

## 2. CUDA 요구사항과 이 PC 상태

- ctranslate2 4.8.2 CUDA 빌드는 **CUDA 12 런타임(cuBLAS 12)과 cuDNN 9**의 DLL이 검색 경로(Windows는 `PATH`)에 있어야 한다.
- 이 PC에는 **시스템 전역 CUDA Toolkit·cuDNN DLL이 없다**(`C:\Windows\System32`에 cublas/cudnn/cudart 없음). `nvidia-smi`(드라이버)만 있다.
- 해결: **venv 안에서만** `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`(설치 결과 cublas 12.9.2.10, cudnn 9.27.0.42, cuda-nvrtc 12.9.86 / `pip check` 무결).
  시스템 전역 설치·드라이버 변경 없음. 설치 후 `ctranslate2.get_cuda_device_count()==1`, 지원 연산 `int8·int8_float16·int8_float32·float16·bfloat16·float32` 확인.
- **주의(설계 환류)**: 이 DLL들이 `.venv\Lib\site-packages\nvidia\{cublas,cudnn,cuda_nvrtc}\bin`에 있어도 프로세스가 자동으로 찾지 않는다.
  서비스(`speech` 역할)는 `add_dll_directory`를 하지 않으므로 **기동 환경의 `PATH` 앞에 위 3개 `bin` 경로를 추가**해야 `STT_DEVICE=cuda`가 적재된다
  (이번 실행도 PATH로 주입). 이 pip 패키지는 `requirements-speech-lock.txt`에 **없다**(선택·GPU 전용). 운영(L40S 리눅스)은 시스템 CUDA 12·cuDNN 9 설치가 정석.

## 3. 실행 명령

```
# 모델 반입 (한 번)
python scripts/fetch_stt_model.py small            --out .cache/stt-models/small
python scripts/fetch_stt_model.py large-v3-turbo   --out .cache/stt-models/large-v3-turbo
# 기동 (PATH 앞에 nvidia\cublas\bin;nvidia\cudnn\bin;nvidia\cuda_nvrtc\bin 추가)
ML_WORKER_ROLE=speech ML_WORKER_PORT=8102 STT_BACKEND=faster-whisper \
  STT_MODEL_ID=<.cache/stt-models/...> STT_DEVICE=cuda STT_COMPUTE_TYPE=int8  node scripts/start-speech.mjs
GET  /speech/health ;  POST /speech/transcribe  (본문 = webm/opus 원시 바이트)
```
(`pnpm --filter ml-worker run start:speech`와 동일 진입점 `start-speech.mjs`를 사용.) 시험 입력은 Windows SAPI 음성으로 합성한 WAV를
PyAV(libopus)로 **webm/opus 48kHz mono**로 인코딩해 브라우저 MediaRecorder 산출물과 같은 형식으로 전송했다.

## 4. 결과(관찰)

### 4.1 적재·VRAM (nvidia-smi `memory.used`, 시작 0MiB)

| 구성 | 기동~health ok(워밍업 포함) | 적재 후 VRAM | 요청 반복 후 VRAM |
|---|---|---|---|
| small int8, cuda | 약 3~4초 | 381MiB | 381~445MiB |
| large-v3-turbo int8, cuda | 약 5.6~7.2초 | 989MiB | 989~1053MiB |
| small int8, **cpu** | 약 4.6초 | 0 | 0 |

(모델 파일은 로컬 디스크 캐시 이후 측정이라 첫 반입 시간은 §1. health는 `warmedUp:true`.)

### 4.2 전사 관찰(합성 한국어 — Windows `Microsoft Heami Desktop` ko-KR)

한국어 음성 팩이 **있었다**(Heami ko-KR, Zira en-US). 정확도 판정이 아니라 파이프 동작 관찰이다(문장 3개).

| 입력(길이) | small int8 GPU | large-v3-turbo int8 GPU |
|---|---|---|
| "안녕하세요. 환불 규정이 어떻게 되는지 알려주세요."(5.3초) | 정확히 동일 | "환불규정"(띄어쓰기만 다름) |
| 위 긴 문장 앞 10초(잘림 지점) | 문장 앞부분 정상, 끝 "…분실되었다면" | 동일 |
| 15.5초 전체 | "…재발성이 가능한지"(재발송→재발성 1글자 오류) | 전부 정확 |
| 영어 5.6초(ko 강제 언어 설정이지만) | 영어 문장 그대로 전사 | 동일 |

- 두 모델·GPU/CPU 모두 파이프(webm 디코드→VAD→전사→JSON)가 끝까지 동작. CPU small 결과도 GPU와 같은 문장.
- 설정상 `language="ko"` 고정이라 영어 입력이 영어로 나온 것은 Whisper 특성이며 영어 지원 주장이 아니다.
- **오기록 정정(작업 중 발견)**: 첫 시도에서 PowerShell 스크립트를 BOM 없이 저장해 한글이 깨진 채로 합성되어 "띵띵, 칠빌…" 같은 엉뚱한 전사가
  나왔다. 입력 합성 오류이며 STT 결함이 아니다(UTF-8 BOM으로 다시 합성해 위 결과를 얻음). 이 때 CPU small의 10~28초 지연/504 DEADLINE도
  깨진 입력(반복 디코딩) 때문이었고 정상 입력 재측정에서는 사라졌다. 오염된 값은 이 보고서에서 제외했다.

### 4.3 전사 지연(요청~응답 전체 ms, HTTP 포함, 동일 음성 8회 반복)

| 입력 | small GPU | large-v3-turbo GPU | small CPU |
|---|---|---|---|
| 5.3초 발화 | 271~343 (중앙 약 300) | 500~551 (중앙 약 514) | 2101~2276 (중앙 약 2137) |
| 10.0초 발화 | 455~512 (중앙 약 477) | 596~641 (중앙 약 606) | 2513~2632 (중앙 약 2550) |
| 15.5초 발화(1회) | 656 | 712 | 2872 |

(첫 요청이 약간 느린 외에 큰 변동 없음. 8회 반복은 P95 산출용 표본이 아니다 — 범위만 기록.) 동시 요청·처리량은 측정하지 않았다.

### 4.4 무음·잡음 입력의 환각 관찰(설계 K-7 — 관찰만, 목록은 빈 목록 유지)

| 입력 | 서비스 기본(VAD=silero) | VAD 끔(`STT_VAD=off`, 모델 단독 관찰) |
|---|---|---|
| 무음 5초 | 두 모델 모두 `empty:true` | small: 빈 결과 / **large-v3-turbo: "시청해주셔서 감사합니다."** |
| 백색잡음 5초(σ=800) | `empty:true` | small: 빈 결과 / **turbo: "다음 영상에서 만나요."** |
| 저잡음 8초(σ=60) | `empty:true` | small: 빈 결과 / **turbo: "다음 영상에서 만나요."** |

- 서비스 경로에서는 VAD가 무음·잡음을 걸러 환각이 발생하지 않았다. 단, 이는 **합성 잡음 3종**의 결과일 뿐이다(실제 주변 소음·숨소리·키보드·음악은 미시험).
- **모델 단독(VAD 끔)에서 large-v3-turbo는 한국어 상투 문장을 지어냈다.** 목록 후보(빈 목록 유지, 사용자 판단 대기):
  `시청해주셔서 감사합니다.`, `다음 영상에서 만나요.` (유튜브 자막 유래 전형 환각). VAD가 약한 실제 잡음(VAD 통과 구간)에서는 이 문구가 나올 수 있으므로
  운영 L40S 실측 때 실제 잡음 샘플로 재관찰이 필요하다.

### 4.5 임베딩 프로세스(KURE-v1)와의 동시 적재(4GB 한계)

`.venv`의 torch는 CPU 빌드라 `EMBEDDING_DEVICE=cuda`가 `Torch not compiled with CUDA enabled`로 기동 실패했다(조용한 대체 없음 — 의도된 동작).
관찰을 위해 **.venv를 건드리지 않고** 임시 폴더에 `torch 2.11.0+cu128`을 `pip --target`으로 설치하고 `PYTHONPATH`로만 임베딩 프로세스에 주입했다
(저장소·.venv 불변). 임베딩 프로세스는 약 23초에 기동, 임베딩 `kind:"QUERY"`는 요청 계약이 `texts`+`kind` 필수.

| 구성 | VRAM 합계(nvidia-smi) | 동시 적재 |
|---|---|---|
| 임베딩(KURE-v1, cuda)만 | 2,275MiB | - |
| + small int8 | 2,656MiB(STT 증분 약 381) | **가능**(잔여 약 1.4GB) |
| + large-v3-turbo int8 | 3,264~3,292MiB(STT 증분 약 989~1,017) | **가능**(잔여 약 0.8GB, 4,096 대비 약 80%) |

- 동시 구동 중 STT 지연 변화는 없음~소폭(turbo 10초 발화 중앙 약 606→618~656ms 범위). 임베딩 단건 호출은 STT 유휴 시 약 40~65ms,
  STT 연속 요청 중 약 37~100ms(소수 표본·반복 구간이 겹친 정도가 불명확 — 임베딩 P95 영향의 **판정이 아니라 관찰**).
- 여유가 작으므로 위젯 외 다른 GPU 작업(No.17 생성 모델 등)이 **동시에** 오를 수 없다. 3050에서의 동시 적재는 임베딩+STT까지로 본다.

## 5. 가능했던 것 / 불가했던 것

- 가능: small·large-v3-turbo int8의 GPU(CUDA) 적재·전사, webm/opus 입력 파이프, CPU 대체 경로(small), 임베딩(GPU)과 STT 동시 적재.
- 불가/미수행: CER 합격 판정(정답 있는 합성 3문장뿐·실제 사람 음성 없음), 동시 N 처리량, P50/P95 정식 산출(표본 8회), float16 3050 구성 미시험,
  브라우저 마이크(위젯) 경로, 실제 소음 환경, 임베딩 P95 영향 판정. 모두 **운영 L40S 실측으로 이월**.
- 한계: 합성 음성은 음향 다양성이 낮아 실제 화자·억양·잡음 대비 낙관적이다. SAPI Heami 한 가지 화자.

## 6. 설계 환류

1. **CUDA DLL 경로**: `speech` 서비스가 pip `nvidia-*-cu12` 패키지 DLL을 자동 탐색하지 않는다. 설계서 §8.5/README에 "3050 Windows는 venv에
   `nvidia-cublas-cu12`·`nvidia-cudnn-cu12` 설치 후 해당 `bin`을 `PATH`에 주입" 절차를 추가하거나, 기동 시 `os.add_dll_directory`로 안내/자동 탐색을 넣을지
   결정 필요(코드 변경은 이번 범위 밖 — 변경하지 않음). `requirements-speech-lock.txt`의 "GPU 요구 조건 기록" 주석은 이 문서의 버전(cublas 12.9.2.10, cudnn 9.27.0.42)으로 채울 수 있다.
2. **환각 후보**: K-7 목록 후보 2건(§4.4)을 사용자가 채택하면 빈 목록을 채운다(채택 전까지 비어 있음). VAD가 1차 방어선임이 관찰로 확인되므로 VAD를 끄는 구성은 금지에 가깝다.
3. **small vs large-v3-turbo on 3050**: 둘 다 4GB 안에서 적재·동작했고 임베딩과 동시 적재도 가능했다. 시연 모델은 small로도 충분히 "동작 확인"이 가능하고,
   turbo는 한 글자 수준 오류가 더 적게 관찰됐다(판정 아님). 어느 쪽이 시연 기본인지는 PM 선택.
4. **임베딩 GPU(3050)**는 `.venv` torch가 CPU 빌드라 별도 CUDA torch 설치가 필요하다(현재 CPU 임베딩이 개발 기본이라 영향 없음). 동시 적재 조합은 문서화 가치 있음.
5. 이번 작업으로 변경된 것: `.venv`에 `nvidia-cublas-cu12`·`nvidia-cudnn-cu12`·`nvidia-cuda-nvrtc-cu12` 추가(잠금 파일 미갱신), `.cache/stt-models/`(gitignore) 모델 2종 반입. 코드·잠금·문서(본 파일 제외) 변경 없음.
