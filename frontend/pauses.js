/* pauses.js: app.pauses, browser-side pause detection with Web Audio (T08, human-owned).
   start(stream) samples the microphone's loudness every 50 ms while a take records and
   stop() hands the samples back; findSilences turns them into quiet stretches and
   reconcile folds those into the transcript pauses the backend found. rms and percentile
   are the two sums everything else is built from. Nothing here touches the DOM. */
(function () {
  "use strict";

  const PERCENT = 100;

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

  app.pauses = { rms, percentile };
})();
