import { MorphAnalyzerPort, MorphToken } from './morph-analyzer.port';

/**
 * M0 — 폴백·기본값(ADR-0028 §2). 의존성 0, 항상 `ready === true`다. 요구사항 J-10이 원래 제안한
 * 알고리즘 그대로다: 공백 분할 + 조사·어미 접미 절단 규칙표. gazetteer 최장일치가 항상 이보다
 * 우선 적용되므로(decompose()의 책임), 이 분석기는 gazetteer가 못 잡은 나머지만 대충 잘라내는
 * 최후의 보루다 — 정밀도가 낮아도 괜찮다(관리자가 칩 경계를 직접 수정할 수 있다, FR-L2-8).
 */
const JOSA_SUFFIXES: readonly string[] = [
  // 긴 것부터 매치되도록 길이 내림차순으로 정렬해 둔다.
  '으로부터', '에게서는', '한테서는',
  '이라도', '에게서', '한테서', '에서는', '으로는', '까지는', '부터는',
  '이나마', '에서도', '으로도', '처럼은',
  '에게', '한테', '에서', '으로', '부터', '까지', '이나', '라도', '만큼', '처럼', '보다', '마저', '조차', '밖에',
  '은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '만', '로',
];

function classifyPos(surface: string, isJosa: boolean): string {
  if (isJosa) return 'JX'; // 정밀 세분류(JKS/JKO 등)는 M0의 목표가 아니다 — 대략적인 조사 표시로 충분하다.
  return 'UNK';
}

export class HeuristicAnalyzer implements MorphAnalyzerPort {
  readonly analyzerId = 'heuristic@0';
  readonly ready = true;

  analyze(text: string): readonly MorphToken[] {
    const tokens: MorphToken[] = [];
    const eojeolPattern = /\S+/g;
    let match: RegExpExecArray | null;

    while ((match = eojeolPattern.exec(text)) !== null) {
      const eojeol = match[0];
      const eojeolStart = match.index;
      const josa = JOSA_SUFFIXES.find((j) => eojeol.length > j.length && eojeol.endsWith(j));

      if (!josa) {
        tokens.push({ surface: eojeol, start: eojeolStart, end: eojeolStart + eojeol.length, pos: classifyPos(eojeol, false) });
        continue;
      }

      const stem = eojeol.slice(0, eojeol.length - josa.length);
      const stemEnd = eojeolStart + stem.length;
      tokens.push({ surface: stem, start: eojeolStart, end: stemEnd, pos: classifyPos(stem, false) });
      tokens.push({ surface: josa, start: stemEnd, end: stemEnd + josa.length, pos: classifyPos(josa, true) });
    }

    return tokens;
  }
}
