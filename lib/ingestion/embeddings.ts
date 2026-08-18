/**
 * Embeddings via @xenova/transformers (all-MiniLM-L6-v2, 384-dim).
 *
 * The ONNX runtime + model loading can consume 300–500 MB of RAM. To prevent
 * an OOM kill from taking down the entire BullMQ worker process, embedding
 * runs in a dedicated child process (embed-worker.mjs). If the child OOMs,
 * only that process dies; the worker catches the error and falls back to zero
 * vectors so the product sync still completes.
 */
import { fork } from 'node:child_process';
import { join } from 'node:path';

export const EMBEDDING_DIM = 384;

const WORKER_PATH = join(__dirname, 'embed-worker.mjs');
const TIMEOUT_MS = 5 * 60 * 1000;

function runEmbedWorker(texts: string[]): Promise<number[][]> {
  return runEmbedWorkerAt(WORKER_PATH, texts);
}

/**
 * Exported purely as a test seam: the interesting failures here are about how a
 * *dying* child is handled, which cannot be exercised through the real worker.
 * Production callers use runEmbedWorker.
 */
export function runEmbedWorkerAt(workerPath: string, texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';

    const child = fork(workerPath, [], {
      execArgv: ['--experimental-vm-modules'],
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
    });

    // Declared before `finish` so it can be a const; the callback only runs
    // asynchronously, by which point `finish` is initialised.
    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(new Error(`Embed worker timed out after ${TIMEOUT_MS}ms`));
      });
    }, TIMEOUT_MS);

    // Every terminal path goes through here, so the promise settles exactly
    // once and the timeout is only ever cleared by something that also settles.
    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      act();
    };

    // Keep the tail only. A stack trace is all we need to diagnose, and an
    // unbounded buffer here would defeat the point of isolating the child.
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });

    child.on('message', (msg: { vectors?: number[][]; error?: string }) => {
      finish(() => {
        child.disconnect();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.vectors ?? []);
      });
    });

    child.on('error', (err) => finish(() => reject(err)));

    // Any exit before a reply is a failure, whatever code/signal it carries.
    // The previous guard (`code !== 0 && signal !== null`) missed the single
    // most common crash there is — exit code 1 with no signal, which is what a
    // failed top-level import or a rejected model download produces. It cleared
    // the timeout and then rejected nothing, so the promise stayed pending
    // forever: ingestProducts hung on the first batch before writing a single
    // row, finishRun never ran, and the IngestionRun sat at RUNNING/0% for good.
    child.on('exit', (code, signal) => {
      finish(() => {
        reject(
          new Error(
            `Embed worker exited without replying (code=${code}, signal=${signal})` +
              (stderr.trim() ? `: ${stderr.trim()}` : ''),
          ),
        );
      });
    });

    child.send({ texts });
  });
}

export async function embed(text: string): Promise<number[]> {
  const [vec] = await runEmbedWorker([text]);
  return vec ?? Array(EMBEDDING_DIM).fill(0) as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return runEmbedWorker(texts);
}

/** Converts a JS number[] into the pgvector literal string `'[a,b,c,...]'`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
