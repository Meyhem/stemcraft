// The row under the transport holds the Stems / Tab / Play along switch and, beside it,
// the tools that belong to whichever view is showing (zoom and follow for Stems and Tab,
// the scale link for Play along). The views are child routes, so they hand their tools
// up through a portal into the slot SongScreen owns.
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const ViewToolsContext = createContext<HTMLElement | null>(null);

export function ViewTools({ children }: { children: ReactNode }) {
  const slot = useContext(ViewToolsContext);
  return slot ? createPortal(children, slot) : null;
}
