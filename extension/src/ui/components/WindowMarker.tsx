import type { Marker } from '../viewModel';

/** Color-only chip identifying a window; no number (Chrome has no window numbers to match). */
export const WindowMarker = ({ marker }: { marker: Marker }) => (
  <span class="marker" style={{ background: marker.color }} aria-hidden="true" />
);
