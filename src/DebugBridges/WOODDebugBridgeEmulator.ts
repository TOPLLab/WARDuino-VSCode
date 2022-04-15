import {WARDuinoDebugBridgeEmulator} from "./WARDuinoDebugBridgeEmulator";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";

export class WOODDebugBridgeEmulator extends WARDuinoDebugBridgeEmulator {
    public pushSession(woodState: WOODState) {
        console.log("Plugin: WOOD RecvState");
        let command = `${InterruptTypes.interruptWOODRecvState}${woodState.toBinary()} \n`;
        this.client?.write(command);
    }
}