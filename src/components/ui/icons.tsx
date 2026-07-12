import type { SVGProps } from "react";

/**
 * Set de íconos de línea entregado por el negocio (public/icons/*.svg),
 * envuelto como componentes React para poder controlar el color con
 * `currentColor` vía clases de Tailwind (un <img> con SVG externo no
 * hereda el `color` de la página). Mismo estilo maestro para todos:
 * viewBox 24x24, stroke, sin relleno, trazo 1.45.
 */

export type IconProps = SVGProps<SVGSVGElement>;

function createIcon(paths: string[], shapes?: (props: IconProps) => React.ReactNode) {
  return function Icon({ strokeWidth = 1.45, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...props}
      >
        {shapes?.(props)}
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

export const LeafIcon = createIcon([
  "M19.5 4.5c-6.4.3-11 2.4-13.4 6.2-1.7 2.7-1.4 5.9.8 7.2 2.3 1.4 5.5.1 7.3-2.6 2.2-3.2 3-7.1 5.3-10.8Z",
  "M6.3 17.8c2.3-3.4 5.1-6.1 8.8-8.3",
  "M9.2 13.9c1 .1 2 .4 2.9.9",
]);

export const ClockIcon = createIcon(
  ["M12 7.7v4.8l3.2 1.8", "M9.2 2.8h5.6"],
  () => <circle cx="12" cy="12" r="8.5" />,
);

export const CakeIcon = createIcon([
  "M5 10.2h14v8.3H5z",
  "M6.5 10.2V8.7c0-1 .8-1.8 1.8-1.8h7.4c1 0 1.8.8 1.8 1.8v1.5",
  "M5 14.2c1.2 0 1.2 1.2 2.4 1.2s1.2-1.2 2.4-1.2 1.2 1.2 2.4 1.2 1.2-1.2 2.4-1.2 1.2 1.2 2.4 1.2 1.2-1.2 2.4-1.2",
  "M9 6.9V5.2M12 6.9V4.7M15 6.9V5.2",
]);

export const PeopleIcon = createIcon(
  [
    "M4.8 18.5c.4-3.4 2.1-5.4 4.2-5.4s3.8 2 4.2 5.4",
    "M13.8 13.8c.7-.7 1.5-1 2.4-1 1.8 0 3.2 1.6 3.6 4.7",
  ],
  () => (
    <>
      <circle cx="9" cy="8.2" r="2.4" />
      <circle cx="16.2" cy="9.2" r="2" />
    </>
  ),
);

export const FlavorIcon = createIcon([
  "M19.2 4.8c-5.2.2-9 1.9-11 4.9-1.5 2.2-1.3 4.8.5 6 1.9 1.2 4.5.2 6-2 1.9-2.6 2.6-5.8 4.5-8.9Z",
  "M8.5 15.4c2-2.7 4.4-4.9 7.5-6.7",
  "M5.1 19.1c2.4-1.1 5.2-1.2 7.7-.3",
]);

export const HeartIcon = createIcon([
  "M12 19.2 4.9 12.4C1.9 9.4 4 5.1 7.5 5.1c2 0 3.2 1.2 4.5 2.8 1.3-1.6 2.5-2.8 4.5-2.8 3.5 0 5.6 4.3 2.6 7.3L12 19.2Z",
]);

export const ChatIcon = createIcon([
  "M4 5.4h16v10.1H9.3L5 19v-3.5H4z",
  "M8.1 9.1h7.8M8.1 12.1h5.2",
]);

export const ClipboardIcon = createIcon([
  "M7 5.5h10v15H7z",
  "M9 5.5V3.8h6v1.7",
  "M9.5 9.2h5M9.5 12.2h5M9.5 15.2h3.2",
  "m15.1 16.2 1.2 1.2 2.3-2.8",
]);

export const DeliveryIcon = createIcon(
  ["M3.5 7.2h10.2v8.7H3.5z", "M13.7 10.1h3.1l2.2 2.3v3.5h-5.3z", "M5.5 10.2h5.7"],
  () => (
    <>
      <circle cx="7" cy="17.4" r="1.6" />
      <circle cx="16.7" cy="17.4" r="1.6" />
    </>
  ),
);

export const CalendarIcon = createIcon(
  ["M7.5 3.7v3.2M16.5 3.7v3.2M4 9.2h16", "M8 12.2h2M12 12.2h2M16 12.2h0M8 15.7h2M12 15.7h2"],
  () => <rect x="4" y="5.5" width="16" height="14" rx="1.5" />,
);

export const NoSameDayIcon = createIcon(
  ["M7.5 3.7v3.2M16.5 3.7v3.2M4 9.2h16", "M8.3 12.4l7.4 5.1M15.7 12.4l-7.4 5.1"],
  () => <rect x="4" y="5.5" width="16" height="14" rx="1.5" />,
);

export const PercentageIcon = createIcon(
  ["M17.6 6.4 6.4 17.6"],
  () => (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="16" cy="16" r="2.1" />
    </>
  ),
);

export const GiftIcon = createIcon([
  "M4.2 10h15.6v9.2H4.2z",
  "M3.5 7.2h17v2.8h-17z",
  "M12 7.2v12",
  "M11.8 7.1C9.7 7.1 7.5 6 7.5 4.5c0-1 .7-1.7 1.8-1.7 1.7 0 2.5 2.2 2.5 4.3Z",
  "M12.2 7.1c2.1 0 4.3-1.1 4.3-2.6 0-1-.7-1.7-1.8-1.7-1.7 0-2.5 2.2-2.5 4.3Z",
]);

export const LocationIcon = createIcon(
  ["M12 20.2s6.2-5.5 6.2-10.4A6.2 6.2 0 0 0 5.8 9.8C5.8 14.7 12 20.2 12 20.2Z"],
  () => <circle cx="12" cy="9.7" r="2.2" />,
);

export const OrderBoxIcon = createIcon([
  "m4.5 8.2 7.5-3.7 7.5 3.7-7.5 3.7-7.5-3.7Z",
  "M4.5 8.2v8.2l7.5 3.1 7.5-3.1V8.2",
  "M12 11.9v7.6",
  "m8.2 6.4 7.5 3.7",
]);

export const CelebrationIcon = createIcon([
  "M6.1 18.8 9.8 9l5.2 5.2-8.9 4.6Z",
  "M10.7 7.1c.8-1.8 2.1-2.8 3.7-3",
  "M14.4 8.3c1.1-1.5 2.5-2.1 4.1-1.9",
  "M15.8 11.2c1.7-.8 3.1-.6 4.4.3",
  "M16.5 4.4h.1M19.3 8.7h.1M13.1 2.9h.1",
]);
