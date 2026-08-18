import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthenticatedCaller } from '../services/session.service'

/** The identity SessionGuard resolved for this request. */
export const Caller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCaller => context.switchToHttp().getRequest().caller,
)
