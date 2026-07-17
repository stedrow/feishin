import Bonjour from 'bonjour-service';
import { Client, DefaultMediaReceiver } from 'castv2-client';
import { EventEmitter } from 'events';

import { CastDevice, CastQueueItem } from '/@/shared/types/types';

const GOOGLECAST_SERVICE_TYPE = 'googlecast';
const STATUS_POLL_INTERVAL_MS = 1000;

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

// Electron-agnostic castv2/bonjour session logic, shared by the Electron main
// process IPC adapter (./index.ts) and the standalone WebSocket cast-server
// (src/cast-server/index.ts) — see docs/plan for why casting needs two transports.
export class CastCore extends EventEmitter {
    private bonjour: Bonjour | null = null;

    private browser: null | ReturnType<Bonjour['find']> = null;

    private client: InstanceType<typeof Client> | null = null;

    private connectedDevice: CastDevice | null = null;

    private discoveredDevices = new Map<string, CastDevice>();

    private player: InstanceType<typeof DefaultMediaReceiver> | null = null;

    private statusPollTimer: NodeJS.Timeout | null = null;

    constructor(private log: (message: string, isError?: boolean) => void = () => {}) {
        super();
    }

    connect(deviceId: string): Promise<CastDevice | null> {
        const device = this.discoveredDevices.get(deviceId);

        if (!device) {
            this.log(`Unknown device id ${deviceId}`, true);
            return Promise.resolve(null);
        }

        this.teardownSession();

        return new Promise((resolve) => {
            const newClient = new Client();

            newClient.on('error', (err: Error) => {
                this.log(`Client error - ${err.message}`, true);
                this.emit('error', err.message);
                this.teardownSession();
                this.emit('disconnected');
            });

            newClient.connect({ host: device.host, port: device.port }, () => {
                newClient.launch(
                    DefaultMediaReceiver,
                    (err: Error | null, newPlayer: InstanceType<typeof DefaultMediaReceiver>) => {
                        if (err) {
                            this.log(`Failed to launch media receiver - ${err.message}`, true);
                            newClient.close();
                            resolve(null);
                            return;
                        }

                        this.client = newClient;
                        this.player = newPlayer;
                        this.connectedDevice = device;

                        newPlayer.on('status', (status: unknown) => {
                            this.emit('status', status);
                        });

                        this.startStatusPoll();
                        this.log(`Connected to ${device.name}`);
                        resolve(device);
                    },
                );
            });
        });
    }

    disconnect() {
        if (this.player) {
            this.player.stop(() => {
                this.teardownSession();
            });
        } else {
            this.teardownSession();
        }
    }

    discoverStart() {
        if (this.bonjour) {
            this.emit('devices', Array.from(this.discoveredDevices.values()));
            return;
        }

        this.bonjour = new Bonjour();
        this.browser = this.bonjour.find({ protocol: 'tcp', type: GOOGLECAST_SERVICE_TYPE });

        this.browser.on('up', (service: any) => {
            const device = serviceToDevice(service);
            this.discoveredDevices.set(device.id, device);
            this.emit('devices', Array.from(this.discoveredDevices.values()));
        });

        this.browser.on('down', (service: any) => {
            const device = serviceToDevice(service);
            this.discoveredDevices.delete(device.id);
            this.emit('devices', Array.from(this.discoveredDevices.values()));
        });
    }

    discoverStop() {
        this.browser?.stop();
        this.browser = null;
        this.bonjour?.destroy();
        this.bonjour = null;
        this.discoveredDevices.clear();
    }

    getStatus(): CastDevice | null {
        return this.connectedDevice;
    }

    load(data: CastLoadData): Promise<unknown> {
        if (!this.player) return Promise.resolve(null);

        const autoplay = data.autoplay ?? true;
        const items = data.items.map((item) => ({ ...toCastMediaItem(item), autoplay }));

        this.log(`queueLoad sending ${items.length} items, startIndex ${data.startIndex ?? 0}`);

        return new Promise((resolve, reject) => {
            this.player!.queueLoad(
                items,
                { currentTime: data.currentTime ?? 0, startIndex: data.startIndex ?? 0 },
                (err: Error | null, status: any) => {
                    if (err) {
                        this.log(`queueLoad failed - ${err.message}`, true);
                        reject(err);
                        return;
                    }
                    this.log(
                        `queueLoad response: ${status?.items?.length ?? 0} items, currentItemId=${status?.currentItemId}, supportedMediaCommands=${status?.supportedMediaCommands}`,
                    );
                    resolve(status);
                },
            );
        });
    }

    pause() {
        this.safeSessionCall('pause', () => this.player?.pause(() => {}));
    }

    play() {
        this.safeSessionCall('play', () => this.player?.play(() => {}));
    }

    queueInsert(data: CastQueueInsertData) {
        if (!this.player) return;

        const items = data.items.map((item) => toCastMediaItem(item));
        this.safeSessionCall('queueInsert', () =>
            this.player!.queueInsert(items, { insertBefore: data.insertBefore }, () => {}),
        );
    }

    queueRemove(itemIds: number[]) {
        this.safeSessionCall('queueRemove', () => this.player?.queueRemove(itemIds, {}, () => {}));
    }

    seek(seconds: number) {
        this.safeSessionCall('seek', () =>
            this.player?.seek(seconds, (err: Error | null) => {
                if (err) this.log(`seek failed - ${err.message}`, true);
            }),
        );
    }

    setVolume(level: number) {
        this.client?.setVolume({ level: Math.min(1, Math.max(0, level)) }, () => {});
    }

    // castv2-client's MediaController throws synchronously (rather than passing an
    // error to the callback) if a command is sent before the receiver's media session
    // is established yet — easy to hit from rapid track changes/transport clicks right
    // after connecting. Without this, that throw is uncaught and kills the process.
    private safeSessionCall(action: string, fn: () => void) {
        try {
            fn();
        } catch (err) {
            this.log(`${action} failed (no active session yet) - ${(err as Error).message}`, true);
        }
    }

    private startStatusPoll() {
        this.stopStatusPoll();
        this.statusPollTimer = setInterval(() => {
            this.player?.getStatus((err: Error | null, status: unknown) => {
                if (!err && status) {
                    this.emit('status', status);
                }
            });
        }, STATUS_POLL_INTERVAL_MS);
    }

    private stopStatusPoll() {
        if (this.statusPollTimer) {
            clearInterval(this.statusPollTimer);
            this.statusPollTimer = null;
        }
    }

    private teardownSession() {
        this.stopStatusPoll();
        this.player = null;

        if (this.client) {
            try {
                this.client.close();
            } catch {
                // Ignore, socket may already be closed
            }
        }

        this.client = null;
        this.connectedDevice = null;
    }
}

function serviceToDevice(service: any): CastDevice {
    const host = service.addresses?.[0] ?? service.host;
    return {
        host,
        id: service.txt?.id ?? service.fqdn,
        name: service.txt?.fn ?? service.name,
        port: service.port,
    };
}

function toCastMediaItem(item: CastQueueItem) {
    return {
        media: {
            contentId: item.contentId,
            contentType: item.contentType,
            metadata: {
                images: item.imageUrl ? [{ url: item.imageUrl }] : [],
                metadataType: 3,
                songName: item.title,
                subtitle: item.album,
                title: item.title,
                type: 0,
            },
            streamType: 'BUFFERED',
        },
    };
}
