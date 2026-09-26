import type { ChannelOutputProfile, DialogOutput, DialogOutputType } from '@chat-bot/shared-types';
import { degradeForProfile } from '@chat-bot/shared-types';

/**
 * 채널이 지원하지 않는 아웃풋 타입을 텍스트로 격하한다(FR-11-19). WEB은 전 타입을 지원하므로
 * 이번 Phase에는 변환이 0건이지만, 경로는 항상 실행되어야 한다 — 새 채널이 추가될 때 격하 규칙이
 * 이미 동작 중인 상태여야 하기 때문이다(§8.2).
 *
 * [신규 No.46] 기존 시그니처(`ReadonlySet<DialogOutputType>`)는 그대로 유지하고(기존 시험 무수정),
 * 3단 사다리 순수 함수 `degradeForProfile`(shared-types — zod 무의존)에 위임한다. `ChannelOutputProfile`을
 * 바로 넘기면 사다리 전체(원형 → 대체 컴포넌트 → 텍스트)가 적용된다(ADR-0043 §5 · §7.6).
 */
export function degradeOutputs(outputs: DialogOutput[], supported: ReadonlySet<DialogOutputType> | ChannelOutputProfile): DialogOutput[] {
  const profile: ChannelOutputProfile = isChannelOutputProfile(supported) ? supported : typeSetProfile(supported);
  return degradeForProfile(outputs, profile).outputs;
}

function isChannelOutputProfile(value: ReadonlySet<DialogOutputType> | ChannelOutputProfile): value is ChannelOutputProfile {
  return !(value instanceof Set);
}

/** `Set` 시그니처 호출부(기존 시험) 호환용 — 모든 상한을 스키마 최대치로 두고 전 버튼 동작·이미지를 지원한다. */
function typeSetProfile(set: ReadonlySet<DialogOutputType>): ChannelOutputProfile {
  return {
    source: 'MEASURED',
    types: [...set],
    carouselMaxCards: set.has('CAROUSEL') ? 10 : 0,
    carouselCardMaxButtons: set.has('CAROUSEL') ? 3 : 0,
    cardMaxButtons: 5,
    quickReply: { supported: set.has('BUTTON'), max: 5 },
    buttonActions: ['MESSAGE', 'LINK', 'NODE'],
    image: true,
    textLimits: { title: 100, description: 500, buttonLabel: 40 },
  };
}
