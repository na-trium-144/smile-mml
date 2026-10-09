/**
 * Waveform generation utilities
 * Generates Fourier series coefficients for alias-free square waves with variable duty cycles
 */

/**
 * Predefined duty cycles for SmileBASIC PSG instruments (@144 - @150)
 * @144: 12.5% (1/8)
 * @145: 25.0% (2/8)
 * @146: 37.5% (3/8)
 * @147: 50.0% (4/8, standard square wave)
 * @148: 62.5% (5/8)
 * @149: 75.0% (6/8)
 * @150: 87.5% (7/8)
 */
export const PSG_DUTY_CYCLES = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] as const;

/**
 * Generate Fourier series (real and imaginary) arrays for PeriodicWave with a given duty cycle.
 * By using band-limited Fourier series, WebAudio's PeriodicWave avoids harsh digital aliasing.
 *
 * @param duty Duty cycle between 0.0 and 1.0 (e.g. 0.125, 0.5)
 * @param harmonics Number of harmonic overtones to include (default: 64)
 */
export function generateSquareWaveHarmonics(
  duty: number,
  harmonics: number = 64
): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);

  // real[0] and imag[0] represent DC offset and must be 0 in PeriodicWave
  for (let n = 1; n <= harmonics; n++) {
    const angle = 2 * Math.PI * n * duty;
    // Fourier coefficients for pulse wave transitioning between +1 and -1:
    // a_n (real / cosine) = (2 / (n * pi)) * sin(2 * pi * n * D)
    real[n] = (2 / (n * Math.PI)) * Math.sin(angle);
    // b_n (imag / sine) = (2 / (n * pi)) * (1 - cos(2 * pi * n * D))
    imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(angle));
  }

  return { real, imag };
}
