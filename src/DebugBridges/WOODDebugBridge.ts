import { EmulatedDebugBridge } from "./EmulatedDebugBridge";
import { WOODState } from "../State/WOODState";
import { InterruptTypes } from "./InterruptTypes";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { ChildProcess, spawn } from "child_process";
import * as vscode from 'vscode';

export class WOODDebugBridge extends EmulatedDebugBridge {

    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        const messages: string[] = woodState.toBinary();
        console.log(`sending ${messages.length} messages as new State\n`);
        for (let i = 0; i < messages.length; i++) {
            this.client?.write(messages[i]);
        }

        this.pushCallbacks(woodState.callbacks);
    }

    private pushCallbacks(callbacks: string) {
        const command = `${InterruptTypes.interruptRecvCallbackmapping}${callbacks} \n`;
        console.log(`send 75 message: ${command}`);
        this.client?.write(command);
    }

    private monitorProxiesCommand(primitives: number[]): string {
        function encode(i: number, byteLength: number, byteorder = 'big'): string {
            const result: Buffer = Buffer.alloc(byteLength);
            result.writeIntBE(i, 0, byteLength);
            return result.toString("hex");
        }

        let command = InterruptTypes.interruptMonitorProxies + encode(primitives.length, 4);
        for (const primitive of primitives) {
            command += encode(primitive, 4);
        }
        command += ' \n';
        return command.toUpperCase();
    }

    // Send new proxy call list to the emulator
    public async specifyProxyCalls() {
        const primitives = this.getSelectedProxiesByIndex();
        const message: string = this.monitorProxiesCommand(primitives);
        this.client?.write(message);
    }

    async updateSelectedProxies(proxy: ProxyCallItem) {
        console.log("Updating proxies");
        if (proxy.isSelected()) {
            this.selectedProxies.add(proxy);
        } else {
            this.selectedProxies.delete(proxy);
        }
        await this.specifyProxyCalls();
    };

    protected spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        const port: string = vscode.workspace.getConfiguration().get("warduino.Port") ?? "/dev/ttyUSB0";
        const baudrate: string = vscode.workspace.getConfiguration().get("warduino.Baudrate") ?? "115200";
        const args: string[] = [`${this.tmpdir}/upload.wasm`, '--socket', `${this.deviceConfig.port}`];

        if (this.deviceConfig.needsProxyToAnotherVM()) {
            const ip = this.deviceConfig.proxyConfig?.ip;
            if (!!ip && ip !== "") {
                args.push("--proxy", `${this.deviceConfig.proxyConfig?.ip}:${this.deviceConfig.proxyConfig?.port}`);
            }
            else {
                args.push("--proxy", port, "--baudrate", baudrate);
            }
        }

        if (this.deviceConfig.onStartConfig.pause) {
            args.push("--paused");
        }
        return spawn(`${this.sdk}/build-emu/wdcli`, args);
        // return spawn(`echo`, ['"Listening"']);
    }
}