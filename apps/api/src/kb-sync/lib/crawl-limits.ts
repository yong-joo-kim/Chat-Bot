/**
 * [신규 No.43 — pass 6 · RG-20⑥] 크롤 단계와 적재 단계(재수집)가 함께 쓰는 응답 크기 상한(순수 상수).
 * HTML 응답은 소스 파일 상한(`maxFileBytes`, 기본 20MB)과 별개로 2MB에서 스트림을 끊는다(§7.3).
 */
export const HTML_MAX_BYTES = 2 * 1024 * 1024;

/**
 * [pass 7 · N-1] 호스트 요청 간격의 서버 쪽 실효 상한(ms) — 소스 `minIntervalMs`(계약에 상한 없음)와 robots `Crawl-delay`가 아무리 커도 페이서에는 이 값까지만 기록한다. 설계 §6.5가
 * "Crawl-delay 300초 초과 호스트는 중단"(§25.1 RG-3 — 미구현)이라 정한 경계와 같은 값이라, 300초 이하 지연은 그대로 지키고 그 이상은 300초로 낮춘다(간격이 무한히 커져 실행이
 * 소스를 영영 점유하지 않게 하는 안전망). 계약(`shared-types`)은 바꾸지 않는다.
 */
export const MAX_HOST_INTERVAL_MS = 300_000;
