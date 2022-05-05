import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {DebugBridgeListener} from './DebugBridgeListener';
import {InterruptTypes} from './InterruptTypes';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {SourceMap} from "../State/SourceMap";
import {AbstractDebugBridge} from "./AbstractDebugBridge";
import {WOODState} from "../State/WOODState";
import {EventsProvider} from "../Views/EventsProvider";

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public port: net.Socket | undefined;
    private wasmPath: string;
    private readonly sdk: string;
    private readonly tmpdir: string;
    private cp?: ChildProcess;
    private parser: DebugInfoParser;
    private buffer: string = "";

    constructor(wasmPath: string, sourceMap: SourceMap | void, eventsProvider: EventsProvider | void, tmpdir: string, listener: DebugBridgeListener,
                warduinoSDK: string) {
        super(sourceMap, eventsProvider, listener);

        this.wasmPath = wasmPath;
        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.parser = new DebugInfoParser();
    }

    upload(): void {
        throw new Error("Method not implemented.");
    }

    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    public connect(): Promise<string> {
        return this.startEmulator();
    }

    getCurrentFunctionIndex(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    private initClient(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let that = this;
            if (this.port === undefined) {
                let address = {port: 8192, host: "127.0.0.1"};  // TODO config
                this.port = new net.Socket();
                this.port.connect(address, () => {
                    this.listener.notifyProgress("Connected to socket");
                    resolve(`${address.host}:${address.port}`);
                });

                this.port.on("error", err => {
                        this.listener.notifyError("Lost connection to the board");
                        console.error(err);
                        reject(err);
                    }
                );

                this.port.on("data", data => {
                        data.toString().split("\n").forEach((line) => {
                            if (line.startsWith("Interrupt:")) {
                                this.buffer = line;
                            } else if (this.buffer.length > 0) {
                                this.buffer += line;
                            } else if (line.startsWith("{")) {
                                this.buffer = line;
                            } else {
                                that.parser.parse(that, line);
                                return;
                            }

                            try {
                                that.parser.parse(that, this.buffer);
                                this.buffer = "";
                            } catch (e) {
                                return;
                            }
                        });
                    }
                );
            }
        });
    }

    public step() {
        this.sendInterrupt(InterruptTypes.interruptSTEP);
    }

    public refresh() {
        this.sendInterrupt(InterruptTypes.interruptDUMPFull);
    }

    public pullSession() {
        this.sendInterrupt(InterruptTypes.interruptWOODDump);
    }

    public pushSession(woodState: WOODState) {
        throw new Error("Method not implemented.");
    }

    private executeCommand(command: InterruptTypes) {
        console.log(command.toString());
        this.port?.write(command.toString + '\n');
    }

    private startEmulator(): Promise<string> {
        this.cp = this.spawnEmulatorProcess();

        this.listener.notifyProgress('Started emulator');
        while (this.cp.stdout === undefined) {
        }

        this.cp.stdout?.on('data', (data) => {  // Print debug and trace information
            console.log(`stdout: ${data}`);
        });

        this.cp.stderr?.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        this.cp.on('error', (err) => {
            console.error('Failed to start subprocess.');
        });

        this.cp.on('close', (code) => {
            this.listener.notifyProgress('Disconnected from emulator');
        });

        return this.initClient();
    }

    public disconnect(): void {
        this.cp?.kill();
        this.port?.destroy();
    }

    private spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        return spawn(`${this.sdk}/build-emu/wdcli`, ['--file', `${this.tmpdir}/upload.wasm`]);
    }

}
