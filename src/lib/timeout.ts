// Bounds the caller's wait; the underlying operation is not cancelled.
export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
