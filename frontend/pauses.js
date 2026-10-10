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

  // The live sampler: a 2048-point analyser read every 50 ms, twenty loudness values a second.
  const FFT_SIZE = 2048;
  const SAMPLE_EVERY_MS = 50;

  // Everything one take's sampler holds, from start() until stop() lets it go.
  const live = {
    context: null,
    source: null,
    analyser: null,
    frame: null,
    timerId: null,
    startedAt: 0,
    samples: [],
  };

  // Begins sampling the stream's loudness every 50 ms into {t, rms} pairs, t in seconds since
  // this call. Nothing is decided live: the samples wait for reconcile() once the backend
  // has answered. A browser without Web Audio, or one that refuses to open a context, leaves
  // stop() with nothing to return and the take otherwise unaffected.
  function start(stream) {
    stop();
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    try {
      live.context = new AudioContextClass();
      live.source = live.context.createMediaStreamSource(stream);
      live.analyser = live.context.createAnalyser();
      live.analyser.fftSize = FFT_SIZE;
      live.source.connect(live.analyser);
    } catch {
      release();
      return;
    }
    live.frame = new Float32Array(FFT_SIZE);
    live.samples = [];
    live.startedAt = performance.now();
    live.timerId = setInterval(takeSample, SAMPLE_EVERY_MS);
    // iOS Safari may hand over a suspended context, and a suspended graph reads as all zeros.
    if (live.context.state === "suspended" && typeof live.context.resume === "function") {
      ignoreRejection(live.context.resume());
    }
  }

  function takeSample() {
    live.analyser.getFloatTimeDomainData(live.frame);
    live.samples.push({
      t: (performance.now() - live.startedAt) / MILLISECONDS,
      rms: rms(live.frame),
    });
  }

  // Ends sampling, lets the audio graph go and returns the samples taken; [] when nothing
  // was started. Safe to call twice: the second call finds nothing to release and returns [].
  function stop() {
    const samples = live.samples;
    release();
    return samples;
  }

  function release() {
    if (live.timerId !== null) {
      clearInterval(live.timerId);
      live.timerId = null;
    }
    if (live.source) {
      live.source.disconnect();
    }
    if (live.context && live.context.state !== "closed") {
      ignoreRejection(live.context.close());
    }
    live.context = null;
    live.source = null;
    live.analyser = null;
    live.frame = null;
    live.samples = [];
  }

  // resume() and close() answer with promises whose outcome changes nothing here.
  function ignoreRejection(promise) {
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {});
    }
  }

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

  // Folds the energy silences of a take into the backend's transcript pauses and returns a
  // new metrics object with the merged list; neither input is changed. A transcript pause
  // ([at, length], at being the end of the word before the gap) always stays, and grows to
  // the length of any silence overlapping it when that is longer. A silence no transcript
  // pause overlaps is added as [start, length] when it falls inside the speech span: its
  // start is when the word before it went quiet, which is what `at` means to Results.
  function reconcile(metrics, samples) {
    const given = metrics && typeof metrics === "object" ? metrics : {};
    const transcriptPauses = wellFormedPauses(given.pauses);
    const silences = findSilences(samples);
    const span = speechSpan(samples, given.duration);

    const merged = transcriptPauses.map(([at, length]) => {
      const longest = silences
        .filter((silence) => overlaps([at, length], silence))
        .reduce((best, silence) => Math.max(best, silence[1]), length);
      return [at, longest];
    });
    silences.forEach((silence) => {
      const confirmsTranscript = transcriptPauses.some((pause) => overlaps(pause, silence));
      if (!confirmsTranscript && insideSpan(silence, span)) {
        merged.push([silence[0], silence[1]]);
      }
    });
    return { ...given, pauses: sortAndDedupe(merged) };
  }

  // Only [number, number] pairs are pauses; anything else in the list is dropped.
  function wellFormedPauses(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter((pause) => Array.isArray(pause) && isFinite(pause[0]) && isFinite(pause[1]))
      .map((pause) => [pause[0], pause[1]]);
  }

  function isFinite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  // Where the words sit in sample time, without the transcript: speech begins at the first
  // loud sample, and the backend's duration runs from the first word's start to the last
  // word's end, so it ends `duration` seconds later. null (no span check) when duration is
  // unknown or the take is too short to have a threshold.
  function speechSpan(samples, duration) {
    if (!isFinite(duration) || duration < 0) {
      return null;
    }
    if (!Array.isArray(samples) || samples.length < MIN_SAMPLES) {
      return null;
    }
    const threshold = quietThreshold(samples);
    const firstLoud = samples.find((sample) => sample.rms >= threshold);
    return firstLoud ? { start: firstLoud.t, end: firstLoud.t + duration } : null;
  }

  function insideSpan([start, length], span) {
    return span === null || (start >= span.start && start + length <= span.end);
  }

  // Two [start, length] stretches share some time.
  function overlaps([startA, lengthA], [startB, lengthB]) {
    return startA < startB + lengthB && startB < startA + lengthA;
  }

  // In time order; of two entries at the same moment only the longer is kept.
  function sortAndDedupe(pairs) {
    const sorted = [...pairs].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    return sorted.filter((pair, index) => index === 0 || pair[0] !== sorted[index - 1][0]);
  }

  app.pauses = { start, stop, reconcile, findSilences, rms, percentile };
})();
