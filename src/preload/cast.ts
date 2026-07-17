import { ipcRenderer } from 'electron';

import { CastDevice, CastQueueItem } from '/@/shared/types/types';

export type { CastDevice, CastQueueItem };

const discoverStart = () => {
    ipcRenderer.send('cast-discover-start');
};

const discoverStop = () => {
    ipcRenderer.send('cast-discover-stop');
};

const connect = async (deviceId: string): Promise<CastDevice | null> => {
    return ipcRenderer.invoke('cast-connect', deviceId);
};

const disconnect = () => {
    ipcRenderer.send('cast-disconnect');
};

const getStatus = async (): Promise<CastDevice | null> => {
    return ipcRenderer.invoke('cast-get-status');
};

const load = async (data: {
    autoplay?: boolean;
    currentTime?: number;
    items: CastQueueItem[];
    startIndex?: number;
}) => {
    return ipcRenderer.invoke('cast-load', data);
};

const play = () => {
    ipcRenderer.send('cast-play');
};

const pause = () => {
    ipcRenderer.send('cast-pause');
};

const seek = (seconds: number) => {
    ipcRenderer.send('cast-seek', seconds);
};

const setVolume = (level: number) => {
    ipcRenderer.send('cast-set-volume', level);
};

const queueInsert = (data: { insertBefore?: number; items: CastQueueItem[] }) => {
    ipcRenderer.send('cast-queue-insert', data);
};

const queueRemove = (itemIds: number[]) => {
    ipcRenderer.send('cast-queue-remove', itemIds);
};

const rendererCastDevices = (cb: (devices: CastDevice[]) => void) => {
    ipcRenderer.on('renderer-cast-devices', (_event, devices) => cb(devices));
};

const rendererCastStatus = (cb: (status: any) => void) => {
    ipcRenderer.on('renderer-cast-status', (_event, status) => cb(status));
};

const rendererCastDisconnected = (cb: () => void) => {
    ipcRenderer.on('renderer-cast-disconnected', () => cb());
};

const rendererCastError = (cb: (message: string) => void) => {
    ipcRenderer.on('renderer-cast-error', (_event, message) => cb(message));
};

export const cast = {
    connect,
    disconnect,
    discoverStart,
    discoverStop,
    getStatus,
    load,
    pause,
    play,
    queueInsert,
    queueRemove,
    seek,
    setVolume,
};

export const castListener = {
    rendererCastDevices,
    rendererCastDisconnected,
    rendererCastError,
    rendererCastStatus,
};

export type Cast = typeof cast;
export type CastListener = typeof castListener;
