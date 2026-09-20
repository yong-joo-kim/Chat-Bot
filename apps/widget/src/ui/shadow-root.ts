import { WIDGET_STYLES } from '../styles';

export interface WidgetMount {
  /** 콘텐츠를 넣을 컨테이너(shadow root 내부, 또는 폴백 시 host 자신). */
  container: ShadowRoot | HTMLElement;
  hostElement: HTMLElement;
}

/**
 * `#cb-widget-root`를 `document.body` 말단에 마운트하고 `attachShadow({mode:'open'})`(ADR-0012 §3).
 * 모든 id/`aria-*` 참조는 shadow 내부에서 완결된다(FR-W-17~21 전제). `attachShadow` 미지원 환경은
 * 네임스페이스 클래스 + `all:initial`로 degrade한다(EX-W-2).
 */
export function mountWidgetRoot(): WidgetMount {
  const host = document.createElement('div');
  host.id = 'cb-widget-root';
  document.body.appendChild(host);

  if (typeof host.attachShadow === 'function') {
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = WIDGET_STYLES;
    shadow.appendChild(style);
    return { container: shadow, hostElement: host };
  }

  // 폴백(EX-W-2): shadow DOM 미지원 시 동일 스타일을 host에 직접 주입한다(격리는 약해지나 기능은 유지).
  const style = document.createElement('style');
  style.textContent = WIDGET_STYLES;
  host.appendChild(style);
  return { container: host, hostElement: host };
}
