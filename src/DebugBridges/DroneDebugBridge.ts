import {HardwareDebugBridge} from "./HardwareDebugBridge";
import {exec} from "child_process";
import {Messages} from "./AbstractDebugBridge";

export interface Socket {
    host: string,
    port: string
}

export class DroneDebugBridge extends HardwareDebugBridge {
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

    protected uploadArduino(path: string, resolver: (value: boolean) => void): void {
        this.listener.notifyProgress(Messages.reset);

        const upload = exec(`make flash PORT=${this.portAddress} FQBN=${this.fqbn}`, {cwd: path}, (err, stdout, stderr) => {
                console.error(err);
                this.listener.notifyProgress(Messages.initialisationFailure);
            }
        );

        upload.on("data", (data: string) => {
            this.listener.notifyProgress(Messages.uploading);
        });

        upload.on("close", (code) => {
            resolver(code === 0);
        });
    }

    protected openSerialPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        super.openSerialPort(reject, resolve);

        this.port?.on("data", data => {
            const text = data.toString();
            if (this.socket.host.length === 0 && text.search('localip') >= 0) {
                let search = /localip: ([0-9.]*)/.exec(text);
                // @ts-ignore
                this.socket.host = search && search.length > 1 ? search[1] : "";
                this.listener.connected();
            }
        });
    }

    public getSocket(): Socket {
        return this.socket;
    }
}
