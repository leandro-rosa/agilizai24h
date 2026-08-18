import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SessionIntrospection } from '@app/iam-contracts'
import { UpstreamClient, UpstreamStatusError } from './upstream.client'

export interface LoginResult {
  token: string
  expires_at: string
  user: { id: number; email: string; name: string; roles: string[]; permissions: string[] }
}

@Injectable()
export class IamClient {
  constructor(
    private readonly upstream: UpstreamClient,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('IAM_SERVICE_URL')
  }

  private get timeoutMs(): number {
    return this.config.get<number>('UPSTREAM_TIMEOUT_MS') ?? 3000
  }

  private get deadlineMs(): number {
    return this.config.get<number>('UPSTREAM_DEADLINE_MS') ?? 5000
  }

  async login(email: string, password: string, correlationId?: string): Promise<LoginResult> {
    const result = await this.upstream.send<LoginResult>(
      { service: 'iam', method: 'post', url: `${this.baseUrl}/auth/login`, payload: { email, password }, correlationId },
      this.timeoutMs,
      this.deadlineMs,
    )

    return result.data
  }

  /**
   * Resolves a session. An invalid session is a normal 200 answer with
   * `valid: false`, not an error — which is exactly what lets the gateway tell
   * "your session is bad" apart from "IAM is down". Only a transport failure
   * throws.
   */
  async introspect(token: string, correlationId?: string): Promise<SessionIntrospection> {
    const result = await this.upstream.send<SessionIntrospection>(
      { service: 'iam', method: 'post', url: `${this.baseUrl}/auth/introspect`, payload: { token }, correlationId },
      this.timeoutMs,
      this.deadlineMs,
    )

    return result.data
  }

  async logout(token: string, correlationId?: string): Promise<void> {
    try {
      await this.upstream.send(
        { service: 'iam', method: 'post', url: `${this.baseUrl}/auth/logout`, payload: { token }, correlationId },
        this.timeoutMs,
        this.deadlineMs,
      )
    } catch (error) {
      // A 4xx on logout means the session was already gone — the caller's
      // intent is satisfied either way. A transport failure still propagates.
      if (!(error instanceof UpstreamStatusError)) throw error
    }
  }
}
