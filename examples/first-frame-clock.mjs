#!/usr/bin/env node
/**
 * First-Frame Clock Sample Example
 *
 * Samples the clock bridge at the first buffer to cross a sink pad, then maps the
 * frame's capture instant onto the CLOCK_MONOTONIC domain via the epoch bridge.
 */
import { Pipeline } from "../dist/esm/index.mjs";

const pipeline = new Pipeline(
  "videotestsrc num-buffers=30 is-live=true ! fakesink name=sink",
);
const sink = pipeline.getElementByName("sink");
if (!sink) throw new Error("sink not found");

// Arm before play so the probe is in place for the first buffer.
const firstFrame = sink.sampleFirstFrameClock();

await pipeline.play(5000);

const sample = await firstFrame;
if (!sample) {
  console.log("No frame arrived before EOS/flush (null sample).");
} else {
  console.log("First-frame clock sample:", sample);
  if (sample.gstClockNs !== undefined && sample.monotonicNs !== undefined) {
    const epochOffsetNs = sample.monotonicNs - sample.gstClockNs;
    console.log("GstClock → monotonic epoch offset (ns):", epochOffsetNs);
  }
  if (sample.runningTimeNs !== undefined && sample.baseTimeNs !== undefined) {
    console.log(
      "Capture instant on the GstClock (runningTimeNs + baseTimeNs):",
      sample.runningTimeNs + sample.baseTimeNs,
    );
  }
}

await pipeline.stop();
pipeline.dispose();
