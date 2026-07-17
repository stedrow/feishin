import { useCallback, useMemo, useRef } from 'react';

import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { getCastTransport } from '/@/renderer/features/player/audio-player/cast-transport';
import {
    CastPlayerEngine,
    CastServerState,
} from '/@/renderer/features/player/audio-player/engine/cast-player-engine';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { useSongUrl } from '/@/renderer/features/player/audio-player/hooks/use-stream-url';
import { AudioPlayer } from '/@/renderer/features/player/audio-player/types';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    usePlaybackSettings,
    usePlayerActions,
    usePlayerData,
    usePlayerMuted,
    usePlayerStore,
    usePlayerVolume,
} from '/@/renderer/store';
import { useCastConnectedDevice } from '/@/renderer/store/cast.store';
import { useDebouncedCallback } from '/@/shared/hooks/use-debounced-callback';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';
import { CastQueueItem } from '/@/shared/types/types';

const MIME_BY_CONTAINER: Record<string, string> = {
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/ogg; codecs="opus"',
    wav: 'audio/wav',
    webm: 'audio/webm',
};

export function CastPlayer() {
    const playerRef = useRef<AudioPlayer>(null);
    const { currentSong, nextSong, status } = usePlayerData();
    const { mediaAutoNext, mediaPause, mediaPlay, mediaPlayByIndex, setTimestamp } =
        usePlayerActions();
    const isMuted = usePlayerMuted();
    const volume = usePlayerVolume();
    const player = usePlayer();
    const { transcode } = usePlaybackSettings();
    const connectedDevice = useCastConnectedDevice();
    const transport = useMemo(() => getCastTransport(), []);

    const currentUrl = useSongUrl(currentSong, true, transcode);
    const nextUrl = useSongUrl(nextSong, false, transcode);

    const currentItem =
        currentSong && currentUrl
            ? buildCastQueueItem(
                  currentSong,
                  currentUrl,
                  transcode.enabled ? transcode.format : undefined,
              )
            : null;
    const nextItem =
        nextSong && nextUrl
            ? buildCastQueueItem(
                  nextSong,
                  nextUrl,
                  transcode.enabled ? transcode.format : undefined,
              )
            : null;

    const handleServerStateSynced = useCallback(
        (state: CastServerState) => {
            const { playing, position, trackId } = state;

            if (trackId) {
                const queue = usePlayerStore.getState().getQueue();
                const queueIndex = queue.items.findIndex((item) => item.id === trackId);

                if (queueIndex !== -1) {
                    const currentId = usePlayerStore.getState().getCurrentSong()?.id;
                    if (trackId !== currentId) {
                        mediaPlayByIndex(queueIndex);
                    }
                }
            }

            if (position > 0) {
                setTimestamp(Math.floor(position));
            }

            if (playing) {
                mediaPlay();
            } else {
                mediaPause();
            }
        },
        [mediaPause, mediaPlay, mediaPlayByIndex, setTimestamp],
    );

    const debouncedSeekToTimestamp = useDebouncedCallback((timestamp: number) => {
        playerRef.current?.seekTo(timestamp);
    }, 300);

    const debouncedSetVolume = useDebouncedCallback((nextVolume: number) => {
        playerRef.current?.setVolume(nextVolume);
    }, 300);

    usePlayerEvents(
        {
            onPlayerSeekToTimestamp: (properties) => {
                debouncedSeekToTimestamp(properties.timestamp);
            },
            onPlayerVolume: (properties) => {
                debouncedSetVolume(properties.volume);
            },
            onQueueCleared: () => {
                player.mediaStop();
            },
        },
        [debouncedSeekToTimestamp, debouncedSetVolume, player],
    );

    return (
        <CastPlayerEngine
            currentItem={currentItem}
            enabled={Boolean(connectedDevice)}
            nextItem={nextItem}
            onEnded={mediaAutoNext}
            onServerStateSynced={handleServerStateSynced}
            onTick={(positionSeconds) => {
                setTimestamp(Math.floor(positionSeconds));
            }}
            playerRef={playerRef}
            playerStatus={status}
            transport={transport}
            volume={isMuted ? 0 : volume}
        />
    );
}

function buildCastQueueItem(song: QueueSong, url: string, transcodeFormat?: string): CastQueueItem {
    const container = transcodeFormat ?? song.container ?? undefined;
    const imageUrl = getItemImageUrl({
        id: song.id,
        imageUrl: song.imageUrl,
        itemType: LibraryItem.SONG,
        serverId: song._serverId,
        useRemoteUrl: true,
    });

    return {
        album: song.album ?? undefined,
        artist: song.artistName,
        contentId: url,
        contentType: MIME_BY_CONTAINER[(container ?? '').toLowerCase()] ?? 'audio/mpeg',
        duration: song.duration,
        id: song.id,
        imageUrl,
        title: song.name,
    };
}
