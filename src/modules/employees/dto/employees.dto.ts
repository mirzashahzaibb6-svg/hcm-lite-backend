import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmploymentType, EmployeeStatus } from '@prisma/client';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-101', required: false })
  @IsOptional() @IsString() employeeCode?: string;

  @ApiProperty({ example: 'Muhammad Ahmed' })
  @IsString() @IsNotEmpty() fullName!: string;

  @ApiProperty({ example: 'ahmed.dev@saylani.org' })
  @IsEmail() email!: string;

  @ApiProperty({ example: '+92 300 1234567' })
  @IsString() @IsNotEmpty() phone!: string;

  @ApiProperty({ example: 'Gulshan-e-Iqbal, Karachi' })
  @IsString() @IsNotEmpty() address!: string;

  @ApiProperty({ example: '1996-05-15', required: false })
  @IsOptional() @IsString() dateOfBirth?: string;

  @ApiProperty({ example: 'Male', required: false })
  @IsOptional() @IsString() gender?: string;

  @ApiProperty({ example: '42101-1234567-1', required: false })
  @IsOptional() @IsString() nationalId?: string;

  @ApiProperty({ example: 'dept-id-uuid' })
  @IsString() @IsNotEmpty() departmentId!: string;

  @ApiProperty({ example: 'desig-id-uuid' })
  @IsString() @IsNotEmpty() designationId!: string;

  @ApiProperty({ example: '2026-01-15', required: false })
  @IsOptional() @IsString() joiningDate?: string;

  @ApiProperty({ enum: EmploymentType, required: false })
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;

  @ApiProperty({ enum: EmployeeStatus, required: false })
  @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;

  @ApiProperty({ example: 85000 })
  @IsNumber() basicSalary!: number;

  @ApiProperty({ example: 'HBL', required: false })
  @IsOptional() @IsString() bankName?: string;

  @ApiProperty({ example: 'Muhammad Ahmed', required: false })
  @IsOptional() @IsString() accountTitle?: string;

  @ApiProperty({ example: '12345678901234', required: false })
  @IsOptional() @IsString() accountNumber?: string;

  @ApiProperty({ example: 'PK36HABB0000001234567890', required: false })
  @IsOptional() @IsString() iban?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() designationId?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
  @IsOptional() @IsNumber() basicSalary?: number;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountTitle?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsString() iban?: string;
}

export class ImportCsvValidateDto {
  @ApiProperty({ description: 'Raw CSV text contents' })
  @IsString() @IsNotEmpty() csvText!: string;
}

export class ImportCsvCommitDto {
  @ApiProperty({ description: 'Array of validated employee rows to commit' })
  rows!: any[];
}
