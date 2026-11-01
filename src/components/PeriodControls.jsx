import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ApperIcon from '@/components/ApperIcon';
import { getPeriodRange, shiftPeriod } from '@/services/periods';

const DEFAULT_OPTIONS = [
  { value: 'month', label: 'Monthly' },
  { value: 'week', label: 'Weekly' },
  { value: 'day', label: 'Daily' },
];

const YEARLY_OPTIONS = [
  { value: 'year', label: 'Yearly' },
  { value: 'month', label: 'Monthly' },
  { value: 'week', label: 'Weekly' },
  { value: 'day', label: 'Daily' },
];

export default function PeriodControls({ type, onTypeChange, anchorDate, onAnchorDateChange, showYearly = false }) {
  const period = getPeriodRange(type, anchorDate);
  const options = showYearly ? YEARLY_OPTIONS : DEFAULT_OPTIONS;

  return (
    <section className="flex flex-col gap-3 border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date period">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={type === option.value ? 'default' : 'outline'}
            aria-pressed={type === option.value}
            className="rounded-sm"
            onClick={() => onTypeChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 rounded-sm"
          onClick={() => onAnchorDateChange(shiftPeriod(anchorDate, type, -1))}
          aria-label="Previous period"
          title="Previous period"
        >
          <ApperIcon name="ChevronLeft" size={16} />
        </Button>
        <div className="min-w-36 flex-1 sm:flex-none">
          <label htmlFor="period-anchor-date" className="sr-only">Choose a date</label>
          <Input
            id="period-anchor-date"
            type="date"
            value={anchorDate}
            onChange={(event) => event.target.value && onAnchorDateChange(event.target.value)}
            className="min-h-9 rounded-sm"
          />
          <p className="mt-1 text-center text-xs font-medium text-muted-foreground">{period.label}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 rounded-sm"
          onClick={() => onAnchorDateChange(shiftPeriod(anchorDate, type, 1))}
          aria-label="Next period"
          title="Next period"
        >
          <ApperIcon name="ChevronRight" size={16} />
        </Button>
      </div>
    </section>
  );
}
