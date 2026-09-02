#!/usr/bin/env node
/**
 * Pipeline Disposal Example
 *
 * Demonstrates dispose() — releasing a pipeline's native memory eagerly instead
 * of waiting for garbage collection to finalize the wrapper.
 *
 * The native GstPipeline allocation is invisible to V8's heap accounting, so a
 * pipeline you simply drop is not reclaimed until GC happens to collect the small
 * JS wrapper. A process that builds a pipeline per unit of work (recording,
 * transcode, feed) can see RSS climb steadily while the JS heap stays flat.
 * dispose() closes that gap: it drives the pipeline to NULL and drops the native
 * reference synchronously.
 *
 * This example builds, plays, stops, and disposes many short-lived pipelines in a
 * loop — the exact pattern where relying on GC timing leaks native memory. Run
 * with `node --expose-gc examples/dispose.mjs` to also see RSS reported.
 */
import { Pipeline } from "../dist/esm/index.mjs";

const ITERATIONS = 25;

function rssMb() {
  return (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
}

console.log(`📊 RSS before: ${rssMb()} MB`);

for (let i = 1; i <= ITERATIONS; i++) {
  const pipeline = new Pipeline("videotestsrc ! fakesink");

  await pipeline.play();
  await pipeline.stop();

  // Release the native pipeline now. Without this, each iteration's native
  // allocation would linger until GC decided to collect the wrapper.
  pipeline.dispose();

  // dispose() is idempotent and terminal: a second call is a no-op, and any
  // other method call after dispose() throws "Pipeline used after dispose()".
  pipeline.dispose();
  try {
    pipeline.playing();
  } catch (err) {
    if (i === 1) console.log(`🔒 use-after-dispose is guarded: ${err.message}`);
  }

  if (i % 5 === 0) console.log(`♻️  disposed ${i}/${ITERATIONS} — RSS: ${rssMb()} MB`);
}

if (typeof globalThis.gc === "function") {
  globalThis.gc();
}

console.log(`📊 RSS after: ${rssMb()} MB`);
console.log("✅ Done — native pipelines were released as each one finished.");
