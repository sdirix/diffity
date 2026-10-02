import type { SVGProps } from 'react';

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
      <polyline points="13.5 2 13.5 4.5 11 4.5" />
    </svg>
  );
}
