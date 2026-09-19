import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbedCode } from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';

/**
 * 임베드 스니펫 생성(FR-4-9, FR-4-13, FR-4-14, NFR-S2, §7.9).
 * 조회 시점에 생성하며 DB에 저장하지 않는다. 스니펫에는 slug(구조적으로 안전한 값)만 포함되고
 * name/headerTitle 등 자유 입력 문자열은 포함하지 않는다 — "이스케이프"가 아니라 "미포함"으로 XSS를 차단한다.
 */
@Injectable()
export class EmbedCodeService {
  constructor(private readonly config: ConfigService) {}

  generate(slug: string): EmbedCode {
    const widgetBaseUrl = this.config.get<string>('WIDGET_BASE_URL');
    const publicApiBaseUrl = this.config.get<string>('PUBLIC_API_BASE_URL');

    // 정상 배포라면 부팅 단계 env 검증(config/env.validation.ts)에서 이미 걸러진다.
    // 검증을 우회한 경우에만 여기서 CONFIG_ERROR로 방어한다(EX-4-3).
    if (!widgetBaseUrl || !publicApiBaseUrl) {
      throw new ApiException(
        'CONFIG_ERROR',
        500,
        '서버 설정(WIDGET_BASE_URL)이 누락되었습니다. 관리자에게 문의해 주세요.',
      );
    }

    const scriptUrl = `${widgetBaseUrl}/widget.js`;
    const publicUrl = `${widgetBaseUrl}/c/${slug}`;

    const pc = [
      '<script',
      `  src="${scriptUrl}"`,
      `  data-chatbot="${slug}"`,
      `  data-api-base="${publicApiBaseUrl}"`,
      '  data-mode="desktop"',
      '  defer></script>',
    ].join('\n');

    const mobile = [
      '<script',
      `  src="${scriptUrl}"`,
      `  data-chatbot="${slug}"`,
      `  data-api-base="${publicApiBaseUrl}"`,
      '  data-mode="mobile"',
      '  data-fullscreen="true"',
      '  defer></script>',
    ].join('\n');

    return { pc, mobile, publicUrl, scriptUrl };
  }
}
