import { useShallow } from 'zustand/react/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { CastDevice } from '/@/shared/types/types';

interface CastActions {
    setAvailableDevices: (devices: CastDevice[]) => void;
    setConnectedDevice: (device: CastDevice | null) => void;
    setConnecting: (connecting: boolean) => void;
}

interface CastState {
    availableDevices: CastDevice[];
    connectedDevice: CastDevice | null;
    connecting: boolean;
}

export const useCastStore = createWithEqualityFn<CastActions & CastState>()((set) => ({
    availableDevices: [],
    connectedDevice: null,
    connecting: false,

    setAvailableDevices: (devices) => {
        set({ availableDevices: devices });
    },

    setConnectedDevice: (device) => {
        set({ connectedDevice: device, connecting: false });
    },

    setConnecting: (connecting) => {
        set({ connecting });
    },
}));

// Selectors
export const useIsCasting = () => useCastStore((s) => Boolean(s.connectedDevice));
export const useCastConnectedDevice = () => useCastStore((s) => s.connectedDevice);
export const useCastConnecting = () => useCastStore((s) => s.connecting);
export const useCastAvailableDevices = () => useCastStore((s) => s.availableDevices);
export const useCastActions = () =>
    useCastStore(
        useShallow((s) => ({
            setAvailableDevices: s.setAvailableDevices,
            setConnectedDevice: s.setConnectedDevice,
            setConnecting: s.setConnecting,
        })),
    );
