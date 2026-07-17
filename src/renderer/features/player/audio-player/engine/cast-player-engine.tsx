import type { RefObject } from 'react';

import { useEffect, useImperativeHandle, useRef } from 'react';

import { CastTransport } from '/@/renderer/features/player/audio-player/cast-transport';
import { AudioPlayer } from '/@/renderer/features/player/audio-player/types';
import { CastQueueItem, PlayerStatus } from '/@/shared/types/types';

export interface CastPlayerEngineHandle extends AudioPlayer {}

export type CastServerState = {
    playing: boolean;
    position: number;
    trackId: null | string;
    volume: number;
};

interface CastPlayerEngineProps {
    currentItem: CastQueueItem | null;
    enabled: boolean;
    nextItem: CastQueueItem | null;
    onEnded: () => void;
    onServerStateSynced?: (state: CastServerState) => void;
    onTick: (positionSeconds: number) => void;
    playerRef: RefObject<CastPlayerEngineHandle | null>;
    playerStatus: PlayerStatus;
    transport: CastTransport;
    volume: number;
}

// MEDIA_STATUS broadcasts are pushed by the Cast device roughly once a second while
// playing (server re-requests status on the same cadence), so no client-side polling
// is needed here — see src/main/features/core/cast/cast-core.ts.
//
// ponytail: only loads current+next, not previous — tried a previous+current+next
// window to get native prev/next buttons on the Cast device's own screen, but Google's
// generic Default Media Receiver (CC1AD845, what every third-party sender uses) never
// advertises QUEUE_NEXT/QUEUE_PREV in supportedMediaCommands regardless of queue size.
// That UI only exists for a custom-registered Cast Receiver app (separate hosted web
// app + Developer Console registration) — real new infrastructure, not reachable from
// here. Transport control from Feishin's own UI already works fine either way.
export const CastPlayerEngine = (props: CastPlayerEngineProps) => {
    const {
        currentItem,
        enabled,
        nextItem,
        onEnded,
        onServerStateSynced,
        onTick,
        playerRef,
        playerStatus,
        transport,
        volume,
    } = props;

    const currentItemRef = useRef<CastQueueItem | null>(currentItem);
    const nextItemRef = useRef<CastQueueItem | null>(nextItem);
    currentItemRef.current = currentItem;
    nextItemRef.current = nextItem;

    // loadedCurrentTrackIdRef only gets set once transport.load()'s promise resolves
    // (see below) — every other effect gates on it as a "session is actually ready"
    // signal, so nothing races ahead of the Cast device having a real media session.
    const loadedCurrentTrackIdRef = useRef<null | string>(null);
    const loadedNextTrackIdRef = useRef<null | string>(null);
    const itemIdByTrackIdRef = useRef<Map<string, number>>(new Map());
    const loadingTrackIdRef = useRef<null | string>(null);

    // Load (or reload) the Cast device's current+next queue whenever Feishin's current
    // track changes — covers first connect, natural end-of-track advance, and manual
    // skip/shuffle-jump identically. Earlier this tried to special-case "expected"
    // advances with a lighter queueInsert-only patch, but that assumed the Cast device
    // had already moved on by itself, which isn't true for a user-initiated skip — the
    // device was still playing the old track, so the "light patch" never actually told
    // it to jump. Always reloading is simpler and correct in every case; the cost is a
    // brief reload glitch on natural track-end instead of a seamless handoff.
    useEffect(() => {
        if (!enabled) {
            return;
        }

        if (!currentItem) {
            transport.pause();
            loadedCurrentTrackIdRef.current = null;
            loadedNextTrackIdRef.current = null;
            loadingTrackIdRef.current = null;
            itemIdByTrackIdRef.current.clear();
            return;
        }

        if (
            currentItem.id === loadedCurrentTrackIdRef.current ||
            currentItem.id === loadingTrackIdRef.current
        ) {
            return;
        }

        const items = nextItem ? [currentItem, nextItem] : [currentItem];
        loadingTrackIdRef.current = currentItem.id;
        itemIdByTrackIdRef.current.clear();

        transport
            .load({
                autoplay: playerStatus === PlayerStatus.PLAYING,
                currentTime: 0,
                items,
                startIndex: 0,
            })
            .finally(() => {
                loadingTrackIdRef.current = null;
                loadedCurrentTrackIdRef.current = currentItem.id;
                loadedNextTrackIdRef.current = nextItem?.id ?? null;
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, currentItem, nextItem, transport]);

    // Once the reload above has settled, keep the "next" slot topped up when it changes
    // on its own (reorder/shuffle-refill) without needing an immediate transition on
    // the device.
    useEffect(() => {
        if (!enabled || !currentItem || currentItem.id !== loadedCurrentTrackIdRef.current) {
            return;
        }

        if (nextItem?.id !== loadedNextTrackIdRef.current) {
            const staleItemId = loadedNextTrackIdRef.current
                ? itemIdByTrackIdRef.current.get(loadedNextTrackIdRef.current)
                : undefined;

            if (nextItem) {
                transport.queueInsert({ items: [nextItem] });
            }

            if (staleItemId !== undefined) {
                transport.queueRemove([staleItemId]);
            }

            loadedNextTrackIdRef.current = nextItem?.id ?? null;
        }
    }, [enabled, currentItem, nextItem, transport]);

    // Play/pause matcher — only once a session actually exists, so this never races
    // ahead of the load effect above (see loadedCurrentTrackIdRef comment).
    useEffect(() => {
        if (!enabled || !loadedCurrentTrackIdRef.current) {
            return;
        }

        if (playerStatus === PlayerStatus.PLAYING) {
            transport.play();
        } else {
            transport.pause();
        }
    }, [enabled, playerStatus, transport]);

    // Volume matcher
    useEffect(() => {
        if (!enabled) {
            return;
        }

        transport.setVolume(volume / 100);
    }, [enabled, volume, transport]);

    // Status listener: rebuild the itemId map on every broadcast so queueInsert/queueRemove
    // always have a fresh id to work with, and report position/play-state/current-track back up.
    useEffect(() => {
        if (!enabled) {
            return;
        }

        const handleStatus = (status: any) => {
            const items: { itemId: number; media?: { contentId?: string } }[] = status?.items ?? [];

            for (const item of items) {
                const contentId = item.media?.contentId;
                if (!contentId) continue;

                if (currentItemRef.current?.contentId === contentId) {
                    itemIdByTrackIdRef.current.set(currentItemRef.current.id, item.itemId);
                } else if (nextItemRef.current?.contentId === contentId) {
                    itemIdByTrackIdRef.current.set(nextItemRef.current.id, item.itemId);
                }
            }

            const playing = status?.playerState === 'PLAYING';
            const position = status?.currentTime ?? 0;
            const volumeLevel = status?.volume?.level ?? 1;

            let trackId: null | string = null;
            if (
                currentItemRef.current &&
                itemIdByTrackIdRef.current.get(currentItemRef.current.id) === status?.currentItemId
            ) {
                trackId = currentItemRef.current.id;
            } else if (
                nextItemRef.current &&
                itemIdByTrackIdRef.current.get(nextItemRef.current.id) === status?.currentItemId
            ) {
                trackId = nextItemRef.current.id;
            }

            onServerStateSynced?.({
                playing,
                position,
                trackId,
                volume: Math.round(volumeLevel * 100),
            });

            onTick(position);

            if (status?.playerState === 'IDLE' && status?.idleReason === 'FINISHED') {
                onEnded();
            }
        };

        transport.onStatus(handleStatus);
        // The preload bridge doesn't expose an "off" for this event (matches the
        // mpv listener pattern); a fresh Cast session only ever has one active
        // engine instance at a time, so this is safe to leave attached.
    }, [enabled, onEnded, onServerStateSynced, onTick, transport]);

    useImperativeHandle<CastPlayerEngineHandle, CastPlayerEngineHandle>(playerRef, () => ({
        decreaseVolume() {
            // Volume is driven by the shared player volume slider (see the Volume matcher
            // effect above); Cast doesn't need its own independent volume ramp.
        },
        increaseVolume() {
            // See decreaseVolume above.
        },
        pause() {
            transport.pause();
        },
        play() {
            transport.play();
        },
        seekTo(seconds: number) {
            transport.seek(seconds);
        },
        setVolume(vol: number) {
            transport.setVolume(vol / 100);
        },
    }));

    return null;
};
