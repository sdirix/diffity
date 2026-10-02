import { Link, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { lastLocation, type AppView } from '../../lib/view-state';

const TABS: { view: AppView; label: string; title: string }[] = [
  { view: 'diff', label: 'Diff', title: 'Review changes' },
  { view: 'tree', label: 'Files', title: 'Browse repository files' },
];

/** Switches between the diff and the file browser, each opening where it was left. */
export function ViewTabs(props: { current: AppView }) {
  const { current } = props;
  const { search } = useLocation();

  return (
    <nav aria-label="Views" className="flex items-center gap-0.5 p-0.5 bg-bg-tertiary rounded-md shrink-0">
      {TABS.map((tab) => {
        const className = 'px-2 py-0.5 rounded text-xs transition-colors';
        if (tab.view === current) {
          return (
            <span key={tab.view} aria-current="page" className={cn(className, 'bg-bg text-text font-medium shadow-sm')}>
              {tab.label}
            </span>
          );
        }
        return (
          <Link key={tab.view} to={lastLocation(tab.view, search)} title={tab.title} className={cn(className, 'text-text-muted hover:text-text')}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
