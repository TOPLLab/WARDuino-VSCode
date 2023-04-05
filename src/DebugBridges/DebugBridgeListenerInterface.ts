import { WOODState } from "../State/WOODState";
import { DebugBridge } from "./DebugBridge";

export interface DebugBridgeListenerInterface {
    setBridge(debugBridge: DebugBridge): void;

    connected(): void;

    disconnected(): void;

    startMultiverseDebugging(woodState: WOODState): void;

    notifyError(message: string): void;

    notifyProgress(message: string): void;

    notifyStateUpdate(): void;

    notifyPaused(): void;

    notifyBreakpointHit(): void;

    notifyException(message: string): void;

    notifyInfoMessage(message: string): void;

    notifyConnected(): void;

    runEvent(): void;

}
