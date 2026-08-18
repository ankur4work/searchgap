/* eslint-disable no-console -- build-time script; its output IS the build log */
/**
 * Build-time model prefetch.
 *
 * Downloads and verifies the MiniLM weights into TRANSFORMERS_CACHE so they are
 * baked into the image layer. Without this the 90MB model is fetched from the
 * HuggingFace CDN on the first embed after every container start — the cache
 * lives in the image, not a volume, so a restart or redeploy re-arms that
 * download. When it failed, the embed child died and product sync stalled.
 *
 * Runs as a Dockerfile RUN step. Failing the build here is deliberate: a broken
 * model is far better caught at build time than on a reviewer's fresh install.
 */
import { pipeline, env as transformersEnv } from '@xenova/transformers';

const EMBEDDING_DIM = 384;

if (process.env.TRANSFORMERS_CACHE) {
  transformersEnv.cacheDir = process.env.TRANSFORMERS_CACHE;
}

// Retry the download: a HuggingFace blip should not block a deploy, but a
// genuinely broken model should still fail the build rather than ship.
const ATTEMPTS = 3;

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    // Actually run inference. Downloading the weights proves nothing about
    // whether onnxruntime-node can load them on this base image — that is a
    // native binding which has failed on musl before, and it fails at
    // inference time, not at import.
    const out = await pipe(['warmup'], { pooling: 'mean', normalize: true });

    if (out.data.length !== EMBEDDING_DIM) {
      throw new Error(`produced ${out.data.length} dims, expected ${EMBEDDING_DIM}`);
    }

    console.log(`Model prefetched and verified (${EMBEDDING_DIM} dims)`);
    process.exit(0);
  } catch (err) {
    console.error(`Model prefetch attempt ${attempt}/${ATTEMPTS} failed: ${err}`);
    if (attempt === ATTEMPTS) {
      console.error(
        'Refusing to build an image whose embeddings cannot run. ' +
          'Shipping it would stall product sync on every install.',
      );
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}
