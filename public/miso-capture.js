/* Audio capture/resampling only. Speech recognition runs in the cloud. */
class MisoCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Int16Array(1280); this.index = 0;
    this.phase = 0; this.sum = 0; this.count = 0; this.energy = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.sum += sample; this.count++; this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0; this.count = 0; this.energy += value * value;
      this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.index === this.frame.length) {
        // Explicit little-endian output also works on a non-little-endian host.
        const bytes = new ArrayBuffer(this.frame.length * 2), view = new DataView(bytes);
        for (let i = 0; i < this.frame.length; i++) view.setInt16(i * 2, this.frame[i], true);
        this.port.postMessage({ pcm: bytes, rms: Math.sqrt(this.energy / this.frame.length) }, [bytes]);
        this.index = 0; this.energy = 0;
      }
    }
    return true;
  }
}
registerProcessor('miso-capture', MisoCapture);
