import type { ReactNode } from 'react';

const ICONS = {
  cube: <path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9Z M3.5 7.5 12 12.2l8.5-4.7 M12 12.2v9" />,
  plane: <path d="M2.8 14.2 12 9.6l9.2 4.6-9.2 4.6Z" />,
  sphere: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12c0 2.2 3.8 4 8.5 4s8.5-1.8 8.5-4" />
    </>
  ),
  cylinder: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
    </>
  ),
  group: <path d="M3.5 7h5.5l2 2h9.5v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />,
  undo: <path d="M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  select: <path d="M5.5 3.5 18.5 10l-6 1.8-2.6 6.2Z" />,
  move: <path d="M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3" />,
  rotate: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4v4.5H15" />,
  scale: <path d="M4 13h7v7H4Z M11 13l9-9 M14 4h6v6" />,
  snap: <path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0Z M5 8h4 M15 8h4" />,
  frame: (
    <>
      <path d="M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  points: (
    <path d="M4.5 4.5h3v3h-3Z M16.5 4.5h3v3h-3Z M4.5 16.5h3v3h-3Z M16.5 16.5h3v3h-3Z M7.5 6h9 M7.5 18h9 M6 7.5v9 M18 7.5v9" />
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <path d="M3 3l18 18 M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8 M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1 M9.9 9.9a2.8 2.8 0 0 0 4 4" />
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  trash: <path d="M4 7h16 M9.5 7V4.5h5V7 M6 7l1 13h10l1-13" />,
  duplicate: <path d="M8.5 8.5h11v11h-11Z M15.5 8.5V4.5h-11v11h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5 M12 8h.01" />
    </>
  ),
  warning: <path d="M12 3.5 21.5 20h-19Z M12 10v4.5 M12 17.3h.01" />,
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6 M15 9l-6 6" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  history: <path d="M4 12a8 8 0 1 0 2.3-5.6 M4 4v4.5h4.5 M12 8v4.5l3 2" />,
  fill: <path d="M4 4h16v16H4Z M4 13l9-9 M9 20l11-11 M15 20l5-5" />,
  normals: <path d="M3 15.5l9 4.5 9-4.5 M12 20V8.5 M8.5 7.5 12 4l3.5 3.5" />,
  inspect: <path d="M4 6h10 M4 12h7 M4 18h6 M15.5 15.5l2 2 3.5-4" />,
  file: <path d="M6 3h8l4 4v14H6Z M14 3v4h4" />,
  folder: <path d="M3.5 6.5h6l2 2h9v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />,
  save: <path d="M5 4h11l3 3v13H5Z M8 4v5h7V4 M8 20v-6h8v6" />,
  close: <path d="M6 6l12 12 M18 6 6 18" />,
  pen: <path d="M4 20l4.6-1.1L19 8.5a2.1 2.1 0 0 0-3-3L5.6 15.9Z M14.2 7.3l3 3" />,
  blueprint: (
    <>
      <path d="M6.6 16.6 11 7.6 M13.2 7.4l4.4 7.2" />
      <circle cx="5.8" cy="18.2" r="1.9" />
      <circle cx="12" cy="5.8" r="1.9" />
      <circle cx="18.6" cy="16.2" r="1.9" />
    </>
  ),
  rectangle: (
    <>
      <path d="M6.5 6h11 M6.5 18h11 M6 6.5v11 M18 6.5v11" />
      <circle cx="6" cy="6" r="1.4" />
      <circle cx="18" cy="6" r="1.4" />
      <circle cx="6" cy="18" r="1.4" />
      <circle cx="18" cy="18" r="1.4" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 12h7.5" strokeDasharray="1.5 2" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  mirror: <path d="M12 3v3 M12 9v2 M12 14v2 M12 19v2 M9.5 7.5 4 17h5.5Z M14.5 7.5 20 17h-5.5Z" />,
  turntable: (
    <path d="M12 4.5 16.5 7v5L12 14.5 7.5 12V7Z M7.5 7 12 9.5 16.5 7 M12 9.5v5 M3.5 14.5c1.2 2.6 4.5 4.5 8.5 4.5 3.3 0 6.1-1.3 7.6-3.2 M17.2 14.6l2.6 1.1-.6 2.8" />
  ),
  export: <path d="M12 3.5v11 M7.5 10 12 14.5l4.5-4.5 M5 17v2.5h14V17" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  shapeFlat: <path d="M3 14.5 12 10l9 4.5-9 4.5Z" />,
  shapeExtrude: <path d="M4 14.5 12 10.5l8 4-8 4Z M4 14.5V9.5L12 5.5l8 4v5 M12 10.5v-5" />,
  shapeRevolve: (
    <path d="M9.5 3.5h5 M10.2 3.5c.3 2.5-4.2 4-4.2 9 0 4.4 2.7 8 6 8s6-3.6 6-8c0-5-4.5-6.5-4.2-9 M6.2 12.5c1.5.9 3.6 1.4 5.8 1.4s4.3-.5 5.8-1.4" />
  ),
  sidebar: <path d="M3.5 5h17v14h-17Z M15 5v14" />,
  fit: <path d="M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M9 9h6v6H9Z" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  magnet: <path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0Z M5 8h4 M15 8h4" />,
  car: (
    <>
      <path d="M2.8 15.5v-2.6c0-.8.5-1.4 1.2-1.6l3.1-.9 2.4-2.5c.5-.5 1.1-.8 1.8-.8h3.4c.8 0 1.5.4 1.9 1l1.6 2.3 2.2.6c.7.2 1.1.8 1.1 1.5v3h-2.2 M8.6 15.5h6.8 M5.6 15.5H2.8" />
      <circle cx="7.1" cy="15.6" r="1.7" />
      <circle cx="16.9" cy="15.6" r="1.7" />
    </>
  ),
  curvePen: (
    <>
      <path d="M3.5 19.5c3.5-1 4.5-9 9-11.5s6.5 1.5 8-3" />
      <circle cx="3.5" cy="19.5" r="1.6" />
      <circle cx="12.5" cy="8" r="1.6" />
      <circle cx="20.5" cy="5" r="1.6" />
    </>
  ),
  smooth: (
    <>
      <path d="M4 18 9 8l5 10 M14 18c1.2-6 2.8-9 3.5-9s2.3 3 2.5 9" />
    </>
  ),
  image: (
    <>
      <path d="M3.5 5h17v14h-17Z M3.5 16l5-5 4 4 2.5-2.5 5.5 5" />
      <circle cx="15.5" cy="9" r="1.6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/** The FORGEX 3D mark: an isometric cube with a forged notch cut from its top face. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M32 6 55 19.3 32 32.6 9 19.3Z" fill="#62cbff" />
      <path d="M9 19.3 32 32.6V59L9 45.7Z" fill="#1c8fe6" />
      <path d="M55 19.3 32 32.6V59l23-13.3Z" fill="#0b5aa6" />
      <path d="M32 14.5 43 20.9 38.6 23.4 32 19.6 25.4 23.4 21 20.9Z" fill="#0a1422" opacity="0.85" />
      <path d="M32 32.6V59" stroke="#0a1422" strokeOpacity="0.5" strokeWidth="1.2" />
    </svg>
  );
}
