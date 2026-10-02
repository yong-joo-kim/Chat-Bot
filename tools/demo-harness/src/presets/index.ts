import type { PresetDef } from '../scenario/types';
import { customerOnprem10m } from './customer-onprem-10m';
import { customerOnpremFull } from './customer-onprem-full';

const PRESETS: Record<string, PresetDef> = {
  [customerOnprem10m.id]: customerOnprem10m,
  [customerOnpremFull.id]: customerOnpremFull,
};

export const DEFAULT_PRESET_ID = customerOnprem10m.id;

export function listPresetIds(): string[] {
  return Object.keys(PRESETS);
}

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS[id];
}
