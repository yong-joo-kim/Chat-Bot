import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [ChatbotsModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
