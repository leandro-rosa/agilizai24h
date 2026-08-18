import { Module } from '@nestjs/common'
import { AuthController } from './controllers/auth.controller'
import { AuthService } from './services/auth.service'
import { PasswordService } from './services/password.service'
import { SessionTokenService } from './services/session-token.service'

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionTokenService],
  exports: [PasswordService],
})
export class AuthModule {}
