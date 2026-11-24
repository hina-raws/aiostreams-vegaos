import React, {useCallback, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {WebView} from '@amazon-devices/webview';

/**
 * The AIOStreams web client, as `scripts/sync-web.mjs` leaves it in `assets/`.
 * The package's own `assets` folder is readable from a page without
 * `allowFileAccess`, at `/pkg/assets`.
 */
const PAGE = 'file:///pkg/assets/index.html';

/** The page's messages to the shell. Anything else is ignored. */
type PageMessage = {type?: string};

/**
 * Vega's WebView exposes `navigator.gpu` and answers `requestAdapter()` with
 * nothing, and the page takes the mere presence for WebGPU working, which
 * picks a player that cannot play. Removing it before the page runs leaves the
 * page on its `<video>` and MSE, which the device does support.
 */
const NO_WEBGPU = `try {
  delete Navigator.prototype.gpu;
  delete Window.prototype.gpu;
  delete navigator.gpu;
} catch (error) {}
true;`;

/**
 * The whole app: the web client in a WebView, which does the TV layout, D-pad
 * focus and playback itself. The shell only supplies what the page cannot do
 * alone: it tells it when to quit, and shows why it would not start.
 */
export const App = () => {
  const page = useRef<React.ComponentRef<typeof WebView>>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const onMessage = useCallback((event: {nativeEvent: {data: string}}) => {
    let message: PageMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as PageMessage;
    } catch {
      return;
    }
    // Back on the page the app opens with has nowhere left to go.
    if (message?.type === 'exit') BackHandler.exitApp();
  }, []);

  const onError = useCallback((event: {nativeEvent: {url?: string}}) => {
    // The page's own images and fonts fail all the time; only the page not
    // loading leaves nothing worth showing.
    const url = event.nativeEvent?.url ?? '';
    if (url && !url.startsWith('file:///pkg/')) return;
    setFailure(url || PAGE);
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        ref={page}
        source={{uri: PAGE}}
        style={styles.page}
        // The page is all JavaScript and keeps its sign-in in DOM storage.
        javaScriptEnabled={true}
        domStorageEnabled={true}
        // Its own focus engine swallows the keys it uses, so the WebView's
        // built-in spatial navigation is left out of it.
        allowSystemKeyEvents={true}
        // Playback starts when a title is picked, not on a tap.
        mediaPlaybackRequiresUserAction={false}
        // The page reads plain http only where the manifest's cleartext policy
        // allows it; this keeps an https page from refusing it as mixed content.
        mixedContentMode="always"
        // The remote's transport keys reach the page's own media session.
        allowsDefaultMediaControl={true}
        injectedJavaScriptBeforeContentLoaded={NO_WEBGPU}
        hasTVPreferredFocus={true}
        onMessage={onMessage}
        onError={onError}
        testID="aiostreams-page"
      />
      {failure ? (
        <View style={styles.failure}>
          <Text style={styles.title}>The app could not start</Text>
          <Text style={styles.detail}>{failure}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Dark from the first frame, instead of the WebView's white.
    backgroundColor: '#070707',
  },
  page: {
    flex: 1,
    backgroundColor: '#070707',
  },
  failure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 64,
    backgroundColor: '#070707',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  detail: {
    color: '#BBBBBB',
    fontSize: 24,
    lineHeight: 34,
    textAlign: 'center',
  },
});
