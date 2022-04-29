import {AbstractDebugBridge, Messages} from "./AbstractDebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {ReadlineParser, SerialPort} from 'serialport';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {InterruptTypes} from "./InterruptTypes";
import {exec, spawn} from "child_process";
import {SourceMap} from "../State/SourceMap";
import {WOODState} from "../State/WOODState";

export class WARDuinoDebugBridge extends AbstractDebugBridge {
    private parser: DebugInfoParser = new DebugInfoParser();
    private wasmPath: string;
    protected port: SerialPort | undefined;
    protected readonly portAddress: string;
    protected readonly sdk: string;
    protected readonly tmpdir: string | undefined;
    private startAddress: number = 0;
    private woodDumpDetected: boolean = false;

    constructor(wasmPath: string,
                sourceMap: SourceMap | void,
                tmpdir: string,
                listener: DebugBridgeListener,
                portAddress: string,
                warduinoSDK: string) {
        super(sourceMap, listener);

        this.wasmPath = wasmPath;
        this.sourceMap = sourceMap;
        this.listener = listener;
        this.portAddress = portAddress;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;
    }

    setVariable(name: string, value: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            console.log(`setting ${name} ${value}`);
            try {
                let command = this.getVariableCommand(name, value);
                this.port?.write(command, err => {
                    resolve("Interrupt send.");
                });
            } catch {
                reject("Local not found.");
            }
        });
    }

    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    run(): void {
        this.sendInterrupt(InterruptTypes.interruptRUN);
    }

    pause(): void {
        this.sendInterrupt(InterruptTypes.interruptPAUSE);
        this.listener.notifyPaused();
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
        this.port = new SerialPort({path: this.portAddress, baudRate: 115200},
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

    public setBreakPoint(address: number) {
        let breakPointAddress: string = (this.startAddress + address).toString(16).toUpperCase();
        let command = `060${(breakPointAddress.length / 2).toString(16)}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        this.port?.write(command);
    }

    private installInputStreamListener() {
        const parser = new ReadlineParser();
        this.port?.pipe(parser);
        parser.on("data", (line: any) => {
            if (this.woodDumpDetected) {
                // Next line will be a WOOD dump
                // TODO receive state from WOOD Dump and call bridge.pushSession(state)
                this.pushSession(new WOODState(line));
                this.woodDumpDetected = false;
                return;
            }
            this.woodDumpDetected = line.includes("DUMP!");
            this.parser.parse(this, line);
        });
    }

    public disconnect(): void {
        this.port?.close();
        this.listener.notifyProgress(Messages.disconnected);
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void): void {
        this.listener.notifyProgress(Messages.reset);

        const upload = exec(`sh upload ${this.portAddress}`, {cwd: path}, (err, stdout, stderr) => {
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
        const compile = spawn("make", ["compile"], {
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

    private sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        return this.port?.write(`${i} \n`, callback);
    }

    getCurrentFunctionIndex(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    step(): void {
        this.sendInterrupt(InterruptTypes.interruptSTEP, function (err: any) {
            console.log("Plugin: Step");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pullSession(): void {
        this.sendInterrupt(InterruptTypes.interruptWOODDump, function (err: any) {
            console.log("Plugin: WOOD Dump");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pushSession(woodState: WOODState): void {
        console.log("Plugin: listener start multiverse debugging");
        this.listener.startMultiverseDebugging(woodState);
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