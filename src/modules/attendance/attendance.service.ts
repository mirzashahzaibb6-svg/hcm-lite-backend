import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { AttendanceStatus, ApprovalStatus, AuditModule, Role } from '@prisma/client';
import { CheckInDto, AttendanceCorrectionDto, ReviewCorrectionDto } from './dto/attendance.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

@Injectable()
export class AttendanceService {
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
      throw new BadRequestException('No employee record associated with your user account');
    }
    return empByUser;
  }

  async checkIn(dto: CheckInDto, currentUser: AuthUser) {
    const employee = await this.getEmployeeForUser(currentUser);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Check duplicate check-in (Rule: 1 record per employee per day -> 409 Conflict)
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
    });

    if (existing) {
      throw new ConflictException('You have already checked in today');
    }

    // Get company settings for grace time and coordinates
    const settings = await this.prisma.companySettings.findFirst();
    const workStartTime = settings?.workStartTime || '09:00';
    const graceMinutes = settings?.graceTimeMinutes || 15;

    const [startH, startM] = workStartTime.split(':').map(Number);
    const cutoffMinutes = startH * 60 + startM + graceMinutes;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const isLate = currentMinutes > cutoffMinutes;
    const status: AttendanceStatus = isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    let isWithinRadius = true;
    if (dto.latitude !== undefined && dto.longitude !== undefined && settings) {
      const distance = haversineDistanceMeters(
        dto.latitude,
        dto.longitude,
        settings.officeLatitude,
        settings.officeLongitude,
      );
      isWithinRadius = distance <= settings.attendanceRadiusMeters;
    }

    const record = await this.prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        date: today,
        checkInTime: now,
        status,
        latitude: dto.latitude,
        longitude: dto.longitude,
        isWithinRadius,
        faceVerified: (dto.faceScore || 0) >= 80,
        faceMatchScore: dto.faceScore,
        notes: isLate
          ? `Checked in at ${now.toTimeString().split(' ')[0]} (Late after ${workStartTime} + ${graceMinutes}m grace)`
          : 'On-time punch',
      },
      include: {
        employee: { include: { department: true } },
      },
    });

    return {
      id: record.id,
      employeeId: record.employee.employeeCode,
      employeeName: record.employee.fullName,
      departmentName: record.employee.department.name,
      date: record.date,
      checkInTime: now.toTimeString().split(' ')[0],
      status: record.status.toLowerCase(),
      checkInLatitude: record.latitude,
      checkInLongitude: record.longitude,
      isWithinRadius: record.isWithinRadius,
      faceMatchScore: record.faceMatchScore,
      notes: record.notes,
    };
  }

  async checkOut(currentUser: AuthUser) {
    const employee = await this.getEmployeeForUser(currentUser);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const record = await this.prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
      include: { employee: { include: { department: true } } },
    });

    if (!record || !record.checkInTime) {
      throw new BadRequestException('No check-in record found for today. You must check in first.');
    }

    if (record.checkOutTime) {
      throw new ConflictException('You have already checked out today');
    }

    const settings = await this.prisma.companySettings.findFirst();
    const halfDayThreshold = settings?.halfDayThresholdHours || 5.0;

    const diffMs = now.getTime() - record.checkInTime.getTime();
    const workingHours = Number((diffMs / (1000 * 60 * 60)).toFixed(2));

    let finalStatus = record.status;
    if (workingHours < halfDayThreshold) {
      finalStatus = AttendanceStatus.HALF_DAY;
    }

    const updated = await this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        totalWorkingHours: workingHours,
        status: finalStatus,
        notes: workingHours < halfDayThreshold
          ? `${record.notes || ''} [Less than ${halfDayThreshold}h working hours - marked Half-Day]`.trim()
          : record.notes,
      },
      include: { employee: { include: { department: true } } },
    });

    return {
      id: updated.id,
      employeeId: updated.employee.employeeCode,
      employeeName: updated.employee.fullName,
      departmentName: updated.employee.department.name,
      date: updated.date,
      checkInTime: updated.checkInTime?.toTimeString().split(' ')[0],
      checkOutTime: now.toTimeString().split(' ')[0],
      totalWorkingHours: updated.totalWorkingHours,
      status: updated.status.toLowerCase(),
      checkInLatitude: updated.latitude,
      checkInLongitude: updated.longitude,
      isWithinRadius: updated.isWithinRadius,
      faceMatchScore: updated.faceMatchScore,
      notes: updated.notes,
    };
  }

  async getDailyBoard(date?: string, department?: string) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const whereDept: any = {};
    if (department && department !== 'All') {
      whereDept.name = department;
    }

    // Get all active employees
    const employees = await this.prisma.employee.findMany({
      where: {
        department: whereDept,
      },
      include: {
        department: true,
        attendanceRecords: {
          where: { date: targetDate },
        },
        leaveRequests: {
          where: {
            status: ApprovalStatus.APPROVED,
            startDate: { lte: targetDate },
            endDate: { gte: targetDate },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return employees.map((emp) => {
      const att = emp.attendanceRecords[0];
      const leave = emp.leaveRequests[0];

      if (att) {
        return {
          id: att.id,
          employeeId: emp.employeeCode,
          employeeName: emp.fullName,
          departmentName: emp.department.name,
          date: targetDate,
          checkInTime: att.checkInTime ? att.checkInTime.toTimeString().split(' ')[0] : undefined,
          checkOutTime: att.checkOutTime ? att.checkOutTime.toTimeString().split(' ')[0] : undefined,
          totalWorkingHours: att.totalWorkingHours,
          status: att.status.toLowerCase(),
          checkInLatitude: att.latitude,
          checkInLongitude: att.longitude,
          isWithinRadius: att.isWithinRadius,
          faceMatchScore: att.faceMatchScore,
          notes: att.notes,
        };
      }

      if (leave) {
        return {
          id: `leave-${emp.id}-${targetDate}`,
          employeeId: emp.employeeCode,
          employeeName: emp.fullName,
          departmentName: emp.department.name,
          date: targetDate,
          status: 'on_leave',
          notes: `Approved leave: ${leave.reason}`,
        };
      }

      return {
        id: `absent-${emp.id}-${targetDate}`,
        employeeId: emp.employeeCode,
        employeeName: emp.fullName,
        departmentName: emp.department.name,
        date: targetDate,
        status: 'absent',
        notes: 'No check-in record and no approved leave found',
      };
    });
  }

  async getPersonalHistory(employeeIdOrCode?: string, currentUser?: AuthUser) {
    let targetEmployeeId: string;

    if (currentUser?.role === 'EMPLOYEE') {
      const emp = await this.getEmployeeForUser(currentUser);
      targetEmployeeId = emp.id;
    } else if (employeeIdOrCode) {
      const found = await this.prisma.employee.findFirst({
        where: { OR: [{ id: employeeIdOrCode }, { employeeCode: employeeIdOrCode }] },
      });
      if (!found) throw new NotFoundException('Employee not found');
      targetEmployeeId = found.id;
    } else {
      const emp = await this.getEmployeeForUser(currentUser!);
      targetEmployeeId = emp.id;
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: { employeeId: targetEmployeeId },
      include: { employee: { include: { department: true } } },
      orderBy: { date: 'desc' },
      take: 60,
    });

    return records.map((r) => ({
      id: r.id,
      employeeId: r.employee.employeeCode,
      employeeName: r.employee.fullName,
      departmentName: r.employee.department.name,
      date: r.date,
      checkInTime: r.checkInTime ? r.checkInTime.toTimeString().split(' ')[0] : undefined,
      checkOutTime: r.checkOutTime ? r.checkOutTime.toTimeString().split(' ')[0] : undefined,
      totalWorkingHours: r.totalWorkingHours,
      status: r.status.toLowerCase(),
      checkInLatitude: r.latitude,
      checkInLongitude: r.longitude,
      isWithinRadius: r.isWithinRadius,
      faceMatchScore: r.faceMatchScore,
      notes: r.notes,
    }));
  }

  async requestCorrection(dto: AttendanceCorrectionDto, currentUser: AuthUser) {
    const employee = await this.getEmployeeForUser(currentUser);

    const existingAtt = await this.prisma.attendanceRecord.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: dto.attendanceDate,
        },
      },
    });

    const correction = await this.prisma.attendanceCorrection.create({
      data: {
        employeeId: employee.id,
        attendanceDate: dto.attendanceDate,
        originalCheckIn: existingAtt?.checkInTime ? existingAtt.checkInTime.toTimeString().split(' ')[0] : undefined,
        originalCheckOut: existingAtt?.checkOutTime ? existingAtt.checkOutTime.toTimeString().split(' ')[0] : undefined,
        requestedCheckIn: dto.requestedCheckIn,
        requestedCheckOut: dto.requestedCheckOut,
        reason: dto.reason.trim(),
        status: ApprovalStatus.PENDING,
      },
      include: { employee: { include: { department: true } } },
    });

    await this.auditService.log({
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role as Role,
      action: 'REQUEST_ATTENDANCE_CORRECTION',
      module: AuditModule.ATTENDANCE,
      description: `Submitted correction request for ${dto.attendanceDate}: ${dto.reason}`,
      afterData: correction,
    });

    return {
      id: correction.id,
      employeeId: employee.employeeCode,
      employeeName: employee.fullName,
      departmentName: employee.department.name,
      attendanceDate: correction.attendanceDate,
      originalCheckIn: correction.originalCheckIn,
      originalCheckOut: correction.originalCheckOut,
      requestedCheckIn: correction.requestedCheckIn,
      requestedCheckOut: correction.requestedCheckOut,
      reason: correction.reason,
      status: correction.status.toLowerCase(),
      submittedAt: correction.createdAt.toLocaleString(),
    };
  }

  async getCorrections(currentUser: AuthUser) {
    const where: any = {};
    if (currentUser.role === 'EMPLOYEE') {
      const emp = await this.getEmployeeForUser(currentUser);
      where.employeeId = emp.id;
    }

    const list = await this.prisma.attendanceCorrection.findMany({
      where,
      include: { employee: { include: { department: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return list.map((c) => ({
      id: c.id,
      employeeId: c.employee.employeeCode,
      employeeName: c.employee.fullName,
      departmentName: c.employee.department.name,
      attendanceDate: c.attendanceDate,
      originalCheckIn: c.originalCheckIn,
      originalCheckOut: c.originalCheckOut,
      requestedCheckIn: c.requestedCheckIn,
      requestedCheckOut: c.requestedCheckOut,
      reason: c.reason,
      status: c.status.toLowerCase(),
      submittedAt: c.createdAt.toLocaleString(),
      reviewedBy: c.reviewedById || undefined,
      reviewedAt: c.reviewedAt ? c.reviewedAt.toLocaleString() : undefined,
      reviewComment: c.reviewComment || undefined,
    }));
  }

  async reviewCorrection(id: string, dto: ReviewCorrectionDto, reviewer: AuthUser) {
    const correction = await this.prisma.attendanceCorrection.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!correction) {
      throw new NotFoundException('Attendance correction request not found');
    }

    const newStatus = dto.status === 'approved' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;

    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceCorrection.update({
        where: { id },
        data: {
          status: newStatus,
          reviewedById: reviewer.name || reviewer.email,
          reviewedAt: new Date(),
          reviewComment: dto.comment,
        },
      });

      // If approved, update or create AttendanceRecord
      if (newStatus === ApprovalStatus.APPROVED) {
        const inParts = correction.requestedCheckIn.split(':').map(Number);
        const outParts = correction.requestedCheckOut.split(':').map(Number);

        const checkInDate = new Date(`${correction.attendanceDate}T${correction.requestedCheckIn}Z`);
        const checkOutDate = new Date(`${correction.attendanceDate}T${correction.requestedCheckOut}Z`);
        const totalHours = Math.max(
          1,
          Number(((checkOutDate.getTime() - checkInDate.getTime()) / 3600000).toFixed(2)),
        );

        const status = inParts[0] > 9 || (inParts[0] === 9 && inParts[1] > 15) ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

        await tx.attendanceRecord.upsert({
          where: {
            employeeId_date: {
              employeeId: correction.employeeId,
              date: correction.attendanceDate,
            },
          },
          create: {
            employeeId: correction.employeeId,
            date: correction.attendanceDate,
            checkInTime: checkInDate,
            checkOutTime: checkOutDate,
            totalWorkingHours: totalHours,
            status,
            notes: `Adjusted via approved correction request (${correction.reason})`,
          },
          update: {
            checkInTime: checkInDate,
            checkOutTime: checkOutDate,
            totalWorkingHours: totalHours,
            status,
            notes: `Adjusted via approved correction request (${correction.reason})`,
          },
        });
      }
    });

    await this.auditService.log({
      userId: reviewer.id,
      userEmail: reviewer.email,
      userRole: reviewer.role as Role,
      action: 'REVIEW_ATTENDANCE_CORRECTION',
      module: AuditModule.ATTENDANCE,
      description: `${newStatus} attendance correction for ${correction.employee.fullName} on ${correction.attendanceDate}`,
    });

    return { success: true };
  }
}
