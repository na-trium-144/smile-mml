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

  constructor(tempoEvents: { tick: number; bpm: number }[], ticksPerWholeNote: number = 192) {
    this.ticksPerQuarter = ticksPerWholeNote / 4;

    const sorted = [...tempoEvents].sort((a, b) => a.tick - b.tick);

    // Initial default tempo if not starting at tick 0
    if (sorted.length === 0 || sorted[0].tick > 0) {
      sorted.unshift({ tick: 0, bpm: 120 });
    }

    let accumulatedSeconds = 0;
    let prevTick = 0;
    let prevBpm = 120;

    for (const ev of sorted) {
      if (ev.tick > prevTick) {
        const deltaTicks = ev.tick - prevTick;
        const secondsPerTick = 60 / (prevBpm * this.ticksPerQuarter);
        accumulatedSeconds += deltaTicks * secondsPerTick;
      }
      this.points.push({
        tick: ev.tick,
        bpm: ev.bpm,
        seconds: accumulatedSeconds,
      });
      prevTick = ev.tick;
      prevBpm = ev.bpm;
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
