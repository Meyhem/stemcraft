import '@testing-library/jest-dom/vitest';

// Mock Web Audio APIs for testing modules that import audio engine code.
if (typeof globalThis.AudioWorkletNode === 'undefined') {
  globalThis.AudioWorkletNode = class {
    constructor(context: any, name: string, options?: any) {}
    connect(node: any) {}
    disconnect() {}
    parameters = new Map();
    port = { postMessage: () => {}, onmessage: null };
  } as any;
}

if (typeof globalThis.AudioContext === 'undefined') {
  globalThis.AudioContext = class {
    audioWorklet = { addModule: async () => {} };
    sampleRate = 48000;
    currentTime = 0;
    state = 'running';
    async resume() {}
    async close() {}
    decodeAudioData = async (bytes: any) => ({
      length: 0,
      getChannelData: () => new Float32Array(),
      numberOfChannels: 2,
    });
    destination = {};
  } as any;
}
