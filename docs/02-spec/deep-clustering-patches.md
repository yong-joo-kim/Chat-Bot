# No.21 딥러닝 군집분석(발화 묶음 분석) — 기존 문서 패치 목록

> 작성: system-architect · 2026-09-30 · 근거: `docs/02-spec/deep-clustering-설계.md`, `docs/02-spec/decisions/ADR-0047-utterance-clustering-in-api-spherical-kmeans-own-status-table-feature-retention-and-single-apply-path.md`
> **적용 상태**: ✅ **적용됨(2026-09-30)** — 37건 전부 적용(미적용 0건). 원래 안내: 오케스트레이터가 적용한다. (architect 세션에 부분 수정 도구가 없고 대상 파일이 CRLF라, 전체 재작성 시 줄바꿈이 통째로 바뀌는 위험을 피하려고 패치 목록으로 남긴다 — 선행 그룹 `*-patches.md`와 같은 방식.)
> **적용 방법**: 각 항목의 "찾을 원문"을 대상 파일에서 **정확히 1회** 찾아 "바꿀 내용"으로 교체한다. 모든 원문은 2026-09-30 시점 작업 트리(커밋 `987e247`)에서 복사했고, 문자열 검색으로 대상 파일 안 **1회 매칭**을 확인했다. "바꿀 내용"이 원문을 그대로 포함하는 항목은 append다.
> **줄바꿈 주의**: 대상 파일은 CRLF다. 모든 "찾을 원문"은 **한 줄 안의 부분 문자열**(줄바꿈 미포함)이다. "바꿀 내용"의 줄바꿈은 대상 파일의 줄바꿈(CRLF)으로 정규화한다. A-19 "바꿀 내용"의 `\*`는 기존 인덱스 행들과 같은 표기(백슬래시+별표)다.
> **순서 독립**: 어떤 "바꿀 내용"도 다른 항목의 "찾을 원문"을 새로 만들지 않는다. 같은 줄에 앵커가 둘인 항목은 없다(개발명세서 앵커 줄: 45 · 95 · 144 · 224 · 298 · 300 · 322 · 329 · 330 · 334 · 355 · 392 · 617 · 639 · 730 · 733 · 792 · 821 · 867 — 모두 다름).
> 코드 변경은 이 파일의 범위가 아니다 — 설계서 §21(역할별 체크리스트)을 따른다. **`CLAUDE.md`는 이 패치의 대상이 아니다**(사용자/오케스트레이터 처리).
> 항목 수: 개발명세서 19(A-1~A-19) · 기능요구사항 5(B-1~B-5) · ADR-0024 2(C) · ADR-0027 2(D) · ADR-0026 2(E) · ADR-0046 2(F) · 자동배포 1(G) · 데이터 거버넌스 설계 1(H) · (test-automation 소관·선택) 시험 문서 2(J) · (선택) 요구사항 PM 확정 기록 1(K) = **37건**

---

## A. `docs/02-spec/개발명세서.md`

### A-1. §1 설계 원칙 — "군집분석 = ml-worker" 문장 정정 (45행 · D-2)

**찾을 원문**
````text
음성/멀티모달 등)은 `apps/ml-worker`로 분리**한다.
````
**바꿀 내용**
````text
음성/멀티모달 등)은 `apps/ml-worker`로 분리**한다. **[2026-09-30 No.21] 군집분석은 GPU 등급인 부분(문장 임베딩 추론)만 ml-worker(`/embed` 재사용)이고, 묶기·대표 키워드·챗봇 대조는 CPU 수치 계산이라 `apps/api` 비동기 작업에서 한다 — 벡터가 대조에 어차피 API 메모리에 있어야 하고, 대화 임베딩 프로세스를 점유하지 않기 위해서다(ADR-0047 §1).**
````

### A-2. §2 워크스페이스 상태 표 — `utterance-analysis` 행 추가 (95행 뒤)

**찾을 원문**
````text
선택 환경변수 4**(ADR-0045) |
````
**바꿀 내용**
````text
선택 환경변수 4**(ADR-0045) |
| **`apps/api/src/utterance-analysis`**(+ `packages/shared-types` `utterance-analysis`) | **발화 묶음 분석 Phase에 신설**(No.21 딥러닝 군집분석) — 업로드 발화 파일(엑셀/CSV) → 금지어·PII 마스킹(원본 파일·원문 저장 0) → 문장 분석(ml-worker `/embed` 재사용) → **API 안 구면 k-평균** 묶기(작은 묶음 = 미분류) → 대표 키워드(garu) → 챗봇 대조(대화 기록 0) → (선택) 묶음 이름 제안(ml-worker 생성 프로파일 `/cluster-label`) · 결과 3테이블(마스킹본만 · 기본 90일 뒤 파기 잡이 삭제) · ★3테이블 쓰기 유일 `core/utterance-analysis.store.ts` · ★자산 쓰기 유일 `apply/utterance-apply.service.ts`(`applyLearning()` 1회) · export 0. **`packages/dialogue-engine`·위젯·공개 대화 경로·채널 어댑터 변경 0 · `@Public()` 9 유지 · 신규 권한·역할 0 · 출구 클래스 7 유지 · 선택 환경변수 API 11 + ml-worker 1**(ADR-0047) |
````

### A-3. §2.2 기능그룹별 모듈 배치 — 발화 묶음 분석 행 추가 (144행 뒤)

**찾을 원문**
````text
`apps/widget`(선제 컨트롤러·말풍선) | **설계 완료 → `proactive-messaging-설계.md`** |
````
**바꿀 내용**
````text
`apps/widget`(선제 컨트롤러·말풍선) | **설계 완료 → `proactive-messaging-설계.md`** |
| **발화 묶음 분석 (No.21)** | **`utterance-analysis`(신규 — 13 핸들러(컨트롤러 1) · 업로드 파서(`SheetReader` 재사용 + 내용 기반 형식 판별) · 작업 러너(`TrainingJobQueue` 재사용 · 상태 싱크 3번째 구현) · 임베딩 공급원 교체 지점 · 챗봇 대조(기록 0 · 전역 질의 캐시 0) · ★쓰기 유일 `core/utterance-analysis.store.ts` · ★자산 쓰기 유일 `apply/utterance-apply.service.ts` · ★출구 `naming/cluster-name-http.client.ts`(`AUGMENT_LOCAL`) · 순수 lib(구면 k-평균·후처리·키워드·마스킹 표식·반영 계획·이름 검사) · 품질 측정 도구 · export 0)** + `learning`(`MorphAnalyzerModule` 분리 · 반영 사유 타입 +1) · `chatbots`(동반 삭제 +3) · `governance`(파기 잡 단계·writer 메서드·지도 `utteranceAnalysis?`·기동 검사 1조건) · `audit-logs`(대상 +1·화이트리스트·열람 감사 +1) · `common/egress`(`AUGMENT_LOCAL` 파일 +1) · `versions`(자동 캡처 트리거 +1) · `packages/shared-types`(`utterance-analysis.ts`) · `apps/ml-worker`(`/cluster-label`) | **설계 완료 → `deep-clustering-설계.md`** |
````

### A-4. §2.2 뒤 인용 — 엔진 불가침·모듈 의존 방향(No.21) 추가 (224행 뒤)

**찾을 원문**
````text
거버넌스는 Prisma 읽기(지도)만 한다(ADR-0045 §2·§6).
````
**바꿀 내용**
````text
거버넌스는 Prisma 읽기(지도)만 한다(ADR-0045 §2·§6).
>
> **엔진 불가침(발화 묶음 분석 No.21)**: 이 그룹은 `packages/dialogue-engine`·`apps/widget`·`conversation/**`·채널 어댑터를 **한 줄도 바꾸지 않는다**(FR-0-286). 챗봇 대조는 엔진을 **호출만** 한다(`resolveTurn` 단일 턴 · `assembleSemanticInput`·`judgeBand` · 판정 `judgeAnswered`는 `conversation/lib` 순수 파일 import) — 대화 기록·세션·전역 질의 캐시·RAG·레거시·웹훅 0. 엔진 패키지에 `utteranceAnalysis` 심볼 0을 정적 검사가 단언한다(ADR-0047).
>
> **모듈 의존 방향(No.21)**: `utterance-analysis → chatbots · dialogue-common · embedding · answer-settings · environment/serving · training-jobs · intents(★반영 1파일) · version-capture · banned-words · learning/morph(MorphAnalyzerModule)` 단방향이고 **export는 0개**다. `ConversationModule`·`KeywordsModule`·`FaqsModule`·`DialogNodesModule`·`AugmentationModule`·`ValidationModule`·`RagModule`·`LegacyApiModule`·`WorkflowModule`·`InboxModule`·`TopicsModule`·`LearningModule`·`GovernanceModule`은 import하지 않는다(미응답 수집기·자산 6모듈 쓰기 경로가 DI 그래프에 없다). 거버넌스는 Prisma 읽기(지도) + writer 삭제(파기)만 하고 이 모듈을 import하지 않는다(ADR-0047).
````

### A-5. §3 엔터티 표 — 3행 추가 (298행 뒤)

**찾을 원문**
````text
보존 종류 추가 0 · 영구삭제 동반 삭제 | 35 |
````
**바꿀 내용**
````text
보존 종류 추가 0 · 영구삭제 동반 삭제 | 35 |
| **`UtteranceAnalysis`** | **발화 묶음 분석 1건(No.21 — ADR-0047).** 상태(`QUEUED`·`RUNNING`·`SUCCEEDED`·`FAILED`·`CANCELLED`)·단계·진행률을 **스스로 소유**(`TrainingJob` kind 추가 0 — 상태 싱크 3번째 구현) · 동시 실행 잠금 `activeLock`(nullable `@unique` — 서버 전체 1건 · 원시 부분 인덱스 0) · 파일 이름(마스킹·절단) · 조건·건수 JSON(문장 0) · 임베딩 `modelId`·`algorithmVersion`·형태소 분석기 id · 대조 대상(라이브/운영 버전·기준 점수)·이름 제안 상태 · 요청자(FK 없음) · **`expiresAt`(생성 시 고정 — 기본 90일 · 파기 잡이 삭제)**. 완료 전이는 결과 쓰기와 같은 트랜잭션. 환경 밖 · 스냅샷·복사·토픽 분리·승격 대상 아님 · 쓰기 1파일 · 영구삭제 동반 삭제 | 21 |
| **`UtteranceCluster`** | **분석 결과의 묶음(미분류 포함 · No.21).** 번호(발화 수 내림차순 · 미분류 = 마지막)·대표 키워드 JSON·자동 이름(키워드 3개)·관리자 수정 이름(메모 — 자산 아님)·AI 제안 이름(검사 통과분 · "확인 필요")·발화 수·발생 합·학습 후보·반영 수·대표 발화 순번. 중심점 벡터 저장 0 | 21 |
| **`AnalyzedUtterance`** | **분석 대상 발화 1행(병합 후 고유 문장 · No.21).** **금지어·PII 마스킹본만**(브랜드 타입 강제 · 원문 컬럼 0) · 정규화 문자열(분석 안 유일) · 발생 횟수 · 출처 메모(마스킹) · 금지어·가림 표시 여부 · 중심 유사도 · 챗봇 대조(답함·대상·구간·점수·2단계 표시)·학습 후보 · 추천 의도 JSON · 반영 기록(의도·반영자·시각 — FK 없음) · 분석 안 정렬 순번(페이지 키) | 21 |
````

### A-6. §3 미도입 결정 제목 — 22건 → 23건 (300행)

**찾을 원문**
````text
> **미도입 결정 22건**
````
**바꿀 내용**
````text
> **미도입 결정 23건**
````

### A-7. §3 미도입 결정 ㉓ 추가 (322행 뒤)

**찾을 원문**
````text
서버가 먼저 말 거는 통로·예측은 규모 B·범위 밖(**ADR-0045**).
````
**바꿀 내용**
````text
서버가 먼저 말 거는 통로·예측은 규모 B·범위 밖(**ADR-0045**).
> ㉓ **분석 벡터 저장 테이블·묶음 중심점 저장·원본 업로드 파일 보관·검증 미리보기 스테이징·`TrainingJob` 분석 kind·동시 실행용 원시 부분 유니크 인덱스·보존 종류(`RetentionTargetKind`) 추가·기능 전용 정리 루프·묶음 → 토픽 자동 배정·자동 의도 생성** — 벡터는 작업 메모리에서만 쓰고(재분석 비용이 문제로 확인되면 재검토), 원본 파일은 요청 처리 안에서 마스킹본으로 바뀐 뒤 버린다(미리보기는 파일 재전송). 상태는 분석 행이 소유하고(ADR-0027 갱신① 선례) 동시 실행은 nullable 유일 `activeLock`(원시 부분 유니크 4종 개수 불변). 보존은 기능 일수 + 행 만료 시각 고정 + 기존 파기 잡 단계("키 없음 = 무기한" 규약 보존). 묶음은 의도 정의가 아니라 제안이다(**ADR-0047**).
````

### A-8. §3.1 참조 무결성 예외 — No.21 FK 규약 추가 (329행 끝)

**찾을 원문**
````text
실행·작업은 소스가 지워져도 남는 사실 기록(이름 스냅샷 동반)이다(ADR-0044).**
````
**바꿀 내용**
````text
실행·작업은 소스가 지워져도 남는 사실 기록(이름 스냅샷 동반)이다(ADR-0044).** **[No.21] `UtteranceAnalysis → Chatbot`·`UtteranceCluster → UtteranceAnalysis`·`AnalyzedUtterance → UtteranceAnalysis·UtteranceCluster`는 `Restrict`(삭제는 발화 → 묶음 → 분석 순서 명시)이고, `UtteranceAnalysis`의 `requestedById`/`probeVersionId`와 `AnalyzedUtterance`의 `probeMatchId`/`appliedIntentId`/`appliedById`·추천 의도 JSON의 의도 id는 FK를 걸지 않는다 — 대조·반영은 의도·버전이 지워져도 남는 사실 기록이다(이름 스냅샷 동반 — ADR-0047).**
````

### A-9. §3.1 파생 데이터 동반 삭제 — No.35 누락 보정(D-3) + No.21 (330행 끝)

**찾을 원문**
````text
동반 삭제 24테이블·사전검사 16종 불변(ADR-0044).**
````
**바꿀 내용**
````text
동반 삭제 24테이블·사전검사 16종 불변(ADR-0044).** **[정정 2026-09-30] No.35 선제 안내 3테이블(`ChatbotProactiveSetting`·`ProactiveRule`·`ProactiveDailyStat` — 설정·파생 데이터)이 동반 삭제에 들어가 24 → 27테이블이 됐다(ADR-0045 — 이 절 미반영분 보정).** **[No.21] 발화 묶음 분석 3테이블(`AnalyzedUtterance → UtteranceCluster → UtteranceAnalysis` 순)은 파생 데이터라 동반 삭제다(27 → 30테이블). 업로드된 외부 발화는 챗봇 대화 기록(통계 원천)이 아니므로 사전검사(409) 대상이 아니며, 사전검사 16종은 불변이다(ADR-0002 갱신 각주, ADR-0047).**
````

### A-10. §3.1 인덱스 — No.21 추가 (334행 끝)

**찾을 원문**
````text
두 번째 이후 KB 마이그레이션은 봉인 KB-14b가 `ADD COLUMN`·`CREATE INDEX`만 허용한다.**
````
**바꿀 내용**
````text
두 번째 이후 KB 마이그레이션은 봉인 KB-14b가 `ADD COLUMN`·`CREATE INDEX`만 허용한다.** **[No.21] `utterance_analyses(chatbotId, createdAt)`(목록)·`(expiresAt, status)`(파기)·`(activeLock)` 유일(nullable — 서버 전체 동시 실행 1건) · `utterance_clusters(analysisId, ordinal)` 유일 · `analyzed_utterances(analysisId, seq)` 유일(페이지)·`(analysisId, textNormalized)` 유일(병합 키)·`(analysisId, clusterId, seq)`(묶음 필터)·`(analysisId, learningCandidate, seq)`(후보 필터)·`(clusterId)`(FK 검사). 문장 컬럼에는 인덱스를 두지 않는다(검색은 분석 1건 안 부분 일치). 마이그레이션은 `CREATE TABLE` 3 + `CREATE INDEX`뿐이라 원시 부분 유니크 4개가 보존된다(생성된 SQL에 `DROP INDEX`가 끼면 제거 · 적용 후 `sqlite_master` 4행 확인 — ADR-0047).**
````

### A-11. §4 AI 엔진 행 — "No.21 미구현" 정정 + 발화 묶음 분석 행 신설 (355행)

**찾을 원문**
````text
No.21(군집분석)은 여전히 미구현 | 16, 21, 23 |
````
**바꿀 내용**
````text
**[2026-09-30 No.21]** ml-worker 생성 프로파일에 선택 경로 `POST /cluster-label`(묶음 이름 제안 — `{ keywords, samples(마스킹 ≤5), locale }` → `{ modelId, label｜null }`)이 추가됐다(임베딩 프로파일에는 없음 · 관리자 콘솔에 직접 노출되지 않음 · API는 `AUGMENT_LOCAL` 출구로만 호출). 군집분석의 관리 API는 아래 "발화 묶음 분석" 행 | 16, 21, 23 |
| **발화 묶음 분석(딥러닝 군집분석)** | **`/chatbots/:chatbotId/utterance-analyses` — `GET …/template?format=xlsx｜csv` · `GET …/capability` · `POST …/preview`(multipart · 저장 0)(⚠ 셋 다 `:analysisId`보다 먼저 선언) · `POST …`(multipart 파일 + `conditions` → **`202 { analysisId, status }`** · 서버 전체 동시 1건 `409 UTTERANCE_ANALYSIS_BUSY` · 챗봇당 보관 상한 `409 UTTERANCE_ANALYSIS_STORE_FULL` · 발화 부족 `400 UTTERANCE_ANALYSIS_TOO_FEW`) · `GET …`(목록) · `GET …/:analysisId`(상세 + 묶음 — 폴링) · `GET …/:analysisId/utterances`(필터·검색·페이지 ≤100 · 거버넌스 모드 `VIEW` 감사) · `PATCH …/:analysisId/clusters/:clusterId`(이름 메모) · `GET …/:analysisId/export`(엑셀 2시트 · `EXPORT` 감사) · `POST …/:analysisId/apply/preview`(DB 변경 0) · `POST …/:analysisId/apply`(선택 발화 ≤50 → 기존 의도 예문 반영 경로 · `applyLearning()` 1회 · 부분 성공) · `POST …/:analysisId/cancel` · `DELETE …/:analysisId`** — 조회·다운로드 `dialogue:read` / 요청·수정·반영·취소·삭제 `dialogue:write`(신규 권한 0). 총 13개 핸들러 · `UTTERANCE_ANALYSIS_ENABLED=false`면 전부 `404` · 신규 `ApiErrorCode` 3종 · **`@Public()` 추가 0건 · 공개 대화 요청·응답 스키마 불변** | 21 |
````

### A-12. §4 정정 이력 — 2026-09-30 발화 묶음 분석 추가 (392행 뒤)

**찾을 원문**
````text
신규 `ApiErrorCode` 0종(`proactive-messaging-설계.md` §9).
````
**바꿀 내용**
````text
신규 `ApiErrorCode` 0종(`proactive-messaging-설계.md` §9).
> **정정 이력(2026-09-30 — 발화 묶음 분석)**: ① **발화 묶음 분석 행을 신설**했다 — 분석은 대조·반영 대상 챗봇이 있는 **챗봇 스코프 자원**(`/chatbots/:chatbotId/utterance-analyses/*`)이다(원본 ROCHA는 전역 메뉴 + 챗봇 선택이지만 교차 챗봇 404 규약을 따른다). ② 작업 생성은 도메인 경로의 `202`이고 상태 조회는 분석 상세 폴링 1경로다(`/training-jobs`를 쓰지 않는다 — 상태를 분석 행이 소유). ③ 검증 미리보기는 저장하지 않고 요청 때 파일을 다시 받는다(원본 서버 보관 0). ④ AI 엔진 행에 ml-worker 선택 경로 `/cluster-label`을 적었다. 신규 `ApiErrorCode` 3종 · 공개 경로 9곳 그대로(`deep-clustering-설계.md` §12).
````

### A-13. §5.1 환경변수 — 6개 행(키 12개) 추가 (617행 뒤)

**찾을 원문**
````text
세션 키 버킷(`pa-ev-key:session:{sessionId}` — 본문 키) |
````
**바꿀 내용**
````text
세션 키 버킷(`pa-ev-key:session:{sessionId}` — 본문 키) |
| **`UTTERANCE_ANALYSIS_ENABLED`** | `apps/api/.env` | — | `true` | 발화 묶음 분석 스위치(No.21 — `false`면 관리 API 13개 `404` · 콘솔 메뉴 숨김) |
| **`UTTERANCE_ANALYSIS_MAX_ROWS`** · **`UTTERANCE_ANALYSIS_MAX_CHARS`** | `apps/api/.env` | — | `5000` · `300` | 파일 행 상한(머리글 제외 · 빈 행 포함 · 100~20000 — 상향은 운영 실측 후) · 발화 길이 상한(마스킹 후 · 50~1000). 파일 크기는 `IMPORT_LIMITS`(5MB) |
| **`UTTERANCE_ANALYSIS_RETENTION_DAYS`** · **`UTTERANCE_ANALYSIS_MAX_STORED_PER_CHATBOT`** | `apps/api/.env` | — | `90` · `20` | 새 분석의 보존 일수(1~3650 — 생성 시 만료 시각 고정 · 삭제는 No.45 파기 잡) · 챗봇당 보관 분석 수(1~200 — 초과 시 새 요청 409, 자동 삭제 아님) |
| **`UTTERANCE_ANALYSIS_EMBED_BATCH_SIZE`** · **`UTTERANCE_ANALYSIS_EMBED_PAUSE_MS`** · **`UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO`** | `apps/api/.env` | — | `16` · `100` · `1.0` | 분석 임베딩 배치(1~64) · 배치 사이 최소 휴식 · 배치 소요 × 비율만큼 휴식(1.0 = ml-worker 시간 최대 절반 — 대화 임베딩 보호) |
| **`UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED`** · **`UTTERANCE_ANALYSIS_NAME_SUGGEST_TIMEOUT_MS`** · **`UTTERANCE_ANALYSIS_NAME_SUGGEST_BUDGET_MS`** | `apps/api/.env` | — | `false` · `30000` · `300000` | 묶음 이름 제안(LLM 보조 — `AUGMENTATION_LOCAL_BASE_URL`의 ml-worker 생성 프로파일 `/cluster-label`) 허용 · 1회 시간 제한 · 단계 전체 예산 |
| **`CLUSTER_LABEL_MAX_NEW_TOKENS`** | `apps/ml-worker/.env` | — | `64` | `/cluster-label` 최대 생성 토큰(생성 프로파일에서만 사용) |
````

### A-14. §5.1 그룹별 환경변수 메모 — No.21 추가 (639행 뒤)

**찾을 원문**
````text
seed는 변경하지 않는다(켜진 예시 규칙은 데모 사이트에 말풍선을 띄운다).
````
**바꿀 내용**
````text
seed는 변경하지 않는다(켜진 예시 규칙은 데모 사이트에 말풍선을 띄운다).
> **발화 묶음 분석 그룹(No.21)이 추가한 12개(API 11 + ml-worker 1)도 전부 선택이다.** 하나도 설정하지 않으면 기능 사용 가능(분석 0건 = 관측 변화 없음 — `EMBEDDING_BASE_URL`이 없으면 요청이 `503`) · 파일 5,000행 · 발화 300자 · 보존 90일 · 챗봇당 20건 · 배치 16 · 휴식 100ms·비율 1.0 · **이름 제안 꺼짐**으로 동작한다. 보존 일수는 **새 분석부터** 적용된다(생성 시 만료 시각 고정) — 자동 삭제는 No.45 파기 잡이 실행하므로 `DATA_RETENTION_JOB_ENABLED=false`인 설치는 자동 삭제가 일어나지 않는다(데이터 지도가 경고). 거버넌스 모드에서 이름 제안을 켜면 `AUGMENTATION_LOCAL_BASE_URL` 호스트가 허용 목록에 있어야 기동한다. boolean은 `envBoolean()` · 새 백그라운드 루프가 없어 `jest.isolate-env.js` 변경 0. 알고리즘 상수(시드·시도 횟수·반복 상한)는 환경변수가 아니라 코드 상수 + 결과 행의 `algorithmVersion`이다. seed는 변경하지 않는다(가짜 개인정보성 분석을 만들지 않는다).
````

### A-15. §6 결정 29(ADR-0024) — No.21 판정 각주 (730행 끝)

**찾을 원문**
````text
장비 등급표는 `자동배포.md` §5.8(ADR-0024 갱신 각주, ADR-0046 §1·§2·§6).
````
**바꿀 내용**
````text
장비 등급표는 `자동배포.md` §5.8(ADR-0024 갱신 각주, ADR-0046 §1·§2·§6).
    - **갱신(2026-09-30b — No.21 판정)**: 결정 29 ③이 남긴 "No.21(군집분석) 트리거 판정은 착수 시 다시"를 항목별로 판정했다 — ① **모델 학습(파인튜닝) 0**(군집은 요청 안의 일시 수치 계산 · 중심점 비저장) ② **벡터화 = ml-worker `/embed` 재사용**(계약 불변) ③ **묶기·키워드·대조 = `apps/api` 비동기 작업 CPU**(벡터가 대조에 어차피 API에 있고, 대화 임베딩 프로세스를 점유하지 않는다) ④ `TrainingJob`·Redis 확장 없음 ⑤ GPU **7 → 5 + 각주**. ml-worker 역할 정의는 그대로이며 생성 프로파일에 **선택 경로 `POST /cluster-label`**(묶음 이름 제안 — 기본 꺼짐)만 더했다(DB·파인튜닝 0 · `/augment` 계약 불변). `scikit-learn`은 venv에 간접 의존성으로 있으나 제품 경로에서 쓰지 않는다(ADR-0024 갱신 각주, ADR-0047 §1·§2·§7).
````

### A-16. §6 결정 30(ADR-0026) — `packages/llm-provider` 승격 판정 각주 (733행 끝)

**찾을 원문**
````text
`packages/llm-provider` 승격 트리거 미발동(ADR-0026 갱신 각주, ADR-0046 §2~§5).
````
**바꿀 내용**
````text
`packages/llm-provider` 승격 트리거 미발동(ADR-0026 갱신 각주, ADR-0046 §2~§5).
    - **갱신(2026-09-30b — No.21)**: 묶음 이름 제안이 **두 번째 LLM 호출 소비자**가 되어 `packages/llm-provider` 승격 트리거가 문자 그대로 발동했으나 **승격하지 않는다** — 두 소비자는 입출력 계약(예문 N개 vs 이름 1개)과 배포 형태(증강 rule·gemini·local vs 이름 local만 · cloud 금지)가 달라 공유할 추상화가 없다. 이름 제안 포트(`ClusterNameSuggester` — local·mock)는 Nest·Prisma 무의존 파일로 두고, 트리거를 "같은 생성 연산(같은 계약)을 쓰는 두 번째 소비자 또는 cloud 구현이 필요한 두 번째 소비자"로 정밀화한다. 증강 포트·팩토리·출구 클래스 불변 · 이름 제안 호출 파일은 `AUGMENT_LOCAL` 레지스트리에 추가(ADR-0026 갱신 각주, ADR-0047 §8).
````

### A-17. §6 — 결정 48 신설 (792행 뒤)

**찾을 원문**
````text
→ **ADR-0046**(+ ADR-0024·0026 갱신 각주)
````
**바꿀 내용**
````text
→ **ADR-0046**(+ ADR-0024·0026 갱신 각주)
48. **딥러닝 군집분석 = 발화 묶음 분석(No.21)의 입력·규모·군집 위치·알고리즘·상태·동시 실행·보존·반영·이름 제안·승격 판정 확정(2026-09-30 — 사용자 확정: P-1 (a) 엑셀/CSV 발화 파일 · P-2/P-3 (A)+(b) 선택 반영 · P-4 (b) 이름 제안 보조·기본 꺼짐 · P-5 (a) 개발 PC 품질 판정 · P-6 (a) 마스킹본·원본 0·90일 · 나머지 권고안)**: **① 입력 = 이미 글자로 된 발화 목록(엑셀 첫 시트·CSV UTF-8 · 5MB · 파일 5,000행 · 발화 300자)** — 음성 인식(No.32)·외부 시스템 자동 수집(No.39)·운영 대화 기록(규모 B)·자동 의도 생성은 범위 밖. 형식은 내용으로 판별(ZIP 서명) · 요청 처리 안에서 **금지어 → PII 마스킹** 후 마스킹본 기준 병합 · **원본 파일·원문 저장 0**(브랜드 타입 `MaskedText` — 마스킹을 건너뛴 저장 코드는 컴파일되지 않는다) · 검증 미리보기 저장 0(파일 재전송). **② 벡터화 = ml-worker `/embed` 재사용(배치 16 · 적응형 양보로 ml-worker 시간 최대 절반 · 전역 질의 캐시·대화 기록 0) · 군집 = `apps/api` 안 구면 k-평균**(k = 목표 묶음 수 · k-means++ 시드 고정 · 3회 시도 · 입력 정규화 문자열 정렬 · 조각 양보 — 새 의존성 0 · 측정 도구가 같은 함수 호출). HDBSCAN(venv에 scikit-learn 1.7.2 간접 설치 확인)은 고차원 원공간 한계·UMAP 새 의존성 4종 때문에 제품 제외 — 측정 기준선만. 최소 발화 수 미만 묶음 = 미분류(원본 "토픽 −1") · 번호 = 발화 수 내림차순 · 대표 발화 3 · 대표 키워드 = garu 명사(기본) c-TF-IDF(고유 발화 기준). **③ 상태 = `UtteranceAnalysis` 자체 소유**(`TrainingJobQueue` 재사용 · 상태 싱크 3번째 구현 · `TrainingJob` kind 추가 0 — ADR-0027 갱신①) · 완료 전이 = 결과 쓰기와 같은 트랜잭션 · 취소(커밋 전만) · 재시작 = `FAILED(SERVER_RESTART)`. **④ 동시 실행 = 서버 전체 1건 — nullable 유일 `activeLock`**(원시 부분 인덱스 0). **⑤ 챗봇 대조 = No.19 규약·부품 재사용**(실행기 클래스는 무수정) — 대상 "서비스 중(환경 모드면 운영 버전)"(기본)·"초안" · 단일 턴 `resolveTurn` · 판정 `judgeAnswered` · 학습 후보 = 답하지 못함 ∨ 점수 < 기준(기본 챗봇 확정 임계값) · RAG·레거시·웹훅 호출 0(표시만) · 추천 의도 = 의미 순위 상위. **⑥ 반영 = `apply/utterance-apply.service.ts` 1파일** — 선택 ≤50 · 미리보기(DB 0) → 확정 · 제외 7사유(없음·이미 반영·금지어·200자·대상 중복·**다른 의도에 이미 있음**·500 초과) · 자동 스냅샷 `BEFORE_UTTERANCE_APPLY` · `applyLearningExample()` 건별 → `applyLearning({ reason: 'UTTERANCE_ANALYSIS_APPLY' })` 1회 · 부분 성공 명시 · 환경 모드는 초안만 · 새 의도는 공통. **⑦ 보존 = 기능 일수(`UTTERANCE_ANALYSIS_RETENTION_DAYS` 90) + 생성 시 `expiresAt` 고정 + No.45 파기 잡 단계 1개**(보존 종류 추가 0 — "키 없음 = 무기한" 규약 보존 · secure_delete · 분석 0건이면 결과·감사 바이트 동일) · 수동 삭제 · 영구삭제 동반 삭제(27 → 30). **⑧ 거버넌스** — 출구 클래스 7 불변(`EMBEDDING` · 이름 제안은 `AUGMENT_LOCAL`에 파일 추가) · 요청 시 출구 사전 판정 · 감사 대상 +1(`UtteranceAnalysis` — 요청 CREATE · 반영 UPDATE · 삭제 DELETE · `EXPORT` · 거버넌스 모드 발화 목록 `VIEW`) · 데이터 지도 선택 키. **⑨ 이름 제안 = ml-worker 생성 프로파일 선택 경로 `/cluster-label`**(No.37 백엔드·주소 통제·시간 제한 재사용 · 키워드 + 마스킹 대표 발화 ≤5 · 실패는 키워드 이름으로 수렴 · 출력 7검사) · **`packages/llm-provider` 승격 트리거 발동·미승격**(공유 계약 없음 — 트리거 정밀화). **⑩ 권한 신규 0**(`dialogue:read｜write`) · 화면 용어 "묶음"(No.22 토픽과 구분). GPU **7 → 5 + 각주** · 구독형 △ + 개인정보 밀도 각주. 품질 합격 = 개발 PC 측정(잠정 순도 0.80·ARI 0.50 — 첫 보고서 후 확정) · 처리 시간 5,000건 10분·이름 제안은 운영 실측 전제(3050 = 동작 확인). 의도된 기존 시험 기대값 변경 4건. 기존 결함 발견: ml-worker venv가 `pyproject.toml` 범위를 벗어남(D-1 — 인계) · §3.1 동반 삭제 수치 미반영(D-3 — 이번 패치로 정정). → **ADR-0047**(+ ADR-0024·0026·0027·0046 갱신 각주)
````

### A-18. §7 인덱스 — 설계서 행 추가 (821행 뒤)

**찾을 원문**
````text
요구사항 대비 해석·조정 12** | 요구사항: `docs/requirements/edge-inference.md` |
````
**바꿀 내용**
````text
요구사항 대비 해석·조정 12** | 요구사항: `docs/requirements/edge-inference.md` |
| **`deep-clustering-설계.md`** | **딥러닝 군집분석 = 발화 묶음 분석(No.21) — 사용자 확정(엑셀/CSV · 규모 A · 선택 반영 · 이름 제안 보조 · 개발 PC 품질 판정 · 마스킹본 90일) · 코드에서 찾은 제약 12(scikit-learn 간접 설치·venv 범위 이탈 · 싱크 포트 · 큐 비직렬 · 실행기 결합 · 반영 1건씩·중복 경고 · 봉인 수치 2 · 보존 기본값 규약 · 형태소 분석기 비공유 · `judgeAnswered` 순수 · 임베딩 없음 = 성립 불가) · ★군집 위치 재판정(API) · ★알고리즘(구면 k-평균 · 의존성 실측 · HDBSCAN 기각) · 대표 키워드(c-TF-IDF) · 업로드·마스킹·병합 · 작업 상태·동시 실행·취소·재시작 · 적응형 양보 · 챗봇 대조 · 데이터 모델(3테이블 · 마이그레이션 `CREATE`만) · shared-types · API 13 · 권한·감사·출구·지도 · 보존(기능 일수 + 파기 잡) · ★반영 경로 · 이름 제안(ml-worker `/cluster-label` · 승격 판정) · 화면 3 정보구조 · 설정 12 · 성능 예산·대화 격리 · 시험 전략·품질 측정 도구·**의도된 기대값 변경 4건**·AC↔시험 · 역할별 체크리스트 · 알려진 제한 14 · 해석·조정 22 · 기존 결함 4** | 요구사항: `docs/requirements/deep-clustering.md` |
````

### A-19. §7 인덱스 — ADR-0047 행 추가 (867행 뒤)

**찾을 원문**
````text
AC-ED1~ED5 |
````
**바꿀 내용**
````text
AC-ED1~ED5 |
| **`decisions/ADR-0047-utterance-clustering-in-api-spherical-kmeans-own-status-table-feature-retention-and-single-apply-path.md`** | **발화 묶음 분석 = 벡터화만 ml-worker `/embed` · 군집·키워드·대조는 `apps/api` CPU(ml-worker `/cluster`·별도 분석 프로세스 기각) · 구면 k-평균 시드 고정(HDBSCAN+UMAP·계층 군집 기각) · 상태 자체 소유(`TrainingJob` kind 기각) · 동시 실행 nullable 유일(원시 부분 인덱스 기각) · 보존 = 기능 일수 + `expiresAt` 고정 + 기존 파기 잡(보존 종류 추가·전용 루프 기각) · 반영 경로 1파일 · 건별 부분 성공(전체 롤백 기각) · "다른 의도에 이미 있음" 제외 · 이름 제안 = 생성 프로파일 `/cluster-label`(`/augment` 재사용·API 직접 호출 기각) · `packages/llm-provider` 트리거 발동·미승격 · 신규 권한 0** | 요구사항 J-1~J-12, FR-0-286~297, FR-DC1-\*~FR-DC9-\*, AC-DC1~DC7 |
````

---

## B. `docs/01-requirements/기능요구사항.md`

### B-1. 47행 No.15 비고 — "19번" 오기 정정

**찾을 원문**
````text
**19번 "딥러닝 군집분석"과는 별개 기능**
````
**바꿀 내용**
````text
**21번 "딥러닝 군집분석"과는 별개 기능**(2026-09-30 오기 정정 — 구 표기 "19번")
````

### B-2. 58행 No.21 — GPU 7 → 5 · 사유 · 비고(설계 완료)

**찾을 원문**
````text
| 7 | 비지도 클러스터링 대량 배치, GPU 권장 | ○ | △ | 대량 처리 시 온프레미스 배치 서버 유리 |
````
**바꿀 내용**
````text
| 5 | 임베딩 배치 추론 + CPU 군집(모델 학습 없음), 대량 시 GPU 권장 | ○ | △ | 대량 처리 시 온프레미스 배치 서버 유리 **[2026-09-30 No.21 설계 완료 — ADR-0047] STT/TA = 이미 글자로 된 발화 파일(엑셀/CSV — 원본 매뉴얼 p.98~102). 업로드 → 금지어·PII 마스킹(마스킹본만 저장 · 원본 파일 저장 0 · 90일 자동 삭제(설정)) → 기존 임베딩(KURE-v1 · ml-worker `/embed`)으로 문장 분석 → API 안 구면 k-평균으로 "묶음"(작은 묶음 = 미분류) → 묶음별 대표 키워드(형태소 분석) → 챗봇 대조(답함/못함·점수 · 대화 기록 0) → 조회·엑셀 다운로드 + 관리자가 고른 발화만 확인 화면을 거쳐 의도 예문 반영(기존 반영 경로 · 자동 반영 없음). LLM은 묶음 이름 제안 보조(서버 설정 · 기본 꺼짐 · 꺼져도 기능 성립). 음성 인식(No.32)·외부 시스템 자동 수집(No.39)·운영 대화 기록 입력(규모 B)·자동 의도 생성은 범위 밖. 화면 용어 "묶음"(No.22 토픽과 구분) · GPU 7 → 5(각주: 기본 구성은 CPU로 성립 — 임베딩 추론 + 수치 군집, 모델 학습 없음 · 수만 건 이상은 GPU 임베딩 권장 · 이름 제안을 켜면 No.37 장비 등급표) · 구독형 △(각주: 상담 전사본의 개인정보 밀도 — 벤더 클라우드 업로드 부담)** |
````

### B-3. 21행 GPU 기준표 5~6 구간 예시 — 딥러닝 군집분석 편입

**찾을 원문**
````text
| 5~6 | 중간 딥러닝(GPU 권장) — 임베딩/증강학습 | Text Embedding, DLE 증강학습 |
````
**바꿀 내용**
````text
| 5~6 | 중간 딥러닝(GPU 권장) — 임베딩/증강학습 | Text Embedding, DLE 증강학습, 딥러닝 군집분석(2026-09-30 7 → 5) |
````

### B-4. 22행 GPU 기준표 7~8 구간 예시 — 딥러닝 군집분석 제거

**찾을 원문**
````text
| 7~8 | LLM/비전 모델(GPU 필수) | 생성형AI+RAG, 딥러닝 군집분석 |
````
**바꿀 내용**
````text
| 7~8 | LLM/비전 모델(GPU 필수) | 생성형AI+RAG |
````

### B-5. §5 교차검증 메모 — 카탈로그 누락 2건 기록 (P-11 · 116행 뒤)

**찾을 원문**
````text
- 간단학습매뉴얼은 매뉴얼 04장(챗봇제작)과 거의 동일해 신규 발견 기능 없음
````
**바꿀 내용**
````text
- 간단학습매뉴얼은 매뉴얼 04장(챗봇제작)과 거의 동일해 신규 발견 기능 없음
- **[2026-09-30 No.21 요구사항 재대조] 카탈로그 누락 2건**: ① 원본 매뉴얼 p.61~62 **"통계 > 군집분석"**(챗봇 대화 기록의 응답/미응답 질문을 고빈도 키워드로 묶고 워드클라우드·질문 목록에서 "의도등록") — 47종 어디에도 없다. 원본의 "딥러닝 군집분석"(p.98~102 — 업로드 엑셀 · No.21)과 **다른 화면**이다. 처리 방향: 번호를 새로 두지 않고 **No.21 규모 B(내부 대화 기록을 입력 소스로 — 임베딩 방식이 키워드 방식의 상위 호환)** 로 흡수한다(재검토 트리거 = 규모 B 요청). ② 대시보드 p.8·학습현황 p.59의 **"많이 사용한 단어"**(형태소 빈도 조회) — No.2·15 구현에 없다. 처리 방향: **No.14/15 고도화 후보**로 연결(형태소 분석기·불용어는 No.23에 이미 있음). 근거 `docs/requirements/deep-clustering.md` §1.3
````

---

## C. `docs/02-spec/decisions/ADR-0024-ml-worker-scope-and-runtime.md`

### C-1. 재검토 트리거(114행) — No.21 판정 완료 표시

**찾을 원문**
````text
(No.21은 미판정 — 착수 시 다시 판정한다).
````
**바꿀 내용**
````text
(No.21은 미판정 — 착수 시 다시 판정한다). → **2026-09-30 판정 완료(No.21 — ADR-0047): 학습 기능 추가 0(군집은 일시 수치 계산) · 벡터화 = `/embed` 재사용 · 군집·키워드·대조 = `apps/api` · `TrainingJob` 확장 0 · GPU 7 → 5. 아래 §갱신(2026-09-30b).**
````

### C-2. 문서 끝 — §갱신(2026-09-30b) 추가 (190행 뒤)

**찾을 원문**
````text
4. **재검토 트리거 "음성·비전 착수 시 내부 구조 재결정"은 이번에도 발동하지 않는다** — 생성 백엔드 추가는 생성 프로파일 안의 구현 선택이다.
````
**바꿀 내용**
````text
4. **재검토 트리거 "음성·비전 착수 시 내부 구조 재결정"은 이번에도 발동하지 않는다** — 생성 백엔드 추가는 생성 프로파일 안의 구현 선택이다.

---

## 갱신 (2026-09-30b — No.21: 군집분석 착수 판정 · 생성 프로파일 선택 경로 `/cluster-label`)

발화 묶음 분석(No.21 딥러닝 군집분석, **ADR-0047**). §갱신 1의 "모델 파인튜닝 없음"과 §갱신 4 "건드리지 않는 것" 전부(`/embed`·`/health` 계약 · DB 무접근 · Python 없이 API 전 시험 통과 · `packages/llm-provider` 미생성)는 **불변**이다.

1. **재검토 트리거 "No.21 착수 → 학습 기능 추가, Job Queue·`TrainingJob` 도입, GPU 필요도 5 복귀"의 항목별 판정**: ① **학습 기능 추가 0** — 군집은 이번 요청의 벡터 위에서 끝나는 일시 수치 계산이고 중심점을 저장하지 않는다(모델 가중치 갱신 0). ② **벡터화 = `/embed` 재사용**(계약 불변) — 분석 임베딩은 대화와 같은 프로세스를 쓰되 서버 1건·배치 16·적응형 양보(ml-worker 시간 최대 절반)로 대화 300ms 예산을 보호한다(효과는 운영 부하 게이트로 확인). ③ **묶기·대표 키워드·챗봇 대조 = `apps/api`** — 벡터가 대조에 어차피 API에 있어야 하고(20MB 재왕복 회피), 대화 `/embed`와 같은 스레드 풀·BLAS 스레드를 점유하지 않는다. ④ `TrainingJob`·Redis 확장 없음(상태는 분석 행이 소유 — ADR-0027 갱신①). ⑤ **GPU 7 → 5**(임베딩 추론 + CPU 군집 · 대량은 GPU 임베딩 권장).
2. **ml-worker 역할 정의 불변 · 생성 프로파일에 선택 경로 1개**: `POST /cluster-label`(묶음 이름 제안 — `{ keywords, samples(마스킹 ≤5), locale }` → `{ modelId, label｜null }`)은 `ML_WORKER_ROLE=augment｜both`에서만 존재한다(기본 `embed`에서는 404 — `/augment`와 같은 규약). 생성 백엔드·주소 통제·시간 제한은 ADR-0046 그대로이며 `/augment` 계약·`build_prompt`는 불변이다. 따라서 §갱신 1의 HTTP 계약 표는 "선택적 `POST /augment`·`GET /augment/health` **+ `POST /cluster-label`**"이 된다.
3. **의존성**: venv에 `scikit-learn` 1.7.2가 `sentence-transformers`의 간접 의존성으로 이미 있지만 **제품 경로에서 쓰지 않는다**(선언 추가 0 — 선택 평가 스크립트만 `eval` 추가 묶음으로 명시 권고). venv가 `pyproject.toml` 범위를 벗어난 기존 결함(D-1)은 별도 인계.
4. **재검토 트리거 "음성·비전 착수 시 내부 구조 재결정"은 이번에도 발동하지 않는다** — 새 경로는 생성 프로파일 안의 선택 기능이다.
````

---

## D. `docs/02-spec/decisions/ADR-0027-intent-classifier-and-training-job.md`

### D-1. 재검토 트리거(148행) — No.21 판정 완료 표시

**찾을 원문**
````text
이 ADR의 결론이 자동으로 상속되지 않는다.
````
**바꿀 내용**
````text
이 ADR의 결론이 자동으로 상속되지 않는다. → **2026-09-30 판정 완료(ADR-0047)**: 군집(비지도 묶기)은 **`apps/api` 안 CPU**(입력 벡터가 챗봇 대조에 어차피 API에 있다 — 이 ADR 근거 1 "학습 입력이 있는 곳에서 학습한다"의 재적용) · 벡터화만 ml-worker · 모델 학습 0 · `TrainingJob` kind 추가 0(상태는 분석 행이 소유). 아래 §갱신(2026-09-30).
````

### D-2. 문서 끝 — §갱신(2026-09-30) 추가 (187행 뒤)

**찾을 원문**
````text
예약 엔진은 관리자가 미리보기로 승인한 반영 동작만 실행한다.
````
**바꿀 내용**
````text
예약 엔진은 관리자가 미리보기로 승인한 반영 동작만 실행한다.

---

## 갱신 (2026-09-30 — No.21: 군집 위치 재판정 · 큐의 네 번째 소비자 · 상태 싱크 세 번째 구현)

발화 묶음 분석(No.21, **ADR-0047**). **이 ADR의 결정(단일 인스턴스 in-process 큐 · Redis/BullMQ 미도입 · 교체 지점 1곳 · 기동 시 고아 정리)은 불변**이다.

1. **학습 위치 재판정(재검토 트리거 "No.21 착수")**: 군집은 모델 학습이 아니라 요청 안의 일시 수치 계산이며 **`apps/api` 안 CPU**에서 한다 — 입력 벡터가 챗봇 대조(의미 매칭 점수)에 어차피 API 메모리에 있어야 하므로 근거 1("학습 입력이 있는 곳에서 학습한다")이 그대로 적용된다. ml-worker는 벡터화(`/embed`)만 한다. 계산은 조각(256점)마다 이벤트 루프를 양보한다(로지스틱 회귀 선례).
2. **`TrainingJob`에 분석 kind를 추가하지 않는다**(갱신① "Training이 아닌 작업은 넣지 않는다"의 두 번째 적용). `UtteranceAnalysis`가 상태를 소유하고 `AsyncJobStatusSink`의 **세 번째 구현**(`UtteranceAnalysisStatusSink`)이 큐와 연결한다 — 기존 호출부 무변경. 결과와 상태가 한 행에 있어 **완료 전이 = 결과 쓰기 한 트랜잭션**이 된다(싱크의 완료 기록은 `RUNNING` CAS라 이미 완료된 행에는 무해).
3. **큐는 직렬화하지 않으므로** 분석 동시 실행(서버 전체 1건)은 큐가 아니라 **DB 제약**(nullable `@unique activeLock`)으로 막는다. 기동 시 고아 정리(`QUEUED｜RUNNING → FAILED(SERVER_RESTART)` + 잠금 해제)는 같은 시점·같은 방식이며, 다중 인스턴스 전환 시 임대 방식 교체 대상(갱신 2026-09-23 ②)에 포함된다.
4. **분류기는 이 기능의 추천 의도에 쓰지 않는다** — 벡터가 이미 있어 의미 순위 상위 의도가 비용 0이고, 분류기 예측은 임베딩을 다시 부른다. 분류기 재학습 트리거 0(자동 재학습 기각 불변).
````

---

## E. `docs/02-spec/decisions/ADR-0026-augmentation-provider-three-ports.md`

### E-1. 재검토 트리거(150행) — 발동·미승격 표시

**찾을 원문**
````text
- **LLM 호출 소비자가 2곳 이상** → `packages/llm-provider` 승격.
````
**바꿀 내용**
````text
- **LLM 호출 소비자가 2곳 이상** → `packages/llm-provider` 승격. → ⚠ **2026-09-30 갱신(No.21)**: 묶음 이름 제안으로 소비자가 2곳이 됐으나 **승격하지 않았다**(공유 계약 없음) — 트리거를 "**같은 생성 연산(같은 계약)을 쓰는 두 번째 소비자, 또는 cloud 구현이 필요한 두 번째 소비자**"로 정밀화한다. 아래 §갱신(2026-09-30b).
````

### E-2. 문서 끝 — §갱신(2026-09-30b) 추가 (184행 뒤)

**찾을 원문**
````text
백엔드가 늘어도 LLM 소비자는 증강 1곳이다.
````
**바꿀 내용**
````text
백엔드가 늘어도 LLM 소비자는 증강 1곳이다.

---

## 갱신 (2026-09-30b — No.21: 두 번째 LLM 소비자 · 승격 트리거 발동 판정 · 미승격)

발화 묶음 분석(No.21, **ADR-0047 §7·§8**). 포트 1 + 구현 3종·팩토리 1곳·모든 실패의 G1 수렴·출구 게이트·`/augment` 계약은 **불변**이다.

1. **두 번째 소비자**: 묶음 이름 제안(`ClusterNameSuggester` — 구현 `local`(ml-worker 생성 프로파일 `/cluster-label`) · `mock`)이 LLM 호출 소비자가 됐다. 기본 꺼짐 · 꺼져도 기능 성립 · 실패는 "이름 없음"으로 수렴(G1 폴백과 같은 원칙).
2. **§6 승격 트리거는 문자 그대로 발동했으나 승격하지 않는다.** 두 소비자는 ① 입출력 계약이 다르고(예문 N개 생성 vs 이름 1개) ② 배포 형태 요구가 다르다(증강 = `rule`·`gemini`·`local` / 이름 = `local`만 — 업로드 발화의 개인정보 밀도 때문에 cloud 금지). 공유할 수 있는 것이 "ml-worker 생성 프로세스로 HTTP를 보낸다"뿐이라 패키지는 빈 추상화가 된다(`packages/pii-mask`는 **같은 함수**를 두 곳이 써서 승격했다). 이름 제안 포트는 §6의 규약대로 **Nest 데코레이터·Prisma 무의존 파일**로 두어 파일 이동만으로 승격 가능하게 한다.
3. **트리거 정밀화**: "LLM 호출 소비자 2곳" → "**같은 생성 연산(같은 입출력 계약)을 쓰는 두 번째 소비자, 또는 cloud 구현이 필요한 두 번째 소비자**"(예: No.24 생성형 답변 제안·No.34 요약이 cloud를 요구할 때).
4. **출구**: 이름 제안 호출 파일은 새 클래스가 아니라 `AUGMENT_LOCAL`의 레지스트리 파일로 등록된다(같은 ml-worker 생성 프로세스 · `fetch` 전 가드). 거버넌스 모드에서 이름 제안을 켜면 `AUGMENTATION_LOCAL_BASE_URL` 호스트가 허용 목록에 있어야 기동한다(`AUGMENTATION_PROVIDER=local` 검사와 같은 규칙).
````

---

## F. `docs/02-spec/decisions/ADR-0046-edge-inference-ml-worker-generation-backends-lightweight-cap-and-backend-address-guard.md`

### F-1. 재검토 트리거(118행) — 발동·미승격 표시

**찾을 원문**
````text
- **두 번째 LLM 소비자 착수** → `packages/llm-provider` 승격(ADR-0026 §6 — 백엔드 수는 소비자 수가 아니다).
````
**바꿀 내용**
````text
- **두 번째 LLM 소비자 착수** → `packages/llm-provider` 승격(ADR-0026 §6 — 백엔드 수는 소비자 수가 아니다). → **2026-09-30 발동·미승격(No.21 묶음 이름 제안 — ADR-0047 §8)**. 트리거는 ADR-0026 갱신(2026-09-30b)의 정밀화 문구를 따른다.
````

### F-2. 문서 끝 — §갱신(2026-09-30) 추가 (121행 뒤)

**찾을 원문**
````text
- **원본 PDF 확인(P-11)에서 엣지/온디바이스에 대한 다른 기술이 발견됨** → 요구사항부터 재검토.
````
**바꿀 내용**
````text
- **원본 PDF 확인(P-11)에서 엣지/온디바이스에 대한 다른 기술이 발견됨** → 요구사항부터 재검토.

---

## 갱신 (2026-09-30 — No.21: 생성 프로파일의 두 번째 선택 경로 `/cluster-label`)

발화 묶음 분석(No.21, **ADR-0047 §7**). §2~§6의 결정(백엔드 3종은 ml-worker 안에서만 · 경량 상한 · 주소 통제 · 시간 제한 25초 · 리다이렉트 비추적 · 비밀값 규약)은 **불변**이다.

1. 생성 프로파일(`ML_WORKER_ROLE=augment｜both`)에 **`POST /cluster-label`**(묶음 이름 제안)을 더한다 — 임베딩 프로파일에는 없다(404). 같은 생성기(`_load_generator()`가 만든 1개)·같은 백엔드·같은 주소 통제·같은 원격 시간 제한을 쓴다. 모델·백엔드는 생성 프로세스 설정(`GENERATION_BACKEND`·`OLLAMA_MODEL`·`VLLM_MODEL`·`GENERATION_MODEL_ID`)을 따르며 API·코드에 모델 이름 0.
2. **봉인 갱신**: ED-2(`/augment` 모델)·ED-4(`build_prompt`·`SYSTEM_INSTRUCTION`·`parse_candidate_array` 불변)·ED-7·ED-8·ED-9·ED-11은 **그대로**다 — 이름 전용 `build_label_prompt()`·`parse_label()`을 별도로 둔다(입력은 JSON 데이터 블록으로만). **ED-10 "생성 백엔드 호출은 `/augment` 처리와 기동 워밍업 외 0"은 "… 와 `/cluster-label` 처리 외 0"으로 넓힌다**(대화 경로 호출 0은 불변). ED-5(HF·Mock 본문 불변)의 취지는 유지하되, 각 생성기에 **선택 메서드 `label()`을 추가**한다(기존 메서드 본문 불변 · 실패 = `None` · 예외 금지).
3. 이름 제안의 최대 토큰은 `CLUSTER_LABEL_MAX_NEW_TOKENS`(기본 64) · 계약 상한(키워드 ≤20 · 표본 ≤5)을 넘으면 400.
4. 3050·경량 구성의 이름 제안 결과는 **"동작 확인"만** — 이름 품질·지연 판정은 운영 모델 채택(No.17) 뒤.
````

---

## G. `docs/05-ops/자동배포.md`

### G-1. §5.9 신설 — 발화 묶음 분석 운영 요구 (161행 앞)

**찾을 원문**
````text
> ⚠ §4의 헬스체크 기준(`redis`)은 초기안이다
````
**바꿀 내용**
````text
### 5.9 발화 묶음 분석(No.21 딥러닝 군집분석) 운영 요구 (2026-09-30 추가)

`deep-clustering-설계.md` · ADR-0047. 발화 파일(상담 녹취 전사본 등)을 받아 묶는 기능을 쓰는 설치의 **운영 책임**이다. 처리 시간·대화 영향 수치는 운영 장비 실측 전까지 **목표**다.

1. **마이그레이션**: `…_utterance_analysis`(`CREATE TABLE` 3 + 인덱스) 적용 뒤 원시 부분 유니크 인덱스 개수가 **4 그대로**인지 확인한다(생성 SQL에 `DROP INDEX`가 끼었으면 그 줄을 지우고 적용). 데이터 이관·백필 없음.
2. **전제**: `EMBEDDING_BASE_URL`(문장 분석)이 설정돼 있어야 한다(없으면 요청이 503). 분석은 대화와 **같은 ml-worker**를 쓴다 — 등급 0·1 장비(§5.8)는 큰 파일 분석을 대화가 적은 시간에 돌리도록 사용자에게 안내한다.
3. **자동 삭제**: 분석 결과는 생성 후 `UTTERANCE_ANALYSIS_RETENTION_DAYS`(기본 90일)가 지나면 **No.45 파기 잡**(`DATA_RETENTION_JOB_ENABLED` · `DATA_RETENTION_WINDOW`)이 지운다. 파기 잡을 끈 설치는 자동 삭제가 일어나지 않는다(데이터 지도 경고) — 수동 삭제로 관리한다. 일수를 바꾸면 **새 분석부터** 적용된다.
4. **개인정보**: 업로드 전에 이름·주소처럼 **자동으로 가려지지 않는 정보**를 지우도록 사용자에게 안내한다(정규식 마스킹 한계). 원본 파일은 서버에 저장되지 않는다. 디스크 암호화가 거버넌스 설치의 전제인 것은 대화 데이터와 같다(§5.3).
5. **이름 제안(선택)**: `UTTERANCE_ANALYSIS_NAME_SUGGEST_ENABLED=true` + `AUGMENTATION_LOCAL_BASE_URL`(생성 프로파일 ml-worker — §5.8 프로세스 구성). 모델·백엔드는 생성 프로세스 설정을 따른다(§5.8). 경량 구성(3050·Ollama)의 이름 품질은 "동작 확인"뿐이다. 거버넌스 모드에서 켜면 그 호스트가 `DATA_EGRESS_ALLOWED_HOSTS`에 있어야 API가 기동한다. ml-worker가 이 그룹 이전 버전이면 `/cluster-label`이 없어 이름 제안만 실패한다(분석은 정상 완료).
6. **부하 게이트(운영 장비 · 첫 사용 전 1회)**: 5,000행 분석을 돌리는 동안 대화 턴을 반복 호출해 ① 대화 임베딩 P95(예산 300ms) ② 임베딩 회로 개방 여부 ③ 결과 저장 시간 ④ 총 소요 시간을 기록한다. P95 초과·회로 개방이 보이면 `UTTERANCE_ANALYSIS_EMBED_YIELD_RATIO`를 올리고(예: 2.0) 다시 잰다 — 그래도 안 되면 분석 전용 임베딩 프로세스 설계를 요청한다(ADR-0047 재검토 트리거).
7. **배포 후 확인**: 콘솔 "발화 묶음 분석" 메뉴 · 양식 받기 · 합성 파일 1개 분석 완료 · 엑셀 다운로드 시 감사 `EXPORT` 1건 · 데이터 지도 "업로드 발화 분석" 절 · 서버 로그에 발화 문장·파일 이름이 없는지.

> ⚠ §4의 헬스체크 기준(`redis`)은 초기안이다
````

---

## H. `docs/02-spec/data-governance-설계.md`

### H-1. §8.1 — 발화 묶음 분석의 보존·파기 편입 방식 (717행 뒤)

**찾을 원문**
````text
- `MessageFeedback`(텍스트 0)·운영 테이블은 1차 대상 아님(§26).
````
**바꿀 내용**
````text
- `MessageFeedback`(텍스트 0)·운영 테이블은 1차 대상 아님(§26).
- **[No.21 — 2026-09-30] 발화 묶음 분석(`UtteranceAnalysis`·`UtteranceCluster`·`AnalyzedUtterance` — 업로드 발화 마스킹본)은 이 표의 종류가 아니다.** 보존 일수는 기능 설정 `UTTERANCE_ANALYSIS_RETENTION_DAYS`(기본 90 — 분석 생성 시 `expiresAt` 고정)이고, **삭제 실행은 이 파기 잡**이 한다: `CUSTOMER_IDENTITY` 뒤·`AUDIT_LOGS` 앞 단계 · 대상 = `expiresAt < now` ∧ 종결 상태 · `governance-data.writer.ts` `deleteUtteranceAnalyses()`(한 트랜잭션 `enableSecureDelete` → 발화 → 묶음 → 분석 **행 삭제**) · 삭제 발화 행 수로 1회 상한 차감 · 삭제가 있을 때만 요약 감사 `affectedByKind.UTTERANCE_ANALYSIS`(0이면 키 없음 — 결과·감사 바이트 동일). 종류로 넣지 않은 이유는 전역 "키 없음 = 무기한" 규약에 한 종류만 "기본 90일" 예외를 만들지 않기 위해서다. 열람 감사(`VIEW`) 대상 +1(발화 목록 — 11 → 12) · 내보내기 감사(`EXPORT`) 호출 파일 +1(3 → 4) · 데이터 지도 선택 키 `utteranceAnalysis?`(분석 0건이면 생략) · 출구 클래스 추가 0(`EMBEDDING` · 이름 제안은 `AUGMENT_LOCAL` 파일 +1)(`deep-clustering-설계.md` §13·§14 · ADR-0047 §5).
````

---

## J. (test-automation 소관 · 선택) 시험 문서

### J-1. `docs/04-test/시험항목.md` 459행 TC-21

**찾을 원문**
````text
| TC-21 | 딥러닝 군집분석 | 미분류 발화 1000건 클러스터링 | 토픽 클러스터 N개 생성, 각 대표 키워드 표시 |
````
**바꿀 내용**
````text
| TC-21 | 딥러닝 군집분석(발화 묶음 분석) | 합성 발화 1,000건 파일(엑셀/CSV) 업로드 → 분석 | 묶음 N개(발화 수 순 · 작은 묶음은 "미분류") · 묶음마다 대표 키워드 · 같은 파일·조건 2회 결과 동일 · 원문 개인정보 저장 0 · 챗봇 대조(답함/못함) · 선택 발화 반영은 확인 후에만(`deep-clustering-설계.md` §20.7 AC-DC 매핑) |
````

### J-2. `docs/04-test/시험데이터.md` 93행

**찾을 원문**
````text
| 딥러닝 군집분석 | 비정형 발화 1,000건 |
````
**바꿀 내용**
````text
| 딥러닝 군집분석 | 합성 발화 1,000건(템플릿 10종 · 빈 행·중복·301자 포함) · 가짜 개인정보(형식만 맞춘 무효 값)·금지어 혼합 파일 · 확장자만 xlsx인 파일 · 5,001행 파일 · 품질 측정용 정답 라벨 데이터(의도 ≥20 × 예문 ≥10 합성) — 실제 고객 문장 0 |
````

---

## K. (선택) `docs/requirements/deep-clustering.md` — PM 확정 기록

> 이 파일은 현재 **미커밋(untracked)** 이다. 파일의 줄바꿈 형식을 그대로 따른다.

### K-1. §13 변경 이력 — PM 확정 기록 추가

**찾을 원문**
````text
- **2026-09-30 작성** — requirements-analyst.
````
**바꿀 내용**
````text
- **2026-09-30 PM 확정(system-architect 기록)** — P-1 (a) 엑셀/CSV 발화 파일 · P-2/P-3 규모 A + (b) 선택 반영 · P-4 (b) 이름 제안 보조·기본 꺼짐·No.37 백엔드 재사용 · P-5 (a) 개발 PC 품질 판정(속도·LLM은 운영 실측) · P-6 (a) 마스킹본만·원본 0·90일 자동 삭제(설정)·수동 삭제 · P-7~P-12 권고안(용어 "묶음" · 5,000행 · GPU 7 → 5 + 각주 · 누락 2건 기록). 설계 `docs/02-spec/deep-clustering-설계.md` · ADR-0047.
- **2026-09-30 작성** — requirements-analyst.
````
