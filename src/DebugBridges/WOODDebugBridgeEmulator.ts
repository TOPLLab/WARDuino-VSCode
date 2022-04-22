import {WARDuinoDebugBridgeEmulator} from "./WARDuinoDebugBridgeEmulator";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {spawn} from "child_process";

export class WOODDebugBridgeEmulator extends WARDuinoDebugBridgeEmulator {
    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let offset = await this.getOffset();

        const messages: string[] = await woodState.toBinary(offset);
        for (let i = 0; i < messages.length; i++) {
            console.log(`send 62 message: ${messages[i]}\n`);
            this.client?.write(`${messages[i]} \n`);
        }
    }

    public async specifyPrimitives(host: string, port: string) {
        let primitives = [0, 1, 2]; // TODO get list from UI
        let message: string = await new Promise((resolve, reject) => {
            let process = spawn(`python3 -c "import cli;cli.encode_monitor_proxies('${host}', '${port}', [${primitives}])"`, {
                cwd: "/home/tolauwae/Documents/out-of-things/warduino"  // TODO add to config (or better yet remove need for python script)
            });

            process.stdout?.on("data", (data: Buffer) => {
                resolve(data.toString());
            });

            process.stderr?.on("data", (data) => {
                console.log(`stderr: ${data}`);
                reject(data);
            });
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
}