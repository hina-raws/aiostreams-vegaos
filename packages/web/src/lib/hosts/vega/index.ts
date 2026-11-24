import type { Host } from '..';

/**
 * The bridge a Vega shell app injects: its WebView sets `onMessage`, which
 * puts `window.ReactNativeWebView` in the page. The page reads its own files
 * from the app's package, and plays through its own `<video>`.
 */
interface VegaBridge {
  postMessage(message: string): void;
}

declare global {
  interface Window {
    ReactNativeWebView?: VegaBridge;
  }
}

const bridge = () => window.ReactNativeWebView;

const host: Host = {
  name: 'vega',
  tv: true,
  // eslint-disable-next-line lingui/no-unlocalized-strings -- how the server lists the device
  device: () => ({ name: 'Fire TV' }),
  // Back on the page the app starts on leaves it: the shell quits on `exit`.
  exit: () => bridge()?.postMessage(JSON.stringify({ type: 'exit' })),
};

/** A Fire TV running the Vega shell, which hosts the page in a WebView. */
export function vegaHost(): Host | null {
  return bridge() ? host : null;
}
