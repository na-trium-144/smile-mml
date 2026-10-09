/**
 * Noise sample generation utilities
 * Generates LFSR (Nintendo DS pseudo-random hardware noise) and standard white noise buffers
 */

/**
 * Generate Nintendo DS authentic 15-bit LFSR noise PCM
 * The DS hardware PSG noise generator uses a 15-bit linear-feedback shift register.
 *
 * @param sampleRate Sampling rate (e.g. 44100 or 48000)
 * @param durationSeconds Buffer duration (default 1.0 second loopable)
 */
export function generateLFSRNoise(
  sampleRate: number = 44100,
  durationSeconds: number = 1.0
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const pcm = new Float32Array(numSamples);

  // 15-bit LFSR polynomial (x^15 + x^14 + 1)
  let lfsr = 0x7fff;

  for (let i = 0; i < numSamples; i++) {
    // Tap bits 0 and 1
    const bit = (lfsr ^ (lfsr >> 1)) & 1;
    lfsr = (lfsr >> 1) | (bit << 14);

    // Convert bit 0 to normalized amplitude (-1.0 or +1.0)
    pcm[i] = (lfsr & 1) ? 0.8 : -0.8;
  }

  return pcm;
}

/**
 * Generate standard White Noise PCM
 */
export function generateWhiteNoise(
  sampleRate: number = 44100,
  durationSeconds: number = 1.0
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const pcm = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    pcm[i] = Math.random() * 2 - 1;
  }

  return pcm;
}
