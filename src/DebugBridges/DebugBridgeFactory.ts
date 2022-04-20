import {DebugBridge} from "./DebugBridge";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {RunTimeTarget} from "./RunTimeTarget";
import {WARDuinoDebugBridgeEmulator} from "./WARDuinoDebugBridgeEmulator";
import {getFileExtension} from '../Parsers/ParseUtils';
import {WARDuinoDebugBridge} from "./WARDuinoDebugBridge";
import * as vscode from "vscode";
import {SourceMap} from "../State/SourceMap";
import {WOODDebugBridgeEmulator} from "./WOODDebugBridgeEmulator";

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

                switch (target) {
                    case RunTimeTarget.emulator:
                        bridge = new WARDuinoDebugBridgeEmulator(file, sourceMap, tmpdir, listener, warduinoSDK);
                        break;
                    case RunTimeTarget.embedded:
                        let portAddress: string | undefined = vscode.workspace.getConfiguration().get("warduino.Port");

                        if (portAddress === undefined) {
                            throw new Error('Configuration error. No port address set.');
                        }
                        bridge = new WARDuinoDebugBridge(file, sourceMap, tmpdir, listener, portAddress, warduinoSDK);
                        break;
                    case RunTimeTarget.wood:
                        bridge = new WOODDebugBridgeEmulator(file, sourceMap, tmpdir, listener, warduinoSDK);
                        break;
                }

                bridge.connect().then(() => {
                    console.log("Plugin: Connected.");
                    listener.connected();
                }).catch(reason => {
                    console.log(reason);
                });
                return bridge;
        }
        throw new Error("Unsupported file type");
    }
}