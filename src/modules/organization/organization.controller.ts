import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import {
  UpdateCompanyProfileDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  UpdateLeaveTypeQuotaDto,
  CreateHolidayDto,
  CreateHRAccountDto,
} from './dto/organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('M2: Organization Setup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organization')
export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get organization company profile and attendance rules' })
  async getProfile() {
    return this.orgService.getProfile();
  }

  @Put('profile')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update company profile, working hours, and coordinates (Admin only)' })
  async updateProfile(@Body() dto: UpdateCompanyProfileDto, @CurrentUser() user: AuthUser) {
    return this.orgService.updateProfile(dto, user);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Get list of departments with employee counts' })
  async getDepartments() {
    return this.orgService.getDepartments();
  }

  @Post('departments')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create new department (Admin only)' })
  async createDepartment(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser) {
    return this.orgService.createDepartment(dto, user);
  }

  @Delete('departments/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete department (Admin only)' })
  async deleteDepartment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgService.deleteDepartment(id, user);
  }

  @Get('designations')
  @ApiOperation({ summary: 'Get list of designations' })
  async getDesignations() {
    return this.orgService.getDesignations();
  }

  @Post('designations')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create new designation (Admin only)' })
  async createDesignation(@Body() dto: CreateDesignationDto, @CurrentUser() user: AuthUser) {
    return this.orgService.createDesignation(dto, user);
  }

  @Get('leave-types')
  @ApiOperation({ summary: 'Get configured leave types and default quotas' })
  async getLeaveTypes() {
    return this.orgService.getLeaveTypes();
  }

  @Put('leave-types/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update leave type quota (Admin only)' })
  async updateLeaveType(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveTypeQuotaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgService.updateLeaveType(id, dto, user);
  }

  @Get('holidays')
  @ApiOperation({ summary: 'Get list of public holidays' })
  async getHolidays() {
    return this.orgService.getHolidays();
  }

  @Post('holidays')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Add a new public holiday (Admin only)' })
  async createHoliday(@Body() dto: CreateHolidayDto, @CurrentUser() user: AuthUser) {
    return this.orgService.createHoliday(dto, user);
  }

  @Delete('holidays/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete public holiday (Admin only)' })
  async deleteHoliday(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgService.deleteHoliday(id, user);
  }

  @Get('hr-accounts')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get list of HR accounts (Admin only)' })
  async getHRAccounts() {
    return this.orgService.getHRAccounts();
  }

  @Post('hr-accounts')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create new HR account login (Admin only)' })
  async createHRAccount(@Body() dto: CreateHRAccountDto, @CurrentUser() user: AuthUser) {
    return this.orgService.createHRAccount(dto, user);
  }

  @Patch('hr-accounts/:id/toggle')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate HR account (Admin only)' })
  async toggleHRStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgService.toggleHRStatus(id, user);
  }
}
