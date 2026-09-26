import { Injectable } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { checkEgress } from '../../common/egress/egress-guard';
import type { LegacyTransport, LegacyTransportRequest, LegacyTransportResult } from './legacy-transport.port';

interface LookupCallback {
  (err: NodeJS.ErrnoException | null, address: string, family: number): void;
  (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>): void;
}

/**
 * ★ `node:http`/`node:https` import 유일 파일(§13 L-2, FR-0-99). 한 개의 데드라인이 DNS~본문 수신
 * 전체를 덮는다(slow-loris 방어, EX-L-23). `lookup` 옵션으로 검증된 주소만 반환해 재바인딩을 막고
 * (AC-L4-3), 호스트명은 그대로 두어 TLS SNI·인증서 검증은 호스트명 기준으로 유지한다.
 * 리다이렉트를 따라가지 않는다(3xx → `REDIRECT_NOT_ALLOWED`, AC-L4-4) · 응답 256KB 스트림 상한
 * (AC-L4-5) · `agent: false`(연결 재사용 없음).
 */
@Injectable()
export class NodeHttpTransport implements LegacyTransport {
  request(req: LegacyTransportRequest): Promise<LegacyTransportResult> {
    return new Promise((resolve) => {
      // [신규 No.45] 방어 이중화 — 클라이언트 우회 경로를 막는다(§6.5).
      if (checkEgress('LEGACY_API', req.url) === 'BLOCKED') {
        resolve({ kind: 'ERROR', outcome: 'NETWORK_ERROR', errorCode: 'EGRESS_BLOCKED' });
        return;
      }
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        resolve({ kind: 'ERROR', outcome: 'NETWORK_ERROR', errorCode: 'INVALID_URL' });
        return;
      }
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;
      const pinned = req.pinnedAddresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));

      let settled = false;
      let clientReq: http.ClientRequest | undefined;
      const finish = (result: LegacyTransportResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const lookup = ((hostname: string, options: unknown, callback: unknown): void => {
        const opts = (options ?? {}) as { all?: boolean };
        const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
        if (opts.all) {
          (cb as (err: null, addrs: Array<{ address: string; family: number }>) => void)(null, pinned);
        } else {
          const first = pinned[0];
          (cb as (err: null, address: string, family: number) => void)(null, first?.address ?? '', first?.family ?? 4);
        }
      }) as unknown as http.RequestOptions['lookup'];

      const options: http.RequestOptions = {
        method: req.method,
        headers: req.headers,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        lookup,
        agent: false,
        ...(isHttps ? { servername: url.hostname } : {}),
      };

      const timer = setTimeout(() => {
        clientReq?.destroy();
        finish({ kind: 'ERROR', outcome: 'TIMEOUT' });
      }, req.timeoutMs);

      clientReq = transport.request(options, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          finish({ kind: 'ERROR', outcome: 'REDIRECT_NOT_ALLOWED' });
          return;
        }
        const contentType = res.headers['content-type'];
        const contentLengthHeader = res.headers['content-length'];
        if (contentLengthHeader && Number(contentLengthHeader) > req.maxBytes) {
          res.destroy();
          finish({ kind: 'ERROR', outcome: 'RESPONSE_TOO_LARGE' });
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > req.maxBytes) {
            res.destroy();
            finish({ kind: 'ERROR', outcome: 'RESPONSE_TOO_LARGE' });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish({ kind: 'RESPONSE', status, contentType, bytes: total, body: Buffer.concat(chunks) });
        });
        res.on('error', () => {
          finish({ kind: 'ERROR', outcome: 'NETWORK_ERROR' });
        });
      });

      clientReq.on('error', (err: NodeJS.ErrnoException) => {
        finish({ kind: 'ERROR', outcome: 'NETWORK_ERROR', errorCode: err.code });
      });

      if (req.body !== null && req.method === 'POST') {
        clientReq.write(req.body);
      }
      clientReq.end();
    });
  }
}
