/**
 * Wall-clock cap for work that must never hang.
 *
 * This does NOT cancel the underlying promise — nothing in Node can force that.
 * It bounds how long a caller waits, so a stalled dependency surfaces as a
 * failure the UI can render instead of a job that stays RUNNING forever.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
