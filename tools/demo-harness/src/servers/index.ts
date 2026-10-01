// 하네스 정적 서버 3개 묶음 시작·종료(설계 §6.1).
import type { Ports } from '../config';
import type { RepoPaths } from '../config';
import { startStaticServer, type RunningServer } from './static-server';
import { startStageServer, type StageBotInfo } from './stage-server';

export interface HarnessServers {
  console: RunningServer;
  widget: RunningServer;
  stage: RunningServer;
  closeAll(): Promise<void>;
}

/** 콘솔(dist + /api 역프록시) · 위젯(dist) · 모형/무대(assets 템플릿) 서버를 시작한다. 하나라도 실패하면 이미 연 것을 닫고 던진다. */
export interface ServerHooks {
  bots?: () => Record<string, StageBotInfo>;
  facts?: () => unknown;
  motion?: 'on' | 'off';
}

export async function startHarnessServers(paths: RepoPaths, ports: Ports, hooks: ServerHooks = {}): Promise<HarnessServers> {
  const started: RunningServer[] = [];
  try {
    const consoleServer = await startStaticServer({
      name: 'console',
      root: paths.webDist,
      port: ports.console,
      spaFallback: true,
      proxy: { prefix: '/api', target: { host: '127.0.0.1', port: ports.api } },
    });
    started.push(consoleServer);
    const widget = await startStaticServer({
      name: 'widget',
      root: paths.widgetDist,
      port: ports.widget,
      spaFallback: true,
      // 로더가 다른 출처(5180 모형 페이지)에서 불려 오므로 청크·스크립트 요청에 CORS를 허용한다(공개 정적 파일).
      headers: { 'access-control-allow-origin': '*' },
    });
    started.push(widget);
    const stage = await startStageServer({
      port: ports.stage,
      assetsDir: paths.assetsDir,
      values: () => ({
        CONSOLE_URL: `http://localhost:${ports.console}`,
        WIDGET_URL: `http://localhost:${ports.widget}`,
        API_BASE: `http://localhost:${ports.api}/api/v1`,
        STAGE_URL: `http://localhost:${ports.stage}`,
        MOTION: hooks.motion ?? 'on',
      }),
      bots: hooks.bots,
      facts: hooks.facts,
    });
    started.push(stage);
    return {
      console: consoleServer,
      widget,
      stage,
      closeAll: async () => {
        await Promise.all(started.map((s) => s.close()));
      },
    };
  } catch (e) {
    await Promise.all(started.map((s) => s.close()));
    throw e;
  }
}
