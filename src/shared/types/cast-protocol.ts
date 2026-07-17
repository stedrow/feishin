import { CastDevice, CastQueueItem } from '/@/shared/types/types';

// Sent by the browser client to the standalone cast-server over WebSocket.
// Channel names mirror the Electron IPC channels 1:1 (see src/main/features/core/cast).
export type CastClientMessage =
    | { data: CastLoadData; reqId: string; type: 'cast-load' }
    | { data: CastQueueInsertData; type: 'cast-queue-insert' }
    | { deviceId: string; reqId: string; type: 'cast-connect' }
    | { itemIds: number[]; type: 'cast-queue-remove' }
    | { level: number; type: 'cast-set-volume' }
    | { reqId: string; type: 'cast-disconnect' }
    | { reqId: string; type: 'cast-discover-start' }
    | { reqId: string; type: 'cast-discover-stop' }
    | { reqId: string; type: 'cast-get-status' }
    | { seconds: number; type: 'cast-seek' }
    | { type: 'cast-pause' }
    | { type: 'cast-play' };

export type CastLoadData = {
    autoplay?: boolean;
    currentTime?: number;
    items: CastQueueItem[];
    startIndex?: number;
};

export type CastQueueInsertData = {
    insertBefore?: number;
    items: CastQueueItem[];
};

// Sent by the cast-server to the browser client(s).
export type CastServerMessage =
    | { device: CastDevice | null; reqId: string; type: 'cast-connect-result' }
    | { device: CastDevice | null; reqId: string; type: 'cast-get-status-result' }
    | { devices: CastDevice[]; type: 'renderer-cast-devices' }
    | { message: string; type: 'renderer-cast-error' }
    | { reqId: string; status: unknown; type: 'cast-load-result' }
    | { status: unknown; type: 'renderer-cast-status' }
    | { type: 'renderer-cast-disconnected' };
