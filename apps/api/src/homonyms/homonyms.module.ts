import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { HomonymsController } from './homonyms.controller';
import { HomonymsService } from './homonyms.service';

@Module({
  imports: [ChatbotsModule],
  controllers: [HomonymsController],
  providers: [HomonymsService],
})
export class HomonymsModule {}
