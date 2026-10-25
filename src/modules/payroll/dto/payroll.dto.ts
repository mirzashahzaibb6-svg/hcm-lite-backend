import { IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePayrollDraftDto {
  @ApiProperty({ example: 10, description: 'Month number (1-12)' })
  @IsNumber() @Min(1) @Max(12) month!: number;

  @ApiProperty({ example: 2026, description: 'Payroll Year' })
  @IsNumber() @Min(2020) @Max(2050) year!: number;
}
