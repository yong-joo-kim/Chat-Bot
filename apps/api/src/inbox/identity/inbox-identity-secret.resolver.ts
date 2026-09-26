import { Injectable } from '@nestjs/common';
import type { IdentitySecretStatus } from '@chat-bot/shared-types';

const MIN_SECRET_BYTES = 32;

/**
 * ★ [신규 No.42] `OMNI_IDENTITY_SECRET__<REF>`·`OMNI_CUSTOMER_KEY_SECRET` 읽기 유일 파일(O-1) —
 * `process.env` 직접(스키마 밖 — §3.4). 값은 로그·오류·응답·감사·지도 어디에도 나가지 않는다.
 */
@Injectable()
export class InboxIdentitySecretResolver {
  private readAndCheck(name: string): { buf?: Buffer; weak: boolean } {
    const raw = process.env[name];
    if (!raw) return { weak: false };
    const buf = Buffer.from(raw, 'utf8');
    return { buf, weak: buf.byteLength < MIN_SECRET_BYTES };
  }

  getIdentitySecrets(ref: string): { current?: Buffer; previous?: Buffer } {
    const current = this.readAndCheck(`OMNI_IDENTITY_SECRET__${ref}`);
    const previous = this.readAndCheck(`OMNI_IDENTITY_SECRET__${ref}__PREV`);
    return {
      current: current.buf && !current.weak ? current.buf : undefined,
      previous: previous.buf && !previous.weak ? previous.buf : undefined,
    };
  }

  secretStatus(ref: string | null): IdentitySecretStatus {
    if (!ref) return 'NOT_SET';
    const { buf, weak } = this.readAndCheck(`OMNI_IDENTITY_SECRET__${ref}`);
    if (!buf) return 'MISSING';
    if (weak) return 'WEAK';
    return 'CONFIGURED';
  }

  getCustomerKeySecret(): Buffer | undefined {
    const { buf, weak } = this.readAndCheck('OMNI_CUSTOMER_KEY_SECRET');
    return buf && !weak ? buf : undefined;
  }

  customerKeyStatus(): 'CONFIGURED' | 'MISSING' | 'WEAK' {
    const { buf, weak } = this.readAndCheck('OMNI_CUSTOMER_KEY_SECRET');
    if (!buf) return 'MISSING';
    if (weak) return 'WEAK';
    return 'CONFIGURED';
  }
}
