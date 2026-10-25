import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/services/audit.service';

describe('PayrollService — Business Rules', () => {
  let service: PayrollService;

  const mockPrisma = {
    payrollRun: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    payrollItem: {
      deleteMany: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    payslip: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
  };

  const mockAudit = {
    log: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should compute tax exempt under 600,000 PKR annually (50,000/mo)', () => {
    // calculateIncomeTax is private, test via any cast
    const tax = (service as any).calculateIncomeTax(45000);
    expect(tax).toBe(0);
  });

  it('should compute 5% tax bracket on salary exceeding 600,000 PKR annually', () => {
    // 80,000 * 12 = 960,000 -> excess = 360,000 * 5% = 18,000 / 12 = 1500
    const tax = (service as any).calculateIncomeTax(80000);
    expect(tax).toBe(1500);
  });

  it('should compute progressive tax for higher brackets accurately', () => {
    // 150,000 * 12 = 1,800,000 -> 30,000 + (600,000 * 0.15) = 120,000 / 12 = 10,000
    const tax = (service as any).calculateIncomeTax(150000);
    expect(tax).toBe(10000);
  });
});
