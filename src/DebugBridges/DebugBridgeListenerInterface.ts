import { WOODState } from '../Model/RuntimeState/WOODState';
import { DebugBridge } from './DebugBridge';

export interface DebugBridgeListenerInterface {
    setBridge(debugBridge: DebugBridge): void;

    connected(): void;

    disconnected(): void;

    startMultiverseDebugging(woodState: WOODState): void;

    notifyError(message: string): void;

    notifyProgress(message: string): void;

    notifyProgressInNotification(title: string, message: string): void;

    notifyStateUpdate(): void;

    notifyPaused(): void;

    notifyBreakpointHit(): void;

    notifyException(message: string): void;

    notifyDisallowedOperation(message: string): void;

    notifyInfoMessage(message: string): void;

    notifyConnected(): void;

    runEvent(): void;

}
