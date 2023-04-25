import { EmulatedDebugBridge } from "./EmulatedDebugBridge";
import { InterruptTypes } from "./InterruptTypes";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { ChildProcess, spawn } from "child_process";
import { Request } from "./APIRequest";

export class WOODDebugBridge extends EmulatedDebugBridge {

    private monitorProxiesRequest(primitive: number[]): Request {
        return {
            dataToSend: this.monitorProxiesCommand(primitive),
            expectedResponse: (line: string) => {
                return line === "done!";
            }
        };
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
        command += '\n';
        return command.toUpperCase();
    }

    // Send new proxy call list to the emulator
    public async specifyProxyCalls() {
        const primitives = this.getSelectedProxiesByIndex();
        const req = this.monitorProxiesRequest(primitives);
        await this.client!.request(req);
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
        const emulatorPort: number = this.deviceConfig.port;
        const proxySerialPort = this.deviceConfig.proxyConfig?.serialPort;
        const proxyBaudrate = this.deviceConfig.proxyConfig?.baudrate;
        const proxyIP = this.deviceConfig.proxyConfig?.ip;
        const proxyPort = this.deviceConfig.proxyConfig?.port;
        const args: string[] = [`${this.tmpdir}/upload.wasm`, '--socket', `${emulatorPort}`];

        if (this.deviceConfig.needsProxyToAnotherVM()) {
            if (proxyIP && proxyIP !== "") {
                args.push("--proxy", `${proxyIP}:${proxyPort}`);
            }
            else if (proxySerialPort && proxySerialPort !== "") {
                args.push("--proxy", proxySerialPort, "--baudrate", `${proxyBaudrate}`);
            }
            else {
                throw Error(`cannot spawn emulator in proxy mode without serialPort or IP of target MCU.
                Given serialPort=${proxySerialPort} baudrate=${proxyBaudrate} IP=${proxyIP} IPPORT=${proxyPort}.`);
            }
        }

        if (this.deviceConfig.onStartConfig.pause) {
            args.push("--paused");
        }
        return spawn(`${this.sdk}/build-emu/wdcli`, args);
        // return spawn(`echo`, ['"Listening"']);
    }
}