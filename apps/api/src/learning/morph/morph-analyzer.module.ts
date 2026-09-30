import { Module } from '@nestjs/common';
import { MorphAnalyzerFactory } from './morph-analyzer.factory';

/**
 * 형태소 분석기 공유 모듈(No.21 — 발화 묶음 분석 설계서 §6.4, C-10).
 *
 * `MorphAnalyzerFactory`는 garu(WASM)를 기동 시 1회 적재한다. 다른 모듈이 이 클래스를 provider로 한 번 더
 * 등록하면 적재가 두 번 일어나고, `LearningModule`을 통째로 import하면 미응답 수집기
 * (`UnansweredCollectorService` — `UnansweredQuestion` 쓰기)가 그 모듈의 DI 그래프에 들어온다.
 * 그래서 형태소 분석기만 이 작은 모듈로 분리해 `LearningModule`(요소분해)과 발화 묶음 분석이 공유한다 —
 * 동작·로드 시점(`onModuleInit` 1회)은 이전과 같다.
 */
@Module({
  providers: [MorphAnalyzerFactory],
  exports: [MorphAnalyzerFactory],
})
export class MorphAnalyzerModule {}
