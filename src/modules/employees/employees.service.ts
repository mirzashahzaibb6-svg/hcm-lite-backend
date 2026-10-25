import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { AuditModule, Role, EmployeeStatus, EmploymentType, AttendanceStatus, ApprovalStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employees.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private mapEmployee(emp: any) {
    return {
      id: emp.id,
      employeeId: emp.employeeCode,
      fullName: emp.fullName,
      email: emp.email,
      phone: emp.phone,
      address: emp.address,
      departmentId: emp.departmentId,
      departmentName: emp.department?.name || '',
      designationId: emp.designationId,
      designationTitle: emp.designation?.title || '',
      role: emp.user?.role?.toLowerCase() || 'employee',
      joiningDate: emp.joiningDate,
      status: emp.status === EmployeeStatus.ACTIVE ? 'Active' : emp.status === EmployeeStatus.ON_LEAVE ? 'On Leave' : 'Terminated',
      employmentType: emp.employmentType === EmploymentType.FULL_TIME ? 'Full-Time' : 'Part-Time',
      avatar: emp.avatar,
      salaryStructure: emp.salaryStructure ? {
        basicSalary: emp.salaryStructure.basicSalary,
        houseRentAllowance: emp.salaryStructure.houseRentAllowance,
        medicalAllowance: emp.salaryStructure.medicalAllowance,
        conveyanceAllowance: emp.salaryStructure.conveyanceAllowance || 0,
        specialAllowance: emp.salaryStructure.specialAllowance || 0,
        grossSalary: emp.salaryStructure.grossSalary,
        providentFundRate: emp.salaryStructure.providentFundRate,
        taxDeductionRate: emp.salaryStructure.taxDeductionRate,
      } : undefined,
    };
  }

  async getEmployees(params?: {
    search?: string;
    department?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(params?.page) || 1;
    const limit = Number(params?.limit) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params?.search) {
      const search = params.search.trim();
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (params?.department && params.department !== 'All') {
      where.department = { name: params.department };
    }

    if (params?.status && params.status !== 'All') {
      if (params.status === 'Active') where.status = EmployeeStatus.ACTIVE;
      else if (params.status === 'On Leave') where.status = EmployeeStatus.ON_LEAVE;
      else if (params.status === 'Terminated') where.status = EmployeeStatus.TERMINATED;
    }

    const [total, rawEmployees] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        include: {
          department: true,
          designation: true,
          user: true,
          salaryStructure: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      employees: rawEmployees.map((e) => this.mapEmployee(e)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getEmployee360(idOrCode: string, currentUser: AuthUser) {
    const emp = await this.prisma.employee.findFirst({
      where: {
        OR: [{ id: idOrCode }, { employeeCode: idOrCode }],
      },
      include: {
        department: true,
        designation: true,
        user: true,
        salaryStructure: true,
      },
    });

    if (!emp) {
      throw new NotFoundException('Employee not found');
    }

    // Role-based data-scope security:
    if (currentUser.role === 'EMPLOYEE') {
      const isOwner = currentUser.id === emp.userId || currentUser.employeeId === emp.id || currentUser.employeeCode === emp.employeeCode;
      if (!isOwner) {
        throw new ForbiddenException('Access denied: You are only permitted to view your own 360 profile');
      }
    }

    const currentYear = new Date().getFullYear();

    const [attendanceRecords, leaveRequests, balances, payslips] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { employeeId: emp.id },
        orderBy: { date: 'desc' },
        take: 30,
      }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: emp.id },
        include: { leaveType: true },
        orderBy: { appliedAt: 'desc' },
      }),
      this.prisma.employeeLeaveBalance.findMany({
        where: { employeeId: emp.id, year: currentYear },
        include: { leaveType: true },
      }),
      this.prisma.payslip.findMany({
        where: { employeeId: emp.id },
        orderBy: { issueDate: 'desc' },
        take: 12,
      }),
    ]);

    // Compute Attendance Stats
    let presentCount = 0;
    let lateCount = 0;
    let halfDayCount = 0;
    let absentCount = 0;
    let onLeaveCount = 0;

    for (const a of attendanceRecords) {
      if (a.status === AttendanceStatus.PRESENT) presentCount++;
      else if (a.status === AttendanceStatus.LATE) lateCount++;
      else if (a.status === AttendanceStatus.HALF_DAY) halfDayCount++;
      else if (a.status === AttendanceStatus.ABSENT) absentCount++;
      else if (a.status === AttendanceStatus.ON_LEAVE) onLeaveCount++;
    }

    const totalDays = attendanceRecords.length || 1;
    const attendancePercentage = Number((((presentCount + lateCount) / totalDays) * 100).toFixed(1));

    return {
      employee: this.mapEmployee(emp),
      recentAttendance: attendanceRecords.map((a) => ({
        id: a.id,
        employeeId: emp.employeeCode,
        employeeName: emp.fullName,
        departmentName: emp.department.name,
        date: a.date,
        checkInTime: a.checkInTime ? a.checkInTime.toTimeString().split(' ')[0] : undefined,
        checkOutTime: a.checkOutTime ? a.checkOutTime.toTimeString().split(' ')[0] : undefined,
        totalWorkingHours: a.totalWorkingHours,
        status: a.status.toLowerCase(),
        checkInLatitude: a.latitude,
        checkInLongitude: a.longitude,
        isWithinRadius: a.isWithinRadius,
        faceMatchScore: a.faceMatchScore,
        notes: a.notes,
      })),
      attendanceStats: {
        presentDays: presentCount,
        lateDays: lateCount,
        halfDays: halfDayCount,
        absentDays: absentCount,
        onLeaveDays: onLeaveCount,
        attendancePercentage: isNaN(attendancePercentage) ? 100 : attendancePercentage,
      },
      leaveBalances: balances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        quotaDays: b.allocatedDays,
        usedDays: b.usedDays,
        pendingDays: b.pendingDays,
        remainingDays: b.remainingDays,
      })),
      leaveHistory: leaveRequests.map((l) => ({
        id: l.id,
        employeeId: emp.employeeCode,
        employeeName: emp.fullName,
        departmentName: emp.department.name,
        leaveTypeId: l.leaveTypeId,
        leaveTypeName: l.leaveType.name,
        startDate: l.startDate,
        endDate: l.endDate,
        workingDays: l.workingDays,
        reason: l.reason,
        status: l.status.toLowerCase(),
        appliedAt: l.appliedAt.toLocaleString(),
        reviewedBy: l.reviewedById || undefined,
        reviewedAt: l.reviewedAt ? l.reviewedAt.toLocaleString() : undefined,
        reviewComment: l.reviewComment || undefined,
      })),
      recentPayslips: payslips.map((p) => ({
        id: p.id,
        employeeId: emp.id,
        employeeName: emp.fullName,
        employeeCode: emp.employeeCode,
        department: emp.department.name,
        designation: emp.designation.title,
        month: p.month,
        year: p.year,
        issueDate: p.issueDate,
        basicSalary: p.basicSalary,
        houseRentAllowance: p.hra,
        medicalAllowance: p.medical,
        specialAllowance: p.specialAllowance,
        grossSalary: p.grossSalary,
        taxDeduction: p.taxDeduction,
        providentFundDeduction: p.pfDeduction,
        unpaidLeaveDeduction: p.unpaidDeduction,
        totalDeductions: p.totalDeductions,
        netSalary: p.netSalary,
        workingDays: p.workingDays,
        attendedDays: p.attendedDays,
        leavesTaken: p.leavesTaken,
        status: p.status,
      })),
    };
  }

  async createEmployee(dto: CreateEmployeeDto, currentUser: AuthUser) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User or Employee with this email already exists');
    }

    // Auto-generate employee code if missing
    let code = dto.employeeCode;
    if (!code) {
      const count = await this.prisma.employee.count();
      code = `EMP-${100 + count + 1}`;
    }

    // Hash temporary password
    const tempPassword = 'Password123!';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    // Compute standard salary breakdown: 40% HRA, 10% Medical, Gross = 1.5 * Basic
    const basic = dto.basicSalary;
    const hra = Math.round(basic * 0.4);
    const medical = Math.round(basic * 0.1);
    const gross = Math.round(basic * 1.5);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: Role.EMPLOYEE,
          isActive: true,
          mustChangePassword: true,
        },
      });

      // 2. Create employee
      const employee = await tx.employee.create({
        data: {
          employeeCode: code!,
          userId: user.id,
          fullName: dto.fullName.trim(),
          email,
          phone: dto.phone.trim(),
          address: dto.address.trim(),
          dateOfBirth: dto.dateOfBirth || '1995-01-01',
          gender: dto.gender || 'Male',
          nationalId: dto.nationalId || '42101-0000000-1',
          departmentId: dto.departmentId,
          designationId: dto.designationId,
          joiningDate: dto.joiningDate || new Date().toISOString().split('T')[0],
          employmentType: dto.employmentType || EmploymentType.FULL_TIME,
          status: dto.status || EmployeeStatus.ACTIVE,
          bankName: dto.bankName,
          accountTitle: dto.accountTitle,
          accountNumber: dto.accountNumber,
          iban: dto.iban,
        },
        include: {
          department: true,
          designation: true,
          user: true,
        },
      });

      // 3. Create SalaryStructure
      const salary = await tx.salaryStructure.create({
        data: {
          employeeId: employee.id,
          basicSalary: basic,
          houseRentAllowance: hra,
          medicalAllowance: medical,
          grossSalary: gross,
          conveyanceAllowance: 0,
          specialAllowance: 0,
          providentFundRate: 5.0,
          taxDeductionRate: 5.0,
        },
      });

      // 4. Create initial leave balances for current year
      const currentYear = new Date().getFullYear();
      const leaveTypes = await tx.leaveType.findMany();
      for (const lt of leaveTypes) {
        await tx.employeeLeaveBalance.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: lt.id,
            year: currentYear,
            allocatedDays: lt.defaultQuota,
            usedDays: 0,
            pendingDays: 0,
            remainingDays: lt.defaultQuota,
          },
        });
      }

      return { ...employee, salaryStructure: salary };
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'CREATE_EMPLOYEE',
      module: AuditModule.EMPLOYEES,
      description: `Registered new employee: ${result.fullName} (${result.employeeCode})`,
      afterData: { id: result.id, email: result.email, code: result.employeeCode },
    });

    return this.mapEmployee(result);
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto, currentUser: AuthUser) {
    const emp = await this.prisma.employee.findFirst({
      where: { OR: [{ id }, { employeeCode: id }] },
      include: { user: true, salaryStructure: true },
    });

    if (!emp) {
      throw new NotFoundException('Employee not found');
    }

    // Role-specific field restriction:
    if (currentUser.role === 'EMPLOYEE') {
      const isOwner = currentUser.id === emp.userId || currentUser.employeeId === emp.id || currentUser.employeeCode === emp.employeeCode;
      if (!isOwner) {
        throw new ForbiddenException('Access denied: You can only edit your own details');
      }

      // Employees are strictly restricted to updating only their phone and address
      const updated = await this.prisma.employee.update({
        where: { id: emp.id },
        data: {
          phone: dto.phone !== undefined ? dto.phone.trim() : emp.phone,
          address: dto.address !== undefined ? dto.address.trim() : emp.address,
        },
        include: { department: true, designation: true, user: true, salaryStructure: true },
      });

      await this.auditService.log({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: Role.EMPLOYEE,
        action: 'UPDATE_PERSONAL_PROFILE',
        module: AuditModule.EMPLOYEES,
        description: `Employee updated phone/address`,
      });

      return this.mapEmployee(updated);
    }

    // HR and Admin can update other fields
    const data: any = {};
    if (dto.fullName) data.fullName = dto.fullName.trim();
    if (dto.phone) data.phone = dto.phone.trim();
    if (dto.address) data.address = dto.address.trim();
    if (dto.departmentId) data.departmentId = dto.departmentId;
    if (dto.designationId) data.designationId = dto.designationId;
    if (dto.employmentType) data.employmentType = dto.employmentType;
    if (dto.status) data.status = dto.status;
    if (dto.bankName) data.bankName = dto.bankName;
    if (dto.accountTitle) data.accountTitle = dto.accountTitle;
    if (dto.accountNumber) data.accountNumber = dto.accountNumber;
    if (dto.iban) data.iban = dto.iban;

    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.employee.update({
        where: { id: emp.id },
        data,
        include: { department: true, designation: true, user: true, salaryStructure: true },
      });

      // Update basic salary if provided
      if (dto.basicSalary && dto.basicSalary > 0) {
        const basic = dto.basicSalary;
        const hra = Math.round(basic * 0.4);
        const medical = Math.round(basic * 0.1);
        const gross = Math.round(basic * 1.5);

        await tx.salaryStructure.upsert({
          where: { employeeId: emp.id },
          create: {
            employeeId: emp.id,
            basicSalary: basic,
            houseRentAllowance: hra,
            medicalAllowance: medical,
            grossSalary: gross,
          },
          update: {
            basicSalary: basic,
            houseRentAllowance: hra,
            medicalAllowance: medical,
            grossSalary: gross,
          },
        });
      }

      return tx.employee.findUnique({
        where: { id: emp.id },
        include: { department: true, designation: true, user: true, salaryStructure: true },
      });
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'UPDATE_EMPLOYEE',
      module: AuditModule.EMPLOYEES,
      description: `Updated details for employee ${emp.fullName}`,
      beforeData: emp,
      afterData: updated,
    });

    return this.mapEmployee(updated);
  }

  async validateCsv(csvText: string) {
    const lines = csvText.trim().split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV file is empty or missing data rows');
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const rowsData = lines.slice(1);

    const existingEmails = new Set(
      (await this.prisma.user.findMany({ select: { email: true } })).map((u) => u.email.toLowerCase()),
    );
    const existingDepts = await this.prisma.department.findMany({ select: { id: true, name: true } });
    const deptMap = new Map(existingDepts.map((d) => [d.name.toLowerCase(), d.id]));

    const processedRows: any[] = [];
    const seenEmailsInFile = new Set<string>();

    for (let idx = 0; idx < rowsData.length; idx++) {
      const line = rowsData[idx];
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const errors: string[] = [];

      const fullName = cols[0] || '';
      const email = (cols[1] || '').toLowerCase().trim();
      const departmentName = cols[2] || '';
      const designationTitle = cols[3] || 'Associate';
      const salary = Number(cols[4]) || 0;

      if (!fullName) errors.push('Full name is required');
      if (!email || !email.includes('@')) errors.push('Valid email is required');
      else if (seenEmailsInFile.has(email)) errors.push('Duplicate email within CSV file');
      else if (existingEmails.has(email)) errors.push('Email already exists in system');
      seenEmailsInFile.add(email);

      if (!departmentName) errors.push('Department name is required');
      else if (!deptMap.has(departmentName.toLowerCase())) {
        errors.push(`Department "${departmentName}" does not exist in organization setup`);
      }

      if (isNaN(salary) || salary <= 0) {
        errors.push('Salary must be greater than 0');
      }

      processedRows.push({
        rowNumber: idx + 2,
        isValid: errors.length === 0,
        errors,
        data: {
          fullName,
          email,
          departmentName,
          departmentId: deptMap.get(departmentName.toLowerCase()),
          designationTitle,
          status: 'Active',
          role: 'employee',
          basicSalary: salary || 50000,
          salaryStructure: {
            basicSalary: salary || 50000,
            houseRentAllowance: Math.round((salary || 50000) * 0.4),
            medicalAllowance: Math.round((salary || 50000) * 0.1),
            conveyanceAllowance: 10000,
            specialAllowance: 5000,
            grossSalary: Math.round((salary || 50000) * 1.5) + 15000,
            providentFundRate: 5,
            taxDeductionRate: 5,
          },
        },
      });
    }

    const validRows = processedRows.filter((r) => r.isValid).length;

    return {
      totalRows: processedRows.length,
      validRows,
      invalidRows: processedRows.length - validRows,
      rows: processedRows,
    };
  }

  async commitCsv(rows: any[], currentUser: AuthUser) {
    let createdCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.isValid && row.data === undefined) continue;
      const data = row.data || row;
      try {
        let deptId = data.departmentId;
        if (!deptId) {
          const dept = await this.prisma.department.findFirst({
            where: { name: { equals: data.departmentName, mode: 'insensitive' } },
          });
          deptId = dept?.id;
        }

        if (!deptId) {
          errors.push(`Row for ${data.fullName}: Department ${data.departmentName} not found`);
          continue;
        }

        let desig = await this.prisma.designation.findFirst({
          where: {
            departmentId: deptId,
            title: { equals: data.designationTitle || 'Associate', mode: 'insensitive' },
          },
        });

        if (!desig) {
          desig = await this.prisma.designation.create({
            data: {
              title: data.designationTitle || 'Associate',
              departmentId: deptId,
              level: 'L2',
              baseSalaryMin: 40000,
              baseSalaryMax: 120000,
            },
          });
        }

        await this.createEmployee(
          {
            fullName: data.fullName,
            email: data.email,
            phone: data.phone || '+92 300 0000000',
            address: data.address || 'Karachi, Pakistan',
            departmentId: deptId,
            designationId: desig.id,
            basicSalary: data.basicSalary || data.salaryStructure?.basicSalary || 50000,
          },
          currentUser,
        );
        createdCount++;
      } catch (err: any) {
        errors.push(`Row for ${data.fullName}: ${err.message}`);
      }
    }

    return {
      success: true,
      committedCount: createdCount,
      errors,
    };
  }

  async exportCsv(): Promise<string> {
    const employees = await this.prisma.employee.findMany({
      include: {
        department: true,
        designation: true,
        salaryStructure: true,
      },
      orderBy: { employeeCode: 'asc' },
    });

    const headers = [
      'Employee Code',
      'Full Name',
      'Email',
      'Phone',
      'Department',
      'Designation',
      'Joining Date',
      'Status',
      'Basic Salary',
      'Gross Salary',
    ];

    const lines = [headers.join(',')];

    for (const e of employees) {
      lines.push(
        [
          `"${e.employeeCode}"`,
          `"${e.fullName}"`,
          `"${e.email}"`,
          `"${e.phone}"`,
          `"${e.department.name}"`,
          `"${e.designation.title}"`,
          `"${e.joiningDate}"`,
          `"${e.status}"`,
          `${e.salaryStructure?.basicSalary || 0}`,
          `${e.salaryStructure?.grossSalary || 0}`,
        ].join(','),
      );
    }

    return lines.join('\n');
  }
}
