import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import { DebugBridgeListener } from './DebugBridgeListener';
import { InterruptTypes } from './InterruptTypes';
import { DebugInfoParser } from "../Parsers/DebugInfoParser";
import { AbstractDebugBridge } from "./AbstractDebugBridge";
import { WOODState } from "../State/WOODState";
import { SourceMap } from "../State/SourceMap";
import { EventsProvider } from "../Views/EventsProvider";
import { Readable } from 'stream';
import { ReadlineParser } from 'serialport';
import { DeviceConfig } from '../DebuggerConfig';
import { StackProvider } from '../Views/StackProvider';
import * as vscode from 'vscode';

// export const EMULATOR_PORT: number = 8300;

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public client: net.Socket | undefined;
    protected readonly tmpdir: string;
    protected readonly sdk: string;
    private cp?: ChildProcess;
    private parser: DebugInfoParser;
    private buffer: string = '';

    constructor(wasmPath: string, config: DeviceConfig, sourceMap: SourceMap, eventsProvider: EventsProvider | void, stackProvider: StackProvider | undefined, tmpdir: string, listener: DebugBridgeListener,
        warduinoSDK: string) {
        super(config, sourceMap, eventsProvider, stackProvider, listener);

        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.parser = new DebugInfoParser(sourceMap);
    }

    upload(): void {
        throw new Error('Method not implemented.');
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
            let address = { port: this.deviceConfig.port, host: "127.0.0.1" };  // TODO config
            if (this.client === undefined) {
                this.client = new net.Socket();
                this.client.connect(address, () => {
                    this.listener.notifyProgress('Connected to socket');
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
        // this.sendInterrupt(InterruptTypes.interruptDUMPFull);
        this.sendInterrupt(InterruptTypes.interruptWOODDump);
    }

    public pullSession() {
        this.sendInterrupt(InterruptTypes.interruptWOODDump);
    }

    public pushSession(woodState: WOODState) {
        throw new Error('Method not implemented.');
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
                    if (data.includes('Listening')) {
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
                reject('No stdout of stderr on emulator');
            }
        });
    }

    public disconnect(): void {
        console.error('Disconnected emulator');
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