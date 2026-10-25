import { IsNotEmpty, IsOptional, IsString, IsNumber, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckInDto {
  @ApiProperty({ example: 24.8738, required: false })
  @IsOptional() @IsNumber() latitude?: number;

  @ApiProperty({ example: 67.0673, required: false })
  @IsOptional() @IsNumber() longitude?: number;

  @ApiProperty({ example: 98.5, required: false })
  @IsOptional() @IsNumber() faceScore?: number;
}

export class AttendanceCorrectionDto {
  @ApiProperty({ example: '2026-10-24' })
  @IsString() @IsNotEmpty() attendanceDate!: string;

  @ApiProperty({ example: '09:00:00' })
  @IsString() @IsNotEmpty() requestedCheckIn!: string;

  @ApiProperty({ example: '18:00:00' })
  @IsString() @IsNotEmpty() requestedCheckOut!: string;

  @ApiProperty({ example: 'Power cut at entrance biometric scanner in morning.' })
  @IsString() @IsNotEmpty() reason!: string;
}

export class ReviewCorrectionDto {
  @ApiProperty({ example: 'approved', enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';

  @ApiProperty({ example: 'Verified with security logbook', required: false })
  @IsOptional() @IsString() comment?: string;
}
