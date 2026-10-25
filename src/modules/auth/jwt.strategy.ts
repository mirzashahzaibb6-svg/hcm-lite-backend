import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'hcm-lite-jwt-secret-saylani-2026-super-secure-key',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        employee: {
          include: {
            department: true,
            designation: true,
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or no longer exists');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employee?.id,
      employeeCode: user.employee?.employeeCode,
      name: user.employee?.fullName || (user.role === 'ADMIN' ? 'System Administrator' : user.email.split('@')[0]),
      departmentId: user.employee?.departmentId,
      departmentName: user.employee?.department?.name,
      designationTitle: user.employee?.designation?.title,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
