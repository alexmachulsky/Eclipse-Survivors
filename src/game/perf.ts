export interface PerfSummary {
  fps: number;
  p50Frame: number;
  p95Frame: number;
  updateP50: number;
  updateP95: number;
  renderP50: number;
  renderP95: number;
}

const SAMPLE_LIMIT = 180;

const frameSamples: number[] = [];
const updateSamples: number[] = [];
const renderSamples: number[] = [];

let frameStartedAt = 0;
let updateStartedAt = 0;
let renderStartedAt = 0;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function pushSample(samples: number[], value: number): void {
  samples.push(Math.max(0, value));

  if (samples.length > SAMPLE_LIMIT) {
    samples.splice(0, samples.length - SAMPLE_LIMIT);
  }
}

function percentile(samples: number[], percentileValue: number): number {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue));
  return Math.round(sorted[index] * 10) / 10;
}

export function beginFrame(timestamp = now()): void {
  frameStartedAt = timestamp;
}

export function endFrame(timestamp = now()): void {
  pushSample(frameSamples, timestamp - frameStartedAt);
}

export function beginUpdate(timestamp = now()): void {
  updateStartedAt = timestamp;
}

export function endUpdate(timestamp = now()): void {
  pushSample(updateSamples, timestamp - updateStartedAt);
}

export function beginRender(timestamp = now()): void {
  renderStartedAt = timestamp;
}

export function endRender(timestamp = now()): void {
  pushSample(renderSamples, timestamp - renderStartedAt);
}

export function summary(): PerfSummary {
  const totalFrameMs = frameSamples.reduce((total, sample) => total + sample, 0);
  const fps = totalFrameMs > 0 ? (frameSamples.length * 1000) / totalFrameMs : 0;

  return {
    fps: Math.round(fps),
    p50Frame: percentile(frameSamples, 0.5),
    p95Frame: percentile(frameSamples, 0.95),
    updateP50: percentile(updateSamples, 0.5),
    updateP95: percentile(updateSamples, 0.95),
    renderP50: percentile(renderSamples, 0.5),
    renderP95: percentile(renderSamples, 0.95)
  };
}

export function resetPerfForTests(): void {
  frameSamples.length = 0;
  updateSamples.length = 0;
  renderSamples.length = 0;
  frameStartedAt = 0;
  updateStartedAt = 0;
  renderStartedAt = 0;
}
