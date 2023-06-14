import { DebugBridge } from './DebugBridge';

export class DevicesManager {
    private devices: DebugBridge[] = [];
    private activeDevice: number = -1;
    private proxies: Map<DebugBridge, DebugBridge> = new Map();
    private emulators: Map<DebugBridge, DebugBridge> = new Map();

    public addDevice(bridge: DebugBridge, proxyBridge?: DebugBridge) {
        if (!this.hasDevice(bridge)) {
            this.devices.push(bridge);
            if (proxyBridge) {
                this.proxies.set(bridge, proxyBridge);
                this.emulators.set(proxyBridge, bridge);
            }
        }
    }

    public getDevice(idx: number): DebugBridge | undefined {
        if (idx < 0 || idx >= this.devices.length) {
            return undefined;
        }
        return this.devices[idx];
    }

    public hasDevice(bridge: DebugBridge): DebugBridge | undefined {
        return this.devices.find(b => {
            return b === bridge;
        });
    }

    public hasProxy(bridge: DebugBridge): boolean {
        return this.proxies.has(bridge);
    }

    public getProxyBridge(bridge: DebugBridge): DebugBridge | undefined {
        return this.proxies.get(bridge);
    }

    public getEmulatorBridge(bridge: DebugBridge): DebugBridge | undefined {
        return this.emulators.get(bridge);
    }
}