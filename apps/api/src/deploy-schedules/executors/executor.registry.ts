import { Injectable } from '@nestjs/common';
import type { DeployScheduleAction } from '@chat-bot/shared-types';
import { RestoreVersionExecutor } from './restore-version.executor';
import { PublishExecutor } from './publish.executor';
import { SetWebChannelExecutor } from './set-web-channel.executor';
import { SwitchProdVersionExecutor } from './switch-prod-version.executor';
import type { DeployActionExecutor } from './deploy-action-executor';

type ExecutorMap = {
  RESTORE_VERSION: DeployActionExecutor<'RESTORE_VERSION'>;
  PUBLISH: DeployActionExecutor<'PUBLISH'>;
  SET_WEB_CHANNEL: DeployActionExecutor<'SET_WEB_CHANNEL'>;
  SWITCH_PROD_VERSION: DeployActionExecutor<'SWITCH_PROD_VERSION'>;
};

/**
 * [신규 2026-09-23 No.28] 동작 → 실행기 매핑 — **분기는 이 1곳뿐**(§5.2). 매핑 타입이라 누락은
 * 컴파일 오류가 된다. 동작 추가 = 실행기 파일 1개 + 아래 객체 리터럴 1줄.
 */
@Injectable()
export class ExecutorRegistry {
  private readonly map: ExecutorMap;

  constructor(
    restoreVersion: RestoreVersionExecutor,
    publish: PublishExecutor,
    setWebChannel: SetWebChannelExecutor,
    switchProdVersion: SwitchProdVersionExecutor,
  ) {
    this.map = { RESTORE_VERSION: restoreVersion, PUBLISH: publish, SET_WEB_CHANNEL: setWebChannel, SWITCH_PROD_VERSION: switchProdVersion };
  }

  get<A extends DeployScheduleAction>(action: A): DeployActionExecutor<A> {
    return this.map[action] as unknown as DeployActionExecutor<A>;
  }
}
