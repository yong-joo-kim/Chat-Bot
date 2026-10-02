// 보고서 쓰기(설계 §17) — GIF 인코딩 · result.json(스키마 검증) · index.html · summary.md · customer.html. 모든 쓰기 경로는 redact()를 지난다.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { encodeGif } from '../capture/gif';
import type { GifClipResult } from '../scenario/runner';
import type { RunPaths } from '../run/run-dir';
import type { Redactor } from '../util/redact';
import { renderReport } from './html';
import { renderSummary } from './markdown';
import { ResultSchema, type ResultJson } from './schema';

export interface WriteReportInput {
  run: RunPaths;
  result: ResultJson;
  gifClips: GifClipResult[];
  redact: (s: string) => string;
  /** 실패 카드·준비 실패에 싣는 로그 꼬리(내부판 전용). */
  logTails?: Record<string, string[]>;
  customerCopy: boolean;
}

export interface WriteReportOutput {
  files: string[];
  gifs: string[];
  errors: string[];
}

/** GIF를 인코딩해 `gif/<단계 ID>.gif`로 쓴다(실패한 클립은 건너뛰고 사유를 돌려준다). */
export function writeGifs(run: RunPaths, clips: GifClipResult[]): { gifs: string[]; errors: string[] } {
  const gifs: string[] = [];
  const errors: string[] = [];
  mkdirSync(run.gif, { recursive: true });
  for (const c of clips) {
    try {
      const buf = encodeGif(c.frames);
      if (!buf) continue;
      writeFileSync(join(run.gif, `${c.stepId}.gif`), buf);
      gifs.push(`gif/${c.stepId}.gif`);
    } catch (e) {
      errors.push(`GIF ${c.stepId}: ${(e as Error).message}`);
    }
  }
  return { gifs, errors };
}

export function writeReport(i: WriteReportInput): WriteReportOutput {
  const errors: string[] = [];
  const g = writeGifs(i.run, i.gifClips);
  errors.push(...g.errors);
  // GIF를 단계 캡처 목록과 보고서 영상 절에 반영한다
  const result: ResultJson = JSON.parse(JSON.stringify(i.result));
  result.media = { video: result.media?.video ?? null, videoReason: result.media?.videoReason ?? null, vtt: result.media?.vtt ?? null, gifs: g.gifs };
  for (const s of result.steps) {
    const gif = g.gifs.find((x) => x === `gif/${s.id}.gif`);
    if (gif && !s.captures.includes(gif)) s.captures.push(gif);
  }
  const checked = ResultSchema.parse(result); // 스키마 위반이면 여기서 예외 — 보고서가 기계 판정을 깨지 않게
  mkdirSync(i.run.report, { recursive: true });
  const files: string[] = [];
  const write = (name: string, text: string): void => {
    writeFileSync(join(i.run.report, name), i.redact(text), 'utf8');
    files.push(`report/${name}`);
  };
  write('result.json', JSON.stringify(checked, null, 2));
  write('index.html', renderReport(checked, { customer: false, logTails: i.logTails }));
  write('summary.md', renderSummary(checked));
  if (i.customerCopy) write('customer.html', renderReport(checked, { customer: true }));
  return { files, gifs: g.gifs, errors };
}

const TEXT_EXT = new Set(['.json', '.log', '.html', '.md', '.vtt', '.txt', '.csv']);
const SKIP_DIRS = new Set(['browser-profile', 'ml-worker']);

/** 정리 단계 마지막 자기 검사(설계 §17.3): 실행 폴더의 텍스트 파일에 등록된 비밀(비밀번호·쿠키 값)이 남아 있는지 — 남은 파일 목록(상대 경로). */
export function scanRunDirForSecrets(runDir: string, redactor: Redactor): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (TEXT_EXT.has(extname(name).toLowerCase()) && st.size < 20 * 1024 * 1024) {
        try {
          if (redactor.containsSecret(readFileSync(p, 'utf8'))) hits.push(relative(runDir, p).split(sep).join('/'));
        } catch {
          /* 읽기 실패는 무시 */
        }
      }
    }
  };
  walk(runDir);
  return hits;
}
