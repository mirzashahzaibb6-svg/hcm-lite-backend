import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatMessageDto, SmartLeaveParserDto, SummarizeDashboardDto } from './dto/ai.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('M8: AI Assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Chat with HCM AI Assistant supporting live DB tools, Roman Urdu, and policy Q&A' })
  async chat(@Body() dto: ChatMessageDto, @CurrentUser() user: AuthUser) {
    return this.aiService.chat(dto, user);
  }

  @Post('smart-leave-parser')
  @ApiOperation({ summary: 'Parse plain English or Roman Urdu leave requests into structured form payload' })
  async parseSmartLeave(@Body() dto: SmartLeaveParserDto) {
    return this.aiService.parseSmartLeave(dto);
  }

  @Post('summarize-dashboard')
  @ApiOperation({ summary: 'Generate live AI executive or HR operations dashboard summary' })
  async summarizeDashboard(@Body() dto: SummarizeDashboardDto) {
    return this.aiService.summarizeDashboard(dto);
  }
}
