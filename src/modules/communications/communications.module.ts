import { Module } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationsController, AuditLogsController } from './communications.controller';

@Module({
  controllers: [CommunicationsController, AuditLogsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
