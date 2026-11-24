import type { MediaStream } from '@/lib/jellyfin/types';

/*
 * What this engine can decode of a file's own sound. A remux often carries a
 * lossless track — Dolby TrueHD, DTS-HD — that a TV without that decoder plays
 * as silence, and a Vega WebView decodes no Dolby at all, not even the Dolby
 * Digital track a remux pairs with its lossless one. The server here only
 * direct plays, so nothing converts a codec the device cannot take.
 */

/** One way of asking about a codec: a container and the codec inside it. */
interface Ask {
  mime: string;
  codecs?: string;
  /** The channel count the question is about, for a device that takes fewer. */
  channels?: number;
}

/** Jellyfin's codec names, and how each is asked about. */
const TYPES: Record<string, readonly Ask[]> = {
  aac: [{ mime: 'audio/mp4', codecs: 'mp4a.40.2', channels: 2 }],
  mp3: [{ mime: 'audio/mpeg' }],
  opus: [
    { mime: 'audio/webm', codecs: 'opus' },
    { mime: 'audio/mp4', codecs: 'opus' },
  ],
  vorbis: [{ mime: 'audio/webm', codecs: 'vorbis' }],
  flac: [{ mime: 'audio/flac' }, { mime: 'audio/mp4', codecs: 'flac' }],
  ac3: [
    { mime: 'audio/mp4', codecs: 'ac-3', channels: 6 },
    { mime: 'audio/ac3' },
  ],
  eac3: [{ mime: 'audio/mp4', codecs: 'ec-3', channels: 6 }],
  truehd: [{ mime: 'audio/mp4', codecs: 'mlpa', channels: 8 }],
  mlp: [{ mime: 'audio/mp4', codecs: 'mlpa', channels: 8 }],
  dca: [{ mime: 'audio/mp4', codecs: 'dtsc', channels: 6 }],
  dts: [{ mime: 'audio/mp4', codecs: 'dtsc', channels: 6 }],
  dtshd: [{ mime: 'audio/mp4', codecs: 'dtsh', channels: 8 }],
  pcm_s16le: [{ mime: 'audio/wav' }],
  pcm_s24le: [{ mime: 'audio/wav' }],
  pcm_bluray: [{ mime: 'audio/wav' }],
};

/** The names as a person reads them, for a notice about what did not play. */
/* eslint-disable lingui/no-unlocalized-strings -- codec names, not text */
const NAMES: Record<string, string> = {
  truehd: 'Dolby TrueHD',
  mlp: 'Dolby TrueHD',
  dtshd: 'DTS-HD',
  dts: 'DTS',
  dca: 'DTS',
  eac3: 'Dolby Digital Plus',
  ac3: 'Dolby Digital',
};
/* eslint-enable lingui/no-unlocalized-strings */

const contentType = ({mime, codecs}: Ask) =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a media type, not text
  codecs ? `${mime}; codecs="${codecs}"` : mime;

let tester: HTMLVideoElement | undefined;

const plays = (ask: Ask): boolean => {
  tester ??= document.createElement('video');
  const type = contentType(ask);
  return (
    !!tester.canPlayType(type) ||
    (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type))
  );
};

/** What the device has answered, by codec name; the engine's own guess until then. */
const answers = new Map<string, boolean>();

/**
 * Whether a codec can be played, the device's word for it where it has one. A
 * codec the app has no question for is taken as playable: calling working sound
 * unplayable is worse than the silence this is for.
 */
export function canPlayAudio(codec?: string | null): boolean {
  const name = codec?.toLowerCase();
  if (!name) return true;
  const asked = TYPES[name];
  if (!asked) return true;
  const answered = answers.get(name);
  if (answered !== undefined) return answered;
  const playable = asked.some(plays);
  answers.set(name, playable);
  return playable;
}

/**
 * Asks the device once, up front, which codecs it decodes. `mediaCapabilities`
 * answers for the file itself, which is what a direct-played version is, and it
 * is the only answer that holds when a device passes a codec through instead of
 * decoding it, or takes fewer channels than the track has.
 */
export async function primeAudioSupport(): Promise<void> {
  const capabilities = navigator.mediaCapabilities;
  if (!capabilities?.decodingInfo) return;
  await Promise.all(
    Object.entries(TYPES).map(async ([name, asked]) => {
      const verdicts = await Promise.all(
        asked.map(async (ask) => {
          try {
            const info = await capabilities.decodingInfo({
              type: 'file',
              audio: {
                contentType: contentType(ask),
                channels: String(ask.channels ?? 2),
                samplerate: 48000,
                bitrate: 640000,
              },
            });
            return info.supported;
          } catch {
            return undefined;
          }
        })
      );
      // One way of asking being answered is enough; an unanswered one says nothing.
      const decided = verdicts.find((v) => v !== undefined);
      if (decided !== undefined) answers.set(name, decided);
    })
  );
}

/** A version's own sound, rather than subtitles fetched into it. */
export const audioStreamsOf = (streams?: readonly MediaStream[] | null) =>
  (streams ?? []).filter((s) => s?.Type === 'Audio' && !s.IsExternal);

/** Whether anything the version carries can be heard here. */
export function hasPlayableAudio(
  streams?: readonly MediaStream[] | null
): boolean {
  const audio = audioStreamsOf(streams);
  // A version that lists no tracks says nothing about its sound.
  return !audio.length || audio.some((s) => canPlayAudio(s.Codec));
}

/** The version's sound this device cannot decode, by name, in file order. */
export function unplayableAudio(
  streams?: readonly MediaStream[] | null
): string[] {
  return audioStreamsOf(streams)
    .filter((s) => !canPlayAudio(s.Codec))
    .map(
      (s) =>
        NAMES[s.Codec?.toLowerCase() ?? ''] ??
        s.DisplayTitle ??
        s.Codec ??
        // eslint-disable-next-line lingui/no-unlocalized-strings -- a codec's own name
        'unknown'
    );
}
