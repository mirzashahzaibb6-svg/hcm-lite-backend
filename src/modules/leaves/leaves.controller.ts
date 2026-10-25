import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeavesService } from './leaves.service';
import { ApplyLeaveDto, ReviewLeaveDto } from './dto/leaves.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('M5: Leave Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leaves')
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Get('balances')
  @ApiOperation({ summary: 'Get current leave balances and quotas for authenticated employee' })
  async getBalances(@CurrentUser() user: AuthUser) {
    return this.leavesService.getBalances(user);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get leave requests (Employees see own; HR/Admin see all)' })
  async getRequests(@CurrentUser() user: AuthUser) {
    return this.leavesService.getRequests(user);
  }

  @Post('apply')
  @ApiOperation({ summary: 'Apply for leave with server-side working day calculation and quota validation' })
  async applyLeave(@Body() dto: ApplyLeaveDto, @CurrentUser() user: AuthUser) {
    return this.leavesService.applyLeave(dto, user);
  }

  @Delete('requests/:id/cancel')
  @ApiOperation({ summary: 'Cancel an eligible pending leave request' })
  async cancelLeave(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.leavesService.cancelLeave(id, user);
  }

  @Patch('requests/:id/review')
  @Roles(Role.ADMIN, Role.HR)
  @ApiOperation({ summary: 'Approve or reject leave request with comments (HR/Admin only)' })
  async reviewLeave(
    @Param('id') id: string,
    @Body() dto: ReviewLeaveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.leavesService.reviewLeave(id, dto, user);
  }
}
