import { createServer, type Server } from 'node:http'

export interface StubRoute {
  status: number
  body?: unknown
  /** Delay before answering, for exercising the deadline. */
  delayMs?: number
}

/**
 * A controllable stand-in for iam-service and the domain services.
 *
 * The gateway's whole job is deciding what to tell the caller when an upstream
 * answers a particular way — or does not answer at all. Driving that with real
 * containers would make the interesting cases (unreachable, slow, a 404 that
 * must be forwarded rather than swallowed) awkward and slow to produce; a stub
 * we control makes each one a single line, and keeps this suite runnable with
 * no infrastructure at all.
 *
 * It is still a real HTTP server on a real socket, so the request genuinely
 * travels through @app/http-client, the guard, the filter and Fastify.
 */
export class UpstreamStub {
  private server?: Server
  private routes = new Map<string, StubRoute>()
  private calls: string[] = []

  async start(): Promise<number> {
    this.server = createServer((req, res) => {
      const key = `${req.method} ${(req.url ?? '').split('?')[0]}`
      this.calls.push(key)

      const route = this.routes.get(key)

      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: `stub has no route for ${key}` }))
        return
      }

      const answer = () => {
        res.writeHead(route.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(route.body ?? {}))
      }

      if (route.delayMs) setTimeout(answer, route.delayMs)
      else answer()
    })

    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))

    return (this.server!.address() as { port: number }).port
  }

  on(method: string, path: string, route: StubRoute): void {
    this.routes.set(`${method} ${path}`, route)
  }

  /** Drops a route so requests to it 404 from the stub. */
  off(method: string, path: string): void {
    this.routes.delete(`${method} ${path}`)
  }

  calledWith(method: string, path: string): boolean {
    return this.calls.includes(`${method} ${path}`)
  }

  resetCalls(): void {
    this.calls = []
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>(resolve => this.server!.close(() => resolve()))
    this.server = undefined
  }
}
