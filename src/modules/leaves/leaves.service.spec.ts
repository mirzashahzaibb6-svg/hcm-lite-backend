import { Test, TestingModule } from '@nestjs/testing';
import { LeavesService } from './leaves.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { UnprocessableEntityException } from '@nestjs/common';

describe('LeavesService — Business Rules', () => {
  let service: LeavesService;
  let prisma: PrismaService;

  const mockPrisma = {
    companySettings: {
      findFirst: jest.fn().mockResolvedValue({
        weekendDays: 'Saturday,Sunday',
      }),
    },
    publicHoliday: {
      findMany: jest.fn().mockResolvedValue([
        { date: '2026-10-28', name: 'Special Public Holiday' },
      ]),
    },
    leaveType: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    leaveRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    employeeLeaveBalance: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockAudit = {
    log: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should accurately calculate working days excluding weekends (Sat/Sun)', async () => {
    // 2026-10-26 is Monday, 2026-10-30 is Friday (5 weekdays)
    // 2026-10-28 is a public holiday in mock
    // Expected working days: 5 weekdays - 1 holiday = 4 working days
    const workingDays = await service.calculateWorkingDays('2026-10-26', '2026-10-30');
    expect(workingDays).toBe(4);
  });

  it('should return 0 working days if range only contains weekend days', async () => {
    // 2026-10-24 is Saturday, 2026-10-25 is Sunday
    const workingDays = await service.calculateWorkingDays('2026-10-24', '2026-10-25');
    expect(workingDays).toBe(0);
  });

  it('should throw UnprocessableEntityException if start date is after end date', async () => {
    await expect(service.calculateWorkingDays('2026-10-28', '2026-10-26')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});
