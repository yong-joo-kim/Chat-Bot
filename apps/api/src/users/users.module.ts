import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, RolesController],
  providers: [UsersService],
})
export class UsersModule {}
