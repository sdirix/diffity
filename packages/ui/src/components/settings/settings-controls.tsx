import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function SettingsGroup(props: { title: string; children: ReactNode }) {
  const { title, children } = props;

  return (
    <section className="flex flex-col">
      <h3 className="pb-1.5 mb-1 border-b border-border text-[11px] font-semibold text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

interface SettingsRowProps {
  /** Lets the search scroll to the row, see `settingElementId`. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Puts the control below the label instead of next to it. */
  stacked?: boolean;
  children?: ReactNode;
}

export function settingElementId(id: string): string {
  return `setting-${id}`;
}

export function SettingsRow(props: SettingsRowProps) {
  const { id, label, hint, stacked, children } = props;

  return (
    <div id={settingElementId(id)} className={cn('flex gap-2 py-2.5', stacked ? 'flex-col' : 'items-center justify-between gap-4')}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] text-text">{label}</span>
        {hint && <p className="text-[11.5px] leading-snug text-text-muted">{hint}</p>}
      </div>
      {children && <div className={cn('flex items-center gap-2', !stacked && 'shrink-0')}>{children}</div>}
    </div>
  );
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** A row of radio buttons, for a setting with a few named values. */
export function ChoiceGroup<T extends string>(props: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  const { label, value, options, onChange } = props;

  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 p-0.5 rounded-lg bg-bg-tertiary">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-6 px-2.5 rounded-md text-xs transition-colors cursor-pointer',
              active ? 'bg-bg text-text shadow-sm ring-1 ring-border' : 'text-text-secondary hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const { label, checked, onChange } = props;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-8 h-[18px] rounded-full transition-colors cursor-pointer',
        checked ? 'bg-accent' : 'bg-bg-tertiary ring-1 ring-inset ring-border',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-[14px]',
        )}
      />
    </button>
  );
}

type ButtonVariant = 'default' | 'primary' | 'danger';

export function SettingsButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const { variant = 'default', className, type = 'button', ...rest } = props;

  return (
    <button
      type={type}
      className={cn(
        'px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default',
        variant === 'default' && 'border border-border text-text hover:bg-hover',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'danger' && 'bg-deleted text-white hover:opacity-90',
        className,
      )}
      {...rest}
    />
  );
}

export const settingsInputClass =
  'w-full rounded-md border border-border bg-bg-secondary px-2.5 font-mono text-xs text-text outline-none placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/20';
