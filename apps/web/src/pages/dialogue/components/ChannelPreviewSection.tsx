import { useMemo, useState } from 'react';
import type { ChannelOutputProfile, DialogOutput } from '@chat-bot/shared-types';
import { CHANNEL_CAPABILITIES, LEGACY_WEB_WIDGET_OUTPUT_PROFILE, degradeForProfile } from '@chat-bot/shared-types';
import { toOutputViews } from '@chat-bot/shared-types/output-view';
import { OutputRenderer } from '../../../components/OutputRenderer';
import { AssumedPreviewBadge } from '../../../components/AssumedPreviewBadge';
import { DegradeChangesNotice } from '../../../components/DegradeChangesNotice';
import { MESSAGES } from '../../../constants/messages';

type TabKey = 'WEB' | 'LEGACY' | 'KAKAO' | 'TEXT_ONLY';

const TAB_ORDER: TabKey[] = ['WEB', 'LEGACY', 'KAKAO', 'TEXT_ONLY'];

function profileFor(tab: TabKey): ChannelOutputProfile {
  switch (tab) {
    case 'WEB':
      return CHANNEL_CAPABILITIES.WEB.outputs;
    case 'LEGACY':
      return LEGACY_WEB_WIDGET_OUTPUT_PROFILE;
    case 'KAKAO':
      return CHANNEL_CAPABILITIES.KAKAOTALK.outputs;
    case 'TEXT_ONLY':
      // [신규 No.46] 나머지 6채널(MOBILE·LINE·FACEBOOK·NAVER_TALKTALK·APP·KIOSK)은 모두 같은
      // `TEXT_ONLY` 프로필을 공유한다 — 대표로 MOBILE을 쓴다(설계서 §7.1).
      return CHANNEL_CAPABILITIES.MOBILE.outputs;
  }
}

function tabLabel(tab: TabKey): string {
  const msg = MESSAGES.richMessages;
  switch (tab) {
    case 'WEB':
      return msg.tabWeb;
    case 'LEGACY':
      return msg.tabLegacyWidget;
    case 'KAKAO':
      return msg.tabKakao;
    case 'TEXT_ONLY':
      return msg.tabTextOnly;
  }
}

/**
 * RM-3 — 노드 편집기 채널별 미리보기 패널(channel-rich-messages-ui-spec.md §3.3). 저장 전 현재 폼
 * state를 4개 채널 프로필로 각각 `degradeForProfile`(순수 계산, 서버 호출 없음)해 `OutputRenderer`로
 * 그린다 — 시뮬레이터(RM-6)와 같은 렌더러를 공유한다(§0).
 */
export function ChannelPreviewSection({ outputs }: { outputs: DialogOutput[] }): JSX.Element {
  const msg = MESSAGES.richMessages;
  const [activeTab, setActiveTab] = useState<TabKey>('WEB');

  const displayOutputs = useMemo(() => toOutputViews(outputs), [outputs]);
  const hasNonDisplayOutputs = outputs.length !== displayOutputs.length;

  const results = useMemo(() => {
    const map = new Map<TabKey, ReturnType<typeof degradeForProfile>>();
    for (const tab of TAB_ORDER) {
      map.set(tab, degradeForProfile(displayOutputs, profileFor(tab)));
    }
    return map;
  }, [displayOutputs]);

  return (
    <div className="channel-preview-section">
      <h3>{msg.previewSectionTitle}</h3>
      {hasNonDisplayOutputs && <p className="field-hint">{MESSAGES.dialogue.outputFields.richUrlNoDisplayHint}</p>}
      {displayOutputs.length === 0 ? (
        <p className="field-hint">{msg.previewEmpty}</p>
      ) : (
        <>
          <div className="sub-tabs" role="tablist" aria-label={msg.previewSectionTitle}>
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={`sub-tab-button${activeTab === tab ? ' sub-tab-button--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabel(tab)}
              </button>
            ))}
          </div>
          {(() => {
            const profile = profileFor(activeTab);
            const result = results.get(activeTab)!;
            return (
              <>
                {profile.source !== 'MEASURED' && <AssumedPreviewBadge />}
                <div className="channel-preview-container">
                  <OutputRenderer outputs={result.outputs} onButtonClick={() => undefined} />
                </div>
                <DegradeChangesNotice changes={result.changes} />
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
