//#region src/ts/index.d.ts
export type GStreamerPropertyPrimitiveValue = string | number | boolean | bigint;
export type GStreamerPropertyValue = GStreamerPropertyPrimitiveValue | GStreamerPropertyPrimitiveValue[];
export type GStreamerSample = {
  buffer?: Buffer;
  pts?: number;
  dts?: number;
  duration?: number;
  offset?: number;
  offsetEnd?: number;
  flags?: number;
  caps?: {
    name?: string;
    [key: string]: GStreamerPropertyValue | undefined;
  };
};
export type GstMessage = {
  type: string;
  srcElementName?: string;
  timestamp: bigint;
  structureName?: string;
  [key: string]: GStreamerPropertyValue | undefined;
  errorMessage?: string;
  errorDomain?: string;
  errorCode?: number;
  debugInfo?: string;
  warningMessage?: string;
  warningDomain?: string;
  warningCode?: number;
  oldState?: number;
  newState?: number;
  pendingState?: number;
};
export type GStreamerPropertyReturnValue = GStreamerPropertyValue | Record<string, GStreamerPropertyValue> | Buffer | GStreamerSample | null;
export type GStreamerPropertyResult = {
  type: "primitive";
  value: GStreamerPropertyPrimitiveValue;
} | {
  type: "array";
  value: GStreamerPropertyPrimitiveValue[];
} | {
  type: "object";
  value: Record<string, GStreamerPropertyValue>;
} | {
  type: "buffer";
  value: Buffer;
} | {
  type: "sample";
  value: GStreamerSample;
} | null;
export type StateChangeResult = {
  result: "success" | "async" | "no-preroll" | "failure" | "unknown";
  finalState: number;
  targetState: number;
};
export type RTPData = {
  timestamp: number;
  sequence: number;
  ssrc: number;
  payloadType: number;
};
export type GstPad = {
  name: string;
  direction: number;
  caps: string | null;
};
export type BufferData = {
  buffer?: Buffer;
  pts?: number;
  dts?: number;
  duration?: number;
  offset?: number;
  offsetEnd?: number;
  flags: number;
  caps?: {
    name?: string;
    [key: string]: GStreamerPropertyValue | undefined;
  };
  rtp?: RTPData;
  timecodeMeta?: {
    hours: number;
    minutes: number;
    seconds: number;
    frames: number;
    dropFrame: boolean;
    rate: Rational;
  };
};
export type SampleFirstFrameClockOptions = {
  baseTimeElement?: ElementBase;
};
export type FirstFrameClockSample = {
  runningTimeNs?: number;
  baseTimeNs?: number;
  gstClockNs?: number;
  monotonicNs?: number;
  baseClockMatched?: boolean;
};
export type Rational = {
  numerator: number;
  denominator: number;
};
export type TimecodeValue = {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame?: boolean;
};
export type SetFirstFrameTimecodeOptions = {
  timecode: TimecodeValue;
  rate?: Rational;
  baseTimeElement?: ElementBase;
  captureAnchor?: {
    anchoredAtNs: number;
  };
};
export type FirstFrameTimecodeResult = {
  timecode: string;
  pts?: number;
  framerate: Rational;
  dropFrame: boolean;
  advancedFrames: number;
  clockBridge: FirstFrameClockSample;
};
export type AttachSubFrameOverlayOptions = {
  timecode: TimecodeValue;
  rate?: Rational;
  repeat: number;
};
export type AttachSourceRateTimecodeOptions = {
  timecode: TimecodeValue;
  rate?: Rational;
  repeat: number;
};
export type AttachCameraRateTimecodeOptions = {
  timecode: TimecodeValue;
  rate?: Rational;
};
export type ElementBase = {
  getElementProperty: (key: string) => GStreamerPropertyResult;
  setElementProperty: (key: string, value: GStreamerPropertyValue) => void;
  addPadProbe: (padName: string, callback: (bufferData: BufferData) => void) => () => void;
  sampleFirstFrameClock: (options?: SampleFirstFrameClockOptions) => Promise<FirstFrameClockSample | null>;
  setFirstFrameTimecode: (options: SetFirstFrameTimecodeOptions) => Promise<FirstFrameTimecodeResult | null>;
  attachSubFrameOverlay: (options: AttachSubFrameOverlayOptions) => () => void;
  attachSourceRateTimecode: (options: AttachSourceRateTimecodeOptions) => () => void;
  attachCameraRateTimecode: (options: AttachCameraRateTimecodeOptions) => () => void;
  setPad: (attribute: string, padName: string) => void;
  getPad: (padName: string) => GstPad | null;
};
type Element = {
  readonly type: "element";
} & ElementBase;
export type AppSinkElement = {
  readonly type: "app-sink-element";
  getSample(timeoutMs?: number): Promise<GStreamerSample | null>;
  onSample(callback: (sample: GStreamerSample) => void): () => void;
} & ElementBase;
export type AppSrcElement = {
  readonly type: "app-src-element";
  push(buffer: Buffer, pts?: Buffer | number): void;
  endOfStream(): void;
} & ElementBase;
interface Pipeline {
  play(timeoutMs?: number): Promise<StateChangeResult>;
  pause(timeoutMs?: number): Promise<StateChangeResult>;
  stop(timeoutMs?: number): Promise<StateChangeResult>;
  playing(): boolean;
  getElementByName(name: string): Element | AppSinkElement | AppSrcElement | null;
  queryPosition(): number;
  queryDuration(): number;
  busPop(timeoutMs?: number): Promise<GstMessage | null>;
  seek(positionSeconds: number): boolean;
  endOfStream(): boolean;
  dispose(): void;
}
interface PipelineConstructor {
  new (pipeline: string): Pipeline;
  elementExists(elementName: string): boolean;
}
/**
 * https://gstreamer.freedesktop.org/documentation/gstreamer/gstbuffer.html?gi-language=c#GstBufferFlags
 * */
export declare const GstBufferFlags: {
  readonly GST_BUFFER_FLAG_LIVE: 16;
  readonly GST_BUFFER_FLAG_DECODE_ONLY: 32;
  readonly GST_BUFFER_FLAG_DISCONT: 64;
  readonly GST_BUFFER_FLAG_RESYNC: 128;
  readonly GST_BUFFER_FLAG_CORRUPTED: 256;
  readonly GST_BUFFER_FLAG_MARKER: 512;
  readonly GST_BUFFER_FLAG_HEADER: 1024;
  readonly GST_BUFFER_FLAG_GAP: 2048;
  readonly GST_BUFFER_FLAG_DROPPABLE: 4096;
  readonly GST_BUFFER_FLAG_DELTA_UNIT: 8192;
  readonly GST_BUFFER_FLAG_TAG_MEMORY: 16384;
  readonly GST_BUFFER_FLAG_SYNC_AFTER: 32768;
  readonly GST_BUFFER_FLAG_NON_DROPPABLE: 65536;
  readonly GST_BUFFER_FLAG_LAST: 1048576;
};
declare const PipelineClass: PipelineConstructor;
declare const _default: {
  Pipeline: PipelineConstructor;
  GStreamerPropertyValue: GStreamerPropertyValue;
  GStreamerSample: GStreamerSample;
  GStreamerPropertyReturnValue: GStreamerPropertyReturnValue;
  GstBufferFlags: {
    readonly GST_BUFFER_FLAG_LIVE: 16;
    readonly GST_BUFFER_FLAG_DECODE_ONLY: 32;
    readonly GST_BUFFER_FLAG_DISCONT: 64;
    readonly GST_BUFFER_FLAG_RESYNC: 128;
    readonly GST_BUFFER_FLAG_CORRUPTED: 256;
    readonly GST_BUFFER_FLAG_MARKER: 512;
    readonly GST_BUFFER_FLAG_HEADER: 1024;
    readonly GST_BUFFER_FLAG_GAP: 2048;
    readonly GST_BUFFER_FLAG_DROPPABLE: 4096;
    readonly GST_BUFFER_FLAG_DELTA_UNIT: 8192;
    readonly GST_BUFFER_FLAG_TAG_MEMORY: 16384;
    readonly GST_BUFFER_FLAG_SYNC_AFTER: 32768;
    readonly GST_BUFFER_FLAG_NON_DROPPABLE: 65536;
    readonly GST_BUFFER_FLAG_LAST: 1048576;
  };
};
//#endregion
export { PipelineClass as Pipeline, _default as default };