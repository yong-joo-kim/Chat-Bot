import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

/** 전 요청을 `als.run()`으로 감싸 감사 기록용 컨텍스트를 준비한다(DD-40). 가드가 인증 성공 후 actor를 주입한다. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    this.requestContext.run(
      {
        actor: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestPath: `${req.method} ${req.path}`,
      },
      next,
    );
  }
}
