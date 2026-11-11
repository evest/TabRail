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

/** Cogwheel (Lucide "settings", ISC license; see THIRD_PARTY_NOTICES.md), on a 24-unit grid. */
export const GearIcon = () => (
  <svg {...base} class="ico" width={14} height={14} viewBox="0 0 24 24" stroke-width={2}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
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

/** Sidebar "Pinned" section pin (filled, unlike Chrome's own pinned-tab glyph). */
export const RailPinIcon = ({ filled }: { filled: boolean }) => (
  <svg {...base} class="ico ico-railpin" fill={filled ? 'currentColor' : 'none'}>
    <path d="M4 1.5h4M5 1.5v3L3 7h6L7 4.5v-3M6 7v3.5" />
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
