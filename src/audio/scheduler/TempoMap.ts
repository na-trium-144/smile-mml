/**
 * Tempo Map
 * Accurately maps between chronological MML ticks and physical playback seconds.
 */

export interface TempoPoint {
  tick: number;
  bpm: number;
  seconds: number; // accumulated time at this point
}

export class TempoMap {
  private points: TempoPoint[] = [];
  public readonly ticksPerQuarter: number;

  constructor(tempoEvents: { tick: number; bpm: number }[] = [], ticksPerWholeNote: number = 192) {
    this.ticksPerQuarter = ticksPerWholeNote / 4;

    this.points.push({ tick: 0, bpm: 120, seconds: 0 });

    const sorted = [...tempoEvents].sort((a, b) => a.tick - b.tick);
    for (const ev of sorted) {
      this.addTempo(ev.tick, ev.bpm);
    }
  }

  /**
   * Dynamically add a tempo point to the map.
   */
  public addTempo(tick: number, bpm: number): void {
    if (this.points.length === 0) {
      this.points.push({ tick: 0, bpm: 120, seconds: 0 });
    }
    const last = this.points[this.points.length - 1];
    if (tick === last.tick) {
      last.bpm = bpm;
      return;
    }
    if (tick > last.tick) {
      const deltaTicks = tick - last.tick;
      const secondsPerTick = 60 / (last.bpm * this.ticksPerQuarter);
      const accumulatedSeconds = last.seconds + deltaTicks * secondsPerTick;
      this.points.push({
        tick,
        bpm,
        seconds: accumulatedSeconds,
      });
      return;
    }

    // If tick < last.tick (rare out-of-order event), insert in order and recalculate
    const insertIdx = this.points.findIndex((p) => p.tick >= tick);
    if (insertIdx !== -1 && this.points[insertIdx].tick === tick) {
      this.points[insertIdx].bpm = bpm;
    } else {
      const idx = insertIdx === -1 ? this.points.length : insertIdx;
      this.points.splice(idx, 0, { tick, bpm, seconds: 0 });
    }
    this.recalculateSeconds();
  }

  private recalculateSeconds(): void {
    let accumulatedSeconds = 0;
    let prevTick = 0;
    let prevBpm = 120;
    for (const point of this.points) {
      if (point.tick > prevTick) {
        const deltaTicks = point.tick - prevTick;
        const secondsPerTick = 60 / (prevBpm * this.ticksPerQuarter);
        accumulatedSeconds += deltaTicks * secondsPerTick;
      }
      point.seconds = accumulatedSeconds;
      prevTick = point.tick;
      prevBpm = point.bpm;
    }
  }

  /**
   * Convert an absolute tick to physical seconds from start
   */
  public tickToSeconds(tick: number): number {
    if (this.points.length === 0) return 0;

    // Find the active tempo point at or before the given tick
    let activePoint = this.points[0];
    for (let i = 1; i < this.points.length; i++) {
      if (this.points[i].tick <= tick) {
        activePoint = this.points[i];
      } else {
        break;
      }
    }

    const deltaTicks = tick - activePoint.tick;
    const secondsPerTick = 60 / (activePoint.bpm * this.ticksPerQuarter);
    return activePoint.seconds + deltaTicks * secondsPerTick;
  }

  /**
   * Calculate duration in seconds for a tick range
   */
  public durationTicksToSeconds(startTick: number, durationTicks: number): number {
    const startSec = this.tickToSeconds(startTick);
    const endSec = this.tickToSeconds(startTick + durationTicks);
    return Math.max(0.001, endSec - startSec);
  }

  /**
   * Convert physical playback seconds back to tick
   */
  public secondsToTick(seconds: number): number {
    if (this.points.length === 0) return 0;

    let activePoint = this.points[0];
    for (let i = 1; i < this.points.length; i++) {
      if (this.points[i].seconds <= seconds) {
        activePoint = this.points[i];
      } else {
        break;
      }
    }

    const deltaSeconds = Math.max(0, seconds - activePoint.seconds);
    const secondsPerTick = 60 / (activePoint.bpm * this.ticksPerQuarter);
    return Math.round(activePoint.tick + deltaSeconds / secondsPerTick);
  }
}
