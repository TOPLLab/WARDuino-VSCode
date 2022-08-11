import {AbstractDebugBridge, Messages} from "./AbstractDebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {InterByteTimeoutParser, SerialPort} from 'serialport';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {exec, spawn} from "child_process";
import {SourceMap} from "../State/SourceMap";
import {WOODState} from "../State/WOODState";
import {EventsProvider} from "../Views/EventsProvider";
import {Command} from "../Parsers/debug";

export class HardwareDebugBridge extends AbstractDebugBridge {
    private parser: DebugInfoParser = new DebugInfoParser();
    private wasmPath: string;
    protected client: SerialPort | undefined;
    protected readonly portAddress: string;
    protected readonly fqbn: string;
    protected readonly sdk: string;
    protected readonly tmpdir: string | undefined;
    private woodState?: WOODState;
    private woodDumpDetected: boolean = false;

    constructor(wasmPath: string,
                sourceMap: SourceMap | void,
                eventsProvider: EventsProvider | void,
                tmpdir: string,
                listener: DebugBridgeListener,
                portAddress: string,
                fqbn: string,
                warduinoSDK: string) {
        super(sourceMap, eventsProvider, listener);

        this.wasmPath = wasmPath;
        this.sourceMap = sourceMap;
        this.listener = listener;
        this.portAddress = portAddress;
        this.fqbn = fqbn;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;
    }

    async connect(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            this.listener.notifyProgress(Messages.compiling);
            await this.compileAndUpload();
            this.listener.notifyProgress(Messages.connecting);
            this.openSerialPort(reject, resolve);
            this.client?.on("data", (chunk: Buffer) => {
                let success: boolean = this.parser.parse(this, Uint8Array.from(chunk));
            });
            // this.installInputStreamListener();
        });
    }

    public async upload() {
        await this.compileAndUpload();
    }

    protected openSerialPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        this.client = new SerialPort({path: this.portAddress, baudRate: 115200},
            (error) => {
                if (error) {
                    reject(`Could not connect to serial port: ${this.portAddress}`);
                } else {
                    this.listener.notifyProgress(Messages.connected);
                    resolve(this.portAddress);
                }
            }
        );
    }

    protected installInputStreamListener() {
        const parser = new InterByteTimeoutParser({interval: 2 /* ms */});
        this.client?.pipe(parser);
        parser.on("data", (data: Buffer) => {
            this.parser.parse(this, Uint8Array.from(data));
        });
    }

    public disconnect(): void {
        console.error("CLOSED!");
        this.client?.close((e) => {
            console.log(e);
        });
        this.listener.notifyProgress(Messages.disconnected);
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        let lastStdOut = "";

        const upload = exec(`make flash PORT=${this.portAddress} FQBN=${this.fqbn}`, {cwd: path}, (err, stdout, stderr) => {
                console.error(err);
                lastStdOut = stdout + stderr;
                this.listener.notifyProgress(Messages.initialisationFailure);
            }
        );

        this.listener.notifyProgress(Messages.uploading);

        upload.on("close", (code) => {
            if (code === 0) {
                resolver(true);
            } else {
                reject(`Could not flash ended with ${code} \n${lastStdOut}`);
            }
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        const compile = spawn("make", ["compile", `FQBN=${this.fqbn}`], {
            cwd: path
        });

        compile.stdout.on("data", data => {
            console.log(data.toString());
        });

        compile.stderr.on("data", (data: string) => {
            console.error(`stderr: ${data}`);
            this.listener.notifyProgress(Messages.initialisationFailure);
            reject(data);
        });

        compile.on("close", (code) => {
            console.log(`Arduino compilation exited with code ${code}`);
            if (code === 0) {
                this.listener.notifyProgress(Messages.compiled);
                this.uploadArduino(path, resolver, reject);
            } else {
                this.listener.notifyProgress(Messages.initialisationFailure);
                reject(false);
            }
        });
    }

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const sdkpath: string = this.sdk + "/platforms/Arduino/";
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);
            cp.on("error", err => {
                reject("Could not store upload file to sdk path.");
            });
            cp.on("close", (code) => {
                this.compileArduino(sdkpath, resolve, reject);
            });
        });
    }

    getCurrentFunctionIndex(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    pullSession(): void {
        this.listener.notifyProgress(Messages.transfering);
        this.sendInterrupt(Command.snapshot, undefined, function (err: any) {
            console.log("Plugin: WOOD Dump");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pushSession(): void {
        console.log("Plugin: listener start multiverse debugging");
        if (this.woodState === undefined
        ) {
            return;
        }
        this.listener.startMultiverseDebugging(this.woodState);
    }

    requestCallbackmapping() {
        this.sendInterrupt(Command.dumpcallbacks);
    }

    refresh(): void {
        console.log("Plugin: Refreshing");
        this.sendInterrupt(Command.dump, undefined, function (err: any) {
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }
}
