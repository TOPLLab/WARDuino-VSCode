import { ChildProcess, spawn } from 'child_process';
import { DebugBridgeListenerInterface } from './DebugBridgeListenerInterface';
import { AbstractDebugBridge } from "./AbstractDebugBridge";
import { SourceMap } from "../State/SourceMap";
import { Readable } from 'stream';
import { ReadlineParser } from 'serialport';
import { DeviceConfig } from '../DebuggerConfig';
import * as vscode from 'vscode';
import { RuntimeViewsRefresher } from '../Views/ViewsRefresh';
import { ClientSideSocket } from '../Channels/ClientSideSocket';
import { RuntimeState } from '../State/RuntimeState';
import { ChannelInterface } from '../Channels/ChannelInterface';
import { StateRequest } from './APIRequest';

// export const EMULATOR_PORT: number = 8300;

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public client: ChannelInterface | undefined;
    protected readonly tmpdir: string;
    protected readonly sdk: string;
    private cp?: ChildProcess;

    constructor(wasmPath: string, config: DeviceConfig, sourceMap: SourceMap, tmpdir: string, listener: DebugBridgeListenerInterface,
        warduinoSDK: string) {
        super(config, sourceMap, listener);

        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.client = new ClientSideSocket(this.deviceConfig.port, this.deviceConfig.ip);
    }

    public proxify(): void {
        throw new Error("Method not supported.");
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


    private async initClient(): Promise<string> {
        try {
            await this.client!.openConnection();
            this.listener.notifyProgress("Connected to socket");
            this.registerCallbacks();
            return `127.0.0.1:${this.deviceConfig.port}`;
        }
        catch (err) {
            this.listener.notifyError("Lost connection to the board");
            console.error(err);
            throw err;
        }
    }

    public async refresh() {
        const stateRequest = new StateRequest();
        stateRequest.includePC();
        stateRequest.includeStack();
        stateRequest.includeGlobals();
        stateRequest.includeCallstack();
        stateRequest.includeBreakpoints();
        stateRequest.includeEvents();
        const req = stateRequest.generateRequest();
        try {
            const response = await this.client!.request(req);
            const runtimeState: RuntimeState = new RuntimeState(response, this.sourceMap);
            this.updateRuntimeState(runtimeState);
        }
        catch (err) {
            console.error(`Emulated: refresh Error ${err}`);
        }
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
        this.client!.disconnect();
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