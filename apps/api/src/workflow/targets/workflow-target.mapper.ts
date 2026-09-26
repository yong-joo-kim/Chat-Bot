import type { EgressDecision, WorkflowTarget } from '@chat-bot/shared-types';
import { checkEgress } from '../../common/egress/egress-guard';
import { governanceRuntime } from '../../common/governance/governance-runtime';
import { WorkflowSecretResolver } from '../secrets/workflow-secret.resolver';

export interface WorkflowTargetRow {
  id: string;
  name: string;
  nameNormalized: string;
  description: string | null;
  baseUrl: string;
  authType: string;
  authHeaderName: string | null;
  secretRef: string | null;
  signingEnabled: boolean;
  signingSecretRef: string | null;
  urlSecretRef: string | null;
  timeoutMs: number;
  maxAttempts: number;
  allowRawPersonalData: boolean;
  enabled: boolean;
  pausedAt: Date | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTargetCounters {
  referencingNodeCount: number;
  subscriptionCount: number;
  succeeded24h: number;
  failed24h: number;
  pendingCount: number;
  heldCount: number;
  failedRetainedCount: number;
}

export function toWorkflowTargetResponse(row: WorkflowTargetRow, secretResolver: WorkflowSecretResolver, counters: WorkflowTargetCounters): WorkflowTarget {
  const host = safeHost(row.baseUrl);
  const decision: EgressDecision = governanceRuntime().egress.enforce ? checkEgress('WORKFLOW_WEBHOOK', row.baseUrl) : 'NOT_ENFORCED';
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseUrl: row.baseUrl,
    baseUrlHost: host,
    authType: row.authType as never,
    authHeaderName: row.authHeaderName,
    secretRef: row.secretRef,
    signingEnabled: row.signingEnabled,
    signingSecretRef: row.signingSecretRef,
    urlSecretRef: row.urlSecretRef,
    timeoutMs: row.timeoutMs,
    maxAttempts: row.maxAttempts,
    allowRawPersonalData: row.allowRawPersonalData,
    enabled: row.enabled,
    pausedAt: row.pausedAt,
    secretStates: {
      auth: secretResolver.status(row.authType as never, row.secretRef),
      signing: secretResolver.signingStatus(row.signingEnabled, row.signingSecretRef),
      url: secretResolver.urlStatus(row.urlSecretRef),
      signingWeak: row.signingEnabled ? secretResolver.isWeak(row.signingSecretRef) : false,
    },
    insecureHttp: row.baseUrl.startsWith('http:'),
    egressDecision: decision,
    consecutiveFailures: row.consecutiveFailures,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    referencingNodeCount: counters.referencingNodeCount,
    subscriptionCount: counters.subscriptionCount,
    stats24h: { succeeded: counters.succeeded24h, failed: counters.failed24h },
    pendingCount: counters.pendingCount,
    heldCount: counters.heldCount,
    failedRetainedCount: counters.failedRetainedCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
