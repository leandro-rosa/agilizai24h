import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { IsEmail, IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { IamClient } from '../../upstream/iam.client'
import { Caller } from '../guards/caller.decorator'
import { Public, SESSION_COOKIE } from '../guards/session.constants'
import type { AuthenticatedCaller } from '../services/session.service'

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly iam: IamClient,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in',
    description:
      'Sets an HTTP-only session cookie. The raw token is never returned in the body, so no page script can read or store it — an XSS in the panel cannot become account takeover.',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials — deliberately generic' })
  async login(@Body() dto: LoginDto, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.iam.login(dto.email, dto.password, (request as { correlationId?: string }).correlationId)

    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/',
      expires: new Date(result.expires_at),
    })

    // Identity and permissions only — never the token.
    return { user: result.user, expires_at: result.expires_at }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log out', description: 'Revokes the session at the identity service, then clears the cookie.' })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const token = (request as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE]

    if (token) {
      await this.iam.logout(token, (request as { correlationId?: string }).correlationId)
    }

    reply.clearCookie(SESSION_COOKIE, { path: '/' })
  }

  @Get('me')
  @ApiOperation({
    summary: 'The authenticated caller and their effective permissions',
    description: 'Resolved fresh on every request, so a revoked permission shows up here without a re-login.',
  })
  me(@Caller() caller: AuthenticatedCaller) {
    return caller
  }
}
