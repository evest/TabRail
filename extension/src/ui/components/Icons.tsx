// 12px stroke icons; color follows currentColor.
const base = {
  width: 12,
  height: 12,
  viewBox: '0 0 12 12',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.3,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
} as const;

export const SleepIcon = () => (
  <svg {...base} class="ico ico-sleep">
    <path d="M3 3.5h3l-3 4h3M7.5 2h2.5l-2.5 3H10" />
  </svg>
);

export const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg {...base} class="ico ico-audio">
    <path d="M1.5 4.5h2L6.5 2v8L3.5 7.5h-2z" />
    {muted ? (
      <path d="M8.5 4.5l3 3M11.5 4.5l-3 3" />
    ) : (
      <path d="M8.5 4a2.8 2.8 0 0 1 0 4M10 2.8a4.8 4.8 0 0 1 0 6.4" />
    )}
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} class="ico">
    <path d="M3 3l6 6M9 3L3 9" />
  </svg>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...base} class={`ico chev${open ? ' open' : ''}`}>
    <path d="M4.5 2.5L8 6l-3.5 3.5" />
  </svg>
);

export const PinIcon = () => (
  <svg {...base} class="ico ico-pin">
    <path d="M7.5 1.5l3 3-2 1-2 2 .5 2.5L2.5 5.5 5 6l2-2z M4.5 7.5L1.5 10.5" />
  </svg>
);

export const GlobeIcon = () => (
  <svg {...base} class="ico">
    <circle cx="6" cy="6" r="4.5" />
    <path d="M1.5 6h9M6 1.5c-1.6 1.6-1.6 7.4 0 9M6 1.5c1.6 1.6 1.6 7.4 0 9" />
  </svg>
);
