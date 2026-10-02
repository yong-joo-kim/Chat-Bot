// [DT-2] 합성 음성(Windows SAPI · 설계 §7.3 · 실기동 확인 X-6 · DX-9) — 커밋 0, 실행마다 만든다.
// `powershell.exe -NoProfile -NonInteractive -EncodedCommand <UTF-16LE base64>` — 스크립트 파일(BOM)·실행 정책·인자 인코딩 문제를 한 번에 피한다(사용자 설정 변경 0).
// 한국어 음성(ko-KR 첫 번째)으로 48kHz mono 16bit WAV를 만들고 문장 앞뒤에 무음 0.5초를 둔다.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseWavHeader, type WavInfo } from './wav';

/** PowerShell 문자열 리터럴(작은따옴표)용 이스케이프. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildSapiScript(phrase: string, outPath: string): string {
  return [
    "$ProgressPreference='SilentlyContinue'", // DX-9: 진행 메시지(CLIXML)가 stderr에 섞이지 않게
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'ko*' } | Select-Object -First 1",
    'if (-not $v) { exit 3 }',
    '$s.SelectVoice($v.VoiceInfo.Name)',
    '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
    `$s.SetOutputToWaveFile(${psQuote(outPath)}, $fmt)`,
    '$pb = New-Object System.Speech.Synthesis.PromptBuilder',
    '$pb.Culture = $v.VoiceInfo.Culture',
    '$pb.AppendBreak([TimeSpan]::FromMilliseconds(500))',
    `$pb.AppendText(${psQuote(phrase)})`,
    '$pb.AppendBreak([TimeSpan]::FromMilliseconds(500))',
    '$s.Speak($pb)',
    '$s.Dispose()',
    'Write-Output $v.VoiceInfo.Name',
  ].join('\n');
}

/** UTF-16LE base64 — `powershell -EncodedCommand`가 요구하는 형식(한글이 깨지지 않는다). */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export interface SynthResult {
  ok: boolean;
  path: string;
  voice: string | null;
  wav: WavInfo | null;
  bytes: number;
  error?: string;
}

/** WAV를 만들고 헤더를 확인한다. 성공 판정은 종료 코드와 WAV 헤더(stderr 비어 있음 가정 금지 — DX-9). */
export function synthesizeWav(phrase: string, outPath: string, timeoutMs = 30_000): SynthResult {
  mkdirSync(dirname(outPath), { recursive: true });
  const script = buildSapiScript(phrase, outPath);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
  if (r.error) return { ok: false, path: outPath, voice: null, wav: null, bytes: 0, error: r.error.message };
  if (r.status === 3) return { ok: false, path: outPath, voice: null, wav: null, bytes: 0, error: 'Windows 한국어 음성이 설치되어 있지 않습니다' };
  if (r.status !== 0) return { ok: false, path: outPath, voice: null, wav: null, bytes: 0, error: `PowerShell 종료 코드 ${r.status}` };
  if (!existsSync(outPath)) return { ok: false, path: outPath, voice: null, wav: null, bytes: 0, error: 'WAV 파일이 만들어지지 않았습니다' };
  const buf = readFileSync(outPath);
  const wav = parseWavHeader(buf);
  const voice = (r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? null;
  if (!wav.ok) return { ok: false, path: outPath, voice, wav, bytes: buf.length, error: `WAV 헤더 오류: ${wav.error}` };
  return { ok: true, path: outPath, voice, wav, bytes: buf.length };
}
