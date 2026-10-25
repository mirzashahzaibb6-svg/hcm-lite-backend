import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import {
  CheckInDto,
  AttendanceCorrectionDto,
  ReviewCorrectionDto,
} from './dto/attendance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('M4: Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @ApiOperation({ summary: 'Punch in attendance with optional GPS geofence and biometric verification' })
  async checkIn(@Body() dto: CheckInDto, @CurrentUser() user: AuthUser) {
    return this.attendanceService.checkIn(dto, user);
  }

  @Post('check-out')
  @ApiOperation({ summary: 'Punch out attendance and compute total working hours' })
  async checkOut(@CurrentUser() user: AuthUser) {
    return this.attendanceService.checkOut(user);
  }

  @Get('daily-board')
  @ApiOperation({ summary: 'Get daily live attendance board with absent/leave state evaluation' })
  async getDailyBoard(
    @Query('date') date?: string,
    @Query('department') department?: string,
  ) {
    return this.attendanceService.getDailyBoard(date, department);
  }

  @Get('my-history')
  @ApiOperation({ summary: 'Get attendance history for current user or specific employee' })
  async getPersonalHistory(
    @Query('employeeId') employeeId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.attendanceService.getPersonalHistory(employeeId, user);
  }

  @Post('correction')
  @ApiOperation({ summary: 'Submit an attendance correction request with reason' })
  async requestCorrection(
    @Body() dto: AttendanceCorrectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.attendanceService.requestCorrection(dto, user);
  }

  @Get('corrections')
  @ApiOperation({ summary: 'Get list of attendance correction requests' })
  async getCorrections(@CurrentUser() user: AuthUser) {
    return this.attendanceService.getCorrections(user);
  }

  @Patch('corrections/:id/review')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Approve or reject attendance correction request (HR/Admin only)' })
  async reviewCorrection(
    @Param('id') id: string,
    @Body() dto: ReviewCorrectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.attendanceService.reviewCorrection(id, dto, user);
  }
}
