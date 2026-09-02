Object.defineProperties(exports, {
	__esModule: { value: true },
	[Symbol.toStringTag]: { value: "Module" }
});
let node_path = require("node:path");
let node_url = require("node:url");
let node_module = require("node:module");
//#region src/ts/index.ts
const projectRoot = (0, node_path.join)((0, node_path.dirname)((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href)), "../../");
const nativeAddon = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href)((0, node_path.join)(projectRoot, "build/Release/gst_kit.node"));
/**
* https://gstreamer.freedesktop.org/documentation/gstreamer/gstbuffer.html?gi-language=c#GstBufferFlags
* */
const GstBufferFlags = {
	GST_BUFFER_FLAG_LIVE: 16,
	GST_BUFFER_FLAG_DECODE_ONLY: 32,
	GST_BUFFER_FLAG_DISCONT: 64,
	GST_BUFFER_FLAG_RESYNC: 128,
	GST_BUFFER_FLAG_CORRUPTED: 256,
	GST_BUFFER_FLAG_MARKER: 512,
	GST_BUFFER_FLAG_HEADER: 1024,
	GST_BUFFER_FLAG_GAP: 2048,
	GST_BUFFER_FLAG_DROPPABLE: 4096,
	GST_BUFFER_FLAG_DELTA_UNIT: 8192,
	GST_BUFFER_FLAG_TAG_MEMORY: 16384,
	GST_BUFFER_FLAG_SYNC_AFTER: 32768,
	GST_BUFFER_FLAG_NON_DROPPABLE: 65536,
	GST_BUFFER_FLAG_LAST: 1048576
};
const { Pipeline: PipelineClass } = nativeAddon;
var ts_default = {
	...nativeAddon,
	GstBufferFlags
};
//#endregion
exports.GstBufferFlags = GstBufferFlags;
exports.Pipeline = PipelineClass;
exports.default = ts_default;

//# sourceMappingURL=index.cjs.map