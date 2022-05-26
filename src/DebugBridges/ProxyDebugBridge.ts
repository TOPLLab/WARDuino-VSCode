import {HardwareDebugBridge} from "./HardwareDebugBridge";
import {exec} from "child_process";
import {Messages} from "./AbstractDebugBridge";

export interface Socket {
    host: string,
    port: string
}

export class ProxyDebugBridge extends HardwareDebugBridge {
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

    protected async openSerialPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        const that = this;
        new Promise((resolve1, reject1) => super.openSerialPort(reject1, resolve1)).then(() => {
            that.client?.on("data", data => {
                const text = data.toString();
                const search = /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.exec(text);
                if (that.socket.host.length === 0 && search !== null) {
                    that.socket.host = search && search.length > 0 ? search[0] : "";
                    resolve(that.socket.host);
                }
            });
        }).catch(reason => reject(reason));
    }

    public getSocket(): Socket {
        return this.socket;
    }
}
