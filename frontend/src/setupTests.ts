import '@testing-library/jest-dom/vitest';

// jsdom implements no canvas and logs "not implemented" on every getContext call. Code
// that paints guards for a null context, so an inert one keeps test output clean; a
// test that wants to observe painting installs its own stub.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom 25 has HTMLDialogElement but no showModal/close. The Modal only needs
// the open attribute toggled and a close event, which is what browsers do.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
