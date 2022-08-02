import {HardwareDebugBridge} from "./HardwareDebugBridge";
import {InterruptTypes} from "./InterruptTypes";
import * as vscode from "vscode";

export interface Socket {
    host: string,
    port: string
}

export class ProxyDebugBridge extends HardwareDebugBridge {
    private socket: Socket = {host: "", port: "8080"};  // TODO host?

    async connect(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            // Connect
            await new Promise((_resolve, _reject) => {
                this.openSerialPort(_reject, _resolve);
            });
            // Dronify
            await this.dronify();
            this.client?.removeAllListeners();
            this.installInputStreamListener();
            resolve("");
        });
    }

    private async dronify(): Promise<void> {
        this.client?.on("data", data => {
            console.log(`hardware: ${data}`);
        });
        const config = vscode.workspace.getConfiguration();
        const message = `${InterruptTypes.interruptDronify}${
            Buffer.from(config.get("warduino.SSID") as string).toString("hex")}00${
            Buffer.from(config.get("warduino.Password") as string).toString("hex")}00 \n`;
        this.client?.write(message);
        return new Promise<void>(resolve => {
            this.client?.on("data", data => {
                if (data.toString().includes("Dronified")) {
                    resolve();
                }
            });
        });
    }

    public getSocket(): Socket {
        return this.socket;
    }
}
