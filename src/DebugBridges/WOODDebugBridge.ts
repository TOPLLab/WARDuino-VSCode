import {EmulatedDebugBridge} from "./EmulatedDebugBridge";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {exec} from "child_process";
import {SourceMap} from "../State/SourceMap";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {EventsProvider} from "../Views/EventsProvider";
import {ProxyCallItem} from "../Views/ProxyCallsProvider";

export class WOODDebugBridge extends EmulatedDebugBridge {
    private readonly outOfThings: string;
    private host: string = "";
    private port: string = "";

    constructor(wasmPath: string, sourceMap: SourceMap | void, eventsProvider: EventsProvider | void, tmpdir: string, listener: DebugBridgeListener,
                warduinoSDK: string, outOfThings: string) {
        super(wasmPath, sourceMap, eventsProvider, tmpdir, listener, warduinoSDK);
        this.outOfThings = outOfThings;
    }

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

        const command = `${InterruptTypes.interruptRecvCallbackmapping}${woodState.callbacks} \n`;
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

    // Send new proxy call list to the emulator
    public async specifyProxyCalls() {
        const primitives = this.getSelectedProxies();
        const message: string = await new Promise((resolve, reject) => {
            exec(`cd ${this.outOfThings}/warduino; python3 -c "import cli;cli.encode_monitor_proxies('${this.host}', ${this.port}, [${primitives}])"`, (err, stdout, stderr) => {
                resolve(stdout);
                console.error(stderr);
                if (err) {
                    reject(err.message);
                }
            });
            // TODO remove need for python script
        });
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
