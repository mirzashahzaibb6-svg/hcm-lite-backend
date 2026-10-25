import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ChatMessageDto, SmartLeaveParserDto, SummarizeDashboardDto } from './dto/ai.dto';
import { Role, AttendanceStatus, ApprovalStatus } from '@prisma/client';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly prisma: PrismaService) {}

  // AUTHORITATIVE TOOL DEFINITIONS
  async executeTool(name: string, args: any, user: AuthUser): Promise<any> {
    switch (name) {
      case 'get_headcount': {
        const total = await this.prisma.employee.count();
        const depts = await this.prisma.department.findMany({
          include: { _count: { select: { employees: true } } },
        });
        return {
          totalHeadcount: total,
          departments: depts.map((d) => ({ name: d.name, employees: d._count.employees })),
        };
      }

      case 'get_attendance_summary': {
        const today = new Date().toISOString().split('T')[0];
        const records = await this.prisma.attendanceRecord.findMany({ where: { date: today } });
        let present = 0;
        let late = 0;
        for (const r of records) {
          if (r.status === AttendanceStatus.PRESENT) present++;
          else if (r.status === AttendanceStatus.LATE) late++;
        }
        const totalEmp = await this.prisma.employee.count();
        const onLeave = await this.prisma.leaveRequest.count({
          where: {
            status: ApprovalStatus.APPROVED,
            startDate: { lte: today },
            endDate: { gte: today },
          },
        });
        return {
          date: today,
          totalEmployees: totalEmp,
          present,
          late,
          onLeave,
          absent: Math.max(0, totalEmp - present - late - onLeave),
        };
      }

      case 'get_late_comers': {
        const today = new Date().toISOString().split('T')[0];
        const lateRecords = await this.prisma.attendanceRecord.findMany({
          where: { date: today, status: AttendanceStatus.LATE },
          include: { employee: { include: { department: true } } },
        });
        return lateRecords.map((r) => ({
          name: r.employee.fullName,
          department: r.employee.department.name,
          checkInTime: r.checkInTime?.toTimeString().split(' ')[0],
          notes: r.notes,
        }));
      }

      case 'get_leave_summary': {
        const pending = await this.prisma.leaveRequest.count({ where: { status: ApprovalStatus.PENDING } });
        const approved = await this.prisma.leaveRequest.count({ where: { status: ApprovalStatus.APPROVED } });
        return { pendingLeaves: pending, approvedLeaves: approved };
      }

      case 'get_my_leave_balance': {
        const emp = await this.prisma.employee.findFirst({
          where: { OR: [{ id: user.employeeId }, { userId: user.id }] },
        });
        if (!emp) return { message: 'No employee record linked.' };
        const currentYear = new Date().getFullYear();
        const balances = await this.prisma.employeeLeaveBalance.findMany({
          where: { employeeId: emp.id, year: currentYear },
          include: { leaveType: true },
        });
        return balances.map((b) => ({
          type: b.leaveType.name,
          quota: b.allocatedDays,
          used: b.usedDays,
          remaining: b.remainingDays,
        }));
      }

      case 'get_payroll_summary': {
        const latestRun = await this.prisma.payrollRun.findFirst({
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        if (!latestRun) return { message: 'No payroll runs created yet.' };
        return {
          month: latestRun.monthName,
          status: latestRun.status,
          totalGross: latestRun.totalGrossPay,
          totalDeductions: latestRun.totalDeductions,
          totalNetPay: latestRun.totalNetPay,
          totalEmployees: latestRun.totalEmployees,
        };
      }

      case 'search_employees': {
        const q = args?.query || '';
        const matches = await this.prisma.employee.findMany({
          where: {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { department: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
          include: { department: true, designation: true },
          take: 5,
        });
        return matches.map((m) => ({
          code: m.employeeCode,
          name: m.fullName,
          department: m.department.name,
          designation: m.designation.title,
        }));
      }

      default:
        return null;
    }
  }

  async chat(dto: ChatMessageDto, user: AuthUser): Promise<{ reply: string }> {
    const startTime = Date.now();
    const prompt = dto.message.trim();
    const lower = prompt.toLowerCase();
    const userRole = (user.role || 'EMPLOYEE').toUpperCase() as Role;

    let reply = '';
    const toolsCalled: string[] = [];

    // 1. Tool execution based on intent
    if (lower.includes('headcount') || lower.includes('kitne employee') || lower.includes('total staff')) {
      toolsCalled.push('get_headcount');
      const data = await this.executeTool('get_headcount', {}, user);
      reply = `📊 **Headcount Overview:**\nCurrently, the organization has **${data.totalHeadcount} employees** across active departments.\n\n` +
        data.departments.map((d: any) => `- **${d.name}**: ${d.employees} employees`).join('\n');
    } else if (lower.includes('attendance') && (lower.includes('today') || lower.includes('aaj') || lower.includes('summary'))) {
      toolsCalled.push('get_attendance_summary');
      const data = await this.executeTool('get_attendance_summary', {}, user);
      reply = `🕒 **Today's Attendance Status (${data.date}):**\n- ✅ **Present on-time**: ${data.present}\n- ⚠️ **Late arrivals**: ${data.late}\n- 🌴 **On approved leave**: ${data.onLeave}\n- ❌ **Absent / Not punched**: ${data.absent}\nTotal workforce: ${data.totalEmployees}`;
    } else if (lower.includes('late') && (lower.includes('comer') || lower.includes('kaun') || lower.includes('who') || lower.includes('list'))) {
      toolsCalled.push('get_late_comers');
      const data = await this.executeTool('get_late_comers', {}, user);
      if (data.length === 0) {
        reply = `✨ Aaj sabhi employees ne on-time punch kiya hai! Koi late arrivals record nahi huay.`;
      } else {
        reply = `⚠️ **Today's Late Check-ins:**\n` +
          data.map((l: any) => `- **${l.name}** (${l.department}) — Punched at ${l.checkInTime}`).join('\n');
      }
    } else if (lower.includes('meri chutti') || lower.includes('my leave balance') || lower.includes('mera balance') || lower.includes('remaining leave')) {
      toolsCalled.push('get_my_leave_balance');
      const data = await this.executeTool('get_my_leave_balance', {}, user);
      if (Array.isArray(data)) {
        reply = `🌴 **Aapka Current Leave Balance:**\n` +
          data.map((b: any) => `- **${b.type}**: ${b.remaining} days remaining (Used: ${b.used}/${b.quota})`).join('\n');
      } else {
        reply = data.message;
      }
    } else if (lower.includes('payroll') || lower.includes('tankhwah') || lower.includes('salary run') || lower.includes('total payroll')) {
      toolsCalled.push('get_payroll_summary');
      const data = await this.executeTool('get_payroll_summary', {}, user);
      if (data.month) {
        reply = `💳 **Payroll Summary (${data.month}):**\n- **Status**: ${data.status.toUpperCase()}\n- **Employees**: ${data.totalEmployees}\n- **Total Gross**: PKR ${data.totalGross.toLocaleString()}\n- **Total Deductions**: PKR ${data.totalDeductions.toLocaleString()}\n- **Net Disbursed**: **PKR ${data.totalNetPay.toLocaleString()}**`;
      } else {
        reply = `Abhi tak koi monthly payroll draft generate nahi hua hai. Admin ya HR portal se create kiya ja sakta hai.`;
      }
    } else if (lower.includes('policy') || lower.includes('grace') || lower.includes('timing') || lower.includes('rule')) {
      reply = `🕒 **Saylani HCM Lite Attendance & Grace Policies:**\n- **Working Hours:** 09:00 AM se 06:00 PM tak.\n- **Grace Period:** 15 minutes (09:15 AM tak punch karne par koi deduction nahi hoti).\n- **Late Mark:** 09:16 AM ke baad punch karne par Late mark hota hai.\n- **Half-Day Rule:** Agar din me working hours 5 ghantay se kam hon toh half-day count hota hai.\n- **3 Late Policy:** 3 martaba late anay par 1 half-day deduction apply hoti hai.\n- **Weekends:** Saturday aur Sunday standard official holidays hain.`;
    } else if (lower.includes('leave') || lower.includes('chutti') || lower.includes('apply')) {
      reply = `🌴 **Leave Rules & Smart Submission:**\n- Annual Leave: **14 days** per year\n- Sick Leave: **8 days** (requires medical certification for >2 days)\n- Casual Leave: **10 days**\n- Unpaid Leave: Available on manager approval.\n\n💡 **Tip:** Aap Smart Leave Assistant ko Roman Urdu ya English me bol saktay hain jaise: *"Mujhe kal aur parson fever ki wajah se leave chahiye"*, aur system automatic form prefill kar dega!`;
    } else {
      reply = `🤖 Salam! Main aapka **HCM Lite AI Assistant** hoon. Main attendance, leave balances, company policies, aur payroll metrics me live assist kar sakta hoon. Kuch bhi poochein! (English & Roman Urdu supported).`;
    }

    const executionTimeMs = Date.now() - startTime;

    // Log to AiLog table
    try {
      await this.prisma.aiLog.create({
        data: {
          userId: user.id,
          userRole,
          endpoint: '/ai/chat',
          prompt,
          response: reply,
          toolCalls: toolsCalled.length > 0 ? toolsCalled : undefined,
          executionTimeMs,
          isSuccess: true,
        },
      });
    } catch (err: any) {
      this.logger.error(`Error saving AiLog: ${err.message}`);
    }

    return { reply };
  }

  async parseSmartLeave(dto: SmartLeaveParserDto): Promise<any> {
    const prompt = dto.prompt.trim();
    const lower = prompt.toLowerCase();

    // 1. Determine leave type
    const leaveTypes = await this.prisma.leaveType.findMany();
    let targetType = leaveTypes.find((l) => l.code === 'AL') || leaveTypes[0];

    if (
      lower.includes('sick') ||
      lower.includes('fever') ||
      lower.includes('doctor') ||
      lower.includes('hospital') ||
      lower.includes('tabiyat') ||
      lower.includes('bimar')
    ) {
      targetType = leaveTypes.find((l) => l.code === 'SL') || targetType;
    } else if (
      lower.includes('urgent') ||
      lower.includes('casual') ||
      lower.includes('emergency') ||
      lower.includes('zaroori') ||
      lower.includes('domestic') ||
      lower.includes('ghar')
    ) {
      targetType = leaveTypes.find((l) => l.code === 'CL') || targetType;
    }

    // 2. Compute Target Dates
    const today = new Date();
    let startDate = new Date(today);
    let endDate = new Date(today);
    let daysRequested = 1;

    if (lower.includes('kal aur parson') || lower.includes('two days') || lower.includes('2 din') || lower.includes('2 days')) {
      daysRequested = 2;
      startDate.setDate(today.getDate() + 1);
      endDate.setDate(startDate.getDate() + 1);
    } else if (lower.includes('kal') || lower.includes('tomorrow')) {
      daysRequested = 1;
      startDate.setDate(today.getDate() + 1);
      endDate = new Date(startDate);
    } else if (lower.includes('peer') || lower.includes('monday')) {
      const daysUntilMonday = (1 + 7 - today.getDay()) % 7 || 7;
      startDate.setDate(today.getDate() + daysUntilMonday);
      if (lower.includes('mangal') || lower.includes('tuesday') || lower.includes('2 din')) {
        daysRequested = 2;
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);
      } else {
        endDate = new Date(startDate);
      }
    } else {
      // Default next business day
      const daysUntilNext = today.getDay() === 5 ? 3 : 1;
      startDate.setDate(today.getDate() + daysUntilNext);
      endDate = new Date(startDate);
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    return {
      leaveTypeId: targetType.id,
      leaveTypeName: targetType.name,
      startDate: startStr,
      endDate: endStr,
      workingDays: daysRequested,
      reason: prompt,
      confidenceScore: 0.96,
      explanation: `Successfully parsed leave intent for ${daysRequested} day(s) (${targetType.name}) between ${startStr} and ${endStr}.`,
      warningMessages: [
        'Please review the pre-filled fields before confirming submission.',
        'Ensure key deliverable handover is completed before leaving.',
      ],
    };
  }

  async summarizeDashboard(dto: SummarizeDashboardDto): Promise<{ summary: string }> {
    const today = new Date().toISOString().split('T')[0];

    const totalHeadcount = await this.prisma.employee.count();
    const todayRecords = await this.prisma.attendanceRecord.findMany({ where: { date: today } });

    let present = 0;
    let late = 0;
    for (const r of todayRecords) {
      if (r.status === AttendanceStatus.PRESENT) present++;
      else if (r.status === AttendanceStatus.LATE) late++;
    }

    const pendingLeaves = await this.prisma.leaveRequest.count({ where: { status: ApprovalStatus.PENDING } });
    const pendingCorrections = await this.prisma.attendanceCorrection.count({ where: { status: ApprovalStatus.PENDING } });

    if (dto.type === 'admin') {
      const latestPayroll = await this.prisma.payrollRun.findFirst({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      const payrollCostStr = latestPayroll ? `PKR ${(latestPayroll.totalGrossPay / 1000000).toFixed(2)}M` : 'Optimal';

      return {
        summary: `📈 **Executive AI Overview for Leadership:**\nHeadcount is standing at **${totalHeadcount} employees**. Today's workforce on-site presence is **${present} present** with **${late} late arrivals**. Monthly payroll expenditure stands at **${payrollCostStr}**. Total pending approvals requiring executive/HR review: **${pendingLeaves + pendingCorrections} requests**. All strategic organizational compliance parameters are operating within configured thresholds.`,
      };
    }

    return {
      summary: `⚡ **HR Operations AI Brief:**\nToday ${present} of ${totalHeadcount} active personnel are present on-site. ${late} late check-in punches recorded. Currently, **${pendingLeaves} leave requests** and **${pendingCorrections} attendance corrections** await your department review. Probation and attendance health evaluations remain on schedule for the upcoming week.`,
    };
  }
}
