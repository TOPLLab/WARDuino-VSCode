import { ChildProcess, spawn } from 'child_process';
import { AbstractDebugBridge, EventsMessages } from "./AbstractDebugBridge";
import { SourceMap } from "../State/SourceMap";
import { Readable } from 'stream';
import { ReadlineParser } from 'serialport';
import { DeviceConfig } from '../DebuggerConfig';
import { ClientSideSocket } from '../Channels/ClientSideSocket';
import { RuntimeState } from '../State/RuntimeState';
import { ChannelInterface } from '../Channels/ChannelInterface';
import { ProxyMode, StateRequest } from './APIRequest';

// export const EMULATOR_PORT: number = 8300;

export class EmulatedDebugBridge extends AbstractDebugBridge {
    public client: ChannelInterface | undefined;
    protected readonly tmpdir: string;
    protected readonly sdk: string;
    private cp?: ChildProcess;

    constructor(config: DeviceConfig, sourceMap: SourceMap, tmpdir: string,
        warduinoSDK: string) {
        super(config, sourceMap);

        this.sdk = warduinoSDK;
        this.sourceMap = sourceMap;
        this.tmpdir = tmpdir;
        this.client = new ClientSideSocket(this.deviceConfig.port, this.deviceConfig.ip);
    }

    public proxify(mode: ProxyMode): Promise<void> {
        throw new Error("EmulatedDebugBridge.proxify: Method not supported.");
    }

    upload(): void {
        throw new Error("EmulatedDebugBridge.upload: Method not implemented.");
    }

    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    public connect(flash?: boolean): Promise<string> {
        return this.startEmulator();
    }


    private async initClient(): Promise<string> {
        try {
            await this.client!.openConnection();
            this.emit(EventsMessages.connected, this);
            this.registerCallbacks();
            return `127.0.0.1:${this.deviceConfig.port}`;
        }
        catch (err) {
            this.emit(EventsMessages.connectionError, this, err);
            console.error(`Connection error: ${err}`);
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

    private startEmulator(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.cp = this.spawnEmulatorProcess();

            this.emit(EventsMessages.emulatorStarted, this);
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
                    this.emit(EventsMessages.emulatorClosed, this, code);
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

    public disconnectMonitor() {
        throw Error("No monitor to disconnect on emulator");
    }

    protected spawnEmulatorProcess(): ChildProcess {
        // TODO package extension with upload.wasm and compile WARDuino during installation.
        const emulatorPort: number = this.deviceConfig.port;
        const proxySerialPort = this.deviceConfig.proxyConfig?.serialPort;
        const proxyBaudrate = this.deviceConfig.proxyConfig?.baudrate;
        const proxyIP = this.deviceConfig.proxyConfig?.ip;
        const proxyPort = this.deviceConfig.proxyConfig?.port;
        const args: string[] = [`${this.tmpdir}/upload.wasm`, '--socket', `${emulatorPort}`];

        if (this.deviceConfig.needsProxyToAnotherVM()) {
            if (proxyIP && proxyIP !== "") {
                args.push("--proxy", `${proxyIP}:${proxyPort}`);
            }
            else if (proxySerialPort && proxySerialPort !== "") {
                args.push("--proxy", proxySerialPort, "--baudrate", `${proxyBaudrate}`);
            }
            else {
                throw Error(`cannot spawn emulator in proxy mode without serialPort or IP of target MCU.
                Given serialPort=${proxySerialPort} baudrate=${proxyBaudrate} IP=${proxyIP} IPPORT=${proxyPort}.`);
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