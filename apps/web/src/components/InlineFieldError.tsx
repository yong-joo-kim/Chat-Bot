/**
 * 폼 필드 인라인 오류(ui-spec §2.3, UIUX §7). 필드 하단에 원인+해결방법 문구를 표시하고
 * 입력 요소의 `aria-describedby`와 이 컴포넌트의 `id`를 연결해야 한다.
 */
export function InlineFieldError({ id, message }: { id: string; message?: string }): JSX.Element | null {
  if (!message) return null;
  return (
    <p id={id} className="field-error" role="alert">
      <span aria-hidden="true">⚠</span> {message}
    </p>
  );
}
