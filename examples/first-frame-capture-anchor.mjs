#!/usr/bin/env node
/**
 * First-Frame Capture-Anchor Example
 *
 * Stamps the first buffer with a label advanced from the seed to the frame's
 * true capture instant. The seed is the reference-clock value at `anchoredAtNs`
 * (a CLOCK_MONOTONIC instant); the probe advances it by the frames elapsed
 * between that anchor and the first buffer, so burn-in / tmcd describe the
 * captured frame rather than the request-time value.
 */
import { Pipeline } from "../dist/esm/index.mjs";

const FPS = 60;
const pipeline = new Pipeline(
  "videotestsrc is-live=true num-buffers=8 ! " +
    `video/x-raw,format=I420,width=320,height=240,framerate=${FPS}/1 ! ` +
    "timecodestamper name=tc_stamper source=internal ! fakesink name=sink",
);
const stamper = pipeline.getElementByName("tc_stamper");
if (!stamper) throw new Error("stamper not found");

// Seed value corresponds to this monotonic instant; 1s in the past here.
const anchoredAtNs = Number(process.hrtime.bigint()) - 1_000_000_000;

const firstFrame = stamper.setFirstFrameTimecode({
  timecode: { hours: 10, minutes: 0, seconds: 0, frames: 0 },
  captureAnchor: { anchoredAtNs },
});

await pipeline.play(5000);

const result = await firstFrame;
console.log("Applied label:", result?.timecode);
console.log("Advanced frames:", result?.advancedFrames, `(~1s ≈ ${FPS} frames)`);

await pipeline.stop();
pipeline.dispose();
