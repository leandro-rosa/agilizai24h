import { HttpException } from '@nestjs/common'
import { REQUIRED_PERMISSION_KEY } from '../auth/guards/session.constants'
import type { AuthenticatedCaller } from '../auth/services/session.service'
import { UpstreamStatusError, UpstreamUnreachableError } from '../upstream/upstream.client'
import { DriveFilesController } from './drive-files.controller'

const caller: AuthenticatedCaller = { id: 7, email: 'ana@agiliz.ai', name: 'Ana', roles: ['operator'], permissions: ['ingestion:upload'] }
const request = { correlationId: 'corr-1' } as never

const build = (respond: (call: { method: string; path: string; payload?: unknown; correlationId?: string }) => unknown = () => ({ status: 200, data: {} })) => {
  const ingestion = jest.fn(async (call: never) => respond(call))
  return { ingestion, controller: new DriveFilesController({ ingestion } as never) }
}

const permissionOf = (method: keyof DriveFilesController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, DriveFilesController.prototype[method])

describe('DriveFilesController (gateway)', () => {
  describe('where it lives and who may use it', () => {
    it('is mounted at /drive-files, not under /ingestions, where GET /ingestions/:id would swallow it', () => {
      expect(Reflect.getMetadata('path', DriveFilesController)).toBe('drive-files')
    })

    it.each(['list', 'status'] as const)('%s needs ingestion:read', method => {
      expect(permissionOf(method)).toBe('ingestion:read')
    })

    it.each(['scan', 'validate', 'import', 'ignore'] as const)('%s needs ingestion:upload', method => {
      expect(permissionOf(method)).toBe('ingestion:upload')
    })
  })

  describe('reads', () => {
    it('lists through the worker, forwarding the status filter and the correlation id', async () => {
      const { controller, ingestion } = build(() => ({ status: 200, data: [{ id: 'f1' }] }))

      expect(await controller.list('new,changed', request)).toEqual([{ id: 'f1' }])
      expect(ingestion).toHaveBeenCalledWith({ method: 'get', path: '/drive-files?status=new%2Cchanged', correlationId: 'corr-1' })
    })

    it('lists everything when no status is given', async () => {
      const { controller, ingestion } = build()

      await controller.list(undefined, request)

      expect(ingestion.mock.calls[0][0]).toMatchObject({ path: '/drive-files' })
    })

    it('reads the status', async () => {
      const { controller, ingestion } = build(() => ({ status: 200, data: { configured: true } }))

      expect(await controller.status(request)).toEqual({ configured: true })
      expect(ingestion.mock.calls[0][0]).toMatchObject({ method: 'get', path: '/drive-files/status' })
    })
  })

  describe('scan', () => {
    it('queues a scan through the worker', async () => {
      const { controller, ingestion } = build(() => ({ status: 202, data: { status: 'queued' } }))

      expect(await controller.scan(request)).toEqual({ status: 'queued' })
      expect(ingestion).toHaveBeenCalledWith({ method: 'post', path: '/drive-files/scan', correlationId: 'corr-1' })
    })
  })

  describe('validate', () => {
    const reply = () => ({ status: jest.fn() })

    it('answers with the status the worker chose: 200 when it evaluated at once, 202 when it queued', async () => {
      for (const status of [200, 202]) {
        const { controller } = build(() => ({ status, data: { id: 'f1' } }))
        const r = reply()

        await controller.validate('f1', { period: '2026-08' }, request, r as never)

        expect(r.status).toHaveBeenCalledWith(status)
      }
    })

    it('forwards the type and period the person chose, and encodes the id', async () => {
      const { controller, ingestion } = build()

      await controller.validate('a/b', { file_type: 'sales', period: '2026-08' }, request, reply() as never)

      expect(ingestion).toHaveBeenCalledWith({
        method: 'post',
        path: '/drive-files/a%2Fb/validate',
        payload: { file_type: 'sales', period: '2026-08' },
        correlationId: 'corr-1',
      })
    })
  })

  describe('import', () => {
    it('adds who confirmed it from the session', async () => {
      const { controller, ingestion } = build(() => ({ status: 202, data: { id: 'f1', status: 'importing' } }))

      const result = await controller.import('f1', { file_type: 'sales', period: '2026-08', confirm_replace: true }, caller, request)

      expect(result).toEqual({ id: 'f1', status: 'importing' })
      expect(ingestion).toHaveBeenCalledWith({
        method: 'post',
        path: '/drive-files/f1/import',
        payload: { file_type: 'sales', period: '2026-08', confirm_replace: true, confirmed_by: 'ana@agiliz.ai' },
        correlationId: 'corr-1',
      })
    })

    it('never lets a browser claim to be someone else: the session overrides a confirmed_by in the body', async () => {
      const { controller, ingestion } = build()

      await controller.import('f1', { file_type: 'sales', period: '2026-08', confirmed_by: 'someone.else@agiliz.ai' }, caller, request)

      expect((ingestion.mock.calls[0][0] as { payload: { confirmed_by: string } }).payload.confirmed_by).toBe('ana@agiliz.ai')
    })

    it('copes with a body that is not an object', async () => {
      const { controller, ingestion } = build()

      await controller.import('f1', undefined, caller, request)

      expect((ingestion.mock.calls[0][0] as { payload: unknown }).payload).toEqual({ confirmed_by: 'ana@agiliz.ai' })
    })
  })

  describe('ignore', () => {
    it('forwards the choice', async () => {
      const { controller, ingestion } = build(() => ({ status: 200, data: { id: 'f1', status: 'new' } }))

      expect(await controller.ignore('f1', { ignored: false }, request)).toEqual({ id: 'f1', status: 'new' })
      expect(ingestion.mock.calls[0][0]).toMatchObject({ path: '/drive-files/f1/ignore', payload: { ignored: false } })
    })
  })

  describe('a refusal from the worker reaches the admin whole', () => {
    const refuse = (status: number, body: unknown) => () => {
      throw new UpstreamStatusError('ingestion', status, body)
    }

    it('keeps the code and the details, which the shared upstream filter would drop', async () => {
      const body = { code: 'replace_confirmation_required', message: 'replaces data', would_replace: { ingestion_id: 'earlier', status: 'completed' } }
      const { controller } = build(refuse(409, body))

      const error = (await controller.import('f1', {}, caller, request).catch((e: unknown) => e)) as HttpException

      expect(error).toBeInstanceOf(HttpException)
      expect(error.getStatus()).toBe(409)
      expect(error.getResponse()).toEqual(body)
    })

    it('does the same for the reads and the other actions', async () => {
      const { controller } = build(refuse(422, { code: 'blocked', blocking: [{ code: 'period_mismatch' }] }))

      expect(((await controller.list(undefined, request).catch((e: unknown) => e)) as HttpException).getResponse()).toMatchObject({ code: 'blocked' })
      expect(((await controller.ignore('f1', {}, request).catch((e: unknown) => e)) as HttpException).getStatus()).toBe(422)
    })

    it('leaves a worker that could not be reached to the shared filter, which answers 502', async () => {
      const { controller } = build(() => {
        throw new UpstreamUnreachableError('ingestion', new Error('ECONNREFUSED'))
      })

      await expect(controller.import('f1', {}, caller, request)).rejects.toBeInstanceOf(UpstreamUnreachableError)
    })

    it('leaves an error with no body to the shared filter as well', async () => {
      const { controller } = build(refuse(500, undefined))

      await expect(controller.scan(request)).rejects.toBeInstanceOf(UpstreamStatusError)
    })
  })
})
