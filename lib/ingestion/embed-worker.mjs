/**
 * Standalone embedding child process.
 * Parent sends: { texts: string[] }
 * Child replies: { vectors: number[][] } or { error: string }
 * Runs in its own process so an OOM kill doesn't take down the BullMQ worker.
 */
import { pipeline, env as transformersEnv } from '@xenova/transformers';

const EMBEDDING_DIM = 384;

// transformers.js does NOT read TRANSFORMERS_CACHE on its own — that's the
// Python library's convention. Without this it caches inside node_modules,
// which is fine locally but brittle in the container. Point it at the
// directory the Dockerfile creates and chowns to the runtime user.
if (process.env.TRANSFORMERS_CACHE) {
  transformersEnv.cacheDir = process.env.TRANSFORMERS_CACHE;
}

let pipe = null;

async function getPipeline() {
  if (!pipe) {
    pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return pipe;
}

process.on('message', async (msg) => {
  try {
    const { texts } = msg;
    if (!Array.isArray(texts) || texts.length === 0) {
      process.send({ vectors: [] });
      return;
    }
    const p = await getPipeline();
    const out = await p(texts, { pooling: 'mean', normalize: true });
    const vectors = texts.map((_, i) =>
      Array.from(out.data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM)),
    );
    process.send({ vectors });
  } catch (err) {
    process.send({ error: String(err) });
  }
});
