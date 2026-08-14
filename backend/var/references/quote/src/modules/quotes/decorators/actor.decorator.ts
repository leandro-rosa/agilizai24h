import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * Reads the `x-demo-actor` header set by frontend/server's BFF gateway.
 * This is a placeholder identity source, NOT authentication — no auth layer
 * exists anywhere in this backend today (see backend/apps/quote/CLAUDE.md,
 * "Decisões pendentes (resolvidas)", and the open question recorded in
 * frontend/docs/api-contracts.md). Never treat a present/absent value here
 * as an authorization decision.
 */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const request = ctx.switchToHttp().getRequest()
  const header = request.headers['x-demo-actor']
  return typeof header === 'string' && header.length > 0 ? header : null
})
