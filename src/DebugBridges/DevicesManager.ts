import { DebugBridge } from "./DebugBridge";

export class DevicesManager {
    private devices: DebugBridge[] = [];
    private activeDevice: number = -1;

    public addDevice(bridge: DebugBridge) {
        if (!this.hasDevice(bridge)) {
            this.devices.push(bridge);
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
            return b == bridge;
        })
    }
}