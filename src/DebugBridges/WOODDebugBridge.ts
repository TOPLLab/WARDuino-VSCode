import {EmulatedDebugBridge} from "./EmulatedDebugBridge";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {exec} from "child_process";
import {FunctionInfo} from "../State/FunctionInfo";
import {SourceMap} from "../State/SourceMap";
import {DebugBridgeListener} from "./DebugBridgeListener";

export class WOODDebugBridge extends EmulatedDebugBridge {
    private readonly outOfThings: string;

    constructor(wasmPath: string, sourceMap: SourceMap | void, tmpdir: string, listener: DebugBridgeListener,
                warduinoSDK: string, outOfThings: string) {
        super(wasmPath, sourceMap, tmpdir, listener, warduinoSDK);
        this.outOfThings = outOfThings;
    }

    private getPrimitives(): number[] {
        return this.sourceMap?.importInfos.map((primitive: FunctionInfo) => (primitive.index)) ?? [];
    }

    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let offset = await this.getOffset();

        const messages: string[] = await woodState.toBinary(offset);
        for (let i = 0; i < messages.length; i++) {
            console.log(`send 62 message: ${messages[i]}\n`);
            this.port?.write(`${messages[i]} \n`);
        }
    }

    public async specifyPrimitives(host: string, port: string) {
        if (host.length === 0 || port.length === 0) {
            return;
        }

        console.log(`Connected to drone (${host}:${port}).`);
        const primitives = this.getPrimitives();  // TODO filter in GUI
        const message: string = await new Promise((resolve, reject) => {
            exec(`cd ${this.outOfThings}/warduino; python3 -c "import cli;cli.encode_monitor_proxies('${host}', ${port}, [${primitives}])"`, (err, stdout, stderr) => {
                resolve(stdout);
                console.error(stderr);
                if (err) {
                    reject(err.message);
                }
            });
            // TODO remove need for python script
        });
        this.port?.write(message);
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
                        that.port?.removeListener("data", parseOffset);
                        resolve(JSON.parse(line).offset);
                    }
                });
            }

            this.port?.on("data", parseOffset);
        });
    }
}
