import isElectron from 'is-electron';

import { CastLoadData, CastQueueInsertData } from '/@/shared/types/cast-protocol';
import { CastDevice } from '/@/shared/types/types';

// Both the Electron desktop app and the web/PWA build ultimately drive the same
// castv2 session logic (src/main/features/core/cast/cast-core.ts) — the desktop
// app over IPC, the browser build over WebSocket to the standalone cast-server
// (src/cast-server), since browsers can't open raw TCP/mDNS sockets themselves
// and Chrome's native chrome.cast SDK only exists in Chrome/Edge, not Firefox/Safari.
export interface CastTransport {
    connect(deviceId: string): Promise<CastDevice | null>;
    disconnect(): void;
    discoverStart(): void;
    discoverStop(): void;
    load(data: CastLoadData): Promise<unknown>;
    onDevices(cb: (devices: CastDevice[]) => void): void;
    onDisconnected(cb: () => void): void;
    onError(cb: (message: string) => void): void;
    onStatus(cb: (status: any) => void): void;
    pause(): void;
    play(): void;
    queueInsert(data: CastQueueInsertData): void;
    queueRemove(itemIds: number[]): void;
    seek(seconds: number): void;
    setVolume(level: number): void;
}

class ElectronCastTransport implements CastTransport {
    connect(deviceId: string) {
        return window.api.cast.connect(deviceId);
    }

    disconnect() {
        window.api.cast.disconnect();
    }

    discoverStart() {
        window.api.cast.discoverStart();
    }

    discoverStop() {
        window.api.cast.discoverStop();
    }

    load(data: CastLoadData) {
        return window.api.cast.load(data);
    }

    onDevices(cb: (devices: CastDevice[]) => void) {
        window.api.castListener.rendererCastDevices(cb);
    }

    onDisconnected(cb: () => void) {
        window.api.castListener.rendererCastDisconnected(cb);
    }

    onError(cb: (message: string) => void) {
        window.api.castListener.rendererCastError(cb);
    }

    onStatus(cb: (status: any) => void) {
        window.api.castListener.rendererCastStatus(cb);
    }

    pause() {
        window.api.cast.pause();
    }

    play() {
        window.api.cast.play();
    }

    queueInsert(data: CastQueueInsertData) {
        window.api.cast.queueInsert(data);
    }

    queueRemove(itemIds: number[]) {
        window.api.cast.queueRemove(itemIds);
    }

    seek(seconds: number) {
        window.api.cast.seek(seconds);
    }

    setVolume(level: number) {
        window.api.cast.setVolume(level);
    }
}

const RECONNECT_DELAY_MS = 3000;

class WsCastTransport implements CastTransport {
    private deviceListeners: ((devices: CastDevice[]) => void)[] = [];

    private disconnectedListeners: (() => void)[] = [];

    private errorListeners: ((message: string) => void)[] = [];

    private pending = new Map<string, (message: any) => void>();

    private reqCounter = 0;

    private statusListeners: ((status: any) => void)[] = [];

    private url = window.CAST_SERVER_URL;

    private ws: null | WebSocket = null;

    connect(deviceId: string) {
        return this.sendWithReply<{ device: CastDevice | null }>({
            deviceId,
            type: 'cast-connect',
        }).then((res) => res.device);
    }

    disconnect() {
        this.send({ type: 'cast-disconnect' });
    }

    discoverStart() {
        this.ensureConnected();
        this.send({ type: 'cast-discover-start' });
    }

    discoverStop() {
        this.send({ type: 'cast-discover-stop' });
    }

    load(data: CastLoadData) {
        return this.sendWithReply<{ status: unknown }>({ data, type: 'cast-load' }).then(
            (res) => res.status,
        );
    }

    onDevices(cb: (devices: CastDevice[]) => void) {
        this.deviceListeners.push(cb);
    }

    onDisconnected(cb: () => void) {
        this.disconnectedListeners.push(cb);
    }

    onError(cb: (message: string) => void) {
        this.errorListeners.push(cb);
    }

    onStatus(cb: (status: any) => void) {
        this.statusListeners.push(cb);
    }

    pause() {
        this.send({ type: 'cast-pause' });
    }

    play() {
        this.send({ type: 'cast-play' });
    }

    queueInsert(data: CastQueueInsertData) {
        this.send({ data, type: 'cast-queue-insert' });
    }

    queueRemove(itemIds: number[]) {
        this.send({ itemIds, type: 'cast-queue-remove' });
    }

    seek(seconds: number) {
        this.send({ seconds, type: 'cast-seek' });
    }

    setVolume(level: number) {
        this.send({ level, type: 'cast-set-volume' });
    }

    private ensureConnected() {
        const url = this.url;
        if (!url || this.ws) return;

        const socket = new WebSocket(url);
        this.ws = socket;

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);

            if (message.reqId && this.pending.has(message.reqId)) {
                this.pending.get(message.reqId)!(message);
                this.pending.delete(message.reqId);
                return;
            }

            switch (message.type) {
                case 'renderer-cast-devices':
                    this.deviceListeners.forEach((cb) => cb(message.devices));
                    break;
                case 'renderer-cast-disconnected':
                    this.disconnectedListeners.forEach((cb) => cb());
                    break;
                case 'renderer-cast-error':
                    this.errorListeners.forEach((cb) => cb(message.message));
                    break;
                case 'renderer-cast-status':
                    this.statusListeners.forEach((cb) => cb(message.status));
                    break;
            }
        };

        socket.onclose = () => {
            this.ws = null;
            setTimeout(() => this.ensureConnected(), RECONNECT_DELAY_MS);
        };
    }

    private send(message: Record<string, unknown>) {
        this.ensureConnected();
        this.ws?.addEventListener(
            'open',
            () => {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify(message));
                }
            },
            { once: true },
        );

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    private sendWithReply<T>(message: Record<string, unknown>): Promise<T> {
        const reqId = String(this.reqCounter++);

        return new Promise((resolve) => {
            this.pending.set(reqId, resolve);
            this.send({ ...message, reqId });
        });
    }
}

let transport: CastTransport | null = null;

export function getCastTransport(): CastTransport {
    if (!transport) {
        transport = isElectron() ? new ElectronCastTransport() : new WsCastTransport();
    }

    return transport;
}
