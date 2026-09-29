import '@testing-library/jest-dom/vitest';

// jsdom implements no canvas and logs "not implemented" on every getContext call. Code
// that paints guards for a null context, so an inert one keeps test output clean; a
// test that wants to observe painting installs its own stub.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
