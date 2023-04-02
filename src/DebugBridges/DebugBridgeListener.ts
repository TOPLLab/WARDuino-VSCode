import { WOODState } from "../State/WOODState";

export interface DebugBridgeListener {
    connected(): void;

    disconnected(): void;

    startMultiverseDebugging(woodState: WOODState): void;

    notifyError(message: string): void;

    notifyProgress(message: string): void;

    notifyStateUpdate(): void;

    notifyPaused(): void;

    notifyBreakpointHit(): void;

    notifyException(message: string): void;
}
