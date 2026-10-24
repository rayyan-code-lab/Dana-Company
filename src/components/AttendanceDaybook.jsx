import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sdk, eq } from '@/services/sdk';
import { useFetch } from '@/hooks/useFetch';
import { useProfile } from '@/hooks/useProfile';
import { getTableAccess } from '@/services/userPermissions';
import { todayLocalDate, getPeriodRange } from '@/services/periods';
import { attendanceEarnings, cash, roundMoney, sameWorker, unitsForStatus } from '@/services/wageCalculations';
import { toast } from 'sonner';
import ApperIcon from '@/components/ApperIcon';
import PeriodControls from '@/components/PeriodControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const WORKER_FIELDS = ['Name', 'role_c', 'phone_c', 'dailyRate_c', 'status_c', 'joinedOn_c', 'notes_c', 'workerType_c'];
const ATTENDANCE_FIELDS = [
  'Name',
  'worker_c',
  'attendanceDate_c',
  'status_c',
  'hoursWorked_c',
  'overtimeHours_c',
  'notes_c',
  'wagePerDay_c',
  'attendanceUnits_c',
  'earnedWage_c',
  'attendanceKey_c',
  'workerTypeSnapshot_c',
];

const STATUS_OPTIONS = [
  { key: 'Full Day', stored: 'Present', label: 'Full day' },
  { key: 'Half Day', stored: 'Half Day', label: 'Half day' },
  { key: 'Absent', stored: 'Absent', label: 'Absent' },
  { key: 'Leave', stored: 'Leave', label: 'Leave' },
  { key: 'Unmarked', stored: 'Unmarked', label: 'Unmarked' },
];

function lookupId(value) {
  return String(value?.Id ?? value ?? '');
}

function normalizeName(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function storedToUiStatus(status) {
  return status === 'Present' ? 'Full Day' : STATUS_OPTIONS.some((item) => item.key === status) ? status : 'Unmarked';
}

function toLocalDateLabel(value) {
  if (!value) return '—';
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, 12).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function fetchAll(table, fields, filter) {
  const results = [];
  let page = 1;
  let more = true;
  while (more) {
    let query = sdk.table(table).select(fields);
    if (filter) query = query.where(filter);
    const response = await query.orderByDesc('CreatedOn').page(page, 100).fetch();
    if (!response.success) throw new Error(response.message || 'Could not load ' + table + '.');
    results.push(...(response.data ?? []));
    more = Boolean(response.hasMore);
    page += 1;
  }
  return results;
}

async function loadDay(date) {
  const [workers, records] = await Promise.all([
    fetchAll('workers_c', WORKER_FIELDS),
    fetchAll('attendance_c', ATTENDANCE_FIELDS, eq('attendanceDate_c', date)),
  ]);
  return { workers, records };
}

function findRecordForWorker(records, worker) {
  const exact = records.filter((row) => lookupId(row.worker_c) === String(worker.Id));
  if (exact.length) return exact.sort((a, b) => String(b.ModifiedOn ?? b.CreatedOn ?? '').localeCompare(String(a.ModifiedOn ?? a.CreatedOn ?? '')))[0];
  return records.find((row) => normalizeName(row.worker_c?.Name) === normalizeName(worker.Name));
}

function dailyStatusEarnings(status, wage) {
  if (status === 'Full Day') return roundMoney(Number(wage) || 0);
  if (status === 'Half Day') return roundMoney((Number(wage) || 0) / 2);
  return 0;
}

export default function AttendanceDaybook() {
  const { profile } = useProfile();
  const access = getTableAccess(profile, 'attendance_c');
  const workerAccess = getTableAccess(profile, 'workers_c');
  const [selectedDate, setSelectedDate] = useState(todayLocalDate());
  const [view, setView] = useState('daybook');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({});
  const [pendingHelpers, setPendingHelpers] = useState([]);
  const [helperOpen, setHelperOpen] = useState(false);
  const [helperForm, setHelperForm] = useState({
    name: '',
    dailyRate: '',
    status: 'Full Day',
    notes: '',
    saveForFuture: false,
  });
  const [periodType, setPeriodType] = useState('month');
  const [periodAnchor, setPeriodAnchor] = useState(todayLocalDate());
  const [historySearch, setHistorySearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const period = getPeriodRange(periodType, periodAnchor);

  const {
    data: dayData,
    loading: dayLoading,
    error: dayError,
    run: reloadDay,
  } = useFetch(() => loadDay(selectedDate), [selectedDate]);

  const {
    data: historyRows,
    loading: historyLoading,
    error: historyError,
    run: reloadHistory,
  } = useFetch(() => fetchAll('attendance_c', ATTENDANCE_FIELDS), []);

  const workers = dayData?.workers ?? [];
  const dayRecords = dayData?.records ?? [];

  const roster = useMemo(() => {
    const rows = workers.filter((worker) => worker.status_c === 'Active');
    dayRecords.forEach((record) => {
      let worker = workers.find((item) => String(item.Id) === lookupId(record.worker_c));
      if (!worker) worker = workers.find((item) => normalizeName(item.Name) === normalizeName(record.worker_c?.Name));
      if (!worker) {
        worker = {
          Id: lookupId(record.worker_c),
          Name: record.worker_c?.Name || 'Unknown worker',
          dailyRate_c: record.wagePerDay_c ?? 0,
          status_c: 'Inactive',
          workerType_c: record.workerTypeSnapshot_c || 'Regular',
        };
      }
      if (!rows.some((item) => String(item.Id) === String(worker.Id))) rows.push(worker);
    });
    pendingHelpers.forEach((helper) => {
      const duplicate = rows.some((worker) => normalizeName(worker.Name) === normalizeName(helper.Name));
      if (!duplicate) rows.push(helper);
    });
    return rows.sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
  }, [workers, dayRecords, pendingHelpers]);

  useEffect(() => {
    const next = {};
    roster.forEach((worker) => {
      const record = findRecordForWorker(dayRecords, worker);
      const defaultRate = record?.wagePerDay_c ?? worker.dailyRate_c ?? 0;
      next[String(worker.Id)] = {
        recordId: record?.Id ?? null,
        sourceRecord: record ?? null,
        status: record ? storedToUiStatus(record.status_c) : 'Unmarked',
        wage: Number(defaultRate),
        overtimeHours: record?.overtimeHours_c ?? '',
        notes: record?.notes_c ?? '',
      };
    });
    setDrafts(next);
    setDirty(false);
  }, [selectedDate, dayData]);

  const visibleWorkers = roster.filter((worker) => {
    if (!search.trim()) return true;
    const query = search.trim().toLocaleLowerCase();
    return String(worker.Name).toLocaleLowerCase().includes(query)
      || String(worker.role_c ?? '').toLocaleLowerCase().includes(query);
  });

  const countStatus = (status) => roster.filter((worker) => (drafts[String(worker.Id)]?.status ?? 'Unmarked') === status).length;
  const earnedTotal = roster.reduce((sum, worker) => {
    const draft = drafts[String(worker.Id)];
    if (!draft || draft.status === 'Unmarked') return sum;
    return sum + dailyStatusEarnings(draft.status, draft.wage);
  }, 0);

  function changeDate(nextDate) {
    if (!nextDate || nextDate === selectedDate) return;
    if (dirty && !window.confirm('Discard unsaved attendance changes for ' + selectedDate + '?')) return;
    setPendingHelpers([]);
    setSelectedDate(nextDate);
    setDirty(false);
  }

  function changeStatus(worker, status) {
    const key = String(worker.Id);
    setDrafts((current) => {
      const prior = current[key] ?? {
        status: 'Unmarked',
        wage: Number(worker.dailyRate_c ?? 0),
        overtimeHours: '',
        notes: '',
        sourceRecord: null,
        recordId: null,
      };
      return { ...current, [key]: { ...prior, status } };
    });
    setDirty(true);
  }

  async function addHelper(event) {
    event.preventDefault();
    if (!workerAccess.canCreate || saving) return;
    const name = helperForm.name.trim();
    const rate = Number(helperForm.dailyRate);
    if (!name) {
      toast.error('Enter the helper name.');
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Daily wage must be greater than zero.');
      return;
    }

    let existing = workers.find((worker) => normalizeName(worker.Name) === normalizeName(name));
    const alreadyListed = roster.find((worker) => normalizeName(worker.Name) === normalizeName(name));
    if (alreadyListed) {
      const key = String(alreadyListed.Id);
      setDrafts((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? {}),
          status: helperForm.status,
          wage: rate,
          notes: helperForm.notes.trim(),
          overtimeHours: current[key]?.overtimeHours ?? '',
          sourceRecord: current[key]?.sourceRecord ?? null,
          recordId: current[key]?.recordId ?? null,
        },
      }));
      toast.info('This worker is already in today’s list. Their attendance draft has been updated.');
      setHelperOpen(false);
      setHelperForm({ name: '', dailyRate: '', status: 'Full Day', notes: '', saveForFuture: false });
      setDirty(true);
      return;
    }

    const candidateKey = globalThis.crypto?.randomUUID?.() || String(Date.now());
    const key = existing ? String(existing.Id) : 'pending-' + candidateKey;
    const helper = existing
      ? { ...existing, dailyRate_c: rate, workerType_c: existing.workerType_c || 'Temporary', _oneDayHelper: true, _saveForFuture: helperForm.saveForFuture }
      : {
          Id: key,
          Name: name,
          role_c: 'Helper',
          dailyRate_c: rate,
          status_c: helperForm.saveForFuture ? 'Active' : 'Inactive',
          joinedOn_c: selectedDate,
          notes_c: helperForm.notes.trim(),
          workerType_c: 'Temporary',
          _pendingHelper: true,
          _saveForFuture: helperForm.saveForFuture,
        };

    setPendingHelpers((current) => [...current.filter((row) => normalizeName(row.Name) !== normalizeName(name)), helper]);
    setDrafts((current) => ({
      ...current,
      [key]: {
        recordId: null,
        sourceRecord: null,
        status: helperForm.status,
        wage: rate,
        overtimeHours: '',
        notes: helperForm.notes.trim(),
      },
    }));
    setHelperForm({ name: '', dailyRate: '', status: 'Full Day', notes: '', saveForFuture: false });
    setHelperOpen(false);
    setDirty(true);
    toast.success('Helper added to the daybook. Save attendance to record the entry.');
  }

  async function resolvePendingHelper(helper, currentWorkers) {
    const existing = currentWorkers.find((worker) => normalizeName(worker.Name) === normalizeName(helper.Name));
    if (existing) {
      if (helper._saveForFuture && (existing.workerType_c === 'Temporary' || existing.role_c === 'Helper')) {
        const result = await sdk.table('workers_c').update({
          Id: existing.Id,
          dailyRate_c: Number(helper.dailyRate_c),
          status_c: 'Active',
          workerType_c: 'Temporary',
        });
        if (!result.data?.length) throw new Error(result.messages?.[0] || 'Could not update the returning helper profile.');
        return result.data[0];
      }
      return existing;
    }

    const result = await sdk.table('workers_c').create({
      Name: helper.Name,
      role_c: 'Helper',
      phone_c: '',
      dailyRate_c: Number(helper.dailyRate_c),
      status_c: helper._saveForFuture ? 'Active' : 'Inactive',
      joinedOn_c: selectedDate,
      notes_c: helper.notes_c || 'Temporary helper. Added from the attendance daybook.',
      workerType_c: 'Temporary',
    });
    if (!result.data?.length) throw new Error(result.messages?.[0] || 'Could not create the helper profile.');
    return result.data[0];
  }

  async function saveAttendance(event) {
    event?.preventDefault?.();
    if (saving) return;
    if (!access.canCreate || !access.canUpdate) {
      toast.error('You do not have permission to save attendance.');
      return;
    }
    setSaving(true);
    let createdCount = 0;
    let updatedCount = 0;
    try {
      let allWorkers = workers;
      if (pendingHelpers.length) allWorkers = await fetchAll('workers_c', WORKER_FIELDS);
      const resolvedHelpers = new Map();
      for (const helper of pendingHelpers) {
        const resolved = await resolvePendingHelper(helper, allWorkers);
        resolvedHelpers.set(String(helper.Id), resolved);
        if (!allWorkers.some((worker) => String(worker.Id) === String(resolved.Id))) allWorkers = [...allWorkers, resolved];
      }

      const freshDay = await loadDay(selectedDate);
      const creates = [];
      const updates = [];
      const attendanceKeySeen = new Set();

      for (const [draftKey, originalWorker] of roster.map((worker) => [String(worker.Id), worker])) {
        let worker = resolvedHelpers.get(draftKey) ?? originalWorker;
        if (draftKey.startsWith('pending-') && !resolvedHelpers.has(draftKey)) {
          const resolved = allWorkers.find((item) => normalizeName(item.Name) === normalizeName(originalWorker.Name));
          if (resolved) worker = resolved;
        }
        const draft = drafts[draftKey];
        if (!draft || !worker?.Id) continue;

        const record = findRecordForWorker(freshDay.records, worker);
        if (draft.status === 'Unmarked' && !record) continue;

        const key = String(worker.Id) + ':' + selectedDate;
        if (attendanceKeySeen.has(key)) {
          toast.warning('A duplicate worker/date entry was skipped: ' + worker.Name);
          continue;
        }
        attendanceKeySeen.add(key);
        let existingByKey = [];
        if (!record) {
          const response = await sdk.table('attendance_c')
            .select(ATTENDANCE_FIELDS)
            .where(eq('attendanceKey_c', key))
            .page(1, 5)
            .fetch();
          if (!response.success) throw new Error(response.message || 'Could not check for an existing attendance entry.');
          existingByKey = response.data ?? [];
        }
        const current = record ?? existingByKey[0] ?? null;
        const storedStatus = draft.status === 'Full Day' ? 'Present' : draft.status;
        const wageSnapshot = current?.wagePerDay_c != null ? Number(current.wagePerDay_c) : Number(draft.wage ?? worker.dailyRate_c ?? 0);
        const units = unitsForStatus(storedStatus);
        const earned = roundMoney(wageSnapshot * units);
        const overtimeHours = draft.overtimeHours === '' ? null : Number(draft.overtimeHours);
        if (overtimeHours != null && (!Number.isFinite(overtimeHours) || overtimeHours < 0)) {
          throw new Error('Overtime hours cannot be negative for ' + worker.Name + '.');
        }
        const payload = {
          Name: worker.Name + ' · ' + selectedDate,
          worker_c: worker.Id,
          attendanceDate_c: selectedDate,
          status_c: storedStatus,
          hoursWorked_c: current?.hoursWorked_c ?? null,
          overtimeHours_c: overtimeHours,
          notes_c: String(draft.notes ?? '').trim(),
          wagePerDay_c: wageSnapshot,
          attendanceUnits_c: units,
          earnedWage_c: earned,
          attendanceKey_c: key,
          workerTypeSnapshot_c: originalWorker._oneDayHelper || worker.workerType_c === 'Temporary' ? 'Temporary' : 'Regular',
        };
        if (current?.Id) updates.push({ ...payload, Id: current.Id });
        else if (draft.status !== 'Unmarked') creates.push(payload);
      }

      let createResponse = { data: [], messages: [], partial: false };
      let updateResponse = { data: [], messages: [], partial: false };
      if (creates.length) createResponse = await sdk.table('attendance_c').create(creates);
      if (updates.length) updateResponse = await sdk.table('attendance_c').update(updates);
      createdCount = createResponse.data?.length ?? 0;
      updatedCount = updateResponse.data?.length ?? 0;

      const partialSave = (creates.length && createdCount !== creates.length)
        || (updates.length && updatedCount !== updates.length)
        || createResponse.partial
        || updateResponse.partial;
      if (partialSave) {
        const messages = [...(createResponse.messages ?? []), ...(updateResponse.messages ?? [])];
        toast.warning('Attendance saved partially (' + createdCount + ' new, ' + updatedCount + ' updated). ' + (messages[0] || 'Review and retry any unsaved entries.'));
      } else {
        toast.success('Attendance saved for ' + selectedDate + '.');
        setPendingHelpers([]);
      }
      setDirty(partialSave);
      if (partialSave) {
        await reloadHistory();
      } else {
        await Promise.all([reloadDay(), reloadHistory()]);
      }
    } catch (error) {
      toast.error('Attendance could not be fully saved.', {
        description: error.message ?? String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  const filteredHistory = (historyRows ?? []).filter((row) => {
    const date = String(row.attendanceDate_c ?? '');
    if (date < period.start || date > period.end) return false;
    const searchTerm = historySearch.trim().toLocaleLowerCase();
    if (!searchTerm) return true;
    return String(row.Name ?? '').toLocaleLowerCase().includes(searchTerm)
      || String(row.worker_c?.Name ?? '').toLocaleLowerCase().includes(searchTerm)
      || String(row.status_c ?? '').toLocaleLowerCase().includes(searchTerm);
  }).sort((a, b) => String(b.attendanceDate_c).localeCompare(String(a.attendanceDate_c)));

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">People / Daily records</p>
          <h1 className="font-heading text-3xl font-semibold">Attendance daybook</h1>
          <p className="mt-2 text-sm text-muted-foreground">Mark everyone for one date, including one-day helpers, without opening individual forms.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={view === 'daybook' ? 'default' : 'outline'} className="rounded-sm" onClick={() => setView('daybook')}>Daily daybook</Button>
          <Button type="button" variant={view === 'history' ? 'default' : 'outline'} className="rounded-sm" onClick={() => setView('history')}>Attendance history</Button>
        </div>
      </header>

      {view === 'daybook' ? (
        <>
          <section className="flex flex-col gap-3 border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-sm flex-1">
              <label htmlFor="attendance-day" className="mb-1.5 block text-sm font-medium">Attendance date</label>
              <Input id="attendance-day" type="date" value={selectedDate} onChange={(event) => changeDate(event.target.value)} className="min-h-10 rounded-sm" />
            </div>
            <div className="text-sm text-muted-foreground">One row per worker per date. Unmarked workers remain pending, not absent.</div>
            <Button type="button" variant="outline" className="rounded-sm" onClick={() => setHelperOpen((open) => !open)}>
              <ApperIcon name="UserPlus" size={16} />
              Add helper
            </Button>
          </section>

          {helperOpen && (
            <section className="border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-xl font-semibold">Quick-add helper</h2>
                  <p className="mt-1 text-sm text-muted-foreground">The day-specific wage is stored with the attendance record.</p>
                </div>
                <Button type="button" size="icon" variant="ghost" className="size-9" aria-label="Close helper form" onClick={() => setHelperOpen(false)}><ApperIcon name="X" size={16} /></Button>
              </div>
              <form onSubmit={addHelper} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label htmlFor="helper-name" className="mb-1.5 block text-sm font-medium">Helper name *</label>
                  <Input id="helper-name" value={helperForm.name} onChange={(event) => setHelperForm((current) => ({ ...current, name: event.target.value }))} required placeholder="Full name" className="min-h-10 rounded-sm" />
                </div>
                <div>
                  <label htmlFor="helper-wage" className="mb-1.5 block text-sm font-medium">Daily wage (₹) *</label>
                  <Input id="helper-wage" type="number" min="0.01" step="0.01" value={helperForm.dailyRate} onChange={(event) => setHelperForm((current) => ({ ...current, dailyRate: event.target.value }))} required placeholder="0.00" className="min-h-10 rounded-sm" />
                </div>
                <div>
                  <label htmlFor="helper-status" className="mb-1.5 block text-sm font-medium">Attendance status *</label>
                  <select id="helper-status" value={helperForm.status} onChange={(event) => setHelperForm((current) => ({ ...current, status: event.target.value }))} className="min-h-10 w-full rounded-sm border border-input bg-background px-3 text-sm">
                    {STATUS_OPTIONS.filter((option) => option.key !== 'Unmarked').map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="helper-notes" className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
                  <Input id="helper-notes" value={helperForm.notes} onChange={(event) => setHelperForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Short note" className="min-h-10 rounded-sm" />
                </div>
                <label className="flex items-start gap-2 text-sm sm:col-span-2 xl:col-span-4">
                  <input type="checkbox" checked={helperForm.saveForFuture} onChange={(event) => setHelperForm((current) => ({ ...current, saveForFuture: event.target.checked }))} className="mt-1 size-4 accent-primary" />
                  <span><span className="font-medium">Keep this helper active for future work</span><span className="mt-0.5 block text-xs text-muted-foreground">If unchecked, the helper profile is retained as inactive for history and can be reactivated later.</span></span>
                </label>
                <div className="flex gap-2 sm:col-span-2 xl:col-span-4">
                  <Button type="submit" className="rounded-sm">Add to today’s list</Button>
                  <Button type="button" variant="outline" className="rounded-sm" onClick={() => setHelperOpen(false)}>Cancel</Button>
                </div>
              </form>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Summary label="Full day" value={countStatus('Full Day')} />
            <Summary label="Half day" value={countStatus('Half Day')} />
            <Summary label="Absent" value={countStatus('Absent')} />
            <Summary label="Leave" value={countStatus('Leave')} />
            <Summary label="Pending / unmarked" value={countStatus('Unmarked')} />
            <section className="border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Earned wages · marked only</p>
              <p className="mt-2 font-heading text-xl font-semibold tabular-nums">{cash(earnedTotal)}</p>
            </section>
          </div>

          <div className="relative max-w-lg">
            <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search worker or role…" className="min-h-10 rounded-sm pl-9" aria-label="Search workers in attendance" />
          </div>

          <section className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><h2 className="text-sm font-semibold">Workers for {toLocalDateLabel(selectedDate)}</h2><p className="mt-1 text-xs text-muted-foreground">Existing attendance entries are updated instead of duplicated.</p></div>
              <span className="text-xs text-muted-foreground">{visibleWorkers.length} workers</span>
            </div>
            {dayLoading && !dayData ? (
              <div className="space-y-3 p-5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : dayError ? (
              <div className="p-6"><p className="font-medium">Attendance could not be loaded.</p><p className="mt-1 text-sm text-muted-foreground">{String(dayError?.message ?? dayError)}</p><Button className="mt-3 rounded-sm" variant="outline" onClick={() => reloadDay()}>Retry</Button></div>
            ) : visibleWorkers.length === 0 ? (
              <div className="p-8 text-center"><ApperIcon name="Users" size={28} className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">No active workers found</p><p className="mt-1 text-sm text-muted-foreground">Add a worker profile or a temporary helper to begin.</p><Button asChild className="mt-4 rounded-sm"><Link to="/workers/new">Add worker</Link></Button></div>
            ) : (
              <div className="divide-y divide-border" aria-busy={saving || dayLoading}>
                {visibleWorkers.map((worker) => {
                  const draft = drafts[String(worker.Id)] ?? { status: 'Unmarked', wage: Number(worker.dailyRate_c ?? 0), overtimeHours: '', notes: '' };
                  const pending = Boolean(worker._pendingHelper);
                  const earnings = dailyStatusEarnings(draft.status, draft.wage);
                  return (
                    <div key={worker.Id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(160px,1fr)_100px_minmax(300px,1.6fr)_110px] lg:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{worker.Name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{worker.role_c || 'Helper'} · {worker.workerType_c === 'Temporary' ? 'Temporary' : 'Regular'}{worker.status_c === 'Inactive' ? ' · Inactive profile' : ''}{pending ? ' · New helper' : ''}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Daily wage</p>
                        <p className="mt-1 font-semibold tabular-nums">{cash(draft.wage)}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {STATUS_OPTIONS.map((option) => (
                          <Button key={option.key} type="button" size="sm" variant={draft.status === option.key ? 'default' : 'outline'} className="min-h-10 rounded-sm px-3" aria-pressed={draft.status === option.key} onClick={() => changeStatus(worker, option.key)}>
                            {option.label}
                          </Button>
                        ))}
                        <div className="flex items-center gap-2">
                          <label htmlFor={'attendance-ot-' + worker.Id} className="sr-only">Overtime hours</label>
                          <Input id={'attendance-ot-' + worker.Id} type="number" min="0" step="0.25" value={draft.overtimeHours ?? ''} onChange={(event) => {
                            setDrafts((current) => ({ ...current, [String(worker.Id)]: { ...draft, overtimeHours: event.target.value } }));
                            setDirty(true);
                          }} placeholder="OT hrs" className="h-10 w-24 rounded-sm" />
                        </div>
                      </div>
                      <div className="text-left lg:text-right">
                        <p className="text-xs text-muted-foreground">Earned today</p>
                        <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{draft.status === 'Unmarked' ? 'Pending' : cash(earnings)}</p>
                      </div>
                      <div className="lg:col-span-4">
                        <label htmlFor={'attendance-notes-' + worker.Id} className="sr-only">Notes for {worker.Name}</label>
                        <Input id={'attendance-notes-' + worker.Id} value={draft.notes ?? ''} onChange={(event) => {
                          setDrafts((current) => ({ ...current, [String(worker.Id)]: { ...draft, notes: event.target.value } }));
                          setDirty(true);
                        }} placeholder="Optional attendance note" className="min-h-9 rounded-sm" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-3 border-t border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Overtime hours are recorded for reference only. They are not added to wages without an explicitly configured overtime rate.</p>
              <Button type="button" onClick={saveAttendance} disabled={saving || dayLoading || !access.canCreate || !access.canUpdate} className="min-h-11 rounded-sm">
                {saving ? 'Saving attendance…' : 'Save / update attendance'}
                {!saving && <ApperIcon name="Check" size={16} />}
              </Button>
            </div>
          </section>
        </>
      ) : (
        <section className="space-y-4">
          <PeriodControls type={periodType} onTypeChange={setPeriodType} anchorDate={periodAnchor} onAnchorDateChange={setPeriodAnchor} />
          <div className="relative max-w-lg">
            <ApperIcon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search worker, date, or status…" className="min-h-10 rounded-sm pl-9" aria-label="Search attendance history" />
          </div>
          <section className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Saved attendance</h2><span className="text-xs text-muted-foreground">{filteredHistory.length} entries · {period.label}</span></div>
            {historyLoading ? <div className="space-y-3 p-5"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              : historyError ? <div className="p-5 text-sm text-destructive">{String(historyError?.message ?? historyError)} <Button size="sm" variant="outline" onClick={() => reloadHistory()}>Retry</Button></div>
                : filteredHistory.length === 0 ? <div className="p-8 text-center"><p className="font-semibold">No attendance for this period</p><p className="mt-1 text-sm text-muted-foreground">Choose another period or switch back to the daybook.</p></div>
                  : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Worker</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Wage snapshot</th><th className="px-4 py-3 text-right">Earned</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-border">{filteredHistory.map((row) => {
                    const worker = workers.find((item) => String(item.Id) === lookupId(row.worker_c)) ?? { Id: lookupId(row.worker_c), Name: row.worker_c?.Name ?? 'Unknown worker' };
                    return <tr key={row.Id}><td className="whitespace-nowrap px-4 py-3">{toLocalDateLabel(row.attendanceDate_c)}</td><td className="px-4 py-3 font-medium">{worker.Name}</td><td className="px-4 py-3">{row.status_c === 'Present' ? 'Full day' : row.status_c}</td><td className="px-4 py-3 text-right tabular-nums">{cash(row.wagePerDay_c ?? worker.dailyRate_c ?? 0)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{row.status_c === 'Unmarked' ? 'Pending' : cash(attendanceEarnings(row, worker))}</td><td className="max-w-56 px-4 py-3 text-muted-foreground">{row.notes_c || '—'}</td><td className="px-4 py-3"><Button type="button" size="sm" variant="outline" className="rounded-sm" onClick={() => { if (dirty && !window.confirm('Discard unsaved attendance changes?')) return; setDirty(false); setSelectedDate(row.attendanceDate_c); setView('daybook'); }}>Correct</Button></td></tr>;
                  })}</tbody></table></div>}
          </section>
        </section>
      )}
    </div>
  );
}

function Summary({ label, value }) {
  return <section className="border border-border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 font-heading text-2xl font-semibold tabular-nums">{value}</p></section>;
}
