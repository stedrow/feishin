import { ipcMain } from 'electron';

import { getMainWindow } from '../../../index';
import { createLog } from '../../../utils';
import { CastCore, CastLoadData, CastQueueInsertData } from './cast-core';

import { CastDevice } from '/@/shared/types/types';

const core = new CastCore((message, isError) => {
    createLog({ message: `[CAST] ${message}`, type: isError ? 'error' : 'info' });
});

core.on('devices', (devices: CastDevice[]) => {
    getMainWindow()?.webContents.send('renderer-cast-devices', devices);
});

core.on('status', (status: unknown) => {
    getMainWindow()?.webContents.send('renderer-cast-status', status);
});

core.on('disconnected', () => {
    getMainWindow()?.webContents.send('renderer-cast-disconnected');
});

core.on('error', (message: string) => {
    getMainWindow()?.webContents.send('renderer-cast-error', message);
});

ipcMain.on('cast-discover-start', () => {
    core.discoverStart();
});

ipcMain.on('cast-discover-stop', () => {
    core.discoverStop();
});

ipcMain.handle('cast-connect', async (_event, deviceId: string): Promise<CastDevice | null> => {
    return core.connect(deviceId);
});

ipcMain.on('cast-disconnect', () => {
    core.disconnect();
});

ipcMain.handle('cast-get-status', (): CastDevice | null => core.getStatus());

ipcMain.handle('cast-load', async (_event, data: CastLoadData) => {
    return core.load(data);
});

ipcMain.on('cast-play', () => {
    core.play();
});

ipcMain.on('cast-pause', () => {
    core.pause();
});

ipcMain.on('cast-seek', (_event, seconds: number) => {
    core.seek(seconds);
});

ipcMain.on('cast-set-volume', (_event, level: number) => {
    core.setVolume(level);
});

ipcMain.on('cast-queue-insert', (_event, data: CastQueueInsertData) => {
    core.queueInsert(data);
});

ipcMain.on('cast-queue-remove', (_event, itemIds: number[]) => {
    core.queueRemove(itemIds);
});
