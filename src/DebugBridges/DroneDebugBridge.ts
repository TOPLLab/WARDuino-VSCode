import {WARDuinoDebugBridge} from "./WARDuinoDebugBridge";
import {exec} from "child_process";

export interface Socket {
    host: string,
    port: string
}

export class DroneDebugBridge extends WARDuinoDebugBridge {
    private socket: Socket = {host: "", port: "8080"};  // TODO host?

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const sdkpath: string = this.sdk + "/platforms/Arduino-socket/";
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);

            cp.on("error", err => {
                resolve(false);
            });
            cp.on("close", (code) => {
                this.compileArduino(sdkpath, resolve);
            });
        });
    }

    public getSocket(): Socket {
        return this.socket;
    }
}