import { Module } from '@nestjs/common'
import { AuthController } from './controllers/auth.controller'
import { SessionService } from './services/session.service'

@Module({
  controllers: [AuthController],
  providers: [SessionService],
  exports: [SessionService],
})
export class AuthModule {}
