// All tuning parameters live here. Differences are mean grayscale levels (0–255).
const STABILITY_CONFIG = Object.freeze({ sampleMs: 200, width: 160, height: 120,
  stableMs: 1500, stableThreshold: 3, movementThreshold: 12, maxGapMs: 800 });

class StabilityDetector {
  constructor(video, { onStatus, onStable, onError = () => {}, config = {} }) {
    Object.assign(this, { video, onStatus, onStable, onError });
    this.config = { ...STABILITY_CONFIG, ...config };
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.config.width;
    this.canvas.height = this.config.height;
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });
    this.generation = 0;
  }
  start() {
    this.stop();
    const generation = this.generation;
    this.onStatus('等待稳定');
    const tick = async () => {
      if (generation !== this.generation) return;
      try {
        if (this.video.readyState < 2 || !this.video.videoWidth) {
          this.previous = null; this.since = null;
        } else {
          const now = performance.now();
          const size = `${this.video.videoWidth}x${this.video.videoHeight}`;
          if (size !== this.size || now - this.last > this.config.maxGapMs) {
            this.previous = null; this.since = null;
          }
          this.size = size; this.last = now;
          this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
          const rgba = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
          const gray = new Uint8Array(rgba.length / 4);
          for (let i = 0; i < gray.length; i++) gray[i] = .299 * rgba[i*4] + .587 * rgba[i*4+1] + .114 * rgba[i*4+2];
          if (this.previous) {
            const change = StabilityDetector.difference(gray, this.previous);
            if (this.locked) {
              // Compare with captured scene too, so gradual movement can rearm.
              if (change >= this.config.movementThreshold || (this.reference && StabilityDetector.difference(gray, this.reference) >= this.config.movementThreshold)) {
                this.locked = false; this.since = null; this.onStatus('画面移动中');
              } else this.onStatus('已拍摄，请移动或翻页');
            } else if (change > this.config.stableThreshold) {
              this.since = null; this.onStatus('画面移动中');
            } else {
              this.since ??= now;
              this.onStatus('等待稳定');
              if (now - this.since >= this.config.stableMs) {
                this.locked = true; this.reference = gray.slice();
                this.onStatus('已拍摄，请移动或翻页');
                await this.onStable();
              }
            }
          }
          this.previous = gray;
        }
      } catch (error) { this.stop(); this.onError(error); return; }
      if (generation === this.generation) this.timer = setTimeout(tick, this.config.sampleMs);
    };
    this.timer = setTimeout(tick, this.config.sampleMs);
  }
  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.previous = this.reference = null;
    this.since = null; this.last = 0; this.size = null; this.locked = false;
  }
  static difference(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }
}
window.StabilityDetector = StabilityDetector;
