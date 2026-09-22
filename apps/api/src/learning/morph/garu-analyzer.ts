import { Logger } from '@nestjs/common';
import { MorphAnalyzerPort, MorphToken } from './morph-analyzer.port';
import { GaruInstance, loadGaruModule } from './garu-esm-loader';

/**
 * M1 — 실측으로 선정한 WASM 배포본(`garu-ko`, ADR-0028 §2 "WASM 배포본 우선"). 5지표 실측 근거는
 * `analyzer-comparison.md` 참고. 로드는 기동 시 1회 비동기(`GaruAnalyzer.load()`)이며, 실패하면
 * `ready=false`인 인스턴스를 반환한다 — 팩토리가 그 값을 보고 M0로 내려간다(ADR-0028 §1, 절대
 * API 기동을 막지 않는다).
 *
 * ESM interop 문제(순수 ESM 패키지 + CJS 빌드)는 `garu-esm-loader.ts`가 격리해서 처리한다 —
 * 이 파일은 결과로 나온 `GaruInstance`만 알면 된다.
 */
export class GaruAnalyzer implements MorphAnalyzerPort {
  readonly analyzerId = 'garu-ko@0.9.18';
  private readonly logger = new Logger('GaruAnalyzer');

  private constructor(private readonly instance: GaruInstance | null) {}

  get ready(): boolean {
    return this.instance !== null;
  }

  static async load(): Promise<GaruAnalyzer> {
    try {
      const { Garu } = await loadGaruModule();
      const instance = await Garu.load();
      return new GaruAnalyzer(instance);
    } catch (e) {
      console.warn(`[GaruAnalyzer] 로드 실패 — heuristic(M0)로 대체됩니다: ${e instanceof Error ? e.message : 'unknown'}`);
      return new GaruAnalyzer(null);
    }
  }

  /**
   * ⚠ `start`/`end`는 **어절(eojeol) 단위** 오프셋이다(같은 어절의 형태소끼리 값을 공유한다).
   * `morph-analyzer.port.ts`의 문서화된 한계를 그대로 전달한다 — 여기서 값을 보정하지 않는다.
   * 불규칙 활용에서는 `surface`를 이어붙여도 원문 부분 문자열과 다를 수 있다(예: "보내"+"ㄹ" →
   * 원문은 "보낼"). 소비자(`decompose()`)가 이 한계를 알고 보수적으로 처리해야 한다.
   */
  analyze(text: string): readonly MorphToken[] {
    if (!this.instance) return [];
    try {
      const result = this.instance.analyze(text);
      return result.tokens.map((t) => ({ surface: t.text, start: t.start, end: t.end, pos: t.pos }));
    } catch (e) {
      this.logger.warn(`분석 실패 — 이 호출만 빈 배열로 처리합니다: ${e instanceof Error ? e.message : 'unknown'}`);
      return [];
    }
  }
}
