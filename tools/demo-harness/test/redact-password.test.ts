// H-T7: redact() · H-T13: 비밀번호 생성기 × validatePasswordPolicy
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordPolicy } from '@chat-bot/shared-types';
import { Redactor, REDACTED } from '../src/util/redact';
import { generatePassword } from '../src/util/password';

test('redact: 등록한 비밀(비밀번호·쿠키 값·키)을 어떤 텍스트에서든 치환', () => {
  const r = new Redactor();
  r.register('Zq7!kLm2#Pw9-xYabcd');
  r.register('cookie-value-123456');
  const out = r.redact('로그인 Zq7!kLm2#Pw9-xYabcd 성공 / 쿠키 cookie-value-123456 / Zq7!kLm2#Pw9-xYabcd');
  assert.ok(!out.includes('Zq7!kLm2#Pw9-xYabcd'));
  assert.ok(!out.includes('cookie-value-123456'));
  assert.equal(out.split(REDACTED).length - 1, 3);
});

test('redact: JSON 비밀번호 필드 4종', () => {
  const r = new Redactor();
  const body = JSON.stringify({ email: 'a@b.c', password: 'pw-aaa', currentPassword: 'pw-bbb', newPassword: 'pw-ccc', temporaryPassword: 'pw-ddd', ok: 1 });
  const out = r.redact(body);
  for (const v of ['pw-aaa', 'pw-bbb', 'pw-ccc', 'pw-ddd']) assert.ok(!out.includes(v), v);
  assert.ok(out.includes('"email":"a@b.c"'));
  assert.ok(out.includes('"ok":1'));
});

test('redact: cb_session · Set-Cookie · Cookie · Authorization · DATA_ENCRYPTION_KEYS', () => {
  const r = new Redactor();
  const text = [
    'Set-Cookie: cb_session=abc123def; Path=/api; HttpOnly',
    'cookie: cb_session=zzz999',
    'Authorization: Bearer tok-1',
    'url?x=1 cb_session=inline777; foo',
    'DATA_ENCRYPTION_KEYS=demo1:AbCdEf==',
  ].join('\n');
  const out = r.redact(text);
  for (const v of ['abc123def', 'zzz999', 'tok-1', 'inline777', 'AbCdEf']) assert.ok(!out.includes(v), v);
});

test('redact: 너무 짧은 값(4자 미만)은 등록하지 않는다(오탐 방지) · 빈 값 무시', () => {
  const r = new Redactor();
  r.register('abc');
  r.register('');
  r.register(undefined);
  r.register(null);
  assert.equal(r.registeredCount, 0);
  assert.equal(r.redact('abc 그대로'), 'abc 그대로');
});

test('containsSecret: 정리 단계 자기 검사', () => {
  const r = new Redactor();
  r.register('secret-pw-1');
  assert.equal(r.containsSecret('아무 내용 secret-pw-1 포함'), true);
  assert.equal(r.containsSecret('깨끗함'), false);
});

test('H-T13: 비밀번호 생성기 1,000회 — 길이 20 · 3종 포함 · 제품 정책 통과 · 이메일 아이디 미포함', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const pw = generatePassword();
    seen.add(pw);
    assert.equal(pw.length, 20);
    assert.ok(/[A-Za-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw), pw);
    const res = validatePasswordPolicy(pw, { email: 'admin1@demo.local' });
    assert.equal(res.ok, true, `${pw}: ${JSON.stringify(res.violations)}`);
    assert.ok(validatePasswordPolicy(pw, { email: 'agent@demo.local' }).ok);
  }
  assert.equal(seen.size, 1000, '무작위 — 중복 0');
});

test('비밀번호 생성기: 짧은 길이 거부 · 지정 길이 준수', () => {
  assert.throws(() => generatePassword(7));
  assert.equal(generatePassword(32).length, 32);
});
