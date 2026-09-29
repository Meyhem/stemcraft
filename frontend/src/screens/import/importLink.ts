import type { Location } from 'react-router-dom';

// D-14 keeps /import a route; it renders as a modal over whatever page linked
// to it. Links pass that page along as the background location.
export interface ImportLinkState {
  background: Location;
}

export function importLinkState(location: Location): ImportLinkState {
  return { background: location };
}
