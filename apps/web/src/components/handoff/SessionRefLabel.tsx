/**
 * `#{앞6자}` 형식으로만 렌더한다 — 이 컴포넌트를 거치지 않고 `sessionRef`/`alias` 원본 문자열을
 * 직접 출력하는 코드를 만들지 않는다(hybrid-cs-ui-spec.md §2.2 `SessionRefLabel`, §12-6).
 * 서버가 이미 `alias`(앞 6자)를 잘라 내려주는 응답은 그대로 통과시키고, 드물게 전체 `sessionRef`
 * (해시 16자 이상)가 넘어온 경우에만 방어적으로 앞 6자만 자른다.
 */
export function SessionRefLabel({ value }: { value: string }): JSX.Element {
  const display = value.length > 6 ? value.slice(0, 6) : value;
  return <span className="session-ref-label">#{display}</span>;
}
