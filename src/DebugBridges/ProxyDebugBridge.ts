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
                this.listener.notifyProgress("Opening Serial Connection to MCU [4\..]");
                this.openSerialPort(_reject, _resolve);
            });
            // Dronify
            this.listener.notifyProgress("Enabling WiFi on MCU");
            const host: string = await this.dronify();
            this.listener.notifyProgress("WiFi enabled on MCU");
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
        console.log("Plugin: sending SSID and PSWD");
        this.client?.write(message);
        return new Promise<string>(resolve => {
            let alldata = '';
            this.client?.on("data", data => {
                alldata += data.toString();
                console.log(`Buffering WiFi IP buffer=${alldata}`);
                const search = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.exec(alldata);
                if (this.socket.host.length === 0 && search !== null) {
                    this.socket.host = search && search.length > 0 ? search[0] : "";
                    console.log("MCU IP Address Received");
                    resolve(this.socket.host);
                }
            });
        });
    }

    public getSocket(): Socket {
        return this.socket;
    }

    protected handleLine(line: string): void {
        if (line.startsWith('{"callbacks": ')) {
            this.listener.todoremove_sendCallbacks(line);
        }
        super.handleLine(line);
    }
}
