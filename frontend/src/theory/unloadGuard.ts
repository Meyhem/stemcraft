// Asks the browser to warn before the page is closed or reloaded, for as long as anything has asked for it
// (D-19, N-08). A PUT during page unload cannot be relied on (its body may exceed a keepalive request's 64 KB),
// so unsaved theory.json changes, a quiz round's unsaved answers and a document kept after leaving the tab each
// hold the guard under their own owner. The listener is one, added when the first owner arrives and removed when
// the last one lets go, so owners cannot remove each other's.
const owners = new Set<object>();

function warn(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

export function holdUnloadGuard(owner: object): void {
  if (owners.has(owner)) return;
  if (owners.size === 0) window.addEventListener('beforeunload', warn);
  owners.add(owner);
}

export function releaseUnloadGuard(owner: object): void {
  if (owners.delete(owner) && owners.size === 0) window.removeEventListener('beforeunload', warn);
}
