import type { SVGProps } from 'react';

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" {...props}>
      <path d="M8 1.5c.3 0 .55.2.62.49l.5 2.03a3.5 3.5 0 0 0 2.56 2.56l2.03.5a.64.64 0 0 1 0 1.24l-2.03.5a3.5 3.5 0 0 0-2.56 2.56l-.5 2.03a.64.64 0 0 1-1.24 0l-.5-2.03a3.5 3.5 0 0 0-2.56-2.56l-2.03-.5a.64.64 0 0 1 0-1.24l2.03-.5a3.5 3.5 0 0 0 2.56-2.56l.5-2.03A.64.64 0 0 1 8 1.5z" />
    </svg>
  );
}

export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2 7.2 8.8M14 2l-4.2 12-2.6-5.2L2 6.2 14 2z" />
    </svg>
  );
}
