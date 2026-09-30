// The navbar is drawn by AppShell; the song session that knows what is playing
// lives below it, under SongScope (D-18). This carries the navbar's decorative
// slot down, so the session can portal the pulse bar up into it without the
// shell knowing anything about engines.
import { createContext } from 'react';

export const PulseSlotContext = createContext<HTMLElement | null>(null);
