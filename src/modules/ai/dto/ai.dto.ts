import { IsNotEmpty, IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ example: 'Mujhe attendance policy aur grace period ke bare me bataiye' })
  @IsString() @IsNotEmpty() message!: string;

  @ApiProperty({ example: 'employee', required: false })
  @IsOptional() @IsString() role?: string;
}

export class SmartLeaveParserDto {
  @ApiProperty({ example: 'Mujhe aglay peer aur mangal ko urgent domestic kaam ki wajah se casual chutti chahiye' })
  @IsString() @IsNotEmpty() prompt!: string;
}

export class SummarizeDashboardDto {
  @ApiProperty({ example: 'admin', enum: ['admin', 'hr'] })
  @IsIn(['admin', 'hr']) type!: 'admin' | 'hr';
}
