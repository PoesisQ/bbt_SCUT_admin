import { env, pipeline } from "./vendor/transformers/transformers.min.js";

export const modelVersion = "bge-small-zh-v1.5@75c43b0/int8/cls";
const queryInstruction = "为这个句子生成表示以用于检索相关文章：";

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL("./models/", import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("./vendor/transformers/ort-wasm-simd-threaded.jsep.js", import.meta.url).href,
  wasm: new URL("./vendor/transformers/ort-wasm-simd-threaded.jsep.wasm", import.meta.url).href,
};
env.backends.onnx.wasm.numThreads = 1;

let extractor;

export async function embed(texts, isQuery = false) {
  extractor ??= pipeline("feature-extraction", "bge-small-zh-v1.5", {
    device: "wasm", dtype: "int8", local_files_only: true,
  }).catch(error => {
    extractor = undefined;
    throw error;
  });
  const model = await extractor;
  const inputs = isQuery ? texts.map(text => queryInstruction + text) : texts;
  const output = await model(inputs, { pooling: "cls", normalize: true });
  return output.tolist();
}
