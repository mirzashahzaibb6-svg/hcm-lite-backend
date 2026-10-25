import { Global, Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { RolesGuard } from './guards/roles.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Global()
@Module({
  providers: [AuditService, RolesGuard, JwtAuthGuard],
  exports: [AuditService, RolesGuard, JwtAuthGuard],
})
export class CommonModule {}
