export function stubDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400));
}
