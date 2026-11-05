import type { ReactNode } from 'react';

type IconName = 'brand' | 'settings' | 'check' | 'spark' | 'scan' | 'arrow' | 'back' | 'edit';

const paths: Record<IconName, ReactNode> = {
  brand: <>
    <path d="m12 2.7 8.7 5.1v8.4L12 21.3l-8.7-5.1V7.8z" />
    <path d="m3.3 7.8 8.7 5 8.7-5M12 12.8v8.5M12 2.7v5.7m0 0-4.9 3m4.9-3 4.9 3" />
  </>,
  settings: <>
    <path d="M12 2.8v2.3m0 13.8v2.3M2.8 12h2.3m13.8 0h2.3M5.5 5.5l1.6 1.6m9.8 9.8 1.6 1.6m0-13L16.9 7m-9.8 9.9-1.6 1.6" />
    <circle cx="12" cy="12" r="6.9" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
  check: <path d="m5.5 12.4 4.1 4.1 8.9-9" />,
  spark: <><path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" /><path d="M19 4v4m-2-2h4" /></>,
  scan: <><path d="M4 9V6a2 2 0 0 1 2-2h3m6 0h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3m-6 0H6a2 2 0 0 1-2-2v-3M8 12h8" /></>,
  arrow: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  edit: <><path d="m14.5 6.5 3 3M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
