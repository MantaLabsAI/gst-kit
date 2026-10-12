import { Pipeline } from "./";
import type { BufferData } from "./";
import { arePluginsAvailable } from "./test-utils";

// attachAudioDropUntilVideo installs two coordinated buffer probes:
// one on the VIDEO element's src pad that records the first video buffer's
// running-time, and one at the FRONT of the AUDIO branch that DROPs leading
// audio buffers whose running-time is below that video origin (or while it is
// still unknown), then latches open. This forces qtmux to select the VIDEO pad
// as the media origin so the QuickTime tmcd track is written relative to video
// (the audio-first ordering is what collapses the tmcd to 00:00:00:00).
//
// The drop decision runs synchronously on the streaming thread in native code,
// so it cannot be exercised from JS. The deterministic, race-free property these
// tests assert is the DROP-WHILE-VIDEO-UNSEEN path: with the video branch
// blocked (no video buffer ever establishes the origin), EVERY audio buffer must
// be dropped, so nothing reaches a downstream audio probe. Without the gate the
// same audio flows freely. The end-to-end tmcd flip is proven in the standalone
// prototype (15/15) and is authoritative on hardware; see the task root-cause.md.
const canRun = arePluginsAvailable([
  "audiotestsrc",
  "videotestsrc",
  "identity",
  "queue",
  "fakesink",
]);

/**
 * Build an audio branch (audiotestsrc → queue → identity tap → fakesink) and a
 * video branch (videotestsrc → identity monitor → fakesink). The video branch's
 * src pad is held with a BLOCK probe so NO video buffer ever reaches the gate's
 * video probe — the gate's "first video running-time" stays unknown for the whole
 * run. Returns how many audio buffers survived to the downstream tap.
 */
async function countAudioSurvivors(opts: {
  gate: boolean;
  blockVideo: boolean;
  audioBuffers?: number;
}): Promise<number> {
  const audioBuffers = opts.audioBuffers ?? 10;
  const pipelineStr =
    "videotestsrc name=vsrc num-buffers=30 is-live=false " +
    "! video/x-raw,format=I420,width=160,height=90,framerate=30/1 " +
    "! identity name=record_input_monitor ! fakesink name=vsink sync=false " +
    `audiotestsrc name=asrc num-buffers=${audioBuffers} is-live=false samplesperbuffer=4410 ` +
    "! queue name=record_audio_input_queue " +
    "! identity name=audio_tap ! fakesink name=asink sync=false";

  const p = new Pipeline(pipelineStr);
  const videoMonitor = p.getElementByName("record_input_monitor");
  const audioQueue = p.getElementByName("record_audio_input_queue");
  const audioTap = p.getElementByName("audio_tap");
  if (!videoMonitor || !audioQueue || !audioTap) {
    throw new Error("named elements not found");
  }

  let audioSurvivors = 0;
  const removeAudioProbe = audioTap.addPadProbe("src", (_b: BufferData) => {
    audioSurvivors += 1;
  });

  // Hold the video branch so no video buffer ever reaches the gate's video probe:
  // the gate's video origin stays unknown and every audio buffer must be dropped.
  // A BLOCK probe on the monitor's src pad (removed only when blockVideo is false
  // — then video flows and establishes the origin as usual).
  let detach: (() => void) | null = null;
  if (opts.gate) {
    detach = audioQueue.attachAudioDropUntilVideo({ videoElement: videoMonitor });
  }

  // The video block uses setElementProperty on an identity drop property so the
  // monitor silently discards every video buffer, keeping the origin unknown
  // without a JS-side pad hold (which addPadProbe cannot express). `drop-probability`
  // 1.0 drops all buffers; 0.0 passes them.
  videoMonitor.setElementProperty("drop-probability", opts.blockVideo ? 1 : 0);

  await p.play(5000);
  // Fixed settle window: audio (10 buffers) completes quickly; a blocked video
  // branch never EOSes, so wait a bounded time rather than for EOS.
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const m = await p.busPop(300);
    if (m && (m.type === "error")) break;
  }
  detach?.();
  removeAudioProbe();
  await p.stop();
  p.dispose();
  return audioSurvivors;
}

describe.skipIf(!canRun)("attachAudioDropUntilVideo (drop-gate)", () => {
  it("drops ALL audio while the video origin is unknown (video blocked)", async () => {
    const survivors = await countAudioSurvivors({ gate: true, blockVideo: true });
    // No video buffer ever established the origin, so every audio buffer is below
    // the (unknown) video origin and must be dropped — none reach the tap.
    expect(survivors).toBe(0);
  });

  it("fails OPEN after a bounded leading drop when video never arrives (M1)", async () => {
    // Video stays blocked so the origin is NEVER established, but we push far more
    // audio buffers than the native AUDIO_DROP_GATE_MAX_LEADING_DROP bound (240).
    // Without the fail-open guard this would drop ALL of them (survivors = 0) and
    // starve the audio trak on a real take. With the guard the gate latches open
    // once the bound is exceeded, so the tail of the audio survives.
    const survivors = await countAudioSurvivors({
      gate: true,
      blockVideo: true,
      audioBuffers: 300,
    });
    expect(survivors).toBeGreaterThan(0);
  });

  it("passes audio when the gate is NOT installed (control)", async () => {
    const survivors = await countAudioSurvivors({ gate: false, blockVideo: true });
    // Same blocked-video construction, but no gate: the audio flows untouched,
    // proving the gate — not the pipeline shape — is what dropped the audio above.
    expect(survivors).toBeGreaterThan(0);
  });

  it("opens the gate and passes audio once video establishes the origin", async () => {
    // Video flows (not blocked): it establishes the origin, the gate latches open,
    // and audio reaches the tap. (Thread timing decides exactly how many leading
    // audio buffers drop first; the invariant asserted is simply that steady-state
    // audio is NOT starved once the origin is known.)
    const survivors = await countAudioSurvivors({ gate: true, blockVideo: false });
    expect(survivors).toBeGreaterThan(0);
  });

  it("rejects a missing videoElement option", () => {
    const p = new Pipeline(
      "audiotestsrc num-buffers=1 ! queue name=aq ! fakesink",
    );
    const aq = p.getElementByName("aq");
    if (!aq) throw new Error("aq not found");
    expect(() =>
      (aq.attachAudioDropUntilVideo as unknown as (o: object) => void)({}),
    ).toThrow();
    p.dispose();
  });
});
