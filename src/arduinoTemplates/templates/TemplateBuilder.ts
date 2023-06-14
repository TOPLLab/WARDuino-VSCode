import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { DeviceConfig, ProxyConfig, WiFiCredentials } from '../../DebuggerConfig';


export class ArduinoTemplateBuilder {
    static sdkpath: string = '';

    static setPath2Templates(path2sdk: string) {
        ArduinoTemplateBuilder.sdkpath = `${path2sdk}/platforms/`;
    }

    static build(deviceConfig: DeviceConfig) {
        if (deviceConfig.usesWiFi()) {
            ArduinoTemplateBuilder.buildArduinoWithWifi(deviceConfig);
        }
        else {
            ArduinoTemplateBuilder.buildArduinoSerial(deviceConfig);
        }
    }

    static buildArduinoSerial(deviceConfig: DeviceConfig, outputDir: string = '', outputFilename: string = 'Arduino.ino') {
        const templateName = 'Arduino.template';
        const path2template = path.join(ArduinoTemplateBuilder.sdkpath, 'Arduino');
        const buf: Buffer = readFileSync(path.join(path2template, templateName));
        const pause = deviceConfig.onStartConfig.pause ? 'wac->program_state = WARDUINOpause;' : '';
        const content = buf.toString()
            .replace('{{initiallyPaused}}', pause);
        const output = path.join(outputDir === '' ? path2template : outputDir, outputFilename);
        writeFileSync(output, content);
        return false;
    }


    static buildArduinoWithWifi(deviceConfig: DeviceConfig, outputDir: string = '', outputFilename: string = 'Arduino-socket.ino'): boolean {
        if (!deviceConfig.usesWiFi()) {
            throw (new Error('ArduinoTemplateBuilder: cannot build Wifi based arduino without wifi credentials'));
        }
        const wifiCredentials = deviceConfig.wifiCredentials as WiFiCredentials;
        const templateName = 'Arduino-socket.template';
        const path2template = path.join(ArduinoTemplateBuilder.sdkpath, 'Arduino-socket');
        const buf: Buffer = readFileSync(path.join(path2template, templateName));
        const pause = deviceConfig.onStartConfig.pause ? 'wac->program_state = WARDUINOpause;' : '';
        const proxyPort = deviceConfig.proxyConfig?.port || ProxyConfig.defaultPort;
        const content = buf.toString()
            .replace('{{SSID}}', wifiCredentials.ssid)
            .replace('{{Password}}', wifiCredentials.pswd)
            .replace('{{initiallyPaused}}', pause)
            .replace('{{port}}', deviceConfig.port.toString())
            .replace('{{proxyPort}}', proxyPort.toString());
        const output = path.join(outputDir === '' ? path2template : outputDir, outputFilename);
        writeFileSync(output, content);
        return false;
    }
}