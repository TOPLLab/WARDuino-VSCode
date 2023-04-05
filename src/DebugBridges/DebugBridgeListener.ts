import * as vscode from 'vscode';
import {
    ContinuedEvent,
    StoppedEvent
} from 'vscode-debugadapter';
import { WARDuinoDebugSession } from "../DebugSession/DebugSession";
import { DebugBridge } from "./DebugBridge";
import { DebugBridgeListenerInterface } from "./DebugBridgeListenerInterface";
import { WOODState } from '../State/WOODState';

export class BridgeListener implements DebugBridgeListenerInterface {

    private debugSession: WARDuinoDebugSession;
    private debugBridge: DebugBridge | undefined;
    private THREAD_ID: number;
    private notifier: vscode.StatusBarItem;

    constructor(debugSession: WARDuinoDebugSession, THREAD_ID: number, notifier: vscode.StatusBarItem) {
        this.debugSession = debugSession;
        this.debugBridge = undefined;
        this.THREAD_ID = THREAD_ID;
        this.notifier = notifier;
    }

    public setBridge(debugBridge: DebugBridge) {
        this.debugBridge = debugBridge;
    }

    public notifyError(message: string) {
        this.debugSession.stop();
    }

    public notifyConnected(): void {
        const deviceName = this.debugBridge?.getDeviceConfig().name;
        if (!!deviceName) {
            vscode.window.showInformationMessage(deviceName);
        }
    }


    public connected(): void {
        if (this.debugBridge?.getDeviceConfig().onStartConfig.pause) {
            this.notifyPaused();
        }
    }

    public notifyPaused(refresh: boolean = true): void {
        this.debugSession.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
        this.debugBridge?.refresh();
    }

    public notifyBreakpointHit(): void {
        this.debugSession.sendEvent(new StoppedEvent('breakpoint', this.THREAD_ID));
        this.debugBridge?.refresh();
    }

    public disconnected(): void {

    }

    public notifyProgress(message: string): void {
        this.notifier.text = message;
    }

    public notifyStateUpdate(): void {
        this.debugSession.notifyStepCompleted();
    }

    public notifyException(message: string): void {
        vscode.window.showErrorMessage(message);
        this.debugSession.sendEvent(new StoppedEvent('pause', this.THREAD_ID));
    }

    public notifyInfoMessage(message: string) {
        vscode.window.showInformationMessage(message);
    }

    public runEvent() {
        this.debugSession.sendEvent(new ContinuedEvent(this.THREAD_ID));
    }

    public startMultiverseDebugging(woodState: WOODState) {
        return;
    }
}