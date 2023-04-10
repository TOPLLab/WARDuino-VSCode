import { DebugBridge } from "./DebugBridge";
import { Frame } from "../Parsers/Frame";
import { VariableInfo } from "../State/VariableInfo";
import { SourceMap } from "../State/SourceMap";
import { DebugBridgeListenerInterface } from "./DebugBridgeListenerInterface";
import { ExecutionStateType, WOODState } from "../State/WOODState";
import { InterruptTypes } from "./InterruptTypes";
import { FunctionInfo } from "../State/FunctionInfo";
import { ProxyCallItem } from "../Views/ProxyCallsProvider";
import { RuntimeState } from "../State/RuntimeState";
import { Breakpoint, BreakpointPolicy, UniqueSet } from "../State/Breakpoint";
import { HexaEncoder } from "../Util/hexaEncoding";
import { DeviceConfig } from "../DebuggerConfig";
import { DebuggingTimeline } from "../State/DebuggingTimeline";
import { RuntimeViewsRefresher } from "../Views/ViewsRefresh";
import { ChannelInterface } from "../Channels/ChannelInterface";
import { PauseRequest, Request, RunRequest, StackValueUpdateRequest, StateRequest, UpdateGlobalRequest } from "./APIRequest";

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
    protected abstract client: ChannelInterface | undefined;

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

    public async run(): Promise<void> {
        await this.client?.request(RunRequest);
        this.listener.runEvent();
    }

    public async pause(): Promise<void> {
        const req = PauseRequest;
        await this.client?.request(req);
        await this.refresh();
        this.listener.notifyPaused();
    }

    public hitBreakpoint() {
        this.listener.notifyBreakpointHit();
    }

    public async step(): Promise<void> {
        const runtimeState = this.timeline.advanceTimeline();
        if (!!runtimeState) {
            // Time travel forward
            const doNotSave = { includeInTimeline: false };
            this.updateRuntimeState(runtimeState, doNotSave);
        } else {
            await this.client?.request({
                dataToSend: InterruptTypes.interruptSTEP + "\n",
                responseMatchCheck: (line) => {
                    return line.includes("STEP");
                },
            });
            // Normal step forward
            await this.refresh();
        }
    }

    public stepBack() {
        // Time travel backward
        const rs = this.timeline.isActiveStateTheStart() ? this.timeline.getStartState() : this.timeline.goBackTimeline();
        if (!!rs) {
            const doNotSave = { includeInTimeline: false };
            this.updateRuntimeState(rs, doNotSave);
        }
    }

    abstract refresh(): Promise<void>;



    public unsetAllBreakpoints() {
        this.breakpoints.forEach(bp => this.unsetBreakPoint(bp));
    }

    public async unsetBreakPoint(breakpoint: Breakpoint | number) {
        let breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint instanceof Breakpoint ? breakpoint.id : breakpoint);
        const bp = breakpoint instanceof Breakpoint ? breakpoint : this.getBreakpointFromAddr(breakpoint);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPRem}${breakPointAddress}\n`,
            responseMatchCheck: (line: string) => {
                return line === `BP ${bp!.id}!`;
            }
        };
        await this.client?.request(req);
        console.log(`BP removed at line ${bp!.line} (Addr ${bp!.id})`)
        this.breakpoints.delete(bp);
    }

    private getBreakpointFromAddr(addr: number): Breakpoint | undefined {
        return Array.from(this.breakpoints).find(bp => bp.id === addr);
    }

    private async setBreakPoint(breakpoint: Breakpoint): Promise<void> {
        const breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint.id);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPAdd}${breakPointAddress}\n`,
            responseMatchCheck: (line: string) => {
                return line === `BP ${breakpoint.id}!`;
            }
        };
        await this.client?.request(req);
        console.log(`BP added at line ${breakpoint.line} (Addr ${breakpoint.id})`)
        this.breakpoints.add(breakpoint);
    }


    private async onBreakpointReached(line: string) {
        let breakpointInfo = line.match(/AT ([0-9]+)!/);
        if (!!breakpointInfo && breakpointInfo.length > 1) {
            await this.refresh();

            let bpAddress = parseInt(breakpointInfo[1]);
            if (this.getBreakpointPolicy() === BreakpointPolicy.singleStop) {
                this.getListener().notifyInfoMessage(`Enforcing '${BreakpointPolicy.singleStop}' breakpoint policy`);
                await this.unsetAllBreakpoints();
                await this.run();
            } else if (this.getBreakpointPolicy() === BreakpointPolicy.removeAndProceed) {
                this.getListener().notifyInfoMessage(`Enforcing '${BreakpointPolicy.removeAndProceed}' breakpoint policy`);
                await this.unsetBreakPoint(bpAddress);
                await this.run();
            }
        }
    }

    public registerCallbacks() {
        this.client?.addCallback(
            (line: string) => !!line.match(/AT ([0-9]+)!/),
            (line: string) => {
                this.onBreakpointReached(line);
            }
        );

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

    public async pushSession(woodState: WOODState) {
        console.log("Plugin: pusing state");
        const messages: string[] = woodState.toBinary();
        console.log(`sending ${messages.length} messages as new State\n`);
        for (let i = 0; i < messages.length; i++) {
            this.client?.write(messages[i]);
        }
    }

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

    //TODO remove
    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        if (!!this.client) {
            return this.client?.write(`${i} \n`, callback);
        }
        // else {
        //     return this.socketConnection?.write(`${i} \n`, callback);
        // }
    }

    //TODO remove
    protected sendData(d: string, callback?: (error: Error | null | undefined) => void) {
        if (!!this.client) {
            return this.client?.write(`${d}\n`, callback);
        }
        // else {
        //     return this.socketConnection?.write(`${d}\n`, callback);
        // }
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

    async requestMissingState(): Promise<void> {
        const missing: ExecutionStateType[] = this.getCurrentState()?.getMissingState() ?? [];
        const stateRequest = StateRequest.fromList(missing);
        if (stateRequest.isRequestEmpty()) {
            // promise that resolves instantly
            return new Promise((res) => {
                res();
            });
        }
        const req = stateRequest.generateRequest();
        const response = await this.client!.request(req);
        const missingState = new RuntimeState(response, this.sourceMap);
        const state = this.getCurrentState();
        state!.copyMissingState(missingState);
        console.log(`PC=${state!.getProgramCounter()} (Hexa ${state!.getProgramCounter().toString(16)})`);
        return;
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

    public isUpdateOperationAllowed(): boolean {
        return this.timeline.isActiveStatePresent() || !!this.timeline.getActiveState()?.hasAllState();
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


    async updateLocal(local: VariableInfo): Promise<void> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeStackValueUpdate(local.index);
        if (!!!command) {
            return;
        }

        const req = StackValueUpdateRequest(local.index, command);
        await this.client!.request(req);
    }

    async updateGlobal(global: VariableInfo): Promise<void> {
        const state = this.getCurrentState()?.getWasmState();
        const command = state?.serializeGlobalValueUpdate(global.index);
        if (!!!command) {
            return;
        }
        const req = UpdateGlobalRequest(global.index, command);
        await this.client!.request(req);
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