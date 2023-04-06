import { DebugBridge } from "./DebugBridge";
import { Frame } from "../Parsers/Frame";
import { VariableInfo } from "../State/VariableInfo";
import { SourceMap } from "../State/SourceMap";
import { DebugBridgeListenerInterface } from "./DebugBridgeListenerInterface";
import { ExecutionStateType, StateRequest, WOODState } from "../State/WOODState";
import { InterruptTypes } from "./InterruptTypes";
import { Writable } from "stream";
import { EventItem, EventsProvider } from "../Views/EventsProvider";
import { FunctionInfo } from "../State/FunctionInfo";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy, UniqueSet } from "../State/Breakpoint";
import { HexaEncoder } from "../Util/hexaEncoding";
import { DeviceConfig } from "../DebuggerConfig";
import { ClientSideSocket } from "../Channels/ClientSideSocket";
import { StackProvider } from "../Views/StackProvider";
import { DebuggingTimeline } from "../State/DebuggingTimeline";
import { RuntimeViewsRefresher } from "../Views/ViewsRefresh";

export class Messages {
    public static readonly compiling: string = 'Compiling the code';
    public static readonly compiled: string = 'Compiled Code';
    public static readonly reset: string = 'Press reset button';
    public static readonly transfering: string = 'Transfering state';
    public static readonly uploading: string = 'Uploading to board';
    public static readonly connecting: string = 'Connecting to board';
    public static readonly connected: string = 'Connected to board';
    public static readonly disconnected: string = 'Disconnected board';
    public static readonly initialisationFailure: string = 'Failed to initialise';
    public static readonly connectionFailure: string = 'Failed to connect device';
}

function convertToLEB128(a: number): string { // TODO can only handle 32 bit
    a |= 0;
    const result = [];
    while (true) {
        const byte_ = a & 0x7f;
        a >>= 7;
        if (
            (a === 0 && (byte_ & 0x40) === 0) ||
            (a === -1 && (byte_ & 0x40) !== 0)
        ) {
            result.push(byte_.toString(16).padStart(2, '0'));
            return result.join('').toUpperCase();
        }
        result.push((byte_ | 0x80).toString(16).padStart(2, '0'));
    }
}

export abstract class AbstractDebugBridge implements DebugBridge {
    // State
    protected sourceMap: SourceMap;
    protected startAddress: number = 0;
    protected pc: number = 0;
    protected callstack: Frame[] = [];
    protected selectedProxies: Set<ProxyCallItem> = new Set<ProxyCallItem>();
    protected breakpoints: UniqueSet<Breakpoint> = new UniqueSet<Breakpoint>();
    protected breakpointPolicy: BreakpointPolicy;

    // Interfaces
    protected listener: DebugBridgeListenerInterface;
    protected abstract client: Writable | undefined;
    public socketConnection?: ClientSideSocket;

    // History (time-travel)
    protected timeline: DebuggingTimeline = new DebuggingTimeline();

    public readonly deviceConfig: DeviceConfig;
    public outOfPlaceActive = false;


    private viewsRefresher: RuntimeViewsRefresher;

    protected constructor(deviceConfig: DeviceConfig, sourceMap: SourceMap, viewRefresher: RuntimeViewsRefresher, listener: DebugBridgeListenerInterface) {
        this.sourceMap = sourceMap;
        const callbacks = sourceMap?.importInfos ?? [];
        this.selectedProxies = new Set<ProxyCallItem>(callbacks.map((primitive: FunctionInfo) => (new ProxyCallItem(primitive))))
            ?? new Set<ProxyCallItem>();
        this.listener = listener;
        this.deviceConfig = deviceConfig;
        this.breakpointPolicy = BreakpointPolicy.default;
        this.viewsRefresher = viewRefresher;
        this.listener.setBridge(this);
    }

    // General Bridge functionality

    abstract connect(): Promise<string>;

    abstract disconnect(): void;

    abstract upload(): void;

    // Debug API

    abstract proxify(): void;

    public run(): void {
        // this.resetHistory();
        console.log("Bridge: Running no longer resets history");
        this.sendInterrupt(InterruptTypes.interruptRUN);
    }

    public pause(): void {
        this.sendInterrupt(InterruptTypes.interruptPAUSE);
        this.listener.notifyPaused();
    }

    public hitBreakpoint() {
        this.listener.notifyBreakpointHit();
    }

    public step(): void {
        const runtimeState = this.timeline.advanceTimeline();
        if (!!runtimeState) {
            // Time travel forward
            const doNotSave = { includeInTimeline: false };
            this.updateRuntimeState(runtimeState, doNotSave);
        } else {
            // Normal step forward
            this.sendInterrupt(InterruptTypes.interruptSTEP, function (err: any) {
                console.log('Plugin: Step');
                if (err) {
                    return console.log('Error on write: ', err.message);
                }
            });
        }
    }

    public stepBack() {
        // Time travel backward
        const rs = this.timeline.goBackTimeline();
        if (!!rs) {
            this.updateRuntimeState(rs);
        }
    }

    abstract refresh(): void;



    public unsetAllBreakpoints() {
        this.breakpoints.forEach(bp => this.unsetBreakPoint(bp));
    }

    public unsetBreakPoint(breakpoint: Breakpoint | number) {
        let breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint instanceof Breakpoint ? breakpoint.id : breakpoint);
        let command = `${InterruptTypes.interruptBPRem}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        if (!!this.client) {
            this.client?.write(command);
        }
        else {
            this.socketConnection?.write(command);
        }
        const bp = breakpoint instanceof Breakpoint ? breakpoint : this.getBreakpointFromAddr(breakpoint);
        this.breakpoints.delete(bp);
    }

    private getBreakpointFromAddr(addr: number): Breakpoint | undefined {
        return Array.from(this.breakpoints).find(bp => bp.id === addr);
    }

    private setBreakPoint(breakpoint: Breakpoint) {
        this.breakpoints.add(breakpoint);
        let breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint.id);
        let command = `${InterruptTypes.interruptBPAdd}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        if (!!this.client) {
            this.client?.write(command);
        }
        else {
            this.socketConnection?.write(command);
        }
    }

    public setBreakPoints(lines: number[]): Breakpoint[] {
        if (this.sourceMap === undefined) {
            console.log('setBreakPointsRequest: no source map');
            return [];
        }

        // Delete absent breakpoints
        Array.from<Breakpoint>(this.breakpoints.values())
            .filter((breakpoint) => !lines.includes(breakpoint.id))
            .forEach(breakpoint => this.unsetBreakPoint(breakpoint));

        // Add missing breakpoints
        lines.forEach((line) => {
            if (this.isNewBreakpoint(line)) {
                const breakpoint: Breakpoint = new Breakpoint(this.lineToAddress(line), line);
                this.setBreakPoint(breakpoint);
            }
        });

        return Array.from(this.breakpoints.values());  // return new breakpoints list
    }

    private isNewBreakpoint(line: Number): boolean {
        const lineInfoPair = this.sourceMap?.lineInfoPairs.find(info => info.lineInfo.line === line);
        return lineInfoPair !== undefined
            && !Array.from<Breakpoint>(this.breakpoints.values()).some(value => value.id === line);
    }

    private lineToAddress(line: number): number {
        const lineInfoPair = this.sourceMap?.lineInfoPairs.find(info => info.lineInfo.line === line);
        return parseInt('0x' + lineInfoPair?.lineAddress ?? '');
    }


    abstract pullSession(): void;

    abstract pushSession(woodState: WOODState): void;



    public notifyNewEvent(): void {
        const req = new StateRequest();
        req.includeEvents();
        this.sendData(req.generateInterrupt(), (err: any) => {
            if (err) {
                console.error(`Request eventdump failed reason: ${err}`);
            }
        })
    }

    public popEvent(): void {
        this.sendInterrupt(InterruptTypes.interruptPOPEvent);
    }

    // Helper functions

    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        if (!!this.client) {
            return this.client?.write(`${i} \n`, callback);
        }
        else {
            return this.socketConnection?.write(`${i} \n`, callback);
        }
    }

    protected sendData(d: string, callback?: (error: Error | null | undefined) => void) {
        if (!!this.client) {
            return this.client?.write(`${d}\n`, callback);
        }
        else {
            return this.socketConnection?.write(`${d}\n`, callback);
        }
    }


    protected getPrimitives(): number[] {
        return this.sourceMap?.importInfos.map((primitive: FunctionInfo) => (primitive.index)) ?? [];
    }

    public getSelectedProxies(): Set<ProxyCallItem> {
        return this.selectedProxies;
    }

    protected getSelectedProxiesByIndex(): number[] {
        return [...this.selectedProxies].map((callback: ProxyCallItem) => (callback.index));
    }

    public setSelectedProxies(proxies: Set<ProxyCallItem>) {
        this.selectedProxies = proxies;
    }

    public updateSelectedProxies(proxy: ProxyCallItem) {
        if (proxy.isSelected()) {
            this.selectedProxies.add(proxy);
        } else {
            this.selectedProxies.delete(proxy);
        }
        console.warn('Only WOOD Emulator Debug Bridge needs proxies');
    }


    // Getters and Setters

    requestMissingState(): void {
        const missing: ExecutionStateType[] = this.getCurrentState()?.getMissingState() ?? [];
        const stateRequest = StateRequest.fromList(missing);
        if (stateRequest.isRequestEmpty()) {
            return;
        }
        const req = stateRequest.generateInterrupt();
        const cberr = (err: any) => {
            if (err) {
                console.error(`AbstractDebubBridge: requestMissingstate error ${err}`);
            }
        };
        this.sendData(req, cberr);
    }

    getDeviceConfig() {
        return this.deviceConfig;
    }

    getListener(): DebugBridgeListenerInterface {
        return this.listener;
    }

    getDebuggingTimeline(): DebuggingTimeline {
        return this.timeline;
    }

    getCurrentState(): RuntimeState | undefined {
        return this.timeline.getActiveState();
    }

    getBreakpointPolicy(): BreakpointPolicy {
        return this.breakpointPolicy;
    }

    setBreakpointPolicy(policy: BreakpointPolicy) {
        this.breakpointPolicy = policy;
    }

    updateRuntimeState(runtimeState: RuntimeState, opts?: { refreshViews?: boolean, includeInTimeline?: boolean }) {
        const includeInTimeline = opts?.includeInTimeline ?? true;
        if (includeInTimeline && this.timeline.isActiveStatePresent()) {
            this.timeline.addRuntime(runtimeState.deepcopy());
            if (!!!this.timeline.advanceTimeline()) {
                throw new Error("Timeline should be able to advance")
            }
        }

        const refresh = opts?.refreshViews ?? true;
        if (refresh) {
            this.refreshRuntimeState(runtimeState);
            this.listener.notifyStateUpdate();
        }

    }

    public refreshViews() {
        const rs = this.getCurrentState();
        if (!!rs) {
            this.refreshRuntimeState(rs);
        }
    }

    private refreshRuntimeState(runtimeState: RuntimeState) {
        if (runtimeState.hasException()) {
            this.listener.notifyException(runtimeState.getExceptionMsg());
        }
        this.viewsRefresher.refreshViews(runtimeState);
    }

    getProgramCounter(): number {
        return this.pc;
    }

    setProgramCounter(pc: number) {
        this.pc = pc;
    }

    getBreakpointPossibilities(): Breakpoint[] {
        return this.sourceMap?.lineInfoPairs.map(info => new Breakpoint(this.lineToAddress(info.lineInfo.line), info.lineInfo.line)) ?? [];
    }


    updateLocal(local: VariableInfo): Promise<string> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeStackValueUpdate(local.index);
        return new Promise<string>((resolve, reject) => {
            console.log(`setting ${local.name} ${local.value}`);
            if (!!!command) {
                reject("Local not found.");
                return;
            }
            this.client?.write(`${command}\n`);
            resolve("updated");
        });
    }

    updateGlobal(global: VariableInfo): Promise<string> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeGlobalValueUpdate(global.index);
        return new Promise<string>((resolve, reject) => {
            console.log(`setting ${global.name} ${global.value}`);
            if (!!!command) {
                reject("Global not found.");
                return;
            }
            this.client?.write(`${command}\n`);
            resolve("updated");
        });
    }



    updateSourceMapper(newSourceMap: SourceMap): void {
        this.sourceMap = newSourceMap;
    }

    updateModule(wasm: Buffer): void {
        const w = new Uint8Array(wasm);
        const sizeHex: string = convertToLEB128(w.length);
        const wasmHex = Buffer.from(w).toString('hex');
        let command = `${InterruptTypes.interruptUPDATEMod}${sizeHex}${wasmHex} \n`;
        console.log('Plugin: send Update module command');
        this.client?.write(command);
    }
}