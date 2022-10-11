import {EmulatedDebugBridge, EMULATOR_PORT} from "./EmulatedDebugBridge";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {ProxyCallItem} from "../Views/ProxyCallsProvider";
import {ChildProcess, spawn} from "child_process";
import * as vscode from 'vscode';

export class WOODDebugBridge extends EmulatedDebugBridge {

    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let offset = await this.getOffset();

        const messages: string[] = await woodState.toBinary(this.tmpdir, offset).catch(reason => {
            throw new Error(`Plugin: toBinary failed: ${reason}`);
        }) ?? [];
        for (let i = 0; i < messages.length; i++) {
            console.log(`send 62 message: ${messages[i]}\n`);
            this.client?.write(`${messages[i]} \n`);
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

    private getOffset(): Promise<string> {
        let that = this;
        this.sendInterrupt(InterruptTypes.interruptOffset);
        return new Promise<string>((resolve, reject) => {
            function parseOffset(data: Buffer) {
                console.log(`parse offset: ${data.toString().split("\n").length} ${data}`);
                data.toString().split("\n").forEach((line) => {
                    console.log(line);
                    if (line.startsWith("{")) {
                        that.client?.removeListener("data", parseOffset);
                        resolve(JSON.parse(line).offset);
                    }
                });
            }

            this.client?.on("data", parseOffset);
        });
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
        return spawn(`${this.sdk}/build-emu/wdcli`, ['--file', `${this.tmpdir}/upload.wasm`, '--proxy', port, '--socket', `${EMULATOR_PORT}`]);
        // return spawn(`echo`, ['"Listening"']);
    }
}
