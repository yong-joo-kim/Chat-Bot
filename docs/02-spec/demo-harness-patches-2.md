# 원클릭 시연 하네스(DT-1) — 상위 문서 패치 2 (1단계 실기동 정정 반영)

> **적용 상태: 적용됨(2026-10-01)**
> **작성**: system-architect · 2026-10-01
> **근거**: `tools/demo-harness/docs/실기동확인.md`(1단계 실기동 6건 · 설계 정정 13건 · 결함 후보 DHX-4) · 갱신된 `docs/02-spec/demo-harness-설계.md`(§0.1 정정표 · §21.2 · §21.3 DHX-4) · `docs/02-spec/decisions/ADR-0051-…md`(실기동 정정 절)
> **적용 주체**: git-manager 또는 부분 편집(Edit)이 가능한 세션. **이 세션은 아래 대상 문서를 직접 수정하지 않았다**(추적 문서는 CRLF/LF 보존을 위해 패치로만). 미추적 신규 문서 중 **설계·ADR-0051은 직접 수정**했다. **요구사항 `docs/requirements/demo-harness.md`는 수정 대상 없음**(정정 13건은 모두 설계 수준 — 요구사항 본문 불변 원칙 · 1차 패치 H-9 문구 그대로). **ui-spec(미추적 · LF · 1047줄)은 바뀌는 곳이 2줄 + 이력 1줄뿐이라** 이 세션의 전체 재작성(부분 편집 도구 없음)으로 인한 훼손 위험을 피하려고 P2-5로 넣었다. `CLAUDE.md`는 대상이 아니다.
> **선행 패치**: `docs/02-spec/demo-harness-patches.md`(H-1~H-9, 적용됨). 이 패치는 그 결과물 위에 적용한다(앵커가 H-3·H-8 적용 후 문구를 가리킨다).

## 적용 규칙

1. 각 **찾을 문자열**은 대상 파일에서 **정확히 1회** 일치함을 2026-10-01(커밋 `5552aa4` + 작업 트리 — H-1~H-9 적용 상태)에 grep으로 확인했다. 적용 직전 다시 확인하고 0회·2회 이상이면 적용하지 말고 보고한다.
2. **[치환]** = 찾을 문자열(줄의 일부 또는 줄 전체)을 바꿀 문자열로. 바꿀 문자열이 여러 줄이면 새 줄의 줄바꿈은 파일 기존 형식(CRLF/LF)을 따른다. **[뒤 삽입]** = 찾을 문자열이 든 줄 **다음 줄**에 새 줄들을 넣는다(삽입 블록 첫 줄이 빈 줄이면 빈 줄도 넣는다).
3. 코드 블록 안의 텍스트만 문서에 넣는다.
4. 같은 파일 안에서는 표의 순서대로 적용한다(앞 패치가 뒤 패치의 앵커를 건드리지 않게 골랐다).

## 목록

| # | 대상 | 줄바꿈 | 건수 | 내용 |
|---|---|---|---|---|
| P2-1 | `docs/04-test/결함분류-2026-10-01.md`(bug-triage 소관 · 추적) | LF | 1 | 결함 후보 **DHX-4** 등록 + DHX-1 실측 증거 |
| P2-2 | `docs/05-ops/자동배포.md` §5.13(추적) | CRLF | 6 | 명령 형태·사용법 필수 내용 · 사전 조건(RAM 표기·가용 RAM·Ollama 종료) · `NODE_PATH` · ffmpeg 반입 폴더 · 단건 지연 3라운드 · 정리(`--stop`)·잠금 파일 규칙·DHX-4 구축형 주의 |
| P2-3 | `docs/04-test/자동시험_전략.md` §22(추적) | CRLF | 2 | 단위 시험 수(14 → 17) · lint 기준·종료 코드 보존·남은 수동 확인 |
| P2-4 | `docs/02-spec/개발명세서.md` §2 · §7(추적) | CRLF | 3 | 워크스페이스 표 상태 · 하네스 전용 키 · 세부 설계서 인덱스에 DHX-4 |
| P2-5 | `docs/03-design/demo-harness-ui-spec.md`(미추적 · ui-designer 소관) | LF | 3 | 보고서 단건 지연 라운드 표시 · 시작 전 확인 Ollama 종료 방법 · 변경 이력 |

합계 15건.

> 참고 — 결함분류 파일은 1차 패치(H-8) 기록상 **LF**이며 2026-10-01 grep에서도 CR 0건을 확인했다(작업 지시에서 "CRLF 문서"로 묶였지만 실제는 LF — 기존 형식을 따른다). ui-spec도 CR 0건(LF).

---

## P2-1. 결함분류-2026-10-01.md (LF · bug-triage 소관)

### P2-1.1 [뒤 삽입] "신규 결함 후보 (2026-10-01 시연 하네스 설계 …)" 절 마지막 항목 다음 (120행)
찾을 문자열:
```
하네스 완료 후 §3 표의 해당 행 "지금 할 수 있는가"에 반영 권장.
```
삽입:
```
- **DHX-1 재확인(2026-10-01 하네스 1단계 실기동)**: 하네스 브라우저 외부 요청 감시가 관리 콘솔에서 `fonts.googleapis.com` **1호스트**를 차단·기록했다(CSS가 막혀 `fonts.gstatic.com` 요청은 발생하지 않음 — 설계 예상 "2호스트" 정정). 확인 시점의 `apps/web/dist`는 글꼴 수정 전 빌드다. 등급·권고는 위 DHX-1 그대로.

### 신규 결함 후보 (2026-10-01 시연 하네스 1단계 실기동 — system-architect 정리, 트리아지 확정 전)

근거 문서: `tools/demo-harness/docs/실기동확인.md` "결함 후보" 표 · `docs/02-spec/demo-harness-설계.md` §2 C-20 · §21.3 DHX-4 · ADR-0051 대안 13·14.

- **DHX-4 (`apps/api`가 `multer`를 직접 의존성으로 선언하지 않음 → 직접 기동 실패)**: 근거 — `apps/api/package.json`에는 `devDependencies`의 `@types/multer ^2.2.0`만 있고 `multer`가 없다. 그런데 `src/faqs/faqs.controller.ts:17`·`src/intents/intents.controller.ts:17`·`src/keywords/keywords.controller.ts:17`·`src/validation/test-cases.controller.ts:3`·`src/utterance-analysis/utterance-analyses.controller.ts:3`이 `import { memoryStorage } from 'multer'`(값 import — 타입 전용 아님)를 한다(`main.ts` 15행은 주석 언급뿐). `multer@2.0.2`는 `@nestjs/platform-express ^10.4.15`의 전이 의존성으로만 설치돼(`pnpm-lock.yaml`) pnpm의 엄격한 `node_modules` 구조에서는 `apps/api`에서 해석되지 않는다. 재현(2026-10-01 실측) — 하네스가 부모 환경을 상속하지 않고 `node apps/api/dist/main.js`를 직접 띄우자 `api.log`에 `Error: Cannot find module 'multer'`(`MODULE_NOT_FOUND`)로 기동 실패. `pnpm start`·`pnpm run`·`node_modules/.bin` 셸은 `NODE_PATH`에 `<저장소>/node_modules/.pnpm/node_modules`를 넣어 주므로 개발·시험(jest)에서는 드러나지 않았다. 영향 — **Docker 이미지·pm2·Windows 서비스 등록·systemd처럼 `node dist/main.js`를 직접 실행하는 구축형(On-Premise) 설치가 첫 기동에서 실패**한다(데이터 손상·보안 영향 없음 — 기동 자체가 안 됨). `pnpm deploy`·`--prod` 설치 방식에 따라서는 `multer`가 아예 복사되지 않을 수도 있다(확인 필요). 등급 제안 **Medium**(구축형 납품 영향 — 설치 방식이 서비스 등록형이면 **High**: 고객 현장 첫 기동 실패). 권고 수정 — `apps/api/package.json` `dependencies`에 `"multer": "^2.0.2"`(이미 그래프에 있는 `2.0.2`와 같은 범위 — 새 내려받기·버전 변화 0)를 추가한다. **잠금 파일 재해석 위험과 처리**: 이 저장소에서 일반 `pnpm install`을 돌리면 pnpm이 그래프를 재해석하면서 `apps/web`·`apps/widget`의 `jsdom@25.0.1` 피어(`canvas` — `pdfjs-dist` 때문에 이미 그래프에 있음) 해석을 바꾸고 기존 스냅샷 1개를 삭제한다(시연 하네스 H0-4에서 실측). 따라서 ① **권고**: `pnpm-lock.yaml`의 `importers['apps/api'].dependencies`에 `multer`(specifier `^2.0.2` · version `2.0.2`) 항목만 손으로 병합하고 `pnpm install --frozen-lockfile` 통과 · `git diff pnpm-lock.yaml`에 삭제 줄 0을 확인한다 ② 재해석을 받아들이는 경우 잠금 파일 diff 전체를 검토하고 `apps/web`·`apps/widget` vitest 전체 통과를 확인한 뒤 같은 커밋에 사유를 적는다. 확인 시험 — `apps/api`에서 `NODE_PATH`를 비운 셸(또는 `env -u NODE_PATH`)로 `node dist/main.js` 기동 → `GET /api/health` 200 · 파일 업로드 라우트 1개(예: 의도 엑셀 가져오기) 동작. 기존 시험 기대값 변경 없음 · 마이그레이션 없음. 담당 backend-implementer. **지금 고칠 수 있는가: 수정 가능**(결정 필요 없음 — 단 잠금 파일 처리 방식 ①/② 선택). 시연 하네스는 이 결함을 우회하지 않고 등록하며, API 자식에 `NODE_PATH`를 넘겨 pnpm 실행 래퍼와 같은 해석 경로를 재현한다(수정 후에도 무해 — 설계 §6.2). 관련 권고: 구축형 설치 문서(`자동배포.md`)의 기동 절차가 `node dist/main.js` 직접 실행이면 수정 전까지 같은 문제가 있음을 주의로 적는다(패치-2 P2-2.5 (b) 항목 9).
```

---

## P2-2. 자동배포.md (CRLF) — §5.13 원클릭 시연 하네스

### P2-2.1 [치환] §5.13 항목 1 끝 — 사용법 문서 필수 내용·명령 형태 (208행)
찾을 문자열:
```
사용법 문서 `docs/05-ops/시연_하네스.md`(구현 시 작성).
```
바꿀 문자열:
```
사용법 문서 `docs/05-ops/시연_하네스.md`(구현 시 작성 — 시연 전 확인(Ollama 종료·메모리 확보) · ffmpeg 반입 · `--stop` 정리 · 남은 수동 확인 항목 포함). 루트 스크립트는 `pnpm -C tools/demo-harness run demo --` 형태라 하네스 종료 코드(0 통과 · 1 단계 실패 · 2 준비 실패 · 130 중단)가 그대로 전달된다(`--filter` 형태는 모두 1로 바뀌므로 쓰지 않는다).
```

### P2-2.2 [치환] §5.13 항목 2 끝 — 메모리·Ollama (209행)
찾을 문자열:
```
디스크 여유 2GB · RAM 16GB 권장.
```
바꿀 문자열:
```
디스크 여유 2GB · RAM 16GB 권장(십진 16GB 기준 — OS가 15.8GiB로 표시해도 통과) · 가용 RAM 2GiB 이상(미만이면 사전 점검 경고 — 모델 적재 직후 지연이 3~10배로 늘 수 있음) · **Ollama 종료**(실행 중이면 사전 점검 경고 — 작업 표시줄 트레이 아이콘에서 종료. 하네스는 남의 프로세스를 끄지 않는다).
```

### P2-2.3 [치환] §5.13 항목 3 끝 — API 기동 방식 (210행)
찾을 문자열:
```
ml-worker `127.0.0.1` 바인드·`HF_HUB_OFFLINE=1`·`CUDA_VISIBLE_DEVICES=-1`.
```
바꿀 문자열:
```
ml-worker `127.0.0.1` 바인드·`HF_HUB_OFFLINE=1`·`CUDA_VISIBLE_DEVICES=-1`. API는 `node apps/api/dist/main.js`로 직접 기동하며 `NODE_PATH=<저장소>/node_modules/.pnpm/node_modules`를 함께 넘긴다 — `apps/api`가 `multer`를 직접 의존성으로 선언하지 않아(결함 후보 DHX-4) 이 값 없이는 `Cannot find module 'multer'`로 기동 실패한다.
```

### P2-2.4 [치환] §5.13 항목 4 — ffmpeg 반입 폴더 (211행)
찾을 문자열:
```
Playwright 전용 ffmpeg 폴더 `%LOCALAPPDATA%\ms-playwright\ffmpeg-<버전>`(`playwright-core` 버전과 짝).
```
바꿀 문자열:
```
Playwright 전용 ffmpeg 폴더 **`%LOCALAPPDATA%\ms-playwright\ffmpeg-1011`(`ffmpeg-win64.exe` 3.49MB) + `winldd-1007`(0.1MB)** 두 폴더(합계 약 3.7MB · `playwright-core 1.63.0`과 짝 — 버전을 올리면 리비전이 바뀐다 · 인터넷 PC에서 `node node_modules/playwright-core/cli.js install ffmpeg`로 받음 · `winldd` 없이 되는지는 미확인이라 함께 복사). ffmpeg가 없으면 하네스는 영상만 끄고 진행한다(Playwright는 ffmpeg 없이 녹화를 요청하면 브라우저 기동 자체가 실패하므로 하네스가 녹화를 요청하지 않는다). 설치는 `pnpm install --frozen-lockfile`로 한다(일반 `pnpm install`은 잠금 파일을 재해석해 제품 항목을 바꾼다 — 항목 8).
```

### P2-2.5 [치환] §5.13 항목 5(줄 전체) · 항목 7(줄 전체 + 새 항목 8·9) — 두 줄을 각각 치환(2건)
**(a)** 찾을 문자열(항목 5 줄 전체 · 212행):
```
5. **CPU 단건 임베딩 예산(§5.1과 연결)**: 하네스가 ml-worker 예열 뒤 단건 20건 P50/P95를 실측해 P95 ≤ 200ms면 300ms 유지, 넘으면 실행별 `EMBEDDING_TIMEOUT_MS`를 올리고 시작 자막·보고서에 공개한다. 이 실측 절차를 구축형 설치 점검에도 그대로 쓸 수 있다(`pnpm demo:check` 보고서 "단건 지연 실측" 절).
```
바꿀 문자열:
```
5. **CPU 단건 임베딩 예산(§5.1과 연결)**: 하네스가 ml-worker 예열 뒤 단건 20건 P50/P95를 실측해 P95 ≤ 200ms면 300ms 유지, 넘으면 실행별 `EMBEDDING_TIMEOUT_MS`를 올리고 시작 자막·보고서에 공개한다. 모델 적재 직후에는 앞 구간이 느려(2026-10-01 개발 노트북 실측: 적재 직후 P95 1.4~1.7초 → 안정 후 P50 108~133ms · P95 111~167ms) **P95 ≤ 200ms가 될 때까지 최대 3라운드 다시 재고 마지막 라운드로 결정하며 모든 라운드를 보고서에 공개**한다. 이 실측 절차를 구축형 설치 점검에도 그대로 쓸 수 있다(`pnpm demo:check` 보고서 "단건 지연 실측" 절) — 설치 직후 1회 측정값만으로 대기 시간을 정하지 않는다.
```
**(b)** 찾을 문자열(항목 7 줄 전체 · 214행):
```
7. **정리**: 정상·실패·Ctrl+C 모두 자식 프로세스 트리를 종료하고 포트를 확인한다. 남은 프로세스는 다음 실행이 표식(명령줄) 확인 뒤 정리한다. 실행 폴더는 최근 5개 보존(`.gitignore` 대상).
```
바꿀 문자열(3줄 — 줄바꿈은 CRLF):
```
7. **정리**: 정상·실패·Ctrl+C 모두 자식 프로세스 트리를 종료하고 포트를 확인한다. 남은 프로세스는 다음 실행이 표식(명령줄) 확인 뒤 정리한다 — 단 그 실행의 하네스가 아직 살아 있으면(서버 유지 중) 건드리지 않는다. 서버를 유지한 실행(`--prepare-only`·`--no-teardown`)은 `pnpm demo -- --stop latest`로 끝낸다(하네스에게 정지 요청 파일을 보내 스스로 정리하게 하고, 15초 안에 응답이 없으면 강제 종료 후 정리). 실행 폴더는 최근 5개 보존(`.gitignore` 대상).
8. **잠금 파일 규칙(하네스 의존성 변경 시)**: 일반 `pnpm install`은 `apps/web`·`apps/widget`의 `jsdom` `canvas` 피어 해석을 바꾸고 기존 스냅샷을 삭제한다. 하네스 의존성을 바꿀 때는 하네스 임포터·새 패키지 항목만 `pnpm-lock.yaml`에 손으로 병합하고 `pnpm install --frozen-lockfile` 통과와 `git diff pnpm-lock.yaml` 삭제 줄 0을 확인한다(`demo-harness-설계.md` §3.3).
9. **구축형 설치 주의(결함 후보 DHX-4 — 수정 전까지)**: `apps/api`를 `node dist/main.js`로 직접 기동하는 설치(Docker·pm2·Windows 서비스·systemd)는 `Cannot find module 'multer'`로 실패할 수 있다(`apps/api/package.json`에 `multer` 미선언). 수정(`multer`를 `dependencies`에 선언) 전에는 `pnpm --filter @chat-bot/api run start`로 기동하거나 `NODE_PATH=<설치 폴더>/node_modules/.pnpm/node_modules`를 지정한다. 상세 `docs/04-test/결함분류-2026-10-01.md` DHX-4.
```

---

## P2-3. 자동시험_전략.md (CRLF) — §22 시연 하네스 시험 방침

### P2-3.1 [치환] §22 항목 1 — 단위 시험 수 (1573행)
찾을 문자열:
```
비밀번호 정책 14종(H-T1~T14)
```
바꿀 문자열:
```
비밀번호 정책 14종(H-T1~T14) + 1단계 추가 3종(H-T15 빌드 지문 재수정 감지 · H-T16 사전 점검 경계값(RAM 16e9 바이트·가용 2GiB·ffmpeg·Ollama) · H-T17 출력 파이프 `EPIPE` 내성)
```

### P2-3.2 [뒤 삽입] §22 항목 5 다음 (1577행)
찾을 문자열:
```
5. **권장 절차**: 기능 그룹 완료(커밋 직전) 때 무인 점검 1회 — 화면 문구가 바뀌어 선택자가 깨지면 "선택자 갱신 필요"로 알려 준다.
```
삽입:
```
6. **[2026-10-01 1단계 실기동 반영]** ① **lint 기준**은 `npx eslint tools` 오류 0이다 — 저장소 전체 `pnpm lint`는 제품 쪽 기존 오류 68건(하네스 무관)이 있어 0이 될 수 없으므로, 하네스 추가 전후 제품 오류 수가 같은지만 확인한다. ② **종료 코드 판정**은 루트 `pnpm demo`·`pnpm demo:check`(`pnpm -C tools/demo-harness run demo --` 형태)로 한다 — `pnpm --filter … run demo`는 하위 종료 코드를 모두 1로 바꾼다. 단위 시험(`harness:test`)은 0/1만 보므로 어느 형태든 무방하다. 시험 실행기는 `tools/demo-harness/scripts/run-tests.mjs`(`dist/test/**/*.test.js`를 모아 `node --test`). ③ **남은 수동 확인 2건**: 실제 콘솔(PowerShell·Windows Terminal) Ctrl+C 신호 전달 1회(자동화는 `SIGINT` 핸들러 경로만 검증 — AC-DH1-4) · 폐쇄망 반입(`node_modules`·venv·HF 캐시·`ffmpeg-1011`·`winldd-1007`만 복사한 PC에서 `demo:check` + 영상 1회 — AC-DH2-2). ④ 결함 후보 DHX-4(`apps/api` `multer` 미선언) 수정 시험은 하네스가 아니라 API 쪽에서 `NODE_PATH` 없는 직접 기동(`node dist/main.js` → `/api/health` 200)으로 한다 — 하네스는 `NODE_PATH`를 넘겨 기동하므로 이 결함을 검출하지 못한다.
```

---

## P2-4. 개발명세서.md (CRLF)

### P2-4.1 [치환] §2 워크스페이스 표 `tools/demo-harness` 행 — 상태 (80행)
찾을 문자열:
```
**2026-10-01 설계 완료**(`demo-harness-설계.md` · ADR-0051)
```
바꿀 문자열:
```
**2026-10-01 설계 완료 · 1단계 구현·실기동 확인 6건 완료**(`demo-harness-설계.md` · ADR-0051 · 실기동 정정 13건은 설계 §0.1)
```

### P2-4.2 [치환] 같은 행 끝 — 하네스 전용 키 (80행)
찾을 문자열:
```
마이그레이션·환경변수·권한 0 · CI 0 |
```
바꿀 문자열:
```
마이그레이션·환경변수·권한 0 · CI 0 · API 자식 기동 시 하네스 전용 키 `NODE_PATH`(pnpm 해석 경로 — 결함 후보 DHX-4 `multer` 미선언 대응)·`NO_COLOR`·`CBDEMO_API_PACKAGE_JSON`만 추가(제품 설정 스키마 밖) · 루트 스크립트 `pnpm -C tools/demo-harness run demo --`(종료 코드 보존) |
```

### P2-4.3 [치환] §7 세부 설계서 인덱스 `demo-harness-설계.md` 행 — 결함 후보 목록 (881행)
찾을 문자열:
```
결함 후보 DHX-1(관리 콘솔 Google Fonts)**
```
바꿀 문자열:
```
결함 후보 DHX-1(관리 콘솔 Google Fonts) · 2026-10-01 1단계 실기동 6건 확인·정정 13건(§0.1) · 결함 후보 DHX-4(`apps/api` `multer` 미선언 — 직접 기동 실패, 구축형 영향)**
```

---

## P2-5. demo-harness-ui-spec.md (LF · 미추적 · ui-designer 소관)

### P2-5.1 [치환] §8.3-G 보고서 단건 지연 표시 — 라운드 공개(설계 §14 정정 #4 · §17.2-6) (640행)
찾을 문자열:
```
단건 지연 실측: `표본 20 · P50 NNms · P95 NNms · 결정 값 300ms(실측)/수동 지정` + 장비·일자·커밋(FR-0-317).
```
바꿀 문자열:
```
단건 지연 실측: `표본 20 · P50 NNms · P95 NNms · 결정 값 300ms(실측)/수동 지정` + 장비·일자·커밋(FR-0-317). **측정이 여러 라운드였으면**(모델 적재 직후 P95 > 200ms면 최대 3라운드 재측정 — 설계 §14) 그 아래 작은 표 `라운드 · P50 · P95`를 모든 라운드에 대해 싣고 마지막 행에 `결정에 쓴 라운드` 글자를 붙인다(색 비의존). 1라운드로 끝났으면 표 없이 위 한 줄만. 표 캡션 `단건 지연 측정 라운드`.
```

### P2-5.2 [치환] §9.3 준비 완료 요약 — 시작 전 확인의 Ollama 줄 (793행)
찾을 문자열:
```
   [ ] Ollama 등 다른 AI 프로그램이 꺼져 있습니다
```
바꿀 문자열:
```
   [ ] Ollama 등 다른 AI 프로그램이 꺼져 있습니다 (트레이 아이콘에서 종료)
```

### P2-5.3 [뒤 삽입] §15 변경 이력 마지막 항목 다음 (1047행)
찾을 문자열:
```
설계서와의 조정 A-1~A-12(§13) · PM 확인 Q-U1~U5(§14).
```
삽입:
```
- **2026-10-01 설계 정정 반영(system-architect 패치 `demo-harness-patches-2.md` P2-5)** — 하네스 1단계 실기동 정정 13건 중 화면에 닿는 것만 반영: §8.3-G 단건 지연 라운드 표(정정 #4 — 모델 적재 직후 재측정 최대 3라운드 · 전 라운드 공개) · §9.3 Ollama 종료 방법 병기(PC-10 보강). 나머지 정정(루트 스크립트 형태·`NODE_PATH`·ffmpeg 게이트·`--stop` 등)은 화면 문구 변화 없음. 사전 점검 신규 항목 PC-11b(가용 RAM 2GiB 미만 경고)는 §9.5 3요소 형식을 그대로 따른다(문구는 구현의 `왜`/`조치` 사용).
```

---

## 적용 후 확인

- `docs/04-test/결함분류-2026-10-01.md`에 `DHX-4` 1회 이상 · `docs/05-ops/자동배포.md` §5.13 항목 1~9 · `docs/04-test/자동시험_전략.md` §22 항목 1~6 · `docs/02-spec/개발명세서.md` 80·881행 갱신 · ui-spec 640·793행과 변경 이력.
- 줄바꿈 형식 유지 확인: 자동배포·자동시험_전략·개발명세서는 CR 수가 "기존 + 새 줄 수"만큼 늘었는지(새 줄: 자동배포 +2 · 자동시험_전략 +1 · 개발명세서 +0), 결함분류·ui-spec은 CR 0 유지.
- 결함분류 §1 요약 표(15~35행)에 DHX-1~4를 넣을지는 bug-triage가 트리아지 확정 때 정한다(이 패치는 H-8과 같이 "신규 결함 후보" 절에만 추가).
