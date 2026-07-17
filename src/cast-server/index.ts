import { WebSocket, WebSocketServer } from 'ws';

import { CastCore } from '../main/features/core/cast/cast-core';

import { CastClientMessage, CastServerMessage } from '/@/shared/types/cast-protocol';

const PORT = Number(process.env.CAST_SERVER_PORT ?? 9181);

// ponytail: castv2-client sometimes throws synchronously from inside its own async
// message-event handlers (e.g. a response missing the `status` array it expects during
// rapid track-change/transport bursts) rather than passing an error to the callback —
// those throws happen outside our call stack, so try/catch at the call site can't reach
// them. This is the backstop so one bad callback can't take the whole bridge down;
// the real fix would be hardening castv2-client itself.
process.on('uncaughtException', (err) => {
    console.error(`[CAST] uncaught error (ignored, server stays up) - ${err.message}`);
});

const core = new CastCore((message, isError) => {
    console[isError ? 'error' : 'log'](`[CAST] ${message}`);
});

const wss = new WebSocketServer({ port: PORT });

function broadcast(message: CastServerMessage) {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

core.on('devices', (devices) => broadcast({ devices, type: 'renderer-cast-devices' }));
core.on('status', (status) => broadcast({ status, type: 'renderer-cast-status' }));
core.on('disconnected', () => broadcast({ type: 'renderer-cast-disconnected' }));
core.on('error', (message: string) => broadcast({ message, type: 'renderer-cast-error' }));

wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
        let message: CastClientMessage;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        switch (message.type) {
            case 'cast-connect': {
                const device = await core.connect(message.deviceId);
                ws.send(
                    JSON.stringify({
                        device,
                        reqId: message.reqId,
                        type: 'cast-connect-result',
                    } satisfies CastServerMessage),
                );
                break;
            }
            case 'cast-disconnect':
                core.disconnect();
                break;
            case 'cast-discover-start':
                core.discoverStart();
                break;
            case 'cast-discover-stop':
                core.discoverStop();
                break;
            case 'cast-get-status':
                ws.send(
                    JSON.stringify({
                        device: core.getStatus(),
                        reqId: message.reqId,
                        type: 'cast-get-status-result',
                    } satisfies CastServerMessage),
                );
                break;
            case 'cast-load': {
                const status = await core.load(message.data);
                ws.send(
                    JSON.stringify({
                        reqId: message.reqId,
                        status,
                        type: 'cast-load-result',
                    } satisfies CastServerMessage),
                );
                break;
            }
            case 'cast-pause':
                core.pause();
                break;
            case 'cast-play':
                core.play();
                break;
            case 'cast-queue-insert':
                core.queueInsert(message.data);
                break;
            case 'cast-queue-remove':
                core.queueRemove(message.itemIds);
                break;
            case 'cast-seek':
                core.seek(message.seconds);
                break;
            case 'cast-set-volume':
                core.setVolume(message.level);
                break;
        }
    });
});

console.log(`[CAST] cast-server listening on port ${PORT}`);
