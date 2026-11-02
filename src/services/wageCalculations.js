export const money = (value) => Number(value ?? 0);

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const cash = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
}).format(Number(value ?? 0));

export function parseWorkerRef(value) {
  if (!value) return { Id: '', Name: '' };
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return { Id: trimmed, Name: trimmed };
      }
    }
    return { Id: trimmed, Name: trimmed };
  }
  return { Id: String(value), Name: String(value) };
}

export function workerIdOf(value) {
  const ref = parseWorkerRef(value);
  return String(ref?.Id ?? '');
}

export function unitsForStatus(status) {
  if (status === 'Present' || status === 'Full Day') return 1;
  if (status === 'Half Day') return 0.5;
  return 0;
}

export function attendanceEarnings(record, worker) {
  const status = record.status_c;
  if (status === 'Unmarked' || status === 'Absent' || status === 'Leave') return 0;
  const units = Number.isFinite(Number(record.attendanceUnits_c))
    ? Number(record.attendanceUnits_c)
    : unitsForStatus(status);
  if (units === 0) return 0;
  if (record.earnedWage_c != null && !Number.isNaN(Number(record.earnedWage_c))) {
    return roundMoney(Number(record.earnedWage_c));
  }
  const rate = record.wagePerDay_c != null
    ? money(record.wagePerDay_c)
    : money(worker?.dailyRate_c);
  return roundMoney(rate * units);
}

export function sameWorker(record, worker) {
  const ref = parseWorkerRef(record.worker_c);
  const refId = String(ref?.Id ?? '');
  const refName = String(ref?.Name ?? '').trim().toLowerCase();
  const workerId = String(worker?.Id ?? '');
  const workerName = String(worker?.Name ?? '').trim().toLowerCase();

  if (refId && workerId && refId === workerId) return true;
  if (refName && workerName && refName === workerName) return true;
  return false;
}

export function payPeriodBounds(value) {
  const matches = String(value ?? '').match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (!matches.length) return null;
  return { start: matches[0], end: matches[1] ?? matches[0] };
}

export function legacyPayrollDisbursed(record, throughDate) {
  const bounds = payPeriodBounds(record.payPeriod_c);
  if (!bounds || bounds.start > throughDate) return 0;
  const advance = money(record.advance_c);
  const paidDate = record.paidOn_c || bounds.end;
  const paidNet = record.status_c === 'Paid' && paidDate <= throughDate ? money(record.netPay_c) : 0;
  return roundMoney(advance + paidNet);
}

export function calculateWorkerWageSummary({
  worker,
  attendance = [],
  payments = [],
  legacyPayroll = [],
  range,
}) {
  const normDate = (d) => String(d ?? '').slice(0, 10);

  const workerAttendance = attendance.filter((row) => sameWorker(row, worker));
  const workerPayments = payments.filter((row) => sameWorker(row, worker));
  const legacy = legacyPayroll.filter((row) => sameWorker(row, worker));

  // Prior period calculations (strictly before range.start)
  const priorAttendance = workerAttendance.filter((row) => {
    const d = normDate(row.attendanceDate_c);
    return d && d < range.start && row.status_c !== 'Unmarked';
  });
  const priorEarned = roundMoney(priorAttendance.reduce((sum, row) => sum + attendanceEarnings(row, worker), 0));

  const priorPayments = workerPayments.filter((row) => {
    const d = normDate(row.paymentDate_c);
    return d && d < range.start;
  });
  const priorRecordedPaid = roundMoney(priorPayments.reduce((sum, row) => sum + money(row.amount_c), 0));
  const priorLegacyDisbursed = roundMoney(legacy.reduce((sum, row) => sum + legacyPayrollDisbursed(row, range.start), 0));
  const priorPaid = roundMoney(priorRecordedPaid + priorLegacyDisbursed);
  const openingBalance = roundMoney(priorEarned - priorPaid);

  // Period attendance (range.start to range.end)
  const periodAttendance = workerAttendance.filter((row) => {
    const d = normDate(row.attendanceDate_c);
    return d && d >= range.start && d <= range.end && row.status_c !== 'Unmarked';
  });
  const earned = roundMoney(periodAttendance.reduce((sum, row) => {
    return sum + attendanceEarnings(row, worker);
  }, 0));

  const attendedRows = periodAttendance.filter((row) => unitsForStatus(row.status_c) > 0);
  const dayShifts = attendedRows.filter((row) => (row.shift_c || worker?.shift_c || 'Day Shift') !== 'Night Shift').length;
  const nightShifts = attendedRows.filter((row) => (row.shift_c || worker?.shift_c) === 'Night Shift').length;
  const totalShifts = dayShifts + nightShifts;
  const fullDays = totalShifts;
  const halfDays = dayShifts;
  const attendanceUnits = roundMoney(periodAttendance.reduce((sum, row) => sum + unitsForStatus(row.status_c), 0));
  const overtimeHours = roundMoney(periodAttendance.reduce((sum, row) => sum + Number(row.overtimeHours_c || 0), 0));

  // Period payments
  const periodPayments = workerPayments.filter((row) => {
    const d = normDate(row.paymentDate_c);
    return d && d >= range.start && d <= range.end;
  });
  const newPeriodPaid = roundMoney(periodPayments.filter((row) => row.transactionType_c !== 'Advance')
    .reduce((sum, row) => sum + money(row.amount_c), 0));
  const periodAdvances = roundMoney(periodPayments.filter((row) => row.transactionType_c === 'Advance')
    .reduce((sum, row) => sum + money(row.amount_c), 0));

  const legacyPaidInPeriod = roundMoney(legacy.reduce((sum, row) => {
    if (row.status_c !== 'Paid' || !row.paidOn_c) return sum;
    const paidD = normDate(row.paidOn_c);
    return paidD >= range.start && paidD <= range.end ? sum + money(row.netPay_c) : sum;
  }, 0));
  const periodPaid = roundMoney(newPeriodPaid + legacyPaidInPeriod);
  const totalPeriodDisbursed = roundMoney(periodPaid + periodAdvances);
  const periodNet = roundMoney(earned - totalPeriodDisbursed);

  // Cumulative through period end
  const relevantAttendance = workerAttendance.filter((row) => {
    const d = normDate(row.attendanceDate_c);
    return d && d <= range.end && row.status_c !== 'Unmarked';
  });
  const cumulativeEarned = roundMoney(relevantAttendance.reduce((sum, row) => sum + attendanceEarnings(row, worker), 0));

  const paymentsThroughPeriod = workerPayments.filter((row) => {
    const d = normDate(row.paymentDate_c);
    return d && d <= range.end;
  });
  const cumulativeRecordedPaid = roundMoney(paymentsThroughPeriod.reduce((sum, row) => sum + money(row.amount_c), 0));
  const legacyDisbursed = roundMoney(legacy.reduce((sum, row) => sum + legacyPayrollDisbursed(row, range.end), 0));
  const cumulativePaid = roundMoney(cumulativeRecordedPaid + legacyDisbursed);
  const cumulativeAdvances = roundMoney(paymentsThroughPeriod.filter((row) => row.transactionType_c === 'Advance')
    .reduce((sum, row) => sum + money(row.amount_c), 0));

  const closingBalance = roundMoney(cumulativeEarned - cumulativePaid);
  const legacyRows = legacy.filter((row) => {
    const bounds = payPeriodBounds(row.payPeriod_c);
    return bounds && bounds.start <= range.end && bounds.end >= range.start;
  });

  return {
    worker,
    totalShifts,
    dayShifts,
    nightShifts,
    fullDays,
    halfDays,
    attendanceUnits,
    overtimeHours,
    earned,
    cumulativeEarned,
    openingBalance,
    periodNet,
    periodPaid,
    periodAdvances,
    totalPeriodDisbursed,
    cumulativePaid,
    cumulativeAdvances,
    closingBalance,
    advanceCredit: Math.max(0, -closingBalance),
    outstanding: Math.max(0, closingBalance),
    periodAttendance,
    periodPayments,
    legacyRows,
  };
}
