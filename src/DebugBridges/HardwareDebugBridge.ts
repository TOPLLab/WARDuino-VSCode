import { AbstractDebugBridge, EventsMessages, Messages } from "./AbstractDebugBridge";
import { InterruptTypes } from "./InterruptTypes";
import { exec, spawn } from "child_process";
import { SourceMap } from "../State/SourceMap";
import { DeviceConfig } from "../DebuggerConfig";
import * as path from 'path';
import { LoggingSerialMonitor } from "../Channels/SerialConnection";
import { ClientSideSocket } from "../Channels/ClientSideSocket";
import { ChannelInterface } from "../Channels/ChannelInterface";
import { SerialChannel } from "../Channels/SerialChannel";
import { ProxifyRequest, ProxyMode, Request, StateRequest } from "./APIRequest";
import { RuntimeState } from "../State/RuntimeState";
import { BreakpointPolicy } from "../State/Breakpoint";

export class HardwareDebugBridge extends AbstractDebugBridge {
    protected client: ChannelInterface | undefined;
    protected readonly portAddress: string;
    protected readonly fqbn: string;
    protected readonly sdk: string;
    protected readonly tmpdir: string | undefined;

    private logginSerialConnection?: LoggingSerialMonitor;

    constructor(
        deviceConfig: DeviceConfig,
        sourceMap: SourceMap,
        tmpdir: string,
        portAddress: string,
        fqbn: string,
        warduinoSDK: string) {
        super(deviceConfig, sourceMap);

        this.sourceMap = sourceMap;
        this.portAddress = portAddress;
        this.fqbn = fqbn;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;
    }


    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    async connect(): Promise<string> {
        this.emit(EventsMessages.progress, this, Messages.compiling);
        if (this.deviceConfig.onStartConfig.flash) {
            await this.compileAndUpload();
        }
        this.emit(EventsMessages.progress, this, Messages.connecting);
        if (this.deviceConfig.usesWiFi()) {
            await this.openSocketPort();
            this.registerCallbacks();
            if (!!!this.logginSerialConnection) {
                const loggername = this.deviceConfig.name;
                const port = this.portAddress;
                const baudRate = 115200;
                this.logginSerialConnection = new LoggingSerialMonitor(loggername, port, baudRate);
            }
            this.logginSerialConnection.openConnection().catch((err) => {
                console.log(`Plugin: could not monitor serial port ${this.portAddress} reason: ${err}`);
            });
        }
        else {
            await this.openSerialPort();
            this.registerCallbacks();
        }

        return "";
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
        const baudrate = 115200;
        this.client = new SerialChannel(this.portAddress, baudrate);
        if (!await this.client.openConnection()) {
            return `Could not connect to serial port: ${this.portAddress}`;
        }
        this.emit(EventsMessages.connected, this);
        return this.portAddress;
    }

    public disconnect(): void {
        this.client?.disconnect();
        this.logginSerialConnection?.disconnect();
        console.error("CLOSED!");
        this.emit(EventsMessages.disconnected, this);
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        let lastStdOut = "";
        this.emit(EventsMessages.progress, this, Messages.reset);

        const upload = exec(`make flash PORT=${this.portAddress} FQBN=${this.fqbn}`, { cwd: path }, (err, stdout, stderr) => {
            console.error(err);
            lastStdOut = stdout + stderr;
            this.emit(EventsMessages.progress, this, Messages.initialisationFailure);
            //this.listener.notifyProgress(Messages.initialisationFailure);
        }
        );

        this.emit(EventsMessages.progress, this, Messages.uploading);

        upload.on('close', (code) => {
            if (code === 0) {
                resolver(true);
            } else {
                reject(`Could not flash ended with ${code} \n${lastStdOut}`);
            }
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        const compile = spawn('make', ['compile', `FQBN=${this.fqbn}`], {
            cwd: path
        });

        compile.stdout.on('data', data => {
            console.log(data.toString());
        });

        compile.stderr.on('data', (data: string) => {
            console.error(`HardwareDebugBridge stderr: ${data}`);
            this.emit(EventsMessages.progress, this, Messages.initialisationFailure);
            reject(data);
        });

        compile.on('close', (code) => {
            console.log(`Arduino compilation exited with code ${code}`);
            if (code === 0) {
                this.emit(EventsMessages.progress, this, Messages.compiled);
                this.uploadArduino(path, resolver, reject);
            } else {
                this.emit(EventsMessages.progress, this, Messages.initialisationFailure);
                reject(false);
            }
        });
    }

    public compileAndUpload(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const arduinoDir = this.deviceConfig.usesWiFi() ? "/platforms/Arduino-socket/" : "/platforms/Arduino/";
            const sdkpath: string = path.join(this.sdk, arduinoDir);
            const cp = exec(`cp ${this.tmpdir}/upload.c ${sdkpath}/upload.h`);
            cp.on("error", err => {
                reject("Could not store upload file to sdk path.");
            });
            cp.on("close", (code) => {
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
