import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import { DebugBridgeListenerInterface } from './DebugBridgeListenerInterface';
import { InterruptTypes } from './InterruptTypes';
import { DebugInfoParser } from "../Parsers/DebugInfoParser";
import { AbstractDebugBridge } from "./AbstractDebugBridge";
import { StateRequest, WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { EventsProvider } from "../Views/EventsProvider";
import { Readable } from 'stream';
import { ReadlineParser } from 'serialport';
import { DeviceConfig } from '../DebuggerConfig';
import { StackProvider } from '../Views/StackProvider';
import * as vscode from 'vscode';
import { RuntimeViewsRefresher } from '../Views/ViewsRefresh';

// export const EMULATOR_PORT: number = 8300;

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public client: net.Socket | undefined;
    protected readonly tmpdir: string;
    private wasmPath: string;
    protected readonly sdk: string;
    private cp?: ChildProcess;
    private parser: DebugInfoParser;
    private buffer: string = "";

    constructor(wasmPath: string, config: DeviceConfig, sourceMap: SourceMap, viewsRefresher: RuntimeViewsRefresher, tmpdir: string, listener: DebugBridgeListenerInterface,
        warduinoSDK: string) {
        super(config, sourceMap, viewsRefresher, listener);

        this.wasmPath = wasmPath;
        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.parser = new DebugInfoParser(sourceMap);
    }

    public proxify(): void {
        throw new Error("Method not supported.");
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


    private initClient(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let that = this;
            let address = { port: this.deviceConfig.port, host: "127.0.0.1" };  // TODO config
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
                    this.buffer += data.toString();
                    let idx = this.buffer.indexOf("\n");
                    while (idx !== -1) {
                        const line = this.buffer.slice(0, idx);
                        this.buffer = this.buffer.slice(idx + 1); // skip newline
                        console.log(`emulator: ${line}`);
                        try {
                            that.parser.parse(that, line);
                        } catch (e) {
                            console.log(`Emulator: failed to parse ${line}`);
                        }
                        idx = this.buffer.indexOf("\n");
                    };
                }
                );
            } else {
                resolve(`${address.host}:${address.port}`);
            }
        });
    }

    public refresh() {
        const stateRequest = new StateRequest();
        stateRequest.includePC();
        stateRequest.includeStack();
        stateRequest.includeGlobals();
        stateRequest.includeCallstack();
        stateRequest.includeBreakpoints();
        stateRequest.includeEvents();
        const req = stateRequest.generateInterrupt();
        const cberr = (err: any) => {
            if (err) {
                console.error(`Emulated: refresh Error ${err}`);
            }
        };
        this.sendData(req, cberr);
    }

    public pullSession() {
        const stateRequest = new StateRequest();
        stateRequest.includeAll();
        const req = stateRequest.generateInterrupt();
        const cberr = (err: any) => {
            if (err) {
                console.error(`Emulated: pullSession error ${err}`);
            }
        };
        this.sendData(req, cberr);
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
                    console.log(`EmulatedDebugBridge stderr: ${data}`);
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

    protected spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        const baudrate: string = vscode.workspace.getConfiguration().get("warduino.Baudrate") ?? "115200";
        const args: string[] = [`${this.tmpdir}/upload.wasm`, '--socket', `${this.deviceConfig.port}`];

        if (this.deviceConfig.needsProxyToAnotherVM()) {
            const ip = this.deviceConfig.proxyConfig?.ip;
            if (!!ip && ip !== "") {
                args.push("--proxy", `${this.deviceConfig.proxyConfig?.ip}:${this.deviceConfig.proxyConfig?.port}`);
            }
            else {
                args.push("--proxy", `${this.deviceConfig.port}`, "--baudrate", baudrate);
            }
        }

        if (this.deviceConfig.onStartConfig.pause) {
            args.push("--paused");
        }
        return spawn(`${this.sdk}/build-emu/wdcli`, args);
        // return spawn(`echo`, ['"Listening"']);
    }

}

function isReadable(x: Readable | null): x is Readable {
    return x != null;
}