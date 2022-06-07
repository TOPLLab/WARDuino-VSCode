import {HardwareDebugBridge} from "./HardwareDebugBridge";
import {InterruptTypes} from "./InterruptTypes";
import * as vscode from "vscode";
import { WOODDebugBridge } from "./WOODDebugBridge";

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
            const host: string = await this.dronify();
            this.client?.removeAllListeners();
            this.installInputStreamListener();
            resolve(host);
        });
    }

    private async dronify(): Promise<string> {
        this.client?.on("data", data => {
            console.log(`hardware: ${data}`);
        });
        const config = vscode.workspace.getConfiguration();
        const message = `${InterruptTypes.interruptDronify}${
            Buffer.from(config.get("warduino.SSID") as string).toString("hex")}00${
            Buffer.from(config.get("warduino.Password") as string).toString("hex")}00 \n`;
        this.client?.write(message);
        return new Promise<string>(resolve => {
            this.client?.on("data", data => {
                const text = data.toString();
                const search = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.exec(text);
                if (this.socket.host.length === 0 && search !== null) {
                    this.socket.host = search && search.length > 0 ? search[0] : "";
                    resolve(this.socket.host);
                }
            });
        });
    }

    protected handleLine(line: string): void {
        if(line.startsWith('{"callbacks": ')){
            this.listener.todoremove_sendCallbacks(line);
        }
        super.handleLine(line);
    }

    public getSocket(): Socket {
        return this.socket;
    }
}
