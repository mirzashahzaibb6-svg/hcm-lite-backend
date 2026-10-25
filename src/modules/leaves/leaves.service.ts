import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { ApprovalStatus, AuditModule, Role } from '@prisma/client';
import { ApplyLeaveDto, ReviewLeaveDto } from './dto/leaves.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async getEmployeeForUser(currentUser: AuthUser) {
    if (currentUser.employeeId) {
      const emp = await this.prisma.employee.findUnique({
        where: { id: currentUser.employeeId },
        include: { department: true },
      });
      if (emp) return emp;
    }

    const empByUser = await this.prisma.employee.findFirst({
      where: { userId: currentUser.id },
      include: { department: true },
    });

    if (!empByUser) {
      throw new BadRequestException('No employee record associated with this account');
    }
    return empByUser;
  }

  // Calculate working days excluding weekend days and public holidays
  async calculateWorkingDays(startDateStr: string, endDateStr: string): Promise<number> {
    const settings = await this.prisma.companySettings.findFirst();
    const weekendDays = (settings?.weekendDays || 'Saturday,Sunday')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim());

    const holidays = await this.prisma.publicHoliday.findMany({
      where: {
        date: { gte: startDateStr, lte: endDateStr },
      },
    });
    const holidayDateSet = new Set(holidays.map((h) => h.date));

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    if (start > end) {
      throw new UnprocessableEntityException('Start date cannot be after end date');
    }

    let workingDays = 0;
    const cur = new Date(start);

    const dayNameMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    while (cur <= end) {
      const dayName = dayNameMap[cur.getDay()];
      const curStr = cur.toISOString().split('T')[0];

      const isWeekend = weekendDays.includes(dayName);
      const isHoliday = holidayDateSet.has(curStr);

      if (!isWeekend && !isHoliday) {
        workingDays++;
      }

      cur.setDate(cur.getDate() + 1);
    }

    return workingDays;
  }

  async getBalances(currentUser: AuthUser) {
    const employee = await this.getEmployeeForUser(currentUser);
    const currentYear = new Date().getFullYear();

    let balances = await this.prisma.employeeLeaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      include: { leaveType: true },
    });

    // If balances haven't been seeded yet for this user/year, initialize them
    if (balances.length === 0) {
      const leaveTypes = await this.prisma.leaveType.findMany();
      for (const lt of leaveTypes) {
        await this.prisma.employeeLeaveBalance.create({
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
      balances = await this.prisma.employeeLeaveBalance.findMany({
        where: { employeeId: employee.id, year: currentYear },
        include: { leaveType: true },
      });
    }

    return balances.map((b) => ({
      leaveTypeId: b.leaveTypeId,
      leaveTypeName: b.leaveType.name,
      quotaDays: b.allocatedDays,
      usedDays: b.usedDays,
      pendingDays: b.pendingDays,
      remainingDays: b.remainingDays,
    }));
  }

  async getRequests(currentUser: AuthUser) {
    const where: any = {};
    if (currentUser.role === 'EMPLOYEE') {
      const employee = await this.getEmployeeForUser(currentUser);
      where.employeeId = employee.id;
    }

    const requests = await this.prisma.leaveRequest.findMany({
      where,
      include: {
        employee: { include: { department: true } },
        leaveType: true,
      },
      orderBy: { appliedAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      employeeId: r.employee.employeeCode,
      employeeName: r.employee.fullName,
      departmentName: r.employee.department.name,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveType.name,
      startDate: r.startDate,
      endDate: r.endDate,
      workingDays: r.workingDays,
      reason: r.reason,
      status: r.status.toLowerCase(),
      appliedAt: r.appliedAt.toLocaleString(),
      reviewedBy: r.reviewedById || undefined,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toLocaleString() : undefined,
      reviewComment: r.reviewComment || undefined,
    }));
  }

  async applyLeave(dto: ApplyLeaveDto, currentUser: AuthUser) {
    const employee = await this.getEmployeeForUser(currentUser);
    const currentYear = new Date().getFullYear();

    // 1. Calculate working days
    const workingDays = await this.calculateWorkingDays(dto.startDate, dto.endDate);
    if (workingDays <= 0) {
      throw new UnprocessableEntityException(
        'Selected leave period has 0 working days (dates fall on weekends or public holidays)',
      );
    }

    // 2. Validate leave type
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { OR: [{ id: dto.leaveTypeId }, { code: dto.leaveTypeId }] },
    });
    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    // 3. Overlap check: No overlapping pending or approved leave requests
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: [ApprovalStatus.PENDING, ApprovalStatus.APPROVED] },
        AND: [
          { startDate: { lte: dto.endDate } },
          { endDate: { gte: dto.startDate } },
        ],
      },
    });

    if (overlapping) {
      throw new UnprocessableEntityException(
        `Overlapping leave request already exists from ${overlapping.startDate} to ${overlapping.endDate}`,
      );
    }

    // 4. Quota and Balance validation
    let balance = await this.prisma.employeeLeaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: currentYear,
        },
      },
    });

    if (!balance) {
      balance = await this.prisma.employeeLeaveBalance.create({
        data: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: currentYear,
          allocatedDays: leaveType.defaultQuota,
          usedDays: 0,
          pendingDays: 0,
          remainingDays: leaveType.defaultQuota,
        },
      });
    }

    if (leaveType.isPaid && leaveType.defaultQuota > 0 && balance.remainingDays < workingDays) {
      throw new UnprocessableEntityException(
        `Insufficient leave balance. Requested ${workingDays} days, but remaining balance is only ${balance.remainingDays} days.`,
      );
    }

    // 5. Create Request and update pending balance in transaction
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          startDate: dto.startDate,
          endDate: dto.endDate,
          workingDays,
          reason: dto.reason.trim(),
          status: ApprovalStatus.PENDING,
          isAiGenerated: dto.isAiGenerated || false,
        },
        include: {
          leaveType: true,
          employee: { include: { department: true } },
        },
      });

      await tx.employeeLeaveBalance.update({
        where: { id: balance!.id },
        data: {
          pendingDays: balance!.pendingDays + workingDays,
          remainingDays: Math.max(0, balance!.remainingDays - workingDays),
        },
      });

      return created;
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'APPLY_LEAVE',
      module: AuditModule.LEAVE,
      description: `Applied for ${workingDays} days of ${leaveType.name} from ${dto.startDate} to ${dto.endDate}`,
      afterData: request,
    });

    return {
      id: request.id,
      employeeId: request.employee.employeeCode,
      employeeName: request.employee.fullName,
      departmentName: request.employee.department.name,
      leaveTypeId: request.leaveTypeId,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      workingDays: request.workingDays,
      reason: request.reason,
      status: request.status.toLowerCase(),
      appliedAt: request.appliedAt.toLocaleString(),
    };
  }

  async cancelLeave(id: string, currentUser: AuthUser) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    if (currentUser.role === 'EMPLOYEE') {
      const emp = await this.getEmployeeForUser(currentUser);
      if (request.employeeId !== emp.id) {
        throw new ForbiddenException('You can only cancel your own leave requests');
      }
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Only PENDING leave requests can be cancelled');
    }

    const currentYear = new Date().getFullYear();

    await this.prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { status: ApprovalStatus.CANCELLED },
      });

      const balance = await tx.employeeLeaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: currentYear,
          },
        },
      });

      if (balance) {
        await tx.employeeLeaveBalance.update({
          where: { id: balance.id },
          data: {
            pendingDays: Math.max(0, balance.pendingDays - request.workingDays),
            remainingDays: balance.remainingDays + request.workingDays,
          },
        });
      }
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'CANCEL_LEAVE',
      module: AuditModule.LEAVE,
      description: `Cancelled leave request ${request.id}`,
    });

    return { success: true };
  }

  async reviewLeave(id: string, dto: ReviewLeaveDto, reviewer: AuthUser) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true, leaveType: true },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Leave request has already been reviewed');
    }

    const newStatus = dto.status === 'approved' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const currentYear = new Date().getFullYear();

    await this.prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: newStatus,
          reviewedById: reviewer.name || reviewer.email,
          reviewedAt: new Date(),
          reviewComment: dto.comment,
        },
      });

      const balance = await tx.employeeLeaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year: currentYear,
          },
        },
      });

      if (balance) {
        if (newStatus === ApprovalStatus.APPROVED) {
          await tx.employeeLeaveBalance.update({
            where: { id: balance.id },
            data: {
              pendingDays: Math.max(0, balance.pendingDays - request.workingDays),
              usedDays: balance.usedDays + request.workingDays,
            },
          });
        } else {
          // If rejected, restore remaining days
          await tx.employeeLeaveBalance.update({
            where: { id: balance.id },
            data: {
              pendingDays: Math.max(0, balance.pendingDays - request.workingDays),
              remainingDays: balance.remainingDays + request.workingDays,
            },
          });
        }
      }
    });

    await this.auditService.log({
      userId: reviewer.id,
      userEmail: reviewer.email,
      userRole: reviewer.role as Role,
      action: 'REVIEW_LEAVE',
      module: AuditModule.LEAVE,
      description: `${newStatus} leave request for ${request.employee.fullName} (${request.workingDays} days)`,
    });

    return { success: true };
  }
}
