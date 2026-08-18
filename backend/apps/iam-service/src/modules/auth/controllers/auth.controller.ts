import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { IntrospectDto } from '../dto/introspect.dto'
import { LoginDto } from '../dto/login.dto'
import { AuthService } from '../services/auth.service'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for a session token' })
  @ApiResponse({ status: 200, description: 'Session created' })
  @ApiResponse({ status: 401, description: 'Invalid credentials — deliberately generic' })
  async login(@Body() dto: LoginDto) {
    const result = await this.auth.login(dto.email, dto.password)

    return {
      token: result.token,
      expires_at: result.expiresAt.toISOString(),
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        roles: result.roles,
        permissions: result.permissions,
      },
    }
  }

  @Post('introspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a session token into an identity and its effective permissions',
    description:
      'Called by gateway-service on every request. Does not extend the session expiry, and returns valid:false rather than an error for an unusable token, so the gateway can tell an invalid session apart from this service being unreachable.',
  })
  async introspect(@Body() dto: IntrospectDto) {
    const result = await this.auth.introspect(dto.token)

    if (!result.valid) return { valid: false, reason: result.reason }

    return {
      valid: true,
      id: result.id,
      email: result.email,
      name: result.name,
      roles: result.roles,
      permissions: result.permissions,
      expires_at: result.expiresAt.toISOString(),
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session immediately' })
  async logout(@Body() dto: IntrospectDto): Promise<void> {
    await this.auth.logout(dto.token)
  }
}
