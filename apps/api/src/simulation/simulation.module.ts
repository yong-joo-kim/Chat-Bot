import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

@Module({
  imports: [ChatbotsModule, DialogueCommonModule],
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
