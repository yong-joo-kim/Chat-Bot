import { z } from 'zod';
import { ProactiveButtonSchema, ProactiveDevice, ProactiveScheduleSchema, ProactiveTriggerSchema } from '@chat-bot/shared-types';
import type { ProactiveButton, ProactiveDevice as ProactiveDeviceType, ProactiveSchedule, ProactiveTrigger } from '@chat-bot/shared-types';

/**
 * [신규 No.35] `ProactiveRule` 행 ↔ DTO(JSON 컬럼 안전 파싱). 순수 — DB·Nest·시계 무의존(시각은
 * 호출자 인자). 불량이면 규칙 무효 취급(`null` 반환 — INVALID_STORED, §9.4).
 */

const ButtonsArraySchema = z.array(ProactiveButtonSchema);
const DevicesArraySchema = z.array(ProactiveDevice);

export interface DecodedProactiveRule {
  trigger: ProactiveTrigger;
  buttons: ProactiveButton[];
  devices: ProactiveDeviceType[];
  schedule: ProactiveSchedule | null;
}

export interface ProactiveRuleJsonColumns {
  trigger: string;
  buttons: string;
  devices: string;
  schedule: string | null;
}

export function decodeProactiveRule(row: ProactiveRuleJsonColumns): DecodedProactiveRule | null {
  try {
    const trigger = ProactiveTriggerSchema.parse(JSON.parse(row.trigger));
    const buttons = ButtonsArraySchema.parse(JSON.parse(row.buttons));
    const devices = DevicesArraySchema.parse(JSON.parse(row.devices));
    const schedule = row.schedule ? ProactiveScheduleSchema.parse(JSON.parse(row.schedule)) : null;
    return { trigger, buttons, devices, schedule };
  } catch {
    return null;
  }
}

export interface EncodedProactiveRuleInput {
  trigger: ProactiveTrigger;
  buttons: readonly ProactiveButton[];
  devices: readonly ProactiveDeviceType[];
  schedule?: ProactiveSchedule | null;
}

export function encodeProactiveRule(input: EncodedProactiveRuleInput): {
  triggerKind: string;
  trigger: string;
  buttons: string;
  devices: string;
  schedule: string | null;
} {
  return {
    triggerKind: input.trigger.kind,
    trigger: JSON.stringify(input.trigger),
    buttons: JSON.stringify(input.buttons),
    devices: JSON.stringify(input.devices),
    schedule: input.schedule ? JSON.stringify(input.schedule) : null,
  };
}
