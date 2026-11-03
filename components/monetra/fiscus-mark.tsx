import type { SVGProps } from 'react';

type FiscusMarkProps = SVGProps<SVGSVGElement> & { size?: number };

export function FiscusMark({ size = 24, ...props }: FiscusMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill="#12382E" stroke="#285B4B" strokeWidth="1.5" />
      <path
        d="M29.5 15.2C26.2 12.5 20.4 12.2 16.5 14.7C12.8 17.1 11.4 20.6 11.7 24.1C7.9 26.5 7 32.2 10 35.7C8.1 40.4 10.6 45.7 15.7 47.3C16.1 52.3 20.5 55.7 25.2 54.8C27 55.9 29.1 56.4 31.2 55.8V17.2C30.7 16.4 30.1 15.7 29.5 15.2Z"
        stroke="#7BD9AE"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 25.5C22.5 25.5 23.8 29.2 21.7 32.2M14.7 38.1C19 37.7 21.1 40.8 19.2 44" stroke="#7BD9AE" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M32 22H40V17.5H45M32 32H43M32 42H39V47H44" stroke="#7BD9AE" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="47.5" cy="17.5" r="2.7" fill="#7BD9AE" />
      <circle cx="46" cy="32" r="2.7" fill="#7BD9AE" />
      <circle cx="46.5" cy="47" r="2.7" fill="#7BD9AE" />
      <path d="M39 26V22M43 26V19.5M47 26V16" stroke="#2D9A70" strokeWidth="1.7" strokeLinecap="round" opacity=".9" />
      <path d="M37.5 24.5L46.5 14.8L45.7 20.2M46.5 14.8L41.2 15.6" stroke="#E7C77A" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="49" r="7.2" fill="#7BD9AE" />
      <path d="M49.8 45.5C49.2 44.8 48.2 44.6 47.3 44.9C46.4 45.2 46 46.1 46.5 46.8C47 47.5 49.5 47.5 49.5 49C49.5 50.1 48.5 50.8 47.3 50.8C46.5 50.8 45.7 50.5 45.2 50M47.7 43.6V52.3" stroke="#12382E" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
