import { AllSettings, Worker, Holiday, ManDayRow } from "../types";
import { DEFAULT_DEPARTMENT_OPTIONS, DEFAULT_JOB_OPTIONS, DEFAULT_RANK_OPTIONS } from "../constants/workerOptions";

export const DEFAULT_NIGHT_SHIFT_START_TIME = "15:00";

/**
 * 일용/사업소득 "급여정산 테이블" 기본값 — 엑셀 노무대장의 표를 그대로 옮긴 것.
 * - countable: false 행은 안내용(반일 두 개의 합계 표시, 점심·식사시간)이라 합산하지 않는다.
 * - toTime "00:00"은 밤 12시(자정, 엑셀의 24:00)를 뜻한다.
 * - 행 라벨(조출/오전/잔업 등)은 화면 표시용으로 붙인 이름이며 계산에는 쓰이지 않는다.
 */
export const DEFAULT_MAN_DAY_TABLE: ManDayRow[] = [
  // ── 주간조 · 평일 ──
  { id: "md-d-wd-1", shift: "day", dayType: "weekday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-wd-2", shift: "day", dayType: "weekday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-wd-3", shift: "day", dayType: "weekday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-wd-4", shift: "day", dayType: "weekday", fromTime: "13:00", toTime: "17:00", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-wd-5", shift: "day", dayType: "weekday", fromTime: "08:00", toTime: "17:00", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-wd-6", shift: "day", dayType: "weekday", fromTime: "17:00", toTime: "19:30", manDays: 0.5, countable: true, label: "잔업 1" },
  { id: "md-d-wd-7", shift: "day", dayType: "weekday", fromTime: "19:30", toTime: "22:00", manDays: 0.5, countable: true, label: "잔업 2" },
  { id: "md-d-wd-8", shift: "day", dayType: "weekday", fromTime: "22:00", toTime: "00:00", manDays: 0.5, countable: true, label: "잔업 3" },
  { id: "md-d-wd-9", shift: "day", dayType: "weekday", fromTime: "13:00", toTime: "15:00", manDays: 0.25, countable: true, label: "오후 조기퇴근", outBefore: "17:00" },
  // ── 주간조 · 토요일 ──
  { id: "md-d-sat-1", shift: "day", dayType: "saturday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-sat-2", shift: "day", dayType: "saturday", fromTime: "08:00", toTime: "16:00", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-sat-3", shift: "day", dayType: "saturday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-sat-4", shift: "day", dayType: "saturday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-sat-5", shift: "day", dayType: "saturday", fromTime: "13:00", toTime: "16:00", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-sat-6", shift: "day", dayType: "saturday", fromTime: "16:00", toTime: "18:00", manDays: 0.5, countable: true, label: "잔업" },
  // ── 주간조 · 일요일(평일 공휴일 포함) ──
  { id: "md-d-sun-1", shift: "day", dayType: "sunday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-sun-2", shift: "day", dayType: "sunday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-sun-3", shift: "day", dayType: "sunday", fromTime: "08:00", toTime: "15:30", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-sun-4", shift: "day", dayType: "sunday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-sun-5", shift: "day", dayType: "sunday", fromTime: "13:00", toTime: "15:30", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-sun-6", shift: "day", dayType: "sunday", fromTime: "15:30", toTime: "17:30", manDays: 0.5, countable: true, label: "잔업" },
  // ── 야간조 · 평일 ──
  { id: "md-n-wd-1", shift: "night", dayType: "weekday", fromTime: "19:30", toTime: "23:30", manDays: 0.75, countable: true, label: "전반" },
  { id: "md-n-wd-2", shift: "night", dayType: "weekday", fromTime: "23:30", toTime: "00:30", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-wd-3", shift: "night", dayType: "weekday", fromTime: "00:30", toTime: "04:30", manDays: 0.75, countable: true, label: "후반" },
  { id: "md-n-wd-4", shift: "night", dayType: "weekday", fromTime: "04:30", toTime: "05:30", manDays: 0.5, countable: true, label: "새벽 잔업" },
  // ── 야간조 · 토요일 ──
  { id: "md-n-sat-1", shift: "night", dayType: "saturday", fromTime: "16:00", toTime: "20:00", manDays: 1, countable: true, label: "전반" },
  { id: "md-n-sat-2", shift: "night", dayType: "saturday", fromTime: "20:00", toTime: "21:00", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-sat-3", shift: "night", dayType: "saturday", fromTime: "21:00", toTime: "01:00", manDays: 1, countable: true, label: "후반" },
  // ── 야간조 · 일요일(평일 공휴일 포함) ──
  { id: "md-n-sun-1", shift: "night", dayType: "sunday", fromTime: "15:30", toTime: "19:30", manDays: 1, countable: true, label: "전반" },
  { id: "md-n-sun-2", shift: "night", dayType: "sunday", fromTime: "19:30", toTime: "20:30", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-sun-3", shift: "night", dayType: "sunday", fromTime: "20:30", toTime: "00:00", manDays: 1, countable: true, label: "후반" },
];

export const DEFAULT_SETTINGS: AllSettings = {
  workTime: {
    defaultCheckIn: "08:00",
    defaultCheckOut: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    lunchDuration: 1,
    standardDailyHours: 8,
    standardWeeklyHours: 40,
    hourlyOrdinaryWageRate: 10320,
    hourlyOrdinaryMonthlyHours: 209,
    departments: DEFAULT_DEPARTMENT_OPTIONS,
    ranks: DEFAULT_RANK_OPTIONS,
    jobs: DEFAULT_JOB_OPTIONS,
  },
  overtimeRules: {
    weekdayOvertimeRate: 1.5,
    holidayRate: 1.5,
    holidayOvertimeRate: 2.0,
    nightRate: 0.5,
    nightStart: "22:00",
    nightEnd: "06:00",
    snapRules: [
      // ── 평일 ──
      { id: "snap-wd-in-1", dayType: "weekday", kind: "in", fromTime: "04:00", toTime: "05:30", snapTo: "05:00" },
      { id: "snap-wd-in-2", dayType: "weekday", kind: "in", fromTime: "06:00", toTime: "08:30", snapTo: "08:00" },
      { id: "snap-wd-out-1", dayType: "weekday", kind: "out", fromTime: "16:30", toTime: "17:50", snapTo: "17:00" },
      { id: "snap-wd-out-2", dayType: "weekday", kind: "out", fromTime: "19:00", toTime: "20:00", snapTo: "19:30" },
      { id: "snap-wd-out-3", dayType: "weekday", kind: "out", fromTime: "21:00", toTime: "22:30", snapTo: "22:00" },
      // 자정 전후 퇴근 → 밤 12시(24:00)로 인정. 정산 테이블의 22:00~24:00 행을 채우기 위함
      { id: "snap-wd-out-4", dayType: "weekday", kind: "out", fromTime: "23:30", toTime: "00:30", snapTo: "00:00" },
      // ── 토요일 (정규 08:00~16:00, 앞뒤 1시간 버퍼) ──
      { id: "snap-sat-in-0", dayType: "saturday", kind: "in", fromTime: "04:00", toTime: "05:30", snapTo: "05:00" },
      { id: "snap-sat-in-1", dayType: "saturday", kind: "in", fromTime: "07:00", toTime: "08:59", snapTo: "08:00" },
      { id: "snap-sat-out-1", dayType: "saturday", kind: "out", fromTime: "15:00", toTime: "16:59", snapTo: "16:00" },
      { id: "snap-sat-out-2", dayType: "saturday", kind: "out", fromTime: "17:30", toTime: "18:59", snapTo: "18:00" },
      // ── 일요일 (정규 08:00~15:30, 앞뒤 1시간 버퍼) ──
      { id: "snap-sun-in-0", dayType: "sunday", kind: "in", fromTime: "04:00", toTime: "05:30", snapTo: "05:00" },
      { id: "snap-sun-in-1", dayType: "sunday", kind: "in", fromTime: "07:00", toTime: "08:59", snapTo: "08:00" },
      { id: "snap-sun-out-1", dayType: "sunday", kind: "out", fromTime: "14:30", toTime: "16:30", snapTo: "15:30" },
      { id: "snap-sun-out-2", dayType: "sunday", kind: "out", fromTime: "17:00", toTime: "17:59", snapTo: "17:30" },
      // ── 공휴일 (정규 08:00~16:00, 앞뒤 1시간 버퍼) ──
      { id: "snap-hol-in-0", dayType: "holiday", kind: "in", fromTime: "04:00", toTime: "05:30", snapTo: "05:00" },
      { id: "snap-hol-in-1", dayType: "holiday", kind: "in", fromTime: "07:00", toTime: "08:59", snapTo: "08:00" },
      { id: "snap-hol-out-1", dayType: "holiday", kind: "out", fromTime: "15:00", toTime: "16:59", snapTo: "16:00" },
      { id: "snap-hol-out-2", dayType: "holiday", kind: "out", fromTime: "17:30", toTime: "18:59", snapTo: "18:00" },
    ],
  },
  dailyWorkerRules: {
    manDayTable: DEFAULT_MAN_DAY_TABLE,
    nightShiftStartTime: DEFAULT_NIGHT_SHIFT_START_TIME,
    earlyMorningStart: "05:00",
    earlyMorningEnd: "08:00",
    earlyMorningWorkDays: 0.5,
    afternoonOvertimeStart: "17:00",
    afternoonOvertimeEnd: "19:30",
    afternoonOvertimeWorkDays: 0.5,
    eveningOvertimeStart: "19:30",
    eveningOvertimeEnd: "22:00",
    eveningOvertimeWorkDays: 0.5,
    holidayRate: 1.0,
  },
  insuranceRates: {
    nationalPensionRate: 0.045,
    healthInsuranceRate: 0.03545,
    longTermCareRate: 0.1295,
    employmentInsuranceRate: 0.009,
    effectiveFrom: "2026-01-01",
  },
  taxRules: {
    businessIncomeRate: 0.033,
    dailyWorkerTaxFreeLimit: 150000,
    dailyWorkerTaxRate: 0.06,
    localTaxRate: 0.1,
  },
  allowanceDefaults: {
    meal: 200000,
    transport: 200000,
    phone: 100000,
  },
  site: {
    companyName: "씨엠(CM)건설",
    siteAddress: "충남 당진시 신평면 신평로 45",
    siteLocation: { lat: 37.1234, lng: 126.4567 },
    allowedRadius: 100,
    paymentDay: 15,
    timezone: "Asia/Seoul",
  },
  annualLeave: {
    firstYearDays: 11,
    secondYearDays: 15,
    maxDays: 25,
    accrualMethod: "monthly",
  },
};

export const DEFAULT_HOLIDAYS: Holiday[] = [
  // 2026 National Holidays
  { date: "2026-01-01", name: "신정 (새해)", type: "public" },
  { date: "2026-03-01", name: "삼일절", type: "public" },
  { date: "2026-05-05", name: "어린이날", type: "public" },
  { date: "2026-06-06", name: "현충일", type: "public" },
  { date: "2026-08-15", name: "광복절", type: "public" },
  { date: "2026-10-03", name: "개천절", type: "public" },
  { date: "2026-10-09", name: "한글날", type: "public" },
  { date: "2026-12-25", name: "기독탄신일 (성탄절)", type: "public" },

  // 2027 National Holidays
  { date: "2027-01-01", name: "신정", type: "public" },
  { date: "2027-03-01", name: "삼일절", type: "public" },
  { date: "2027-05-05", name: "어린이날", type: "public" },
  { date: "2027-06-06", name: "현충일", type: "public" },
  { date: "2027-08-15", name: "광복절", type: "public" },
  { date: "2027-10-03", name: "개천절", type: "public" },
  { date: "2027-10-09", name: "한글날", type: "public" },
  { date: "2027-12-25", name: "성탄절", type: "public" },

  // 2028 National Holidays
  { date: "2028-01-01", name: "신정", type: "public" },
  { date: "2028-03-01", name: "삼일절", type: "public" },
  { date: "2028-05-05", name: "어린이날", type: "public" },
  { date: "2028-06-06", name: "현충일", type: "public" },
  { date: "2028-08-15", name: "광복절", type: "public" },
  { date: "2028-10-03", name: "개천절", type: "public" },
  { date: "2028-10-09", name: "한글날", type: "public" },
  { date: "2028-12-25", name: "성탄절", type: "public" },

  // 2029 National Holidays
  { date: "2029-01-01", name: "신정", type: "public" },
  { date: "2029-03-01", name: "삼일절", type: "public" },
  { date: "2029-05-05", name: "어린이날", type: "public" },
  { date: "2029-06-06", name: "현충일", type: "public" },
  { date: "2029-08-15", name: "광복절", type: "public" },
  { date: "2029-10-03", name: "개천절", type: "public" },
  { date: "2029-10-09", name: "한글날", type: "public" },
  { date: "2029-12-25", name: "성탄절", type: "public" },

  // 2030 National Holidays
  { date: "2030-01-01", name: "신정", type: "public" },
  { date: "2030-03-01", name: "삼일절", type: "public" },
  { date: "2030-05-05", name: "어린이날", type: "public" },
  { date: "2030-06-06", name: "현충일", type: "public" },
  { date: "2030-08-15", name: "광복절", type: "public" },
  { date: "2030-10-03", name: "개천절", type: "public" },
  { date: "2030-10-09", name: "한글날", type: "public" },
  { date: "2030-12-25", name: "성탄절", type: "public" },
];

export const MOCK_WORKERS: Worker[] = [
  {
    workerId: "CM-2026-001",
    name: "김철수",
    englishName: "Chulsoo Kim",
    nationality: "대한민국",
    residentNumber: "880512-1456789",
    phone: "010-1234-5678",
    address: "서울시 마포구 독막로 12",
    employmentType: "salary",
    contractDate: "2026-01-01",
    joinDate: "2026-01-10",
    retireDate: null,
    duty: "과장",
    department: "관리부",
    job: "관리",
    contractEndDate: "",
    isForeigner: false,
    visaType: "",
    passportExpiry: "",
    homeAddress: "",
    homeContact: "",
    emergencyName: "",
    emergencyRelation: "",
    hasVehicle: true,
    salarySettings: {
      monthlyBase: 4500000,
      hourlyRate: 15000,
      dailyRate: 150000,
      allowances: {
        meal: null, // inherits 200,000 from company defaults
        transport: 250000, // overridden customized local transport allowance
        phone: null, // inherits 100,000
      },
    },
    deductionSettings: {
      housingFee: 0,
      cashAdvance: 0,
      customDeductions: [],
    },
    bankSettings: {
      bankName: "신한은행",
      accountNo: "110-345-234567",
      holder: "김철수",
    },
    loginId: "010-1234-5678",
    initialPassword: "password123!",
    language: "ko",
  },
  {
    workerId: "CM-2026-002",
    name: "박동근",
    englishName: "Dongkeun Park",
    nationality: "대한민국",
    residentNumber: "921204-1023456",
    phone: "010-9876-5432",
    address: "충남 당진시 신평면 신평길 88",
    employmentType: "hourly",
    contractDate: "2026-02-15",
    joinDate: "2026-03-01",
    retireDate: null,
    duty: "주임",
    department: "생산부",
    job: "취부",
    contractEndDate: "",
    isForeigner: false,
    visaType: "",
    passportExpiry: "",
    homeAddress: "",
    homeContact: "",
    emergencyName: "",
    emergencyRelation: "",
    hasVehicle: false,
    salarySettings: {
      monthlyBase: 0,
      hourlyRate: 18000,
      dailyRate: 180000,
      allowances: {
        meal: 150000, // overridden custom meal fee
        transport: null, // inherits default transport
        phone: 0, // no phone allowance given
      },
    },
    deductionSettings: {
      housingFee: 150000, // 숙소료 15만원 공제
      cashAdvance: 300000, // 가불금 30만원
      customDeductions: [{ name: "가스 전기 요금", amount: 35000 }],
    },
    bankSettings: {
      bankName: "국민은행",
      accountNo: "405602-04-123456",
      holder: "박동근",
    },
    loginId: "010-9876-5432",
    initialPassword: "password456!",
    language: "ko",
  },
  {
    workerId: "CM-2026-003",
    name: "이민우",
    englishName: "Minwoo Lee",
    nationality: "대한민국",
    residentNumber: "950711-1345621",
    phone: "010-3333-4444",
    address: "충남 아산시 배방읍 광장로 25",
    employmentType: "daily",
    contractDate: "2026-04-10",
    joinDate: "2026-04-15",
    retireDate: null,
    duty: "팀장",
    department: "생산부",
    job: "절단",
    contractEndDate: "",
    isForeigner: false,
    visaType: "",
    passportExpiry: "",
    homeAddress: "",
    homeContact: "",
    emergencyName: "",
    emergencyRelation: "",
    hasVehicle: false,
    salarySettings: {
      monthlyBase: 0,
      hourlyRate: 0,
      dailyRate: 220000, // 1일 단가 22만원
      allowances: {
        meal: 0,
        transport: null,
        phone: 0,
      },
    },
    deductionSettings: {
      housingFee: 200000, // 숙소공제 20만원
      cashAdvance: 0,
      customDeductions: [],
    },
    bankSettings: {
      bankName: "하나은행",
      accountNo: "123-456789-01234",
      holder: "이민우",
    },
    loginId: "010-3333-4444",
    initialPassword: "password789!",
    language: "ko",
  },
  {
    workerId: "CM-2026-004",
    name: "John Doe",
    englishName: "John Doe",
    nationality: "미국",
    residentNumber: "US-990812-F",
    phone: "010-5555-6666",
    address: "평택시 팽성읍 안정리",
    employmentType: "business",
    contractDate: "2026-05-01",
    joinDate: "2026-05-10",
    retireDate: null,
    duty: "대리",
    department: "생산부",
    job: "용접",
    contractEndDate: "2026-07-20",
    isForeigner: true,
    visaType: "F-4",
    passportExpiry: "2026-07-15",
    homeAddress: "123 Main St, Springfield, USA",
    homeContact: "+1-202-555-0147",
    emergencyName: "Jane Doe",
    emergencyRelation: "배우자",
    hasVehicle: false,
    salarySettings: {
      monthlyBase: 0,
      hourlyRate: 0,
      dailyRate: 250000, // 3.3% 사업소득자 1일 단가 25만원
      allowances: {
        meal: 0,
        transport: 0,
        phone: 0,
      },
    },
    deductionSettings: {
      housingFee: 0,
      cashAdvance: 100000,
      customDeductions: [],
    },
    bankSettings: {
      bankName: "기업은행",
      accountNo: "010-5555-6666-01",
      holder: "John Doe",
    },
    loginId: "010-5555-6666",
    initialPassword: "password000!",
    language: "en",
  },
];
