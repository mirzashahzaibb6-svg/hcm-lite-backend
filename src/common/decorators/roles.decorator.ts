import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: (Role | 'admin' | 'hr' | 'employee')[]) =>
  SetMetadata(
    ROLES_KEY,
    roles.map((r) => r.toUpperCase() as Role),
  );
