import type { IntegratedOverview } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { MetricCard } from '../chatbot-detail/MetricCard';
import { formatDate, formatPercent } from '../../lib/date';

/** §2.4 — 누적 KPI 카드 4장. 기존 3-prop `MetricCard`를 변경 없이 재사용한다. */
export function CumulativeKpiCards({ overview }: { overview: IntegratedOverview }): JSX.Element {
  const { totals, chatbotCounts, firstDayBucket } = overview;

  return (
    <div>
      <div className="dashboard-cards integrated-kpi-cards">
        <MetricCard label={MESSAGES.integratedStats.kpiCumulativeTurnLabel} value={String(totals.turnCount)} caption="" />
        <MetricCard
          label={MESSAGES.integratedStats.kpiCumulativeResponseRateLabel}
          value={formatPercent(totals.responseRate)}
          caption={MESSAGES.integratedStats.kpiCumulativeResponseRateCaption}
        />
        <MetricCard
          label={MESSAGES.integratedStats.kpiCumulativeSessionLabel}
          value={String(totals.sessionCount)}
          caption={MESSAGES.integratedStats.kpiCumulativeSessionCaption}
        />
        <MetricCard
          label={MESSAGES.integratedStats.kpiChatbotCountLabel}
          value={MESSAGES.integratedStats.kpiChatbotCountValue(chatbotCounts.active, chatbotCounts.draft, chatbotCounts.archived)}
          caption=""
        />
      </div>
      <p className="field-hint integrated-kpi-collection-start">
        {firstDayBucket ? MESSAGES.integratedStats.kpiCollectionStart(formatDate(firstDayBucket)) : MESSAGES.integratedStats.kpiCollectionStartEmpty}
      </p>
    </div>
  );
}
