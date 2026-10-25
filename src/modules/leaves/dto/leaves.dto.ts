import { IsNotEmpty, IsString, IsIn, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplyLeaveDto {
  @ApiProperty({ example: 'leave-type-id-uuid' })
  @IsString() @IsNotEmpty() leaveTypeId!: string;

  @ApiProperty({ example: '2026-10-26' })
  @IsString() @IsNotEmpty() startDate!: string;

  @ApiProperty({ example: '2026-10-27' })
  @IsString() @IsNotEmpty() endDate!: string;

  @ApiProperty({ example: 'Family wedding ceremonies in Lahore' })
  @IsString() @IsNotEmpty() reason!: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional() @IsBoolean() isAiGenerated?: boolean;
}

export class ReviewLeaveDto {
  @ApiProperty({ example: 'approved', enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';

  @ApiProperty({ example: 'Approved, please ensure emergency cover is informed.', required: false })
  @IsOptional() @IsString() comment?: string;
}
