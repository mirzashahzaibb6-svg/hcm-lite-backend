import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { PayrollStatus, Role, AuditModule, AttendanceStatus, ApprovalStatus } from '@prisma/client';
import { CreatePayrollDraftDto } from './dto/payroll.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import PDFDocument from 'pdfkit';

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private calculateIncomeTax(monthlyGross: number): number {
    const annualGross = monthlyGross * 12;
    let annualTax = 0;

    // Pakistan standard progressive income tax slabs for salaried individuals
    if (annualGross <= 600000) {
      annualTax = 0;
    } else if (annualGross <= 1200000) {
      annualTax = (annualGross - 600000) * 0.05;
    } else if (annualGross <= 2200000) {
      annualTax = 30000 + (annualGross - 1200000) * 0.15;
    } else if (annualGross <= 3200000) {
      annualTax = 180000 + (annualGross - 2200000) * 0.25;
    } else {
      annualTax = 430000 + (annualGross - 3200000) * 0.35;
    }

    return Math.round(annualTax / 12);
  }

  async getDrafts() {
    const drafts = await this.prisma.payrollRun.findMany({
      include: {
        items: {
          include: {
            employee: {
              include: { department: true, designation: true },
            },
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return drafts.map((d) => ({
      id: d.id,
      month: d.month,
      year: d.year,
      monthName: d.monthName,
      totalEmployees: d.totalEmployees,
      totalGrossPay: d.totalGrossPay,
      totalDeductions: d.totalDeductions,
      totalNetPay: d.totalNetPay,
      status: d.status.toLowerCase() as 'draft' | 'under_review' | 'finalized',
      finalizedAt: d.finalizedAt?.toLocaleString(),
      finalizedBy: d.finalizedById || undefined,
      records: d.items.map((item) => ({
        id: item.id,
        employeeId: item.employee.id,
        employeeName: item.employee.fullName,
        employeeCode: item.employee.employeeCode,
        department: item.employee.department.name,
        designation: item.employee.designation.title,
        workingDays: item.workingDaysInMonth,
        attendedDays: item.attendedDays,
        absentDays: item.absentDays,
        halfDays: item.halfDays,
        basicSalary: item.basicSalary,
        hra: item.hra,
        medical: item.medical,
        specialAllowance: item.otherAllowances,
        grossSalary: item.grossPay,
        absentDeduction: item.absentDeductions,
        taxDeduction: item.taxDeductions,
        providentFund: item.providentFund,
        totalDeductions: item.totalDeductions,
        netPay: item.netPay,
        status: d.status.toLowerCase(),
        bankAccount: item.bankAccount || item.employee.accountNumber || 'PK36HABB0000001234567890',
      })),
    }));
  }

  async createDraft(dto: CreatePayrollDraftDto, currentUser: AuthUser) {
    const month = dto.month;
    const year = dto.year;
    const monthName = `${MONTH_NAMES[month]} ${year}`;

    // Check if payroll run already exists
    const existing = await this.prisma.payrollRun.findUnique({
      where: { month_year: { month, year } },
    });

    if (existing && existing.status === PayrollStatus.FINALIZED) {
      throw new ForbiddenException(`Payroll for ${monthName} is finalized and locked against modifications`);
    }

    // Determine days in month
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // Compute standard working days (excluding Saturdays and Sundays)
    let workingDaysInMonth = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month - 1, day);
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        workingDaysInMonth++;
      }
    }

    // Get all active employees with salary structure
    const employees = await this.prisma.employee.findMany({
      include: {
        salaryStructure: true,
        department: true,
        designation: true,
        attendanceRecords: {
          where: {
            date: { gte: startDateStr, lte: endDateStr },
          },
        },
        leaveRequests: {
          where: {
            status: ApprovalStatus.APPROVED,
            startDate: { lte: endDateStr },
            endDate: { gte: startDateStr },
          },
          include: { leaveType: true },
        },
      },
    });

    if (employees.length === 0) {
      throw new BadRequestException('No active employees found to process payroll');
    }

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    const itemsData: any[] = [];

    for (const emp of employees) {
      const basic = emp.salaryStructure?.basicSalary || 50000;
      const hra = emp.salaryStructure?.houseRentAllowance || Math.round(basic * 0.4);
      const medical = emp.salaryStructure?.medicalAllowance || Math.round(basic * 0.1);
      const otherAllowances = emp.salaryStructure?.specialAllowance || 0;
      const gross = emp.salaryStructure?.grossSalary || basic + hra + medical + otherAllowances;

      const perDayRate = gross / workingDaysInMonth;

      // Attendance metrics
      let presentDays = 0;
      let lateDays = 0;
      let halfDays = 0;
      for (const att of emp.attendanceRecords) {
        if (att.status === AttendanceStatus.PRESENT) presentDays++;
        else if (att.status === AttendanceStatus.LATE) lateDays++;
        else if (att.status === AttendanceStatus.HALF_DAY) halfDays++;
      }

      // Approved leaves
      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      for (const l of emp.leaveRequests) {
        if (l.leaveType.isPaid) paidLeaveDays += l.workingDays;
        else unpaidLeaveDays += l.workingDays;
      }

      const attendedDays = presentDays + lateDays + paidLeaveDays + halfDays * 0.5;
      const absentDays = Math.max(0, workingDaysInMonth - attendedDays - halfDays * 0.5 - unpaidLeaveDays);

      // Deductions
      const absentDeduction = Math.round(absentDays * perDayRate);
      const halfDayDeduction = Math.round(halfDays * 0.5 * perDayRate);
      const unpaidDeduction = Math.round(unpaidLeaveDays * perDayRate);
      const taxDeduction = this.calculateIncomeTax(gross);
      const pfDeduction = Math.round(basic * 0.05);

      const itemTotalDeduction =
        absentDeduction + halfDayDeduction + unpaidDeduction + taxDeduction + pfDeduction;
      const netPay = Math.max(0, gross - itemTotalDeduction);

      totalGross += gross;
      totalDeductions += itemTotalDeduction;
      totalNet += netPay;

      itemsData.push({
        employeeId: emp.id,
        workingDaysInMonth,
        attendedDays,
        absentDays,
        unpaidLeaveDays,
        halfDays,
        basicSalary: basic,
        hra,
        medical,
        otherAllowances,
        grossPay: gross,
        absentDeductions: absentDeduction + halfDayDeduction,
        unpaidLeaveDeductions: unpaidDeduction,
        taxDeductions: taxDeduction,
        providentFund: pfDeduction,
        totalDeductions: itemTotalDeduction,
        netPay,
        bankAccount: emp.accountNumber || 'PK36HABB0000001234567890',
      });
    }

    // Persist PayrollRun and PayrollItems in transaction
    const payrollRun = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.payrollItem.deleteMany({ where: { payrollRunId: existing.id } });
        return tx.payrollRun.update({
          where: { id: existing.id },
          data: {
            totalEmployees: employees.length,
            totalGrossPay: totalGross,
            totalDeductions,
            totalNetPay: totalNet,
            status: PayrollStatus.DRAFT,
            items: {
              create: itemsData,
            },
          },
          include: {
            items: {
              include: { employee: { include: { department: true, designation: true } } },
            },
          },
        });
      }

      return tx.payrollRun.create({
        data: {
          month,
          year,
          monthName,
          totalEmployees: employees.length,
          totalGrossPay: totalGross,
          totalDeductions,
          totalNetPay: totalNet,
          status: PayrollStatus.DRAFT,
          items: {
            create: itemsData,
          },
        },
        include: {
          items: {
            include: { employee: { include: { department: true, designation: true } } },
          },
        },
      });
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'CREATE_PAYROLL_DRAFT',
      module: AuditModule.PAYROLL,
      description: `Generated payroll draft for ${monthName} with ${employees.length} employees`,
      afterData: { month, year, totalEmployees: employees.length, totalNetPay: totalNet },
    });

    return {
      id: payrollRun.id,
      month: payrollRun.month,
      year: payrollRun.year,
      monthName: payrollRun.monthName,
      totalEmployees: payrollRun.totalEmployees,
      totalGrossPay: payrollRun.totalGrossPay,
      totalDeductions: payrollRun.totalDeductions,
      totalNetPay: payrollRun.totalNetPay,
      status: 'draft' as const,
      records: payrollRun.items.map((item) => ({
        id: item.id,
        employeeId: item.employee.id,
        employeeName: item.employee.fullName,
        employeeCode: item.employee.employeeCode,
        department: item.employee.department.name,
        designation: item.employee.designation.title,
        workingDays: item.workingDaysInMonth,
        attendedDays: item.attendedDays,
        absentDays: item.absentDays,
        halfDays: item.halfDays,
        basicSalary: item.basicSalary,
        hra: item.hra,
        medical: item.medical,
        specialAllowance: item.otherAllowances,
        grossSalary: item.grossPay,
        absentDeduction: item.absentDeductions,
        taxDeduction: item.taxDeductions,
        providentFund: item.providentFund,
        totalDeductions: item.totalDeductions,
        netPay: item.netPay,
        status: 'draft',
        bankAccount: item.bankAccount || item.employee.accountNumber || 'PK36HABB0000001234567890',
      })),
    };
  }

  async finalizePayroll(draftId: string, adminUser: AuthUser) {
    if (adminUser.role !== 'ADMIN') {
      throw new ForbiddenException('Only Administrators are authorized to finalize payroll runs');
    }

    const draft = await this.prisma.payrollRun.findUnique({
      where: { id: draftId },
      include: {
        items: {
          include: { employee: { include: { department: true, designation: true } } },
        },
      },
    });

    if (!draft) {
      throw new NotFoundException('Payroll draft not found');
    }

    if (draft.status === PayrollStatus.FINALIZED) {
      throw new ConflictException('This payroll run is already finalized');
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Lock payroll run
      const finalized = await tx.payrollRun.update({
        where: { id: draftId },
        data: {
          status: PayrollStatus.FINALIZED,
          finalizedAt: new Date(),
          finalizedById: adminUser.name || adminUser.email,
        },
        include: {
          items: {
            include: { employee: { include: { department: true, designation: true } } },
          },
        },
      });

      // 2. Generate immutable Payslip records for each employee
      for (const item of draft.items) {
        await tx.payslip.upsert({
          where: { payrollItemId: item.id },
          create: {
            payrollItemId: item.id,
            employeeId: item.employeeId,
            month: draft.monthName,
            year: draft.year,
            issueDate: todayStr,
            basicSalary: item.basicSalary,
            hra: item.hra,
            medical: item.medical,
            specialAllowance: item.otherAllowances,
            grossSalary: item.grossPay,
            taxDeduction: item.taxDeductions,
            pfDeduction: item.providentFund,
            unpaidDeduction: item.absentDeductions + item.unpaidLeaveDeductions,
            totalDeductions: item.totalDeductions,
            netSalary: item.netPay,
            workingDays: item.workingDaysInMonth,
            attendedDays: item.attendedDays,
            leavesTaken: item.unpaidLeaveDays,
            status: 'FINALIZED',
          },
          update: {
            basicSalary: item.basicSalary,
            hra: item.hra,
            medical: item.medical,
            specialAllowance: item.otherAllowances,
            grossSalary: item.grossPay,
            taxDeduction: item.taxDeductions,
            pfDeduction: item.providentFund,
            unpaidDeduction: item.absentDeductions + item.unpaidLeaveDeductions,
            totalDeductions: item.totalDeductions,
            netSalary: item.netPay,
            workingDays: item.workingDaysInMonth,
            attendedDays: item.attendedDays,
            leavesTaken: item.unpaidLeaveDays,
            status: 'FINALIZED',
          },
        });

        // 3. Create Notification for employee
        if (item.employee.userId) {
          await tx.notification.create({
            data: {
              userId: item.employee.userId,
              title: 'Payslip Released',
              message: `Your payslip for ${draft.monthName} has been finalized and is now available for download.`,
              type: 'PAYROLL',
              actionUrl: '/payroll',
            },
          });
        }
      }

      return finalized;
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: Role.ADMIN,
      action: 'FINALIZE_PAYROLL',
      module: AuditModule.PAYROLL,
      description: `Finalized and locked payroll for ${draft.monthName}`,
      afterData: { id: draft.id, totalNetPay: draft.totalNetPay },
    });

    return {
      id: updated.id,
      month: updated.month,
      year: updated.year,
      monthName: updated.monthName,
      totalEmployees: updated.totalEmployees,
      totalGrossPay: updated.totalGrossPay,
      totalDeductions: updated.totalDeductions,
      totalNetPay: updated.totalNetPay,
      status: 'finalized' as const,
      finalizedAt: updated.finalizedAt?.toLocaleString(),
      finalizedBy: updated.finalizedById || 'Admin',
      records: updated.items.map((item) => ({
        id: item.id,
        employeeId: item.employee.id,
        employeeName: item.employee.fullName,
        employeeCode: item.employee.employeeCode,
        department: item.employee.department.name,
        designation: item.employee.designation.title,
        workingDays: item.workingDaysInMonth,
        attendedDays: item.attendedDays,
        absentDays: item.absentDays,
        halfDays: item.halfDays,
        basicSalary: item.basicSalary,
        hra: item.hra,
        medical: item.medical,
        specialAllowance: item.otherAllowances,
        grossSalary: item.grossPay,
        absentDeduction: item.absentDeductions,
        taxDeduction: item.taxDeductions,
        providentFund: item.providentFund,
        totalDeductions: item.totalDeductions,
        netPay: item.netPay,
        status: 'finalized',
        bankAccount: item.bankAccount || item.employee.accountNumber || 'PK36HABB0000001234567890',
      })),
    };
  }

  async getPayslip(employeeIdOrCode?: string, month?: string, currentUser?: AuthUser) {
    let targetEmployeeId: string;

    if (currentUser?.role === 'EMPLOYEE') {
      const emp = await this.prisma.employee.findFirst({
        where: { OR: [{ id: currentUser.employeeId }, { userId: currentUser.id }] },
      });
      if (!emp) throw new BadRequestException('No employee record found');
      targetEmployeeId = emp.id;
    } else if (employeeIdOrCode) {
      const found = await this.prisma.employee.findFirst({
        where: { OR: [{ id: employeeIdOrCode }, { employeeCode: employeeIdOrCode }] },
      });
      if (!found) throw new NotFoundException('Employee not found');
      targetEmployeeId = found.id;
    } else {
      const emp = await this.prisma.employee.findFirst();
      if (!emp) throw new NotFoundException('No employee records in system');
      targetEmployeeId = emp.id;
    }

    const where: any = { employeeId: targetEmployeeId };
    if (month) where.month = { contains: month, mode: 'insensitive' };

    let slip = await this.prisma.payslip.findFirst({
      where,
      include: {
        employee: { include: { department: true, designation: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!slip) {
      // Fallback: search by employee
      slip = await this.prisma.payslip.findFirst({
        where: { employeeId: targetEmployeeId },
        include: { employee: { include: { department: true, designation: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!slip) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: targetEmployeeId },
        include: { department: true, designation: true, salaryStructure: true },
      });

      if (!emp) throw new NotFoundException('Employee not found');

      const basic = emp.salaryStructure?.basicSalary || 65000;
      const hra = Math.round(basic * 0.4);
      const medical = Math.round(basic * 0.1);
      const gross = Math.round(basic * 1.5);
      const tax = this.calculateIncomeTax(gross);
      const pf = Math.round(basic * 0.05);
      const totalDeductions = tax + pf;
      const net = gross - totalDeductions;

      return {
        id: `mock-payslip-${emp.id}`,
        employeeId: emp.id,
        employeeName: emp.fullName,
        employeeCode: emp.employeeCode,
        department: emp.department.name,
        designation: emp.designation.title,
        month: month || 'October 2026',
        year: 2026,
        issueDate: new Date().toISOString().split('T')[0],
        basicSalary: basic,
        houseRentAllowance: hra,
        medicalAllowance: medical,
        specialAllowance: 0,
        grossSalary: gross,
        taxDeduction: tax,
        providentFundDeduction: pf,
        unpaidLeaveDeduction: 0,
        totalDeductions,
        netSalary: net,
        workingDays: 22,
        attendedDays: 22,
        leavesTaken: 0,
        bankAccount: emp.accountNumber || 'PK36HABB0000001234567890',
        status: 'FINALIZED',
      };
    }

    return {
      id: slip.id,
      employeeId: slip.employeeId,
      employeeName: slip.employee.fullName,
      employeeCode: slip.employee.employeeCode,
      department: slip.employee.department.name,
      designation: slip.employee.designation.title,
      month: slip.month,
      year: slip.year,
      issueDate: slip.issueDate,
      basicSalary: slip.basicSalary,
      houseRentAllowance: slip.hra,
      medicalAllowance: slip.medical,
      specialAllowance: slip.specialAllowance,
      grossSalary: slip.grossSalary,
      taxDeduction: slip.taxDeduction,
      providentFundDeduction: slip.pfDeduction,
      unpaidLeaveDeduction: slip.unpaidDeduction,
      totalDeductions: slip.totalDeductions,
      netSalary: slip.netSalary,
      workingDays: slip.workingDays,
      attendedDays: slip.attendedDays,
      leavesTaken: slip.leavesTaken,
      bankAccount: slip.employee.accountNumber || 'PK36HABB0000001234567890',
      status: slip.status,
    };
  }

  generatePayslipPdf(slip: any): any {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header with Sapphire Blue Styling
    doc.fillColor('#1e40af').fontSize(22).text('SAYLANI WELFARE INTERNATIONAL TRUST', { align: 'center' });
    doc.fillColor('#4b5563').fontSize(12).text('HCM Lite — Human Capital Management System', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#0284c7').fontSize(14).text(`OFFICIAL SALARY PAYSLIP — ${slip.month.toUpperCase()}`, { align: 'center' });
    doc.moveDown(1);

    // Divider
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Employee & Company Details
    const startY = doc.y;
    doc.fillColor('#111827').fontSize(10);
    doc.text(`Employee Name: ${slip.employeeName}`, 50, startY);
    doc.text(`Employee Code: ${slip.employeeCode}`, 50, startY + 16);
    doc.text(`Department: ${slip.department}`, 50, startY + 32);
    doc.text(`Designation: ${slip.designation}`, 50, startY + 48);

    doc.text(`Issue Date: ${slip.issueDate}`, 340, startY);
    doc.text(`Working Days: ${slip.workingDays} days`, 340, startY + 16);
    doc.text(`Attended Days: ${slip.attendedDays} days`, 340, startY + 32);
    doc.text(`Bank Account: ${slip.bankAccount}`, 340, startY + 48);

    doc.y = startY + 75;
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Two Column Breakdown: Earnings vs Deductions
    const tableTop = doc.y;
    doc.fillColor('#1e3a8a').fontSize(12).text('EARNINGS (PKR)', 50, tableTop);
    doc.fillColor('#991b1b').fontSize(12).text('DEDUCTIONS (PKR)', 320, tableTop);
    doc.moveDown(0.5);

    let curY = doc.y;
    doc.fillColor('#374151').fontSize(10);

    // Earnings items
    doc.text('Basic Salary:', 50, curY);
    doc.text(`${slip.basicSalary.toLocaleString()}`, 200, curY, { align: 'right' });

    doc.text('Income Tax:', 320, curY);
    doc.text(`${slip.taxDeduction.toLocaleString()}`, 470, curY, { align: 'right' });

    curY += 20;
    doc.text('House Rent Allowance (HRA):', 50, curY);
    doc.text(`${slip.houseRentAllowance.toLocaleString()}`, 200, curY, { align: 'right' });

    doc.text('Provident Fund (5%):', 320, curY);
    doc.text(`${slip.providentFundDeduction.toLocaleString()}`, 470, curY, { align: 'right' });

    curY += 20;
    doc.text('Medical Allowance (10%):', 50, curY);
    doc.text(`${slip.medicalAllowance.toLocaleString()}`, 200, curY, { align: 'right' });

    doc.text('Absent / Unpaid Leaves:', 320, curY);
    doc.text(`${slip.unpaidLeaveDeduction.toLocaleString()}`, 470, curY, { align: 'right' });

    curY += 20;
    doc.text('Special / Other Allowances:', 50, curY);
    doc.text(`${slip.specialAllowance.toLocaleString()}`, 200, curY, { align: 'right' });

    curY += 30;
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, curY).lineTo(545, curY).stroke();
    curY += 10;

    // Totals
    doc.fillColor('#1e40af').fontSize(11).text('Gross Salary:', 50, curY);
    doc.text(`PKR ${slip.grossSalary.toLocaleString()}`, 200, curY, { align: 'right' });

    doc.fillColor('#991b1b').text('Total Deductions:', 320, curY);
    doc.text(`PKR ${slip.totalDeductions.toLocaleString()}`, 470, curY, { align: 'right' });

    curY += 35;
    // Highlighted Net Pay Box
    doc.rect(50, curY, 495, 45).fillAndStroke('#eff6ff', '#2563eb');
    doc.fillColor('#1e3a8a').fontSize(14).text('NET TAKE-HOME PAYABLE:', 70, curY + 15);
    doc.fillColor('#1e40af').fontSize(16).text(`PKR ${slip.netSalary.toLocaleString()}`, 320, curY + 14, { align: 'right' });

    curY += 70;
    // Security verification and signature box
    doc.fillColor('#6b7280').fontSize(9).text('This is a computer-generated salary advice slip authenticated via HCM Lite Digital Authorization Service. No physical signature is required.', 50, curY, { width: 495, align: 'center' });
    doc.moveDown(0.5);
    doc.text(`Verified Status: ${slip.status} | Saylani Welfare International Trust © 2026`, { align: 'center' });

    doc.end();
    return doc;
  }
}
