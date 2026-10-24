import { useEffect, useRef, useState } from "react";
import mascot from "../assets/speechpillmascot.png";
import { holdAudioAwake, playDictationSound, soundContext, startThinkingLoop, stopThinkingLoop } from "../sounds";
import { useAuthStore } from "../stores/authStore";
import { clearAgentSilence, useAgentPlayback } from "../voice-layer/agentPlayback";
import { useRecorder } from "../voice-layer/useRecorder";
import { useVoicePlayer } from "../voice-layer/useVoicePlayer";

const BAR_COUNT = 7;
// Bar heights in px. Quiet bars sit as short stubs, so the pill doesn't look empty before anyone speaks.
const BAR_MIN = 4;
const BAR_MAX = 22;
// Middle bars reach a little higher than the edges.
const BAR_WEIGHT = [0.35, 0.45, 0.6, 0.85, 1, 0.85, 0.6];
// How much of each bar's height follows its own slice of the voice, versus the overall level.
// High, so bars rise and fall apart from each other instead of moving as one block.
const BAND_MIX = 0.9;
// Volume only sets how tall the bars can get: quiet speech still reaches this share of full height,
// and loud speech the rest. It never pushes bars past the top, so loud speech keeps its shape.
const QUIET_REACH = 0.35;
// Voice range the bands cover, in Hz, split evenly on a log scale.
const BAND_LOW_HZ = 120;
const BAND_HIGH_HZ = 4000;
// Which band each bar shows, left to right. Low bands (most of a voice) sit in the middle, and
// neighbouring bars never show neighbouring bands, so they don't track each other.
const BAND_ORDER = [6, 4, 2, 0, 1, 3, 5];
// A band's height comes from how far it is above its own recent average, in dB, compared with the
// other bands this frame: this far below the others sits at the bottom, and SHAPE_RANGE_DB above
// that is full height. Comparing each band to itself keeps low bands (always loudest) from
// dominating; comparing with the others means getting louder overall doesn't lift every bar at once.
const SHAPE_BELOW_DB = 6;
const SHAPE_RANGE_DB = 9;
// How quickly a band's average follows the voice, in seconds.
const BAND_AVERAGE_S = 0.8;
// Loudness window, in dBFS. Below the floor is silence; at the ceiling bars are full height.
const DB_FLOOR = -56;
const DB_CEIL = -16;
// Spring stiffness (rad/s) for the bars: rising fast enough to feel instant, falling a little softer.
// Critically damped, so bars glide to each new height without wobbling past it.
const RISE = 34;
const FALL = 16;

// 0..1 from dBFS, eased at both ends so bars don't flicker around the noise floor.
const loudnessFromDb = (db: number) => {
  const x = Math.min(1, Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
  return x * x * (3 - 2 * x);
};

const PILL_WIDTH = 104;
const PILL_HEIGHT = 48;

// Listening and speaking stay the narrow capsule. "Working..." is wider, and the pill eases between them.
const REST_WIDTH = PILL_WIDTH;
const WORK_WIDTH = 150;

// Bars follow the mic's loudness (RMS of the waveform), with most of each bar's height from its own
// frequency band, so the shape changes with every syllable. Every bar moves on a critically damped
// spring, and bars scale with transforms rather than height, so motion is sub-pixel smooth.
// Time is in seconds per frame, so 120Hz displays don't race ahead of 60Hz ones.
function SpeechBars({
  live,
  source = "mic",
}: {
  live: boolean;
  // mic: the user's hold. An analyser: Browsie's own voice. synth: the system voice, which can't be measured.
  source?: AnalyserNode | "mic" | "synth";
}) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!live) {
      barsRef.current.forEach((el) => {
        if (el) {
          el.style.transform = `scaleY(${BAR_MIN / BAR_MAX})`;
        }
      });
      return undefined;
    }

    const external = source instanceof AnalyserNode ? source : null;
    const synthetic = source === "synth";
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let micSource: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let samples: Float32Array<ArrayBuffer> | null = null;
    let freq: Float32Array<ArrayBuffer> | null = null;
    // Bin range per bar, filled once the mic's sample rate is known.
    let bands: Array<[number, number]> = [];
    const pos = new Float32Array(BAR_COUNT);
    const vel = new Float32Array(BAR_COUNT);
    const goals = new Float32Array(BAR_COUNT);
    const bandAverage = new Float32Array(BAR_COUNT).fill(NaN);
    const shapes = new Float32Array(BAR_COUNT);
    const rise = new Float32Array(BAR_COUNT);
    let last = performance.now();

    const measure = (dt: number) => {
      goals.fill(0);

      if (synthetic) {
        const t = performance.now() / 1000;

        for (let i = 0; i < BAR_COUNT; i++) {
          const wave = 0.5 + 0.5 * Math.sin(t * (5.5 + i * 0.7) + i * 1.3);
          goals[i] = 0.22 + 0.72 * wave * wave;
        }

        return;
      }

      if (!analyser || !samples || !freq) {
        return;
      }

      analyser.getFloatTimeDomainData(samples);
      let sum = 0;

      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }

      const level = loudnessFromDb(
        20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-8),
      );

      if (level === 0) {
        return;
      }

      analyser.getFloatFrequencyData(freq);
      const follow = 1 - Math.exp(-dt / BAND_AVERAGE_S);
      let mean = 0;

      for (let i = 0; i < BAR_COUNT; i++) {
        const [start, end] = bands[BAND_ORDER[i]];
        let total = 0;

        for (let bin = start; bin < end; bin++) {
          total += Math.pow(10, freq[bin] / 10);
        }

        const db = 10 * Math.log10(total / (end - start) + 1e-12);
        bandAverage[i] = Number.isNaN(bandAverage[i])
          ? db
          : bandAverage[i] + (db - bandAverage[i]) * follow;
        rise[i] = db - bandAverage[i];
        mean += rise[i] / BAR_COUNT;
      }

      let peak = 0;
      let low = 1;

      for (let i = 0; i < BAR_COUNT; i++) {
        const x = Math.min(
          1,
          Math.max(0, (rise[i] - mean + SHAPE_BELOW_DB) / SHAPE_RANGE_DB),
        );
        // Squared, so mid values drop away and the peaks stand out.
        shapes[i] = x * x;
        peak = Math.max(peak, shapes[i]);
        low = Math.min(low, shapes[i]);
      }

      // Stretch the spread between bands so the strongest reaches the top and the weakest drops
      // toward the bottom. The floor on the divisor keeps near-equal bands from all jumping to full.
      const floor = low * 0.6;
      const spread = Math.max(peak - floor, 0.25);

      for (let i = 0; i < BAR_COUNT; i++) {
        const shape = Math.min(1, (shapes[i] - floor) / spread);
        const reach = QUIET_REACH + (1 - QUIET_REACH) * level;
        goals[i] =
          reach * ((1 - BAND_MIX) * BAR_WEIGHT[i] + BAND_MIX * Math.max(0, shape));
      }
    };

    // Runs from the first frame, mic or not, so bars are drawn while the mic is opening.
    const tick = (now: number) => {
      if (stopped) {
        return;
      }

      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      measure(dt);

      for (let i = 0; i < BAR_COUNT; i++) {
        const omega = goals[i] > pos[i] ? RISE : FALL;
        vel[i] +=
          (omega * omega * (goals[i] - pos[i]) - 2 * omega * vel[i]) * dt;
        pos[i] = Math.min(1, Math.max(0, pos[i] + vel[i] * dt));
        const el = barsRef.current[i];

        if (el) {
          el.style.transform = `scaleY(${(BAR_MIN + pos[i] * (BAR_MAX - BAR_MIN)) / BAR_MAX})`;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    const stopMic = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      analyser = null;
      micSource?.disconnect();
      micSource = null;
    };

    const openMic = async () => {
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (stopped) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = next;
        // The same context the cues play through. A second context would open (and on release close)
        // its own output stream right as the start cue plays, which garbled it.
        const audio = soundContext;
        const node = audio.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.5;
        micSource = audio.createMediaStreamSource(stream);
        micSource.connect(node);
        samples = new Float32Array(node.fftSize);
        freq = new Float32Array(node.frequencyBinCount);

        const hzPerBin = audio.sampleRate / node.fftSize;
        const ratio = Math.pow(BAND_HIGH_HZ / BAND_LOW_HZ, 1 / BAR_COUNT);
        bands = Array.from({ length: BAR_COUNT }, (_, i) => {
          const start = Math.max(
            1,
            Math.floor((BAND_LOW_HZ * Math.pow(ratio, i)) / hzPerBin),
          );
          const end = Math.max(
            start + 1,
            Math.floor((BAND_LOW_HZ * Math.pow(ratio, i + 1)) / hzPerBin),
          );
          return [start, Math.min(end, node.frequencyBinCount)];
        });

        analyser = node;
      } catch {
        // Mic refused or missing: the pill still shows, bars stay at rest.
        stopMic();
      }
    };

    const arm = (node: AnalyserNode) => {
      samples = new Float32Array(node.fftSize);
      freq = new Float32Array(node.frequencyBinCount);
      const hzPerBin = node.context.sampleRate / node.fftSize;
      const ratio = Math.pow(BAND_HIGH_HZ / BAND_LOW_HZ, 1 / BAR_COUNT);
      bands = Array.from({ length: BAR_COUNT }, (_, i) => {
        const start = Math.max(1, Math.floor((BAND_LOW_HZ * Math.pow(ratio, i)) / hzPerBin));
        const end = Math.max(start + 1, Math.floor((BAND_LOW_HZ * Math.pow(ratio, i + 1)) / hzPerBin));
        return [start, Math.min(end, node.frequencyBinCount)] as [number, number];
      });
      analyser = node;
    };

    if (external) {
      arm(external);
    }

    raf = requestAnimationFrame(tick);
    if (!external && !synthetic) {
      void openMic();
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopMic();
    };
  }, [live, source]);

  return (
    <div
      // Fills everything right of the avatar, so the bars sit centered in that space. The extra 1px
      // on the right keeps the bars on whole pixels (an odd-width group in an even-width space would
      // land on half pixels and blur).
      className="flex h-6 flex-1 items-center justify-center gap-[2px] pr-px"
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          ref={(el) => {
            barsRef.current[index] = el;
          }}
          className="block w-[3px] origin-center bg-white will-change-transform"
          style={{ height: BAR_MAX, transform: `scaleY(${BAR_MIN / BAR_MAX})` }}
        />
      ))}
    </div>
  );
}

function Profile({ pictureDataUrl }: { pictureDataUrl?: string }) {
  if (pictureDataUrl) {
    return (
      <img
        src={pictureDataUrl}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-end justify-center overflow-hidden rounded-full bg-[#d4d4d4]">
      <i
        className="bi bi-person-fill -mb-1 text-xl leading-none text-[#ffffff]"
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * The pill over the page. Space held: it slides up and the bars follow the mic. After release it
 * stays while a request is running — "Working..." until Browsie speaks, then the same bars drawn
 * from Browsie's voice — and slides away once that is finished.
 */
function SpeechPill() {
  const pictureDataUrl = useAuthStore((state) => state.pictureDataUrl);
  const deviceVolumeDbRef = useRef(-10);
  const [thinkingFlash, setThinkingFlash] = useState(0);
  const [live, setLive] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Release should not drop the pill in the gap before main says the request is underway.
  const [sticky, setSticky] = useState(false);
  const playback = useAgentPlayback();
  const present = live || pinned || sticky;
  // Space cutting the agent off is the resting bars: no words, no sound.
  const face = live
    ? "listen"
    : playback.speaking
      ? "speak"
      : playback.silenced
        ? "quiet"
        : pinned || sticky
          ? "work"
          : "quiet";
  // This view also records what's said while Space is held, and plays Browsie's voice.
  useRecorder(live);
  useVoicePlayer();

  useEffect(() => {
    let current = true;
    let heard = false;
    let raf = 0;
    const browsie = window.browsie;

    // Main shows this view and says "held" in the same moment. A view hidden since startup hasn't
    // drawn a frame yet, so a slide started right away has no starting point and the pill would just
    // appear. Waiting two frames lets the off-screen pill paint first, so the slide always plays.
    const follow = (held: boolean) => {
      cancelAnimationFrame(raf);

      if (!held) {
        setLive(false);
        return;
      }

      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (current) {
            setLive(true);
          }
        });
      });
    };

    // Sounds play right on the press and release, not after the frames the slide waits for.
    // Only for these events: the pill opening while space is already held (below) stays quiet.
    const stop = browsie?.onSpeechHeld((held, deviceVolumeDb) => {
      heard = true;
      deviceVolumeDbRef.current = deviceVolumeDb;

      if (!current) {
        return;
      }

      playDictationSound(held ? "start" : "end", deviceVolumeDb);
      holdAudioAwake(held);
      if (!held) {
        setSticky(true);
      }
      follow(held);
    });
    const stopPill = browsie?.voice.onPill((visible) => {
      if (!current) {
        return;
      }

      setPinned(visible);
      if (visible) {
        clearAgentSilence();
      } else {
        setSticky(false);
      }
    });

    void browsie?.isSpeechHeld().then((held) => {
      if (current && !heard) {
        follow(held);
      }
    });

    return () => {
      current = false;
      cancelAnimationFrame(raf);
      stop?.();
      stopPill?.();
    };
  }, []);

  const working = face === "work";

  useEffect(() => {
    if (!working) {
      stopThinkingLoop();
      return;
    }

    startThinkingLoop(deviceVolumeDbRef.current, () => setThinkingFlash((flash) => flash + 1));
    return stopThinkingLoop;
  }, [working]);
  const bars =
    face === "listen" ? "mic" : face === "speak" ? playback.analyser ?? "synth" : "mic";

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute top-2 left-1/2 will-change-transform"
        style={{
          transform: `translateX(-50%) translateY(${present ? "0" : "100vh"})`,
          transition: present
            ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "transform 200ms cubic-bezier(0.55, 0, 1, 0.45)",
        }}
      >
        <div
          role="status"
          aria-label={working ? "Working" : face === "listen" ? "Listening" : face === "speak" ? "Speaking" : "Stopped"}
          className="flex items-center overflow-hidden rounded-full bg-[#111111] pl-1.5 shadow-[inset_0_0_0_1px_#4a4a4a]"
          style={{
            width: working ? WORK_WIDTH : REST_WIDTH,
            height: PILL_HEIGHT,
            transition: "width 320ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {face === "listen" ? (
            <Profile pictureDataUrl={pictureDataUrl} />
          ) : (
            <img
              src={mascot}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full bg-[#ffffff] object-contain p-[3px]"
            />
          )}
          {working ? (
            <span key={thinkingFlash} className="working-shimmer flex-1 pr-3 text-center text-[15px] font-medium tracking-tight">
              Working...
            </span>
          ) : (
            <SpeechBars live={present && face !== "quiet"} source={bars} />
          )}
        </div>
      </div>
    </div>
  );
}

export default SpeechPill;
