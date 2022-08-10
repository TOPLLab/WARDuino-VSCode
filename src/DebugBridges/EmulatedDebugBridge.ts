import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {DebugBridgeListener} from './DebugBridgeListener';
import {InterruptTypes} from './InterruptTypes';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {SourceMap} from "../State/SourceMap";
import {AbstractDebugBridge} from "./AbstractDebugBridge";
import {WOODState} from "../State/WOODState";
import {EventsProvider} from "../Views/EventsProvider";
import {Readable} from 'stream';
import {ReadlineParser} from 'serialport';
import {Command} from "../Parsers/debug";

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public client: net.Socket | undefined;
    protected readonly tmpdir: string;
    private wasmPath: string;
    private readonly sdk: string;
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
            let address = {port: 8192, host: "127.0.0.1"};  // TODO config
            if (this.client === undefined) {
                this.client = new net.Socket();
                this.client.connect(address, () => {
                    this.listener.notifyProgress("Connected to socket");
                    resolve(`${address.host}:${address.port}`);
                });

                this.client.on("error", err => {
                        this.listener.notifyError("Lost connection to the board");
                        console.error(err);
                        reject(err);
                    }
                );

                this.client.on("data", data => {
                        data.toString().split("\n").forEach((line) => {
                            console.log(`emulator: ${line}`);

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
            } else {
                resolve(`${address.host}:${address.port}`);
            }
        });
    }

    public refresh() {
        this.sendInterrupt(Command.dump);
    }

    public pullSession() {
        this.sendInterrupt(Command.snapshot);
    }

    public pushSession(woodState: WOODState) {
        throw new Error("Method not implemented.");
    }

    private executeCommand(command: InterruptTypes) {
        console.log(command.toString());
        this.client?.write(command.toString + '\n');
    }

    private startEmulator(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.cp = this.spawnEmulatorProcess();

            this.listener.notifyProgress('Started emulator');
            while (this.cp.stdout === undefined) {
            }
            if (isReadable(this.cp.stdout) && isReadable(this.cp.stderr)) {
                const outParser = new ReadlineParser();
                this.cp.stdout.pipe(outParser);
                const errParser = new ReadlineParser();
                this.cp.stderr.pipe(errParser);

                outParser.on('data', (data) => {  // Print debug and trace information
                    console.log(`stdout: ${data}`);
                    if (data.includes("Listening")) {
                        this.initClient().then(resolve).catch(reject);
                    }
                });
                errParser.on('data', (data) => {  // Print debug and trace information
                    console.log(`stderr: ${data}`);
                });

                this.cp.on('error', (err) => {
                    console.error('Failed to start subprocess.');
                    reject(err);
                });

                this.cp.on('close', (code) => {
                    this.listener.notifyProgress('Disconnected from emulator');
                    this.cp?.kill();
                    this.cp = undefined;
                });

            } else {
                reject("No stdout of stderr on emulator");
            }
        });
    }

    public disconnect(): void {
        console.error("Disconnected emulator");
        this.cp?.kill();
        this.client?.destroy();
    }

    private spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        return spawn(`${this.sdk}/build-emu/wdcli`, ['--file', `${this.tmpdir}/upload.wasm`]);
    }

}

function isReadable(x: Readable | null): x is Readable {
    return x != null;
}