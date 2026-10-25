import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  OnApplicationBootstrap,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { AuditModule, Role } from '@prisma/client';
import { LoginDto, ChangePasswordDto, FirstLoginResetDto } from './dto/auth.dto';

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedInitialSystemState();
  }

  private async seedInitialSystemState() {
    try {
      // 1. Ensure Company Settings exist
      const settingsCount = await this.prisma.companySettings.count();
      if (settingsCount === 0) {
        await this.prisma.companySettings.create({
          data: {
            companyName: 'Saylani Welfare International Trust — HCM Lite',
            taxId: 'PK-NTN-902418-S',
            website: 'https://saylaniwelfare.com',
            address: 'A-25, Bahadurabad Chowrangi, Karachi, Pakistan',
            contactEmail: 'hcm-support@saylani.org',
            contactPhone: '+92 21 111 729 526',
            workStartTime: '09:00',
            workEndTime: '18:00',
            graceTimeMinutes: 15,
            halfDayThresholdHours: 5.0,
            weekendDays: 'Saturday,Sunday',
            officeLatitude: 24.8738,
            officeLongitude: 67.0673,
            attendanceRadiusMeters: 200.0,
          },
        });
        this.logger.log('Initial Company Settings initialized successfully');
      }

      // 2. Ensure Default Leave Types exist
      const leaveTypesCount = await this.prisma.leaveType.count();
      if (leaveTypesCount === 0) {
        const defaultLeaveTypes = [
          { code: 'AL', name: 'Annual Leave', defaultQuota: 14, isPaid: true, color: '#3b82f6', requiresProof: false },
          { code: 'SL', name: 'Sick Leave', defaultQuota: 8, isPaid: true, color: '#ef4444', requiresProof: true },
          { code: 'CL', name: 'Casual Leave', defaultQuota: 10, isPaid: true, color: '#10b981', requiresProof: false },
          { code: 'UL', name: 'Unpaid Leave', defaultQuota: 0, isPaid: false, color: '#6b7280', requiresProof: false },
          { code: 'ML', name: 'Maternity/Paternity Leave', defaultQuota: 30, isPaid: true, color: '#8b5cf6', requiresProof: true },
        ];
        for (const lt of defaultLeaveTypes) {
          await this.prisma.leaveType.create({ data: lt });
        }
        this.logger.log('Default Leave Types initialized');
      }

      // 3. Ensure Default Departments exist
      const deptCount = await this.prisma.department.count();
      if (deptCount === 0) {
        const depts = [
          { name: 'Engineering', code: 'ENG', headName: 'Muhammad Daniyal', budget: 5000000 },
          { name: 'Human Resources', code: 'HR', headName: 'Ayesha Khan', budget: 2000000 },
          { name: 'Finance', code: 'FIN', headName: 'Farhan Zaidi', budget: 3500000 },
          { name: 'Operations', code: 'OPS', headName: 'Tariq Mehmood', budget: 2500000 },
          { name: 'Marketing', code: 'MKT', headName: 'Sara Ali', budget: 1800000 },
        ];
        for (const d of depts) {
          await this.prisma.department.create({ data: d });
        }
        this.logger.log('Default Departments initialized');
      }

      // 4. Ensure Initial Admin exists
      const adminCount = await this.prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount === 0) {
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@saylani.org';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Password123!';
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminPassword, salt);

        await this.prisma.user.create({
          data: {
            email: adminEmail.toLowerCase().trim(),
            passwordHash,
            role: Role.ADMIN,
            isActive: true,
            mustChangePassword: false,
          },
        });
        this.logger.log(`Initial Admin created: ${adminEmail}`);
      }
    } catch (err: any) {
      this.logger.error(`Error during initial state seeding: ${err.message}`, err.stack);
    }
  }

  async login(dto: LoginDto, ipAddress = '127.0.0.1') {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Your account has been deactivated. Please contact HR or Administrator.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const token = this.jwtService.sign(payload);

    await this.auditService.log({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'LOGIN_SUCCESS',
      module: AuditModule.AUTH,
      description: `User ${user.email} successfully logged in`,
      ipAddress,
    });

    const roleName = user.role.toLowerCase() as 'admin' | 'hr' | 'employee';

    return {
      token,
      user: {
        id: user.id,
        name: user.employee?.fullName || (user.role === Role.ADMIN ? 'System Administrator' : user.email.split('@')[0]),
        email: user.email,
        role: roleName,
        department: user.employee?.department?.name || (user.role === Role.ADMIN ? 'Executive Management' : undefined),
        designation: user.employee?.designation?.title || (user.role === Role.ADMIN ? 'Chief Technology Officer' : undefined),
        employeeId: user.employee?.employeeCode || user.employee?.id,
        isFirstLogin: user.mustChangePassword,
        avatar: user.employee?.avatar || undefined,
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Current password does not match');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.newPassword, salt);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
    });

    await this.auditService.log({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'PASSWORD_CHANGED',
      module: AuditModule.AUTH,
      description: `User ${user.email} changed their password`,
    });

    return { success: true };
  }

  async firstLoginReset(userId: string, dto: FirstLoginResetDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.newPassword, salt);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
      },
    });

    await this.auditService.log({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'FIRST_LOGIN_PASSWORD_RESET',
      module: AuditModule.AUTH,
      description: `User ${user.email} completed first-login password reset`,
    });

    return {
      success: true,
      user: {
        id: updated.id,
        name: updated.employee?.fullName || (updated.role === Role.ADMIN ? 'System Administrator' : updated.email.split('@')[0]),
        email: updated.email,
        role: updated.role.toLowerCase() as 'admin' | 'hr' | 'employee',
        department: updated.employee?.department?.name,
        designation: updated.employee?.designation?.title,
        employeeId: updated.employee?.employeeCode || updated.employee?.id,
        isFirstLogin: false,
        avatar: updated.employee?.avatar || undefined,
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      name: user.employee?.fullName || (user.role === Role.ADMIN ? 'System Administrator' : user.email.split('@')[0]),
      email: user.email,
      role: user.role.toLowerCase() as 'admin' | 'hr' | 'employee',
      department: user.employee?.department?.name || (user.role === Role.ADMIN ? 'Executive Management' : undefined),
      designation: user.employee?.designation?.title || (user.role === Role.ADMIN ? 'Chief Technology Officer' : undefined),
      employeeId: user.employee?.employeeCode || user.employee?.id,
      isFirstLogin: user.mustChangePassword,
      avatar: user.employee?.avatar || undefined,
    };
  }
}
