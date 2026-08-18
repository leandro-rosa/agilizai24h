import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { STORE_STATUS_VALUES, type StoreStatus } from '../constants/store-vocabulary'

export class SetStatusDto {
  @ApiProperty({ enum: STORE_STATUS_VALUES })
  @IsIn(STORE_STATUS_VALUES)
  status: StoreStatus
}
