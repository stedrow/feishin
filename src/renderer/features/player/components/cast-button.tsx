import { useTranslation } from 'react-i18next';

import { getCastTransport } from '/@/renderer/features/player/audio-player/cast-transport';
import {
    useCastActions,
    useCastAvailableDevices,
    useCastConnectedDevice,
    useCastConnecting,
} from '/@/renderer/store/cast.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Popover } from '/@/shared/components/popover/popover';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

export const CastButton = () => {
    const { t } = useTranslation();
    const connectedDevice = useCastConnectedDevice();
    const connecting = useCastConnecting();
    const availableDevices = useCastAvailableDevices();
    const { setConnectedDevice, setConnecting } = useCastActions();

    const handleConnect = async (deviceId: string) => {
        setConnecting(true);
        try {
            const device = await getCastTransport().connect(deviceId);
            if (!device) {
                toast.error({
                    message: t('common.error', { defaultValue: 'Something went wrong' }),
                });
            }
            setConnectedDevice(device);
        } catch {
            setConnectedDevice(null);
        }
    };

    const handleDisconnect = () => {
        getCastTransport().disconnect();
        setConnectedDevice(null);
    };

    return (
        <Popover position="top-end" withArrow>
            <Popover.Target>
                <ActionIcon
                    icon="cast"
                    iconProps={{ color: connectedDevice ? 'primary' : undefined, size: 'lg' }}
                    loading={connecting}
                    onClick={(e) => e.stopPropagation()}
                    size="sm"
                    tooltip={{ label: connectedDevice?.name ?? 'Cast', openDelay: 0 }}
                    variant="subtle"
                />
            </Popover.Target>
            <Popover.Dropdown miw={200} onClick={(e) => e.stopPropagation()} p="sm">
                <Stack gap="xs">
                    {connectedDevice ? (
                        <>
                            <Text isNoSelect size="sm">
                                {connectedDevice.name}
                            </Text>
                            <Text
                                isNoSelect
                                onClick={handleDisconnect}
                                size="sm"
                                style={{ cursor: 'pointer', opacity: 0.7 }}
                            >
                                {t('common.disconnect', { defaultValue: 'Disconnect' })}
                            </Text>
                        </>
                    ) : availableDevices.length > 0 ? (
                        availableDevices.map((device) => (
                            <Text
                                isNoSelect
                                key={device.id}
                                onClick={() => handleConnect(device.id)}
                                size="sm"
                                style={{ cursor: 'pointer' }}
                            >
                                {device.name}
                            </Text>
                        ))
                    ) : (
                        <Text isNoSelect size="sm">
                            {t('common.noDevicesFound', { defaultValue: 'No devices found' })}
                        </Text>
                    )}
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};
