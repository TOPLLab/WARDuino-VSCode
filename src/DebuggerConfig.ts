// TODO validate configuration
import { readFileSync } from "fs";

class InvalidDebuggerConfiguration extends Error {
    constructor(errormsg: string) {
        super(`InvalidDebuggerConfiguration: ${errormsg}`);
    }
};

export class OnStartConfig {
    public readonly flash: boolean = true;
    public readonly updateSource: boolean = false;
    public readonly pause: boolean = true;

    constructor(flash: boolean, updateSource: boolean, pause: boolean) {
        this.flash = flash;
        this.updateSource = updateSource;
        this.pause = pause;
    }

    static defaultConfig(): OnStartConfig {
        const flash = true;
        const source = false;
        const pause = true;
        return new OnStartConfig(flash, source, pause);
    }

    static fromAnyObject(obj: any): OnStartConfig {
        if (typeof obj !== 'object') {
            throw (new InvalidDebuggerConfiguration("`onStart` property expected to be an object"));
        }

        const c = { flash: true, updateSource: false, pause: false };

        if (obj.hasOwnProperty('flash')) {
            c.flash = obj.flash;
        }

        if (obj.hasOwnProperty('updateSource')) {
            c.updateSource = obj.updateSource;
            console.log(`DebuggerConfig: update source not yet activated`);
        }

        if (obj.hasOwnProperty('pause')) {
            c.pause = obj.pause;
        }

        return new OnStartConfig(c.flash, c.updateSource, c.pause);
    }

}



export class WiFiCredentials {
    public readonly ssid: string;
    public readonly pswd: string;
    constructor(ssid: string, pswd: string) {
        this.ssid = ssid;
        this.pswd = pswd;
    }

    static validate(pathToCredentials: any): WiFiCredentials {
        const credentials = { "ssid": "", "pswd": "" };
        try {
            if (typeof pathToCredentials !== 'string') {
                throw (new InvalidDebuggerConfiguration("`wifiCredentials` is expected to be a path to a json file"));
            }
            const fileContent = readFileSync(pathToCredentials as string);
            const jsonObj = JSON.parse(fileContent.toString());
            if (jsonObj.hasOwnProperty('ssid')) {
                credentials.ssid = jsonObj['ssid'];
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: Provided json path ${pathToCredentials} does not exist`));
            }

            if (jsonObj.hasOwnProperty('pswd')) {
                credentials.pswd = jsonObj['pswd'];
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: ${pathToCredentials} misses 'pswd' property`));
            }
        }
        catch (e) {
            if (e instanceof InvalidDebuggerConfiguration) {
                throw e;
            }
            else if (e instanceof SyntaxError) {
                throw (new InvalidDebuggerConfiguration("DebuggerConfig: WifiCreditials is not valid JSON content"));
            }
            else {
                throw (new InvalidDebuggerConfiguration(`DebuggerConfig: Provided json path ${pathToCredentials} does not exist`));
            }
        }
        return new WiFiCredentials(credentials.ssid, credentials.pswd);
    }
}

export class ProxyConfig {
    static defaultPort = 8081;
    public port: number = ProxyConfig.defaultPort;
    public ip: string = "";
    public serialPort: string = "";
    public baudrate: number = -1;


    constructor(obj: any) {
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('serialPort')) {
            this.serialPort = obj.serialPort;
        }
        if (obj.hasOwnProperty('baudrate')) {
            this.baudrate = obj.baudrate;
        }
    }
}

export class DeviceConfig {

    static readonly emulatedDebugMode: string = "emulated";
    static readonly embeddedDebugMode: string = "embedded";
    static readonly allowedModes: Set<string> = new Set<string>([DeviceConfig.emulatedDebugMode, DeviceConfig.embeddedDebugMode]);
    static readonly defaultDebugPort: number = 8300;


    public readonly wifiCredentials: WiFiCredentials | undefined;

    public name: string = "";
    public port: number = -1;
    public ip: string = "";
    public debugMode: string = DeviceConfig.emulatedDebugMode;
    public proxyConfig: undefined | ProxyConfig;
    public onStartConfig: OnStartConfig;

    public serialPort: string = "";
    public baudrate: number = -1;
    public fqbn: string = "";

    constructor(obj: any) {
        if (obj.hasOwnProperty('wifiCredentials')) {
            const credentials = WiFiCredentials.validate(obj.wifiCredentials);
            this.wifiCredentials = new WiFiCredentials(credentials.ssid, credentials.pswd);
        }
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        else {
            this.port = DeviceConfig.defaultDebugPort;
        }

        if (obj.hasOwnProperty("name")) {
            this.name = obj.name;
        } else {
            this.name = this.ip === "" ? "device unknown" : this.ip;
        }

        if (DeviceConfig.allowedModes.has(obj.debugMode)) {
            this.debugMode = obj.debugMode;
        }
        else {
            throw (new InvalidDebuggerConfiguration(`No debugmode provided. Options: '${DeviceConfig.embeddedDebugMode}' or '${DeviceConfig.emulatedDebugMode}'`));
        }
        if (obj.hasOwnProperty("proxy")) {
            this.proxyConfig = new ProxyConfig(obj.proxy);
        }

        if (obj.hasOwnProperty("onStart")) {
            this.onStartConfig = OnStartConfig.fromAnyObject(obj.onStart);
        }
        else {
            this.onStartConfig = OnStartConfig.defaultConfig();
        }

        if (this.onStartConfig.flash) {
            if (!obj.hasOwnProperty("serialPort")) {
                throw (new InvalidDebuggerConfiguration('serialPort is missing. E.g "serialPort": "/dev/ttyUSB0"'));
            }
            if (!obj.hasOwnProperty("fqbn")) {
                throw (new InvalidDebuggerConfiguration('fqbn is missing from device configuration. E.g. "fqbn": "esp32:esp32:m5stick-c'));
            }
            if (!obj.hasOwnProperty("baudrate")) {
                throw (new InvalidDebuggerConfiguration('baudrate is missing from device configuration. E.g. "baudrate": 115200'));
            }
            if (this.ip && this.ip !== "" && !!!this.wifiCredentials) {
                throw (new InvalidDebuggerConfiguration('`wifiCredentials` entry (path to JSON) is needed when compiling for OTA debugging'));
            }
        }
        this.serialPort = obj.serialPort;
        this.fqbn = obj.fqbn;
        this.baudrate = obj.baudrate;
    }

    needsProxyToAnotherVM(): boolean {
        return !!this.proxyConfig && this.debugMode === DeviceConfig.emulatedDebugMode;
    }

    isForHardware(): boolean {
        return this.debugMode === DeviceConfig.embeddedDebugMode;
    }

    usesWiFi(): boolean {
        return !!this.wifiCredentials;
    }

    static defaultDeviceConfig(name: string = "emulated-vm"): DeviceConfig {
        return new DeviceConfig({
            name: name,
            port: DeviceConfig.defaultDebugPort,
            debugMode: DeviceConfig.emulatedDebugMode
        });
    }

    static configForProxy(deviceName: string, mcuConfig: DeviceConfig) {
        const pc = {
            port: mcuConfig.proxyConfig?.port,
            ip: mcuConfig.ip,
            serialPort: mcuConfig.serialPort,
            baudrate: mcuConfig.baudrate
        };
        if ((pc.serialPort === "" || pc.baudrate === -1) && pc.ip === "") {
            throw (new InvalidDebuggerConfiguration("cannot proxy a device without `serialPort` and/or `IP` address"));
        }
        if (pc.ip !== "" && pc.port === undefined) {
            pc.port = ProxyConfig.defaultPort;
        }
        const flash = false;
        const updateSource = false;
        const pause = true;
        const os = new OnStartConfig(flash, updateSource, pause);

        return new DeviceConfig({
            name: deviceName,
            ip: "127.0.0.1",
            port: DeviceConfig.defaultDebugPort,
            debugMode: DeviceConfig.emulatedDebugMode,
            proxy: pc,
            onStart: os
        });
    }

    static fromObject(obj: any): DeviceConfig {
        return new DeviceConfig(obj);
    }
}