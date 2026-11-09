import type { Marker } from '../viewModel';

export const WindowMarker = ({ marker }: { marker: Marker }) => (
  <span class="marker" style={{ background: marker.color }} title={`Window ${marker.n}`}>
    {marker.n}
  </span>
);
