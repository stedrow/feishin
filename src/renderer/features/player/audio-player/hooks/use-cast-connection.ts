import { useEffect } from 'react';

import { getCastTransport } from '/@/renderer/features/player/audio-player/cast-transport';
import { useCastActions } from '/@/renderer/store/cast.store';
import { toast } from '/@/shared/components/toast/toast';

// Always mounted (regardless of whether a Cast session is active) so device
// discovery and disconnect/error events are handled even while CastPlayer isn't rendered.
export const CastConnectionHook = () => {
    const { setAvailableDevices, setConnectedDevice } = useCastActions();

    useEffect(() => {
        const transport = getCastTransport();

        transport.onDevices((devices) => {
            setAvailableDevices(devices);
        });

        transport.onDisconnected(() => {
            setConnectedDevice(null);
        });

        transport.onError((message) => {
            toast.error({ message: `Cast error: ${message}` });
            setConnectedDevice(null);
        });

        transport.discoverStart();

        return () => {
            transport.discoverStop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
};
