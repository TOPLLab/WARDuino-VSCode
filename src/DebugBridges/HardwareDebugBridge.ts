import {AbstractDebugBridge, Messages} from "./AbstractDebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {ReadlineParser, SerialPort} from 'serialport';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {InterruptTypes} from "./InterruptTypes";
import {exec, spawn} from "child_process";
import {SourceMap} from "../State/SourceMap";
import {WOODState} from "../State/WOODState";
import {EventsProvider} from "../Views/EventsProvider";

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


    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    async connect(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            this.listener.notifyProgress(Messages.compiling);
            await this.compileAndUpload();
            this.listener.notifyProgress(Messages.connecting);
            this.openSerialPort(reject, resolve);
            this.installInputStreamListener();
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
        const parser = new ReadlineParser();
        this.client?.pipe(parser);
        parser.on("data", (line: any) => {
                        // everrying over the serial port
                        require('fs').appendFile('/tmp/hardwareOut', line, function (err:any) {
                            if (err) {
                                console.error(`COULD not add hardware: ${line}`);
                            }})
            if (this.woodDumpDetected) {
                // Next line will be a WOOD dump
                // TODO receive state from WOOD Dump and call bridge.pushSession(state)
                this.woodState = new WOODState(line);
                this.requestCallbackmapping();
                this.woodDumpDetected = false;
                return;
            }
            if (line.startsWith('{"callbacks": ') && this.woodState !== undefined) {
                this.woodState.callbacks = line;
                this.pushSession();
            }
            this.woodDumpDetected = line.includes("DUMP!");
            console.log(`hardware: ${line}`);

            this.parser.parse(this, line);
        });
    }

    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void): boolean | undefined {
        require('fs').appendFile('/tmp/hardwareOut', `${i} \n`, function (err:any) {
            if (err) {
                console.error(`COULD not add interuptcall:`);
            }})
            return super.sendInterrupt(i,callback);
    }

    public disconnect(): void {
        this.client?.close();
        this.listener.notifyProgress(Messages.disconnected);
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void): void {
        this.listener.notifyProgress(Messages.reset);

        const upload = exec(`make flash PORT=${this.portAddress} FQBN=${this.fqbn}`, {cwd: path}, (err, stdout, stderr) => {
                console.error(err);
                this.listener.notifyProgress(Messages.initialisationFailure);
            }
        );

        upload.on("data", (data: string) => {
            console.log(`stdout: ${data}`);
            if (data.search('Uploading') >= 0) {
                this.listener.notifyProgress(Messages.uploading);
            }
        });

        upload.on("close", (code) => {
            resolver(code === 0);
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void): void {
        const compile = spawn("make", ["compile", `FQBN=${this.fqbn}`], {
            cwd: path
        });

        compile.stdout.on("data", data => {
            console.log(data.toString());
        });

        compile.stderr.on("data", (data: string) => {
            console.error(`stderr: ${data}`);
            this.listener.notifyProgress(Messages.initialisationFailure);
            resolver(false);
        });

        compile.on("close", (code) => {
            console.log(`Arduino compilation exited with code ${code}`);
            if (code === 0) {
                this.listener.notifyProgress(Messages.compiled);
                this.uploadArduino(path, resolver);
            } else {
                this.listener.notifyProgress(Messages.initialisationFailure);
                resolver(false);
            }
        });
    }

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const sdkpath: string = this.sdk + "/platforms/Arduino/";
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);
            cp.on("error", err => {
                resolve(false);
            });
            cp.on("close", (code) => {
                this.compileArduino(sdkpath, resolve);
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
        this.sendInterrupt(InterruptTypes.interruptWOODDump, function (err: any) {
            console.log("Plugin: WOOD Dump");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pushSession(): void {
        console.log("Plugin: listener start multiverse debugging");
        if (this.woodState === undefined) {
            return;
        }
        this.listener.startMultiverseDebugging(this.woodState);
    }

    requestCallbackmapping() {
        this.sendInterrupt(InterruptTypes.interruptDUMPCallbackmapping);
    }

    refresh(): void {
        console.log("Plugin: Refreshing");
        this.sendInterrupt(InterruptTypes.interruptDUMPFull, function (err: any) {
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }
}
