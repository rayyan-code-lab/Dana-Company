export const money = (value) => Number(value ?? 0);

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const cash = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
}).format(Number(value ?? 0));

export function workerIdOf(value) {
  return String(value?.Id ?? value ?? '');
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
  const rate = record.wagePerDay_c != null
    ? money(record.wagePerDay_c)
    : money(worker?.dailyRate_c);
  return roundMoney(rate * units);
}

export function sameWorker(record, worker) {
  const reference = record.worker_c;
  const referenceId = workerIdOf(reference);
  if (referenceId && worker?.Id && referenceId === String(worker.Id)) {
    return true;
  }
  if (reference?.Name && worker?.Name && String(reference.Name).trim() === String(worker.Name).trim()) {
    return true;
  }
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
  const workerAttendance = attendance.filter((row) => sameWorker(row, worker));
  const relevantAttendance = workerAttendance.filter((row) => {
    const date = String(row.attendanceDate_c ?? '');
    return date && date <= range.end;
  });
  const periodAttendance = relevantAttendance.filter((row) => {
    const date = String(row.attendanceDate_c ?? '');
    return date >= range.start && date <= range.end && row.status_c !== 'Unmarked';
  });
  const cumulativeEarned = roundMoney(relevantAttendance.reduce((sum, row) => {
    return sum + attendanceEarnings(row, worker);
  }, 0));
  const earned = roundMoney(periodAttendance.reduce((sum, row) => {
    return sum + attendanceEarnings(row, worker);
  }, 0));
  const fullDays = periodAttendance.filter((row) => unitsForStatus(row.status_c) === 1).length;
  const halfDays = periodAttendance.filter((row) => unitsForStatus(row.status_c) === 0.5).length;
  const attendanceUnits = roundMoney(periodAttendance.reduce((sum, row) => sum + unitsForStatus(row.status_c), 0));
  const overtimeHours = roundMoney(periodAttendance.reduce((sum, row) => sum + Number(row.overtimeHours_c || 0), 0));
  const workerPayments = payments.filter((row) => sameWorker(row, worker));
  const paymentsThroughPeriod = workerPayments.filter((row) => row.paymentDate_c && row.paymentDate_c <= range.end);
  const periodPayments = paymentsThroughPeriod.filter((row) => row.paymentDate_c >= range.start && row.paymentDate_c <= range.end);
  const cumulativeRecordedPaid = roundMoney(paymentsThroughPeriod.reduce((sum, row) => sum + money(row.amount_c), 0));
  const newPeriodPaid = periodPayments.filter((row) => row.transactionType_c !== 'Advance')
    .reduce((sum, row) => sum + money(row.amount_c), 0);
  const periodAdvances = roundMoney(periodPayments.filter((row) => row.transactionType_c === 'Advance')
    .reduce((sum, row) => sum + money(row.amount_c), 0));
  const legacy = legacyPayroll.filter((row) => sameWorker(row, worker));
  const legacyPaidInPeriod = legacy.reduce((sum, row) => {
    if (row.status_c !== 'Paid' || !row.paidOn_c) return sum;
    return row.paidOn_c >= range.start && row.paidOn_c <= range.end
      ? sum + money(row.netPay_c)
      : sum;
  }, 0);
  const periodPaid = roundMoney(newPeriodPaid + legacyPaidInPeriod);
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
    fullDays,
    halfDays,
    attendanceUnits,
    overtimeHours,
    earned,
    cumulativeEarned,
    periodPaid,
    periodAdvances,
    cumulativeAdvances,
    closingBalance,
    advanceCredit: Math.max(0, -closingBalance),
    outstanding: Math.max(0, closingBalance),
    periodAttendance,
    periodPayments,
    legacyRows,
    cumulativePaid,
  };
}
