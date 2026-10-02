import type { SVGProps } from 'react';

export function GitCompareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="4" r="1.5" />
      <path d="M4 10.5V6.5a2 2 0 0 1 2-2h3" />
      <polyline points="7.5 3 9 4.5 7.5 6" />
      <path d="M12 5.5v4a2 2 0 0 1-2 2H7" />
      <polyline points="8.5 10 7 11.5 8.5 13" />
    </svg>
  );
}
