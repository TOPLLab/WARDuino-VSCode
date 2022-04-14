import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {DebugBridgeListener} from './DebugBridgeListener';
import {InterruptTypes} from './InterruptTypes';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {SourceMap} from "../State/SourceMap";
import {AbstractDebugBridge} from "./AbstractDebugBridge";
import {WOODState} from "../State/WOODState";

export class WARDuinoDebugBridgeEmulator extends AbstractDebugBridge {
    private client?: net.Socket;
    private wasmPath: string;
    private readonly sdk: string;
    private readonly tmpdir: string;
    private cp?: ChildProcess;
    private parser: DebugInfoParser;
    private startAddress: number = 0;
    private buffer: string = "";

    constructor(wasmPath: string, sourceMap: SourceMap | void, tmpdir: string, listener: DebugBridgeListener,
                warduinoSDK: string) {
        super(sourceMap, listener);

        this.wasmPath = wasmPath;
        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.parser = new DebugInfoParser();
    }

    upload(): void {
        throw new Error('Method not implemented.');
    }

    setVariable(name: string, value: number): Promise<string> {
        console.log(`setting ${name} ${value}`);
        return new Promise<string>(resolve => resolve("Variable set."));
    }

    pause(): void {
        throw new Error('Method not implemented.');
    }

    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    run(): void {
        this.sendInterrupt(InterruptTypes.interruptRUN);
    }

    setBreakPoint(x: number): void {
        console.log(this.startAddress);
        throw new Error('Method not implemented.');
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
            if (this.client === undefined) {
                this.client = new net.Socket();
                this.client.connect({port: 8192, host: '127.0.0.1'}, () => {
                    this.listener.notifyProgress('Connected to socket');
                    resolve("127.0.0.1:8192");
                });  // TODO config

                this.client.on('error', err => {
                        this.listener.notifyError('Lost connection to the board');
                        console.error(err);
                        reject(err);
                    }
                );

                this.client.on('data', data => {
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

    private sendInterrupt(i: InterruptTypes) {
        let command = `${i} \n`;
        this.client?.write(command);
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
        console.log("Plugin: WOOD RecvState");
        let command = `${InterruptTypes.interruptWOODRecvState}${woodState.toBinary()} \n`;
        this.client?.write(command);
    }

    private executeCommand(command: InterruptTypes) {
        console.log(command.toString());
        this.client?.write(command.toString + '\n');
    }

    private startEmulator(): Promise<string> {
        this.cp = this.spawnEmulatorProcess();

        this.listener.notifyProgress('Started Emulator');
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
            console.error('Something went wrong with the emulator stream');
            this.listener.notifyProgress('Disconnected from emulator');
        });

        return this.initClient();
    }

    public disconnect(): void {
        this.cp?.kill();
        this.client?.destroy();
    }

    private spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        return spawn(`${this.sdk}/build-emu/wdcli`, ['--file', `${this.tmpdir}/upload.wasm`]);
    }

}