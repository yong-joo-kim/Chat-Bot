import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { SeverityBadge } from '../../../components/SeverityBadge';
import { MESSAGES } from '../../../constants/messages';

/**
 * UA-4 — 데이터 지도 "업로드 발화 분석" 절(`deep-clustering-ui-spec.md` §6.1). 읽기 전용이며, 분석이 1건 이상일 때만
 * (`utteranceAnalysis` 키가 있을 때만) 호출부가 이 절을 그린다. 경고는 색이 아니라 글자로도 전달한다.
 */
export function UtteranceAnalysisDataMapSection({ map }: { map: NonNullable<GovernanceMapResponse['utteranceAnalysis']> }): JSX.Element {
  const msg = MESSAGES.utteranceAnalysis.dataMap;
  const exits: string[] = [];
  if (map.exits.includes('EMBEDDING')) exits.push(msg.exitEmbedding);
  if (map.exits.includes('AUGMENT_LOCAL')) exits.push(msg.exitAugmentLocal);
  return (
    <section className="settings-card" aria-labelledby="ua-data-map-title">
      <h2 id="ua-data-map-title">{msg.title}</h2>
      <p>{msg.storage}</p>
      <p>{msg.scale(map.analyses, map.utterances)}</p>
      <p>{msg.retention(map.retentionDays)}</p>
      {exits.length > 0 && (
        <p>
          {msg.exitsLabel}: {exits.join(' + ')}
          {map.nameSuggestEnabled && ` · ${msg.nameSuggestOn}`}
        </p>
      )}
      {!map.retentionJobEnabled && (
        <p className="form-banner form-banner--warning">
          <SeverityBadge severity="WARNING" label={msg.retentionJobOff} />
        </p>
      )}
    </section>
  );
}
