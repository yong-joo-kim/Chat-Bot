import { ConfigService } from '@nestjs/config';
import { LegacyApiHttpClient } from './legacy-api-http.client';
import { LegacyApiSecretResolver } from './legacy-api-secret.resolver';
import { buildLegacyRequest } from './lib/build-request';
import type { LegacyDnsResolver, LegacyTransport, LegacyTransportRequest } from './transport/legacy-transport.port';

function buildClient(overrides: { dnsResolver?: LegacyDnsResolver; transport?: LegacyTransport; config?: Record<string, unknown> } = {}) {
  const dnsResolver: LegacyDnsResolver = overrides.dnsResolver ?? { lookupAll: jest.fn().mockResolvedValue(['203.0.113.5']) };
  const transport: LegacyTransport = overrides.transport ?? {
    request: jest.fn().mockResolvedValue({ kind: 'RESPONSE', status: 200, contentType: 'application/json', bytes: 2, body: Buffer.from('{}') }),
  };
  const configValues: Record<string, unknown> = { LEGACY_API_PRIVATE_ALLOWLIST: '', ...overrides.config };
  const config = { get: jest.fn((key: string) => configValues[key]) } as unknown as ConfigService;
  const secretResolver = new LegacyApiSecretResolver();
  const client = new LegacyApiHttpClient(dnsResolver, transport, secretResolver, config);
  return { client, dnsResolver, transport, config };
}

describe('LegacyApiHttpClient — 유일한 출구(§7.3)', () => {
  it('공인 주소로 해석되면 정상 전송하고, 리졸버는 1회만 호출된다(AC-L4-3)', async () => {
    const { client, dnsResolver, transport } = buildClient();
    const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = await client.send(built.request, { authType: 'NONE' }, { timeoutMs: 1000, maxBytes: 1024 });

    expect(result.kind).toBe('RESPONSE');
    expect(dnsResolver.lookupAll).toHaveBeenCalledTimes(1);
    expect(transport.request).toHaveBeenCalledTimes(1);
    const sentReq = (transport.request as jest.Mock).mock.calls[0][0] as LegacyTransportRequest;
    // ★ 전송이 받은 주소 = 검증된 공인 주소(재바인딩 방지) — 호스트명이 아니라 이미 분류된 IP다.
    expect(sentReq.pinnedAddresses).toEqual(['203.0.113.5']);
  });

  it('해석된 주소가 루프백이면 전송을 시도하지 않고 BLOCKED_ADDRESS를 반환한다(AC-L4-2)', async () => {
    const { client, transport } = buildClient({ dnsResolver: { lookupAll: jest.fn().mockResolvedValue(['127.0.0.1']) } });
    const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
    if (!built.ok) throw new Error('build failed');

    const result = await client.send(built.request, { authType: 'NONE' }, { timeoutMs: 1000, maxBytes: 1024 });

    expect(result).toEqual({ kind: 'ERROR', outcome: 'BLOCKED_ADDRESS', blockedAddress: '127.0.0.1' });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('사설 주소는 allowlist가 비어 있으면 전송을 시도하지 않는다(AC-L4-2)', async () => {
    const { client, transport } = buildClient({ dnsResolver: { lookupAll: jest.fn().mockResolvedValue(['10.1.2.3']) } });
    const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
    if (!built.ok) throw new Error('build failed');

    const result = await client.send(built.request, { authType: 'NONE' }, { timeoutMs: 1000, maxBytes: 1024 });

    expect(result.kind).toBe('ERROR');
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('사설 주소는 allowlist에 있으면 전송된다', async () => {
    const { client, transport } = buildClient({
      dnsResolver: { lookupAll: jest.fn().mockResolvedValue(['10.1.2.3']) },
      config: { LEGACY_API_PRIVATE_ALLOWLIST: '10.1.2.0/24' },
    });
    const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
    if (!built.ok) throw new Error('build failed');

    const result = await client.send(built.request, { authType: 'NONE' }, { timeoutMs: 1000, maxBytes: 1024 });

    expect(result.kind).toBe('RESPONSE');
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it('시크릿 미설정(BEARER) 시 SECRET_MISSING을 반환하고 전송하지 않는다', async () => {
    const { client, transport } = buildClient();
    const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
    if (!built.ok) throw new Error('build failed');

    const result = await client.send(built.request, { authType: 'BEARER', secretRef: 'NOT_SET_ANYWHERE' }, { timeoutMs: 1000, maxBytes: 1024 });

    expect(result).toEqual({ kind: 'ERROR', outcome: 'SECRET_MISSING' });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('BEARER 시크릿이 설정되어 있으면 Authorization 헤더로 전달한다(값은 응답·오류에 노출하지 않는다)', async () => {
    process.env.LEGACY_API_SECRET__TESTREF = 'tok-XYZ';
    try {
      const { client, transport } = buildClient();
      const built = buildLegacyRequest({ baseUrl: 'https://legacy.example.invalid', method: 'GET', pathTemplate: '/x', pathValues: [], query: [], body: [] });
      if (!built.ok) throw new Error('build failed');

      await client.send(built.request, { authType: 'BEARER', secretRef: 'TESTREF' }, { timeoutMs: 1000, maxBytes: 1024 });

      const sentReq = (transport.request as jest.Mock).mock.calls[0][0] as LegacyTransportRequest;
      expect(sentReq.headers.Authorization).toBe('Bearer tok-XYZ');
    } finally {
      delete process.env.LEGACY_API_SECRET__TESTREF;
    }
  });
});
