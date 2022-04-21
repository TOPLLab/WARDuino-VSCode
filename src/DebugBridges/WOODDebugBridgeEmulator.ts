import {WARDuinoDebugBridgeEmulator} from "./WARDuinoDebugBridgeEmulator";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";

export class WOODDebugBridgeEmulator extends WARDuinoDebugBridgeEmulator {
    public async pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let that = this;
        let offset = "";
        this.sendInterrupt(InterruptTypes.interruptOffset);
        offset = await new Promise<string>((resolve, reject) => {
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

        const binary: string = await woodState.toBinary(offset);
        let messages = Buffer.from(binary, "base64").toString("ascii").split("\n");
        for (let i = 0; i < messages.length; i++) {
            console.log(`send 62 message: ${messages[i]}\n`);
            this.client?.write(`${messages[i]} \n`);
        }
    }

    // TODO proxies
}