import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { CreatePayrollDraftDto } from './dto/payroll.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { Response } from 'express';

@ApiTags('M6: Payroll Lite')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get('drafts')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Get monthly payroll runs and drafts (HR/Admin only)' })
  async getDrafts() {
    return this.payrollService.getDrafts();
  }

  @Post('drafts')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Create monthly payroll calculation draft (HR/Admin only)' })
  async createDraft(@Body() dto: CreatePayrollDraftDto, @CurrentUser() user: AuthUser) {
    return this.payrollService.createDraft(dto, user);
  }

  @Post('drafts/:id/finalize')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Finalize and permanently lock payroll run (Admin only)' })
  async finalizePayroll(@Param('id') draftId: string, @CurrentUser() user: AuthUser) {
    return this.payrollService.finalizePayroll(draftId, user);
  }

  @Get('payslip')
  @ApiOperation({ summary: 'Get payslip for authenticated employee or specified employee' })
  async getPayslip(
    @Query('employeeId') employeeId?: string,
    @Query('month') month?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.payrollService.getPayslip(employeeId, month, user);
  }

  @Get('payslip/:id/pdf')
  @ApiOperation({ summary: 'Download official PDF payslip document' })
  async downloadPayslipPdf(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    const slip = await this.payrollService.getPayslip(id, undefined, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${slip.employeeCode}-${slip.month.replace(/\s+/g, '_')}.pdf"`);
    const doc = this.payrollService.generatePayslipPdf(slip);
    doc.pipe(res);
  }
}
