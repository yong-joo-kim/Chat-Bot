import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CompareRequestDto,
  CompareRequestSchema,
  CompareResponse,
  SimulateRequestDto,
  SimulateRequestSchema,
  SimulateResponse,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { SimulationService } from './simulation.service';

/** No.10 응답 테스트/시뮬레이션(관리자 전용). 조회성이지만 본문이 크고 캐시되면 안 되므로 POST를 쓴다(§5.2). */
@Controller('chatbots/:chatbotId/simulate')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('simulation:read')
  simulate(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(SimulateRequestSchema)) dto: SimulateRequestDto,
  ): Promise<SimulateResponse> {
    return this.simulationService.simulate(chatbotId, dto);
  }

  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('simulation:read')
  compare(
    @Param('chatbotId') chatbotId: string,
    @Body(new ZodValidationPipe(CompareRequestSchema)) dto: CompareRequestDto,
  ): Promise<CompareResponse> {
    return this.simulationService.compare(chatbotId, dto);
  }
}
