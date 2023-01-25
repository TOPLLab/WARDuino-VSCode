// TODO validate configuration
import { readFileSync } from "fs";

class InvalidDebuggerConfiguration extends Error {
    constructor(errormsg: string) {
        super(`InvalidDebuggerConfiguration: ${errormsg}`);
    }
};

class OnStartConfig {
    public readonly flash: boolean = true;
    public readonly updateSource: boolean = false;
    constructor(flash: boolean, updateSource: boolean) {
        this.flash = flash;
        this.updateSource = updateSource;
    }

    static defaultConfig(): OnStartConfig {
        return new OnStartConfig(true, false);
    }

    static fromAnyObject(obj: any): OnStartConfig {
        if (typeof obj !== 'object') {
            throw (new InvalidDebuggerConfiguration("`onStart` property expected to be an object"));
        }

        const c = { flash: true, updateSource: false };

        if (obj.hasOwnProperty('flash')) {
            c.flash = obj.flash;
        }

        if (obj.hasOwnProperty('updateSource')) {
            c.updateSource = obj.updateSource;
            console.log(`DebuggerConfig: update source not yet activated`);
        }
        return new OnStartConfig(c.flash, c.updateSource);
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
    public port: number = -1;
    public ip: string = "";
    public serial: string = "";


    constructor(obj: any) {
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('serial')) {
            this.serial = obj.serial;
        }
    }
}

export class DeviceConfig {

    static readonly emulatedDebugMode: string = "emulated";
    static readonly mcuDebugMode: string = "mcu";
    static readonly allowedModes: Set<string> = new Set<string>([DeviceConfig.emulatedDebugMode, DeviceConfig.mcuDebugMode]);
    static readonly defaultDebugPort: number = 8300;

    public name: string = "";
    public ip: string = "";
    public port: number = DeviceConfig.defaultDebugPort;
    public debugMode: string = DeviceConfig.emulatedDebugMode;
    public proxyConfig: undefined | ProxyConfig;
    public onStartConfig: OnStartConfig;

    constructor(obj: any) {
        if (obj.hasOwnProperty('ip')) {
            this.ip = obj.ip;
        }
        if (obj.hasOwnProperty('port')) {
            this.port = obj.port;
        }
        if (obj.hasOwnProperty("name")) {
            this.name = obj.name;
        } else {
            this.name = this.ip === "" ? "device unknown" : this.ip;
        }

        if (DeviceConfig.allowedModes.has(obj.debugMode)) {
            this.debugMode = obj.debugMode;
        }
        if (obj.hasOwnProperty("proxy")) {
            this.proxyConfig = new ProxyConfig(obj.proxy);
            if (this.debugMode === DeviceConfig.mcuDebugMode) {
                throw (new InvalidDebuggerConfiguration("Proxying not allowed for MCU"));
            }
        }

        if (obj.hasOwnProperty("onStart")) {
            this.onStartConfig = OnStartConfig.fromAnyObject(obj.onStart);
        }
        else {
            this.onStartConfig = OnStartConfig.defaultConfig();
        }
    }

    needsProxyToAnotherVM(): boolean {
        return !!this.proxyConfig;
    }

    static defaultDeviceConfig(name: string = "emulated-vm"): DeviceConfig {
        return new DeviceConfig({
            name: name,
            port: DeviceConfig.defaultDebugPort,
            mode: DeviceConfig.emulatedDebugMode
        });
    }
}

export class DebuggerConfig {

    public ssid: string = "";
    public pswd: string = "";
    public device: DeviceConfig = DeviceConfig.defaultDeviceConfig('emulated-vm');

    constructor() {
    }

    fillConfig(obj: any) {

        if (obj.hasOwnProperty('wifiCredentials')) {
            const credentials = WiFiCredentials.validate(obj.wifiCredentials);
            this.ssid = credentials.ssid;
            this.pswd = credentials.pswd;
        }

        if (obj.hasOwnProperty('device')) {
            this.device = new DeviceConfig(obj.device);
        }
    }
}