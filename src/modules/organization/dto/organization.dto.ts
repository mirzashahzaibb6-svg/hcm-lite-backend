import { IsNotEmpty, IsOptional, IsString, IsNumber, IsBoolean, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCompanyProfileDto {
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() officeHours?: {
    startTime?: string;
    endTime?: string;
    gracePeriodMinutes?: number;
    halfDayThresholdHours?: number;
  };
  @IsOptional() weekendDays?: string[];
  @IsOptional() officeCoordinates?: {
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
  };
}

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Artificial Intelligence' })
  @IsString() @IsNotEmpty() name!: string;

  @ApiProperty({ example: 'AI' })
  @IsString() @IsNotEmpty() code!: string;

  @ApiProperty({ example: 'Dr. Zeeshan Usmani' })
  @IsString() @IsNotEmpty() headName!: string;

  @ApiProperty({ example: 4500000, required: false })
  @IsOptional() @IsNumber() budget?: number;
}

export class CreateDesignationDto {
  @ApiProperty({ example: 'Principal AI Engineer' })
  @IsString() @IsNotEmpty() title!: string;

  @ApiProperty({ example: 'dept-id-uuid' })
  @IsString() @IsNotEmpty() departmentId!: string;

  @ApiProperty({ example: 'L5', required: false })
  @IsOptional() @IsString() level?: string;

  @ApiProperty({ example: 120000, required: false })
  @IsOptional() @IsNumber() baseSalaryMin?: number;

  @ApiProperty({ example: 350000, required: false })
  @IsOptional() @IsNumber() baseSalaryMax?: number;
}

export class UpdateLeaveTypeQuotaDto {
  @ApiProperty({ example: 16 })
  @IsNumber() quotaDays!: number;
}

export class CreateHolidayDto {
  @ApiProperty({ example: 'Pakistan Resolution Day' })
  @IsString() @IsNotEmpty() name!: string;

  @ApiProperty({ example: '2026-03-23' })
  @IsString() @IsNotEmpty() date!: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional() @IsNumber() daysCount?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional() @IsBoolean() isRecurring?: boolean;

  @ApiProperty({ example: 'National Holiday commemorating Lahore Resolution', required: false })
  @IsOptional() @IsString() description?: string;
}

export class CreateHRAccountDto {
  @ApiProperty({ example: 'Ayesha Khan' })
  @IsString() @IsNotEmpty() name!: string;

  @ApiProperty({ example: 'ayesha.hr@saylani.org' })
  @IsEmail() email!: string;

  @ApiProperty({ example: 'Human Resources' })
  @IsString() @IsNotEmpty() department!: string;

  @ApiProperty({ example: 'Emp123456!' })
  @IsString() @IsNotEmpty() password!: string;
}
