import {EmulatedDebugBridge} from "./EmulatedDebugBridge";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {ProxyCallItem} from "../Views/ProxyCallsProvider";

export class WOODDebugBridge extends EmulatedDebugBridge {
    todo_remove_sendCallbacks(callbacks: string): void {
        this.pushCallbacks(callbacks);
    }

    private host: string = "";
    private port: string = "";

    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let offset = await this.getOffset();

        this.listener.notifyProgress("Pushing State to Emulator");

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

    // Send socket of the proxy to the emulator
    public async specifySocket(host: string, port: string) {
        if (host.length === 0 || port.length === 0) {
            return;
        }

        this.host = host;
        this.port = port;

        console.log(`Connected to proxy (${host}:${port}).`);
        await this.specifyProxyCalls();
    }

    private monitorProxiesCommand(primitives: number[]): string {
        function encode(i: number, byteLength: number, byteorder = 'big'): string {
            const result: Buffer = new Buffer(byteLength);
            result.writeIntBE(i, 0, byteLength);
            return result.toString("hex");
        }

        let command = InterruptTypes.interruptMonitorProxies + encode(primitives.length, 4);
        for (const primitive of primitives) {
            command += encode(primitive, 4);
        }
        command += encode(+this.port, 4);
        command += encode(this.host.length, 1);
        command += Buffer.from(this.host).toString("hex");
        command += ' \n';
        return command.toUpperCase();
    }

    // Send new proxy call list to the emulator
    public async specifyProxyCalls() {
        const primitives = this.getSelectedProxies();
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
}
