import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  ImportCsvValidateDto,
  ImportCsvCommitDto,
} from './dto/employees.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { Response } from 'express';

@ApiTags('M3: Employee Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @ApiOperation({ summary: 'Get employee directory with server-side search, filtering, and pagination' })
  async getEmployees(
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.employeesService.getEmployees({ search, department, status, page, limit });
  }

  @Get('export')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Export employee directory as CSV' })
  async exportCsv(@Res() res: Response) {
    const csvData = await this.employeesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hcm_employees_export.csv"');
    return res.send(csvData);
  }

  @Get(':id/360')
  @ApiOperation({ summary: 'Get complete Employee 360 profile with attendance, leaves, and salary' })
  async getEmployee360(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.employeesService.getEmployee360(id, user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Register a new employee with temporary login and leave quotas (HR/Admin only)' })
  async createEmployee(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employeesService.createEmployee(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update employee information (Employees can only update phone/address)' })
  async updateEmployee(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeesService.updateEmployee(id, dto, user);
  }

  @Post('import-validate')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Dry-run CSV import validation with line-by-line error reporting' })
  async validateCsv(@Body() dto: ImportCsvValidateDto) {
    return this.employeesService.validateCsv(dto.csvText);
  }

  @Post('import-commit')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Commit validated CSV rows to database' })
  async commitCsv(@Body() dto: ImportCsvCommitDto, @CurrentUser() user: AuthUser) {
    return this.employeesService.commitCsv(dto.rows, user);
  }
}
