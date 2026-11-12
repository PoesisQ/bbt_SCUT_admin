import { embed, modelVersion } from "./embeddings.js";

async function loadIndex() {
  const response = await fetch(new URL("./data/vectors.json?v=20261112-notices", import.meta.url));
  if (!response.ok) throw new Error("Lecture vectors could not be loaded");
  const index = await response.json();
  if (index.modelVersion !== modelVersion) throw new Error("Lecture vectors use a different model");
  return index.rows;
}

let index;
let queue = Promise.resolve();
self.addEventListener("message", ({ data: { id, query } }) => {
  queue = queue.then(async () => {
    try {
      index ??= loadIndex().catch(error => {
        index = undefined;
        throw error;
      });
      const [[queryVector], rows] = await Promise.all([embed([query], true), index]);
      const scores = Object.fromEntries(rows.map(({ id: evidenceId, text, vector }) => {
        if (vector.length !== queryVector.length) throw new Error("Embedding dimension mismatch");
        const score = vector.reduce((sum, component, i) => sum + component * queryVector[i], 0);
        return [evidenceId, { text, score }];
      }));
      self.postMessage({ id, scores });
    } catch {
      self.postMessage({ id, failed: true });
    }
  });
});
