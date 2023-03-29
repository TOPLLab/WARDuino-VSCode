import {AbstractDebugBridge, Messages} from "./AbstractDebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {ReadlineParser, SerialPort} from 'serialport';
import {DebugInfoParser} from "../Parsers/DebugInfoParser";
import {InterruptTypes} from "./InterruptTypes";
import {exec, spawn} from "child_process";
import {WOODState} from "../State/WOODState";
import {SourceMap} from "../State/SourceMap";
import {EventsProvider} from "../Views/EventsProvider";
import { DeviceConfig } from "../DebuggerConfig";
import * as path from 'path';
import { LoggingSerialMonitor } from "../Channels/SerialConnection";
import { ClientSideSocket } from "../Channels/ClientSideSocket";
import { StackProvider } from "../Views/StackProvider";

export class HardwareDebugBridge extends AbstractDebugBridge {
    private parser: DebugInfoParser;
    private wasmPath: string;
    protected client: SerialPort | undefined;
    protected readonly portAddress: string;
    protected readonly fqbn: string;
    protected readonly sdk: string;
    protected readonly tmpdir: string | undefined;
    private woodState?: WOODState;
    private woodDumpDetected: boolean = false;

    private logginSerialConnection?: LoggingSerialMonitor;

    constructor(wasmPath: string,
                deviceConfig: DeviceConfig,
                sourceMap: SourceMap,
                eventsProvider: EventsProvider | void,
                stackProvider: StackProvider | undefined,
                tmpdir: string,
                listener: DebugBridgeListener,
                portAddress: string,
                fqbn: string,
                warduinoSDK: string) {
        super(deviceConfig, sourceMap, eventsProvider, stackProvider, listener);

        this.wasmPath = wasmPath;
        this.sourceMap = sourceMap;
        this.listener = listener;
        this.portAddress = portAddress;
        this.fqbn = fqbn;
        this.sdk = warduinoSDK;
        this.tmpdir = tmpdir;
        this.parser = new DebugInfoParser(sourceMap);
    }


    setStartAddress(startAddress: number) {
        this.startAddress = startAddress;
    }

    async connect(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            this.listener.notifyProgress(Messages.compiling);
            if (this.deviceConfig.onStartConfig.flash) {
                await this.compileAndUpload();
            }
            this.listener.notifyProgress(Messages.connecting);
            if(this.deviceConfig.usesWiFi()){
              await this.openSocketPort(reject, resolve);
              if(!!!this.logginSerialConnection){
                  const loggername = this.deviceConfig.name;
                  const port = this.portAddress;
                  const baudRate = 115200;
                  this.logginSerialConnection = new LoggingSerialMonitor(loggername,port,baudRate);
              }
              this.logginSerialConnection.openConnection().catch((err)=>{
                  console.log(`Plugin: could not monitor serial port ${this.portAddress} reason: ${err}`);
              });
            }
            else{
                this.openSerialPort(reject, resolve);
                this.installInputStreamListener();
            }
        });
    }

    public async upload() {
        await this.compileAndUpload();
    }

    protected async openSocketPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        this.socketConnection = new ClientSideSocket(this.deviceConfig.port, this.deviceConfig.ip);
        // TODO fix only on a newline handle the line
        this.socketConnection.on('data', (data)=>{this.handleLine(data);});
        const maxConnectionAttempts = 5;
        if(await this.socketConnection.openConnection(maxConnectionAttempts)){
            this.listener.notifyProgress(Messages.connected);
            this.client = undefined;
            resolve(`${this.deviceConfig.ip}:${this.deviceConfig.port}`);
        }
        else{
            reject(`Could not connect to socket ${this.deviceConfig.ip}:${this.deviceConfig.port}`);
        }
    }

    protected openSerialPort(reject: (reason?: any) => void, resolve: (value: string | PromiseLike<string>) => void) {
        this.client = new SerialPort({path: this.portAddress, baudRate: 115200},
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

    protected installInputStreamListener() {
        const parser = new ReadlineParser();
        this.client?.pipe(parser);
        let buff = '';
        parser.on("data", (line: string) => {
            try {
                if(buff === ''){
                    this.handleLine(line);
                }
                else{
                    this.handleLine(buff + line);
                }
            }
            catch(e){
                if(e instanceof SyntaxError){
                    buff +=line;
                }
                else{
                    buff ='';
                }
            }
        });
    }

    protected handleLine(line: string) {
        if (this.woodDumpDetected && this.outOfPlaceActive) {
            // Next line will be a WOOD dump
            // TODO receive state from WOOD Dump and call bridge.pushSession(state)
            this.woodState = new WOODState(line);
            this.requestCallbackmapping();
            this.woodDumpDetected = false;
            return;
        }

        if (this.woodState !== undefined && line.startsWith('{"callbacks": ')) {
            this.woodState.callbacks = line;
            this.pushSession();
        }
        this.woodDumpDetected = line.includes("DUMP!");
        console.log(`hardware: ${line}`);
        this.parser.parse(this, line);
    }

    public disconnect(): void {
        console.error("CLOSED!");
        if(!!this.client){
            this.client?.close((e) => {
                console.log(e);
                this.listener.notifyProgress(Messages.disconnected);
            });
        }
        else{
            // this.socketConnection?.close((e)=>{
            //     console.log(e);
        this.listener.notifyProgress(Messages.disconnected);
            // });
        }
    }

    protected uploadArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        let lastStdOut = "";
        this.listener.notifyProgress(Messages.reset);

        const upload = exec(`make flash PORT=${this.portAddress} FQBN=${this.fqbn}`, {cwd: path}, (err, stdout, stderr) => {
                console.error(err);
                lastStdOut = stdout + stderr;
                this.listener.notifyProgress(Messages.initialisationFailure);
            }
        );

        this.listener.notifyProgress(Messages.uploading);

        upload.on("close", (code) => {
            if (code === 0) {
                resolver(true);
            } else {
                reject(`Could not flash ended with ${code} \n${lastStdOut}`);
            }
        });
    }

    public compileArduino(path: string, resolver: (value: boolean) => void, reject: (value: any) => void): void {
        const compile = spawn("make", ["compile", `FQBN=${this.fqbn}`], {
            cwd: path
        });

        compile.stdout.on("data", data => {
            console.log(data.toString());
        });

        compile.stderr.on("data", (data: string) => {
            console.error(`HardwareDebugBridge stderr: ${data}`);
            this.listener.notifyProgress(Messages.initialisationFailure);
            reject(data);
        });

        compile.on("close", (code) => {
            console.log(`Arduino compilation exited with code ${code}`);
            if (code === 0) {
                this.listener.notifyProgress(Messages.compiled);
                this.uploadArduino(path, resolver, reject);
            } else {
                this.listener.notifyProgress(Messages.initialisationFailure);
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

    getCurrentFunctionIndex(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    pullSession(): void {
        this.outOfPlaceActive = true;
        this.listener.notifyProgress(Messages.transfering);
        this.sendInterrupt(InterruptTypes.interruptWOODDump, function (err: any) {
            console.log("Plugin: WOOD Dump");
            if (err) {
                return console.log("Error on write: ", err.message);
            }
        });
    }

    pushSession(): void {
        if (this.woodState === undefined) {
            return;
        }
        console.log("Plugin: transfer state received.");
        this.sendInterrupt(InterruptTypes.interruptProxify);
        this.listener.startMultiverseDebugging(this.woodState);
    }

    requestCallbackmapping() {
        this.sendInterrupt(InterruptTypes.interruptDUMPCallbackmapping);
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
