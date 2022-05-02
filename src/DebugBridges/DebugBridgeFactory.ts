import {DebugBridge} from "./DebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {RunTimeTarget} from "./RunTimeTarget";
import {EmulatedDebugBridge} from "./EmulatedDebugBridge";
import {getFileExtension} from '../Parsers/ParseUtils';
import {HardwareDebugBridge} from "./HardwareDebugBridge";
import * as vscode from "vscode";
import {SourceMap} from "../State/SourceMap";
import {WOODDebugBridge} from "./WOODDebugBridge";
import {Messages} from "./AbstractDebugBridge";
import {DroneDebugBridge} from "./DroneDebugBridge";

export class DebugBridgeFactory {
    static makeDebugBridge(file: string, sourceMap: SourceMap | void, target: RunTimeTarget, tmpdir: string, listener: DebugBridgeListener): DebugBridge {
        let fileType = getFileExtension(file);
        let bridge;
        switch (fileType) {
            case "wast" :
                const warduinoSDK: string | undefined = vscode.workspace.getConfiguration().get("warduino.WarduinoToolChainPath");
                if (warduinoSDK === undefined) {
                    throw new Error('WARDuino Tool Chain not set');
                }

                let portAddress: string | undefined;
                let fqbn: string | undefined;
                switch (target) {
                    case RunTimeTarget.emulator:
                        bridge = new EmulatedDebugBridge(file, sourceMap, tmpdir, listener, warduinoSDK);
                        break;
                    case RunTimeTarget.embedded:
                        portAddress = vscode.workspace.getConfiguration().get("warduino.Port");
                        fqbn = vscode.workspace.getConfiguration().get("warduino.Device");

                        if (portAddress === undefined || fqbn === undefined) {
                            throw new Error('Configuration error. No port address set.');
                        }
                        bridge = new HardwareDebugBridge(file, sourceMap, tmpdir, listener, portAddress, fqbn, warduinoSDK);
                        break;
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridge(file, sourceMap, tmpdir, listener, warduinoSDK);
                        break;
                    case RunTimeTarget.drone:
                        portAddress = vscode.workspace.getConfiguration().get("warduino.Port");
                        fqbn = vscode.workspace.getConfiguration().get("warduino.Device");

                        if (portAddress === undefined || fqbn === undefined) {
                            throw new Error('Configuration error. No port address set.');
                        }
                        bridge = new DroneDebugBridge(file, sourceMap, tmpdir, listener, portAddress, fqbn, warduinoSDK);
                        break;
                }

                bridge.connect().then(() => {
                    console.log("Plugin: Connected.");
                    listener.connected();
                }).catch(reason => {
                    console.log(reason);
                    listener.notifyProgress(Messages.connectionFailure);
                });
                return bridge;
        }
        throw new Error("Unsupported file type");
    }
}
