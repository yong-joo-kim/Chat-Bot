import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MorphAnalyzerPort } from './morph-analyzer.port';
import { HeuristicAnalyzer } from './heuristic-analyzer';
import { GaruAnalyzer } from './garu-analyzer';

/**
 * `MorphAnalyzerPort` 구현체 교체 지점 **1곳**(ADR-0028 §2). `MORPH_ANALYZER` 환경변수로 선택하며
 * 기본값은 `auto`다 — 실측으로 선정한 M1(`garu-ko`)을 시도하고, 로드에 실패하면 M0(휴리스틱)로
 * 자동 하강한다. **API 기동 자체는 이 로드 성공 여부와 무관하게 항상 성공한다.**
 *
 * 로드는 기동 시 1회(비동기)이며, 완료 전에 들어오는 분해 요청은 M0로 응답한다(`getAnalyzer()`가
 * 초기값 `HeuristicAnalyzer`를 즉시 반환하기 때문 — 별도의 "loading" 상태를 만들지 않는다).
 */
@Injectable()
export class MorphAnalyzerFactory implements OnModuleInit {
  private readonly logger = new Logger('MorphAnalyzerFactory');
  private analyzer: MorphAnalyzerPort = new HeuristicAnalyzer();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    const mode = (this.config.get<string>('MORPH_ANALYZER') ?? 'auto').trim().toLowerCase();

    if (mode === 'heuristic') {
      this.analyzer = new HeuristicAnalyzer();
      return;
    }

    if (mode === 'auto' || mode === 'garu-ko' || mode === 'garu') {
      const garu = await GaruAnalyzer.load();
      if (garu.ready) {
        this.logger.log(`형태소 분석기 로드 완료: ${garu.analyzerId}`);
        this.analyzer = garu;
      } else {
        this.logger.warn('garu-ko 로드 실패 — heuristic(M0)으로 동작합니다.');
        this.analyzer = new HeuristicAnalyzer();
      }
      return;
    }

    this.logger.warn(`알 수 없는 MORPH_ANALYZER 값(${mode}) — heuristic(M0)으로 동작합니다.`);
    this.analyzer = new HeuristicAnalyzer();
  }

  getAnalyzer(): MorphAnalyzerPort {
    return this.analyzer;
  }
}
