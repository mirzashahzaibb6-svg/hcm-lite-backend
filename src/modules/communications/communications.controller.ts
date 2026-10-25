import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';
import { CreateAnnouncementDto } from './dto/communications.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('M9: Communications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly commsService: CommunicationsService) {}

  @Get('announcements')
  @ApiOperation({ summary: 'Get list of organization announcements' })
  async getAnnouncements() {
    return this.commsService.getAnnouncements();
  }

  @Post('announcements')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Publish new company announcement (HR/Admin only)' })
  async createAnnouncement(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.commsService.createAnnouncement(dto, user);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Get in-app notifications for authenticated user' })
  async getNotifications(@CurrentUser() user: AuthUser) {
    return this.commsService.getNotifications(user);
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark in-app notification as read' })
  async markAsRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.commsService.markAsRead(id, user);
  }
}

@ApiTags('M9: Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly commsService: CommunicationsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get immutable audit logs with before/after state (Admin only)' })
  async getAuditLogs(
    @Query('module') module?: string,
    @Query('action') action?: string,
  ) {
    return this.commsService.getAuditLogs({ module, action });
  }
}
