import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Priority } from '@prisma/client';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Annual Town Hall 2026' })
  @IsString() @IsNotEmpty() title!: string;

  @ApiProperty({ example: 'Join us in Main Auditorium this Thursday at 3:00 PM for Saylani vision announcements.' })
  @IsString() @IsNotEmpty() content!: string;

  @ApiProperty({ enum: Priority, example: Priority.NORMAL, required: false })
  @IsOptional() @IsEnum(Priority) priority?: Priority;

  @ApiProperty({ example: 'All', required: false })
  @IsOptional() @IsString() targetDepartment?: string;
}
