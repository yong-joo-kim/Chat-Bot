import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest.config의 test.globals=false와 일관되게, 프로젝트 전역에 afterEach/it 등을 주입하지 않는다.
// 그 대신 testing-library가 기대하는 "각 테스트 후 자동 언마운트"를 여기서 명시적으로 등록한다.
// (globals=false이면 @testing-library/react의 자동 afterEach(cleanup) 등록이 동작하지 않는다.)
afterEach(() => {
  cleanup();
});

// jsdom에는 없는 API를 최소한으로 폴리필한다(모달 포커스 트랩/스크롤 관련 코드가 참조).
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// jsdom은 실제 레이아웃 엔진이 없어 모든 요소의 offsetParent가 항상 null이다(jsdom 한계, 앱 버그 아님).
// `components/Modal.tsx`의 포커스 트랩은 `el.offsetParent !== null`로 "화면에 보이는 요소"를 걸러내므로,
// 이 폴리필이 없으면 트랩 대상 목록이 항상 비어 테스트에서 Tab/Shift+Tab이 모달 밖으로 빠져나간다.
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});
