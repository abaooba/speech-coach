/* pauses.js: app.pauses, browser-side pause detection with Web Audio (T08, human-owned).
   start(stream) samples the microphone's loudness every 50 ms while a take records and
   stop() hands the samples back; findSilences turns them into quiet stretches and
   reconcile folds those into the transcript pauses the backend found. rms and percentile
   are the two sums everything else is built from. Nothing here touches the DOM. */
(function () {
  "use strict";

  const PERCENT = 100;
  const MILLISECONDS = 1000;

  // findSilences: how many samples a take needs before its loudness says anything, where
  // the room's noise floor and the speaker's level sit in the sorted loudness values, how far
  // above the floor "quiet" ends, and the shortest quiet run worth reporting (DESIGN.md calls
  // the metric "Pauses over 1.5 s", the same bar the backend uses for transcript gaps).
  const MIN_SAMPLES = 10;
  const NOISE_FLOOR_PERCENTILE = 10;
  const SPEECH_LEVEL_PERCENTILE = 90;
  const QUIET_FRACTION_OF_RANGE = 0.15;
  const DEFAULT_MIN_SILENCE_SECONDS = 1.5;

  // Root mean square of one analyser frame: the frame's loudness as a single number
  // between 0 (silence) and 1 (full scale). An empty frame is silent.
  function rms(buffer) {
    if (buffer.length === 0) {
      return 0;
    }
    let sumOfSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      sumOfSquares += buffer[i] * buffer[i];
    }
    return Math.sqrt(sumOfSquares / buffer.length);
  }

  // The value `percent` of the way through an ascending list, interpolating between the
  // two nearest entries: percentile([1, 2, 3, 4, 5], 10) is 1.4. An empty list gives 0.
  function percentile(sortedValues, percent) {
    if (sortedValues.length === 0) {
      return 0;
    }
    const rank = (percent / PERCENT) * (sortedValues.length - 1);
    const below = Math.floor(rank);
    const above = Math.ceil(rank);
    const fraction = rank - below;
    return sortedValues[below] + (sortedValues[above] - sortedValues[below]) * fraction;
  }

  // Rounds to the millisecond, the precision the backend keeps for word times and gaps.
  function toMilliseconds(seconds) {
    return Math.round(seconds * MILLISECONDS) / MILLISECONDS;
  }

  // The quiet stretches of a take as [startSeconds, lengthSeconds] pairs in time order, from
  // {t, rms} samples. The bar adapts to the take: the 10th percentile of loudness stands for
  // the room's noise floor, the 90th for the speaker's level, and anything under 15% of the
  // way from the one to the other is quiet. A quiet run starts at its first quiet sample and
  // ends at the next loud one, or at the last sample when the take ends quiet. Fewer than 10
  // samples, or a flat signal (every sample equal, as a silent analyser gives), means none.
  function findSilences(samples, minSeconds = DEFAULT_MIN_SILENCE_SECONDS) {
    if (!Array.isArray(samples) || samples.length < MIN_SAMPLES) {
      return [];
    }
    const threshold = quietThreshold(samples);
    const silences = [];
    let i = 0;
    while (i < samples.length) {
      if (samples[i].rms >= threshold) {
        i += 1;
        continue;
      }
      const runStart = i;
      while (i < samples.length && samples[i].rms < threshold) {
        i += 1;
      }
      const runEndsAt = i < samples.length ? samples[i].t : samples[i - 1].t;
      const length = toMilliseconds(runEndsAt - samples[runStart].t);
      if (length >= minSeconds) {
        silences.push([toMilliseconds(samples[runStart].t), length]);
      }
    }
    return silences;
  }

  function quietThreshold(samples) {
    const sorted = samples.map((sample) => sample.rms).sort((a, b) => a - b);
    const noiseFloor = percentile(sorted, NOISE_FLOOR_PERCENTILE);
    const speechLevel = percentile(sorted, SPEECH_LEVEL_PERCENTILE);
    return noiseFloor + QUIET_FRACTION_OF_RANGE * (speechLevel - noiseFloor);
  }

  app.pauses = { findSilences, rms, percentile };
})();
