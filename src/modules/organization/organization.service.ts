import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { AuditModule, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  UpdateCompanyProfileDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  UpdateLeaveTypeQuotaDto,
  CreateHolidayDto,
  CreateHRAccountDto,
} from './dto/organization.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getProfile() {
    let settings = await this.prisma.companySettings.findFirst();
    if (!settings) {
      settings = await this.prisma.companySettings.create({
        data: {},
      });
    }

    const weekendArray = settings.weekendDays.split(',').map((s) => s.trim());

    return {
      companyName: settings.companyName,
      taxId: settings.taxId,
      website: settings.website,
      address: settings.address,
      contactEmail: settings.contactEmail,
      contactPhone: settings.contactPhone,
      officeHours: {
        startTime: settings.workStartTime,
        endTime: settings.workEndTime,
        gracePeriodMinutes: settings.graceTimeMinutes,
        halfDayThresholdHours: settings.halfDayThresholdHours,
      },
      weekendDays: weekendArray,
      officeCoordinates: {
        latitude: settings.officeLatitude,
        longitude: settings.officeLongitude,
        radiusMeters: settings.attendanceRadiusMeters,
      },
    };
  }

  async updateProfile(dto: UpdateCompanyProfileDto, adminUser: any) {
    const current = await this.prisma.companySettings.findFirst();
    if (!current) {
      throw new NotFoundException('Company settings record not found');
    }

    const updateData: any = {};
    if (dto.companyName !== undefined) updateData.companyName = dto.companyName;
    if (dto.taxId !== undefined) updateData.taxId = dto.taxId;
    if (dto.website !== undefined) updateData.website = dto.website;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.contactEmail !== undefined) updateData.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) updateData.contactPhone = dto.contactPhone;

    if (dto.officeHours) {
      if (dto.officeHours.startTime) updateData.workStartTime = dto.officeHours.startTime;
      if (dto.officeHours.endTime) updateData.workEndTime = dto.officeHours.endTime;
      if (dto.officeHours.gracePeriodMinutes !== undefined) updateData.graceTimeMinutes = dto.officeHours.gracePeriodMinutes;
      if (dto.officeHours.halfDayThresholdHours !== undefined) updateData.halfDayThresholdHours = dto.officeHours.halfDayThresholdHours;
    }

    if (dto.weekendDays) {
      updateData.weekendDays = Array.isArray(dto.weekendDays) ? dto.weekendDays.join(',') : dto.weekendDays;
    }

    if (dto.officeCoordinates) {
      if (dto.officeCoordinates.latitude !== undefined) updateData.officeLatitude = dto.officeCoordinates.latitude;
      if (dto.officeCoordinates.longitude !== undefined) updateData.officeLongitude = dto.officeCoordinates.longitude;
      if (dto.officeCoordinates.radiusMeters !== undefined) updateData.attendanceRadiusMeters = dto.officeCoordinates.radiusMeters;
    }

    const updated = await this.prisma.companySettings.update({
      where: { id: current.id },
      data: updateData,
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'UPDATE_COMPANY_PROFILE',
      module: AuditModule.ORGANIZATION,
      description: 'Updated company configuration and attendance parameters',
      beforeData: current,
      afterData: updated,
    });

    return this.getProfile();
  }

  async getDepartments() {
    const depts = await this.prisma.department.findMany({
      include: {
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return depts.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      headName: d.headName,
      budget: d.budget || 0,
      employeeCount: d._count.employees,
    }));
  }

  async createDepartment(dto: CreateDepartmentDto, adminUser: any) {
    const existing = await this.prisma.department.findFirst({
      where: {
        OR: [{ name: dto.name }, { code: dto.code.toUpperCase() }],
      },
    });

    if (existing) {
      throw new ConflictException('Department with this name or code already exists');
    }

    const dept = await this.prisma.department.create({
      data: {
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        headName: dto.headName.trim(),
        budget: dto.budget,
      },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'CREATE_DEPARTMENT',
      module: AuditModule.ORGANIZATION,
      description: `Created department: ${dept.name} (${dept.code})`,
      afterData: dept,
    });

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      headName: dept.headName,
      budget: dept.budget || 0,
      employeeCount: 0,
    };
  }

  async deleteDepartment(id: string, adminUser: any) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });

    if (!dept) {
      throw new NotFoundException('Department not found');
    }

    if (dept._count.employees > 0) {
      throw new BadRequestException('Cannot delete department with active employees');
    }

    await this.prisma.department.delete({ where: { id } });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'DELETE_DEPARTMENT',
      module: AuditModule.ORGANIZATION,
      description: `Deleted department: ${dept.name}`,
      beforeData: dept,
    });
  }

  async getDesignations() {
    const designations = await this.prisma.designation.findMany({
      include: { department: true },
      orderBy: { title: 'asc' },
    });

    return designations.map((d) => ({
      id: d.id,
      title: d.title,
      departmentId: d.departmentId,
      departmentName: d.department.name,
      level: d.level,
      baseSalaryMin: d.baseSalaryMin,
      baseSalaryMax: d.baseSalaryMax,
    }));
  }

  async createDesignation(dto: CreateDesignationDto, adminUser: any) {
    const designation = await this.prisma.designation.create({
      data: {
        title: dto.title.trim(),
        departmentId: dto.departmentId,
        level: dto.level || 'L3',
        baseSalaryMin: dto.baseSalaryMin || 50000,
        baseSalaryMax: dto.baseSalaryMax || 150000,
      },
      include: { department: true },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'CREATE_DESIGNATION',
      module: AuditModule.ORGANIZATION,
      description: `Created designation: ${designation.title} in ${designation.department.name}`,
      afterData: designation,
    });

    return {
      id: designation.id,
      title: designation.title,
      departmentId: designation.departmentId,
      departmentName: designation.department.name,
      level: designation.level,
      baseSalaryMin: designation.baseSalaryMin,
      baseSalaryMax: designation.baseSalaryMax,
    };
  }

  async getLeaveTypes() {
    const list = await this.prisma.leaveType.findMany({
      orderBy: { code: 'asc' },
    });

    return list.map((lt) => ({
      id: lt.id,
      name: lt.name,
      code: lt.code,
      quotaDays: lt.defaultQuota,
      isPaid: lt.isPaid,
      color: lt.color,
      requiresProof: lt.requiresProof,
    }));
  }

  async updateLeaveType(id: string, dto: UpdateLeaveTypeQuotaDto, adminUser: any) {
    const current = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Leave type not found');
    }

    const updated = await this.prisma.leaveType.update({
      where: { id },
      data: { defaultQuota: dto.quotaDays },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'UPDATE_LEAVE_QUOTA',
      module: AuditModule.ORGANIZATION,
      description: `Updated default quota for ${current.name} to ${dto.quotaDays} days`,
      beforeData: current,
      afterData: updated,
    });
  }

  async getHolidays() {
    return this.prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(dto: CreateHolidayDto, adminUser: any) {
    const holiday = await this.prisma.publicHoliday.create({
      data: {
        name: dto.name.trim(),
        date: dto.date.trim(),
        daysCount: dto.daysCount || 1,
        isRecurring: dto.isRecurring !== undefined ? dto.isRecurring : true,
        description: dto.description,
      },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'CREATE_PUBLIC_HOLIDAY',
      module: AuditModule.ORGANIZATION,
      description: `Added public holiday: ${holiday.name} on ${holiday.date}`,
      afterData: holiday,
    });

    return holiday;
  }

  async deleteHoliday(id: string, adminUser: any) {
    const hol = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!hol) {
      throw new NotFoundException('Holiday not found');
    }

    await this.prisma.publicHoliday.delete({ where: { id } });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'DELETE_PUBLIC_HOLIDAY',
      module: AuditModule.ORGANIZATION,
      description: `Deleted public holiday: ${hol.name}`,
      beforeData: hol,
    });
  }

  async getHRAccounts() {
    const users = await this.prisma.user.findMany({
      where: { role: Role.HR },
      include: {
        employee: {
          include: { department: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.employee?.fullName || u.email.split('@')[0],
      email: u.email,
      department: u.employee?.department?.name || 'Human Resources',
      status: u.isActive ? ('active' as const) : ('inactive' as const),
      createdAt: u.createdAt.toISOString().split('T')[0],
      employeeId: u.employee?.employeeCode,
    }));
  }

  async createHRAccount(dto: CreateHRAccountDto, adminUser: any) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: Role.HR,
        isActive: true,
        mustChangePassword: true,
      },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'CREATE_HR_ACCOUNT',
      module: AuditModule.ORGANIZATION,
      description: `Created HR account for ${user.email}`,
    });

    return {
      id: user.id,
      name: dto.name,
      email: user.email,
      department: dto.department,
      status: 'active' as const,
      createdAt: user.createdAt.toISOString().split('T')[0],
    };
  }

  async toggleHRStatus(id: string, adminUser: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { employee: { include: { department: true } } },
    });

    if (!user || user.role !== Role.HR) {
      throw new NotFoundException('HR Account not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      include: { employee: { include: { department: true } } },
    });

    await this.auditService.log({
      userId: adminUser.id,
      userEmail: adminUser.email,
      userRole: adminUser.role,
      action: 'TOGGLE_HR_STATUS',
      module: AuditModule.ORGANIZATION,
      description: `Toggled HR account status for ${user.email} to ${updated.isActive ? 'ACTIVE' : 'INACTIVE'}`,
    });

    return {
      id: updated.id,
      name: updated.employee?.fullName || updated.email.split('@')[0],
      email: updated.email,
      department: updated.employee?.department?.name || 'Human Resources',
      status: updated.isActive ? ('active' as const) : ('inactive' as const),
      createdAt: updated.createdAt.toISOString().split('T')[0],
      employeeId: updated.employee?.employeeCode,
    };
  }
}
