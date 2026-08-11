import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { FastifyAdapter as BullFastifyAdapter } from '@bull-board/fastify'
import { BullMQController } from './controllers/bullmq'
import { HoldItModule, HoldItQueueBoardService } from './hold-it.module'
import { HoldItKafkaBroker } from './services/brokers/kafka'
import { KafkaDlqService } from './services/brokers/kafka/dlq'

jest.mock('@bull-board/api', () => ({ createBullBoard: jest.fn() }))
jest.mock('@bull-board/api/bullMQAdapter', () => ({ BullMQAdapter: jest.fn() }))
jest.mock('@bull-board/fastify', () => ({ FastifyAdapter: jest.fn() }))

describe('HoldItModule Bull Board configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('preserves the operational controller by default and can omit it', () => {
    expect(HoldItModule.register([]).controllers).toEqual([BullMQController])
    expect(HoldItModule.register([], { exposeController: false }).controllers).toEqual([])
  })

  it('can disable Kafka providers independently of the process environment', () => {
    const originalWithKafkaBrokers = process.env.WITH_KAFKA_BROKERS
    process.env.WITH_KAFKA_BROKERS = 'true'

    try {
      const module = HoldItModule.register([], { withKafkaBrokers: false })

      expect(module.providers).not.toEqual(expect.arrayContaining([HoldItKafkaBroker, KafkaDlqService]))
      expect(module.exports).not.toEqual(expect.arrayContaining([HoldItKafkaBroker, KafkaDlqService]))
    } finally {
      if (originalWithKafkaBrokers === undefined) {
        delete process.env.WITH_KAFKA_BROKERS
      } else {
        process.env.WITH_KAFKA_BROKERS = originalWithKafkaBrokers
      }
    }
  })

  it('configures a read-only board at the requested path', () => {
    const queue = { name: 'quote.process-upload' }
    const moduleRef = { get: jest.fn().mockReturnValue(queue) }
    const setBasePath = jest.fn()
    const plugin = jest.fn()
    const registerPlugin = jest.fn().mockReturnValue(plugin)

    jest.mocked(BullFastifyAdapter).mockImplementation(() => ({ setBasePath, registerPlugin }) as never)

    const boardService = new HoldItQueueBoardService(moduleRef as never, [queue.name])
    const result = boardService.setupBoard({ basePath: '/queues', readOnlyMode: true, allowRetries: false })

    expect(moduleRef.get).toHaveBeenCalledWith('BullQueue_quote.process-upload', { strict: false })
    expect(BullMQAdapter).toHaveBeenCalledWith(queue, { readOnlyMode: true, allowRetries: false })
    expect(setBasePath).toHaveBeenCalledWith('/queues')
    expect(jest.mocked(createBullBoard).mock.calls[0][0].queues).toHaveLength(1)
    expect(result).toBe(plugin)
  })
})
