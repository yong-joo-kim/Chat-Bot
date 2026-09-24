import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns';
import { promisify } from 'node:util';
import type { LegacyDnsResolver } from './legacy-transport.port';

const lookupAsync = promisify(lookup) as unknown as (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

/** ★ `node:dns` import 유일 파일(§13 L-2). */
@Injectable()
export class NodeDnsResolver implements LegacyDnsResolver {
  async lookupAll(hostname: string): Promise<string[]> {
    try {
      const results = await lookupAsync(hostname, { all: true, verbatim: true });
      return results.map((r) => r.address);
    } catch {
      return [];
    }
  }
}
