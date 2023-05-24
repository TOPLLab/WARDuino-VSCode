import { AbstractDebugBridge, EventsMessages, Messages } from './AbstractDebugBridge';
import { InterruptTypes } from './InterruptTypes';
import { exec, spawn } from 'child_process';
import { SourceMap } from '../State/SourceMap';
import { DeviceConfig } from '../DebuggerConfig';
import * as path from 'path';
import { LoggingSerialMonitor } from '../Channels/SerialConnection';
import { ClientSideSocket } from '../Channels/ClientSideSocket';
import { ChannelInterface } from '../Channels/ChannelInterface';
import { SerialChannel } from '../Channels/SerialChannel';
import { ProxifyRequest, ProxyMode, Request, StateRequest } from './APIRequest';
import { RuntimeState } from '../State/RuntimeState';
import { BreakpointPolicy } from '../State/Breakpoint';

export class HardwareDebugBridge extends AbstractDebugBridge {
    protected client: ChannelInterface | undefined;
    protected readonly sdk: string;
    protected readonly tmpdir: string | undefined;

    private logginSerialConnection?: LoggingSerialMonitor;

    constructor(
        deviceConfig: DeviceConfig,
        sourceMap: SourceMap,
        tmpdir: string,
        warduinoSDK: string) {
        super(deviceConfig, sourceMap);

        this.sourceMap = sourceMap;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;
    }


    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    async connect(flash?: boolean): Promise<string> {
        const doFlash = flash === undefined ? this.deviceConfig.onStartConfig.flash : flash;
        if (doFlash) {
            await this.compileAndUpload();
        }
        this.emit(EventsMessages.progress, this, Messages.connecting);
        if (this.deviceConfig.usesWiFi()) {
            await this.openSocketPort();
            this.registerCallbacks();
            if (!!!this.logginSerialConnection) {
                const loggername = this.deviceConfig.name;
                const port = this.deviceConfig.serialPort;
                const baudRate = this.deviceConfig.baudrate;
                this.logginSerialConnection = new LoggingSerialMonitor(loggername, port, baudRate);
            }
            this.logginSerialConnection.openConnection().catch((err) => {
                console.log(`Plugin: could not monitor serial port ${this.deviceConfig.serialPort} reason: ${err}`);
            });
        }
        else {
            await this.openSerialPort();
            this.registerCallbacks();
        }
        if (doFlash) {
            const p = new Promise((res) => {
                const secs = 2000;
                setTimeout(() => {
                    res('done');
                }, secs);
            });
            await p;
        }
        return '';
    }

    public async upload() {
        await this.compileAndUpload();
    }

    protected async openSocketPort() {
        this.client = new ClientSideSocket(this.deviceConfig.port, this.deviceConfig.ip);
        try {
            const maxConnectionAttempts = 5;
            if (!await this.client.openConnection(maxConnectionAttempts)) {
                return `Could not connect to socket ${this.deviceConfig.ip}:${this.deviceConfig.port}`;
            }
            this.emit(EventsMessages.connected, this);
            return `127.0.0.1:${this.deviceConfig.port}`;
        }
        catch (err) {
            this.emit(EventsMessages.connectionError, this, err);
            console.error(err);
            throw err;
        }
    }

    public disconnectMonitor() {
        this.logginSerialConnection?.disconnect();
    }

    protected async openSerialPort() {
        this.client = new SerialChannel(this.deviceConfig.serialPort, this.deviceConfig.baudrate);
        if (!await this.client.openConnection()) {
            return `Could not connect to serial port: ${this.deviceConfig.serialPort}`;
        }
        this.emit(EventsMessages.connected, this);
        return this.deviceConfig.serialPort;
    }

    public disconnect(): void {
        this.client?.disconnect();
        this.logginSerialConnection?.disconnect();
        console.error('CLOSED!');
        this.emit(EventsMessages.disconnected, this);
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        let lastStdOut = '';
        this.emit(EventsMessages.progress, this, EventsMessages.flashing);
        const upload = exec(`make flash PORT=${this.deviceConfig.serialPort} FQBN=${this.deviceConfig.fqbn} PAUSED=true`, { cwd: path }, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                lastStdOut = stdout + stderr;
                const errMsg = `${EventsMessages.flashingFailure} reason: ${err}`;
                this.emit(EventsMessages.errorInProgress, this, errMsg);
            }
        });

        this.emit(EventsMessages.progress, this, EventsMessages.flashing);

        upload.on('close', (code) => {
            if (code === 0) {
                resolver(true);
            } else {
                const errMsg = `${EventsMessages.flashingFailure}. Exit code: ${code}`;
                this.emit(EventsMessages.errorInProgress, this, errMsg);
                reject(`Could not flash ended with ${code} \n${lastStdOut}`);
            }
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        this.emit(EventsMessages.progress, this, Messages.compiling);
        const compile = spawn('make', ['compile', `FQBN=${this.deviceConfig.fqbn}`, `BINARY=${this.tmpdir}/upload.wasm`, 'PAUSED=true'], {
            cwd: path
        });

        compile.stdout.on('data', data => {
            console.log(data.toString());
        });

        compile.stderr.on('data', (data: string) => {
            console.error(`HardwareDebugBridge stderr: ${data}`);
            const errMsg = `${EventsMessages.compilationFailure}. Reason: ${data}`;
            this.emit(EventsMessages.errorInProgress, this, errMsg);
            reject(data);
        });

        compile.on('close', (code) => {
            console.log(`Arduino compilation exited with code ${code}`);
            if (code === 0) {
                this.uploadArduino(path, resolver, reject);
            } else {
                this.emit(EventsMessages.progress, this, Messages.initialisationFailure);
                reject(false);
            }
        });
    }

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const arduinoDir = this.deviceConfig.usesWiFi() ? '/platforms/Arduino-socket/' : '/platforms/Arduino/';
            const sdkpath: string = path.join(this.sdk, arduinoDir);
            this.emit(EventsMessages.progress, this, Messages.compiling);
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);
            cp.on('error', err => {
                const errMsg = `Could not store upload file to sdk path. Reason: ${err}`;
                this.emit(EventsMessages.errorInProgress, this, errMsg);
                reject(errMsg);
            });
            cp.on('close', (code) => {
                this.compileArduino(sdkpath, resolve, reject);
            });
        });
    }

    public async proxify(mode: ProxyMode): Promise<void> {
        const req = ProxifyRequest(mode);
        await this.client!.request(req);
    }

    async refresh(): Promise<void> {
        const stateRequest = this.createStateRequest();
        try {
            const response = await this.client!.request(stateRequest);
            const runtimeState: RuntimeState = new RuntimeState(response, this.sourceMap);
            this.updateRuntimeState(runtimeState);
        }
        catch (err) {
            console.error(`Hardware: refresh Error ${err}`);
        }
    }

    private createStateRequest(): Request {
        const stateRequest = new StateRequest();
        if (this.breakpointPolicy !== BreakpointPolicy.default) {
            // non default bp policy is set so debugging on a MCU that cannot
            // be stopped is in place.
            // To keep he MCU running and allow local debugging
            // we must request all the state
            stateRequest.includeAll();
        }
        else {
            // default bp policy is set so pausing a MCU to debug is allowed
            // requesting a part of a snapshot suffices
            stateRequest.includePC();
            stateRequest.includeStack();
            stateRequest.includeCallstack();
            stateRequest.includeBreakpoints();
            stateRequest.includeGlobals();
            stateRequest.includeEvents();
        }
        return stateRequest.generateRequest();
    }
}
