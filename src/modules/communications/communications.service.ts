import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/communications.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { Priority } from '@prisma/client';

@Injectable()
export class CommunicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnnouncements() {
    const list = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return list.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      priority: a.priority.toLowerCase(),
      targetDepartment: a.targetDepartment,
      authorName: a.authorName,
      createdAt: a.createdAt.toLocaleString(),
    }));
  }

  async createAnnouncement(dto: CreateAnnouncementDto, currentUser: AuthUser) {
    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        content: dto.content.trim(),
        priority: dto.priority || Priority.NORMAL,
        targetDepartment: dto.targetDepartment || 'All',
        authorName: currentUser.name || currentUser.email,
        authorId: currentUser.id,
      },
    });

    return {
      id: created.id,
      title: created.title,
      content: created.content,
      priority: created.priority.toLowerCase(),
      targetDepartment: created.targetDepartment,
      authorName: created.authorName,
      createdAt: created.createdAt.toLocaleString(),
    };
  }

  async getNotifications(currentUser: AuthUser) {
    const list = await this.prisma.notification.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return list.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.isRead,
      actionUrl: n.actionUrl || undefined,
      createdAt: n.createdAt.toLocaleString(),
    }));
  }

  async markAsRead(id: string, currentUser: AuthUser) {
    const notif = await this.prisma.notification.findUnique({ where: { id } });
    if (!notif) throw new NotFoundException('Notification not found');

    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return { success: true };
  }

  async getAuditLogs(filters?: { module?: string; action?: string }) {
    const where: any = {};
    if (filters?.module && filters.module !== 'All') {
      where.module = filters.module.toUpperCase();
    }
    if (filters?.action) {
      where.action = { contains: filters.action, mode: 'insensitive' };
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    return logs.map((l) => ({
      id: l.id,
      userEmail: l.userEmail,
      userRole: l.userRole.toLowerCase(),
      action: l.action,
      module: l.module,
      description: l.description,
      ipAddress: l.ipAddress,
      timestamp: l.timestamp.toLocaleString(),
      beforeData: l.beforeData || undefined,
      afterData: l.afterData || undefined,
    }));
  }
}
