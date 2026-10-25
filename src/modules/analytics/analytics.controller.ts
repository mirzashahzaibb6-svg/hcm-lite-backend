import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('M7: Dashboards and Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('admin')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get Admin dashboard metrics, department headcount, and payroll costs' })
  async getAdminKPIs() {
    return this.analyticsService.getAdminKPIs();
  }

  @Get('hr')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Get HR operations metrics, attendance trends, and pending approvals' })
  async getHRKPIs() {
    return this.analyticsService.getHRKPIs();
  }

  @Get('employee')
  @ApiOperation({ summary: 'Get personalized employee KPIs, attendance hours, and leave balances' })
  async getEmployeeKPIs(@CurrentUser() user: AuthUser) {
    return this.analyticsService.getEmployeeKPIs(user);
  }
}
