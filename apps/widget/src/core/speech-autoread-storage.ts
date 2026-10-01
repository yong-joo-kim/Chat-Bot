import { getItem, setItem } from './session';

/**
 * [신규 No.32] 자동 읽기 토글의 탭 세션 기억 — `sessionStorage` `cb.vo.ar.{slug}`('1' = 켜짐). 새 탭·새 세션은 꺼짐
 * (NFR-VOA2). 저장소 접근 불가 시 메모리 폴백은 `session.ts`의 `getItem`/`setItem`을 그대로 쓴다(번들 절약).
 */
export const loadAutoRead = (slug: string): boolean => getItem(`cb.vo.ar.${slug}`) === '1';
export const saveAutoRead = (slug: string, on: boolean): void => setItem(`cb.vo.ar.${slug}`, on ? '1' : '0');
