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
                console.log(`parseoffset: ${data.toString().split("\n").length} ${data}`);
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
        let binary: string = await woodState.toBinary(offset);
        let command = `${InterruptTypes.interruptWOODRecvState}${binary} \n`;
        this.client?.write(command);
    }
}