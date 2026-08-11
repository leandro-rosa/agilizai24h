import { Job } from 'bullmq'
import { HoldItSimpleJobDataDTO } from './hold-it-message'

export class HoldItJobEventsDTO<T = HoldItSimpleJobDataDTO> {
  job: Job<T>
  event: string
  error?: Error
  result?: any
}
