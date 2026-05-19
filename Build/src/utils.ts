export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: number | undefined;
  return function (this: unknown, ...args: Parameters<T>): void {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(
      () =>
        Reflect.apply(
          func as unknown as (...a: unknown[]) => unknown,
          this,
          args as unknown[],
        ),
      wait,
    );
  };
}

// Copy text to clipboard utility
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err: unknown) {
    console.error("Failed to copy text:", err);
  }
}
