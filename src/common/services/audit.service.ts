import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditModule, Role } from '@prisma/client';

export interface CreateAuditLogParams {
  userId?: string;
  userEmail: string;
  userRole: Role;
  action: string;
  module: AuditModule;
  description: string;
  ipAddress?: string;
  beforeData?: any;
  afterData?: any;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: CreateAuditLogParams) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          userId: params.userId,
          userEmail: params.userEmail,
          userRole: params.userRole,
          action: params.action,
          module: params.module,
          description: params.description,
          ipAddress: params.ipAddress || '127.0.0.1',
          beforeData: params.beforeData ? JSON.parse(JSON.stringify(params.beforeData)) : undefined,
          afterData: params.afterData ? JSON.parse(JSON.stringify(params.afterData)) : undefined,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to record audit log: ${err.message}`, err.stack);
    }
  }
}
