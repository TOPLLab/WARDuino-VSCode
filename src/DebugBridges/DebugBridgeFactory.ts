import { DebugBridge } from './DebugBridge';
import { DebugBridgeListenerInterface } from './DebugBridgeListenerInterface';
import { RunTimeTarget } from './RunTimeTarget';
import { EmulatedDebugBridge } from './EmulatedDebugBridge';
import { getFileExtension } from '../Parsers/ParseUtils';
import { HardwareDebugBridge } from './HardwareDebugBridge';
import * as vscode from 'vscode';
import { SourceMap } from '../State/SourceMap';
import { WOODDebugBridge } from './WOODDebugBridge';
import { DeviceConfig } from '../DebuggerConfig';

function getConfig(id: string): string {
    const config: string | undefined = vscode.workspace.getConfiguration().get(id);
    if (config === undefined) {
        throw new Error(`${config} is not set.`);
    }
    return config;
}

export class DebugBridgeFactory {
    static makeDebugBridge(file: string, deviceConfig: DeviceConfig, sourceMap: SourceMap, target: RunTimeTarget, tmpdir: string): DebugBridge {
        let fileType = getFileExtension(file);
        let bridge;
        switch (fileType) {
            case 'ts':
            case 'wast' :
                const warduinoSDK: string = getConfig('warduino.WARDuinoToolChainPath');
                switch (target) {
                    // Emulated runtimes
                    case RunTimeTarget.emulator:
                        bridge = new EmulatedDebugBridge(deviceConfig, sourceMap, tmpdir, warduinoSDK);
                        break;
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridge(deviceConfig, sourceMap, tmpdir, warduinoSDK);
                        break;
                        // Hardware runtimes
                    case RunTimeTarget.embedded:
                        bridge = new HardwareDebugBridge(deviceConfig, sourceMap, tmpdir, warduinoSDK);
                        break;
                }

                return bridge;
        }
        throw new Error('Unsupported file type');
    }
}
