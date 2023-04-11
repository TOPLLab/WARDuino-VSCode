import { DebugBridge } from "./DebugBridge";
import { Frame } from "../Parsers/Frame";
import { VariableInfo } from "../State/VariableInfo";
import { SourceMap } from "../State/SourceMap";
import { ExecutionStateType, WOODDumpResponse, WOODState } from "../State/WOODState";
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
import { PauseRequest, Request, RunRequest, StackValueUpdateRequest, StateRequest, UpdateGlobalRequest, UpdateStateRequest } from "./APIRequest";
import { EventItem } from "../Views/EventsProvider";
import EventEmitter = require("events");

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

export class EventsMessages {
    public static readonly stateUpdated: string = "state updated";
    public static readonly stepCompleted: string = "stepped";
    public static readonly running: string = "running";
    public static readonly paused: string = "paused";
    public static readonly exceptionOccurred: string = "exception occurred";
    public static readonly enforcingBreakpointPolicy: string = "enforcing breakpoint policy";
    public static readonly connected: string = "connected";
    public static readonly connectionError: string = "connectionError";
    public static readonly disconnected: string = "disconnected";
    public static readonly emulatorStarted: string = "emulator started";
    public static readonly emulatorClosed: string = "emulator closed";
    public static readonly progress: string = "progress";
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

export abstract class AbstractDebugBridge extends EventEmitter implements DebugBridge {
    // State
    protected sourceMap: SourceMap;
    protected startAddress: number = 0;
    protected pc: number = 0;
    protected callstack: Frame[] = [];
    protected selectedProxies: Set<ProxyCallItem> = new Set<ProxyCallItem>();
    protected breakpoints: UniqueSet<Breakpoint> = new UniqueSet<Breakpoint>();
    protected breakpointPolicy: BreakpointPolicy;

    // Interfaces
    protected abstract client: ChannelInterface | undefined;

    // History (time-travel)
    protected timeline: DebuggingTimeline = new DebuggingTimeline();

    public readonly deviceConfig: DeviceConfig;
    public outOfPlaceActive = false;

    protected constructor(deviceConfig: DeviceConfig, sourceMap: SourceMap) {
        super();
        this.sourceMap = sourceMap;
        const callbacks = sourceMap?.importInfos ?? [];
        this.selectedProxies = new Set<ProxyCallItem>(callbacks.map((primitive: FunctionInfo) => (new ProxyCallItem(primitive))))
            ?? new Set<ProxyCallItem>();
        this.deviceConfig = deviceConfig;
        this.breakpointPolicy = BreakpointPolicy.default;
    }

    // General Bridge functionality

    abstract connect(): Promise<string>;

    abstract disconnect(): void;

    abstract upload(): void;

    // Debug API

    abstract proxify(): void;

    public async run(): Promise<void> {
        await this.client?.request(RunRequest);
        this.emit(EventsMessages.running);
    }

    public async pause(): Promise<void> {
        const req = PauseRequest;
        await this.client?.request(req);
        await this.refresh();
        this.emit(EventsMessages.paused);
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
                expectedResponse: (line) => {
                    return line.includes("STEP");
                },
            });
            // Normal step forward
            await this.refresh();
        }
        this.emit(EventsMessages.stepCompleted);
    }

    public stepBack() {
        // Time travel backward
        const rs = this.timeline.isActiveStateTheStart() ? this.timeline.getStartState() : this.timeline.goBackTimeline();
        if (!!rs) {
            const doNotSave = { includeInTimeline: false };
            this.updateRuntimeState(rs, doNotSave);
            this.emit(EventsMessages.paused);
        }
    }

    abstract refresh(): Promise<void>;



    public async unsetAllBreakpoints(): Promise<void> {
        await Promise.all(Array.from(this.breakpoints).map(bp => this.unsetBreakPoint(bp)));
    }

    public async unsetBreakPoint(breakpoint: Breakpoint | number) {
        let breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint instanceof Breakpoint ? breakpoint.id : breakpoint);
        const bp = breakpoint instanceof Breakpoint ? breakpoint : this.getBreakpointFromAddr(breakpoint);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPRem}${breakPointAddress}\n`,
            expectedResponse: (line: string) => {
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

    private async setBreakPoint(breakpoint: Breakpoint): Promise<Breakpoint> {
        const breakPointAddress: string = HexaEncoder.serializeUInt32BE(breakpoint.id);
        const req: Request = {
            dataToSend: `${InterruptTypes.interruptBPAdd}${breakPointAddress}\n`,
            expectedResponse: (line: string) => {
                return line === `BP ${breakpoint.id}!`;
            }
        };
        await this.client?.request(req);
        console.log(`BP added at line ${breakpoint.line} (Addr ${breakpoint.id})`)
        this.breakpoints.add(breakpoint);
        return breakpoint;
    }


    private async onBreakpointReached(line: string) {
        let breakpointInfo = line.match(/AT ([0-9]+)!/);
        if (!!breakpointInfo && breakpointInfo.length > 1) {
            let bpAddress = parseInt(breakpointInfo[1]);
            console.log(`BP reached at line ${this.getBreakpointFromAddr(bpAddress)?.line} (addr=${bpAddress})`)
            await this.refresh();

            if (this.getBreakpointPolicy() === BreakpointPolicy.singleStop) {
                this.emit(EventsMessages.enforcingBreakpointPolicy, BreakpointPolicy.singleStop);
                await this.unsetAllBreakpoints();
                await this.run();
            } else if (this.getBreakpointPolicy() === BreakpointPolicy.removeAndProceed) {
                this.emit(EventsMessages.enforcingBreakpointPolicy, BreakpointPolicy.removeAndProceed);
                await this.unsetBreakPoint(bpAddress);
                await this.run();
            }
            else {
                this.emit(EventsMessages.paused);
            }
        }
    }

    protected registerCallbacks() {
        this.registerAtBPCallback();
        this.registerOnNewPushedEventCallback();
        this.registerOnExceptionCallback();
    }

    public async setBreakPoints(lines: number[]): Promise<Breakpoint[]> {
        // Delete absent breakpoints
        await Promise.all(Array.from<Breakpoint>(this.breakpoints.values())
            .filter((breakpoint) => !lines.includes(breakpoint.id))
            .map(breakpoint => this.unsetBreakPoint(breakpoint)));

        // Add missing breakpoints
        await Promise.all(
            lines
                .filter((line) => { return this.isNewBreakpoint(line); })
                .map(line => {
                    const breakpoint: Breakpoint = new Breakpoint(this.lineToAddress(line), line);
                    return this.setBreakPoint(breakpoint);
                })
        );
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

    public async pushSession(woodState: WOODState): Promise<void> {
        const messages: string[] = woodState.toBinary();
        const requests: Request[] = UpdateStateRequest(messages);
        console.log(`sending ${messages.length} messages as new State\n`);
        const promises = requests.map(req => {
            return this.client!.request(req);
        })
        await Promise.all(promises);
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
        this.emitNewStateEvent();
    }

    public isUpdateOperationAllowed(): boolean {
        return this.timeline.isActiveStatePresent() || !!this.timeline.getActiveState()?.hasAllState();
    }

    public emitNewStateEvent() {
        const currentState = this.getCurrentState();
        console.log(`PC=${currentState!.getProgramCounter()} (Hexa ${currentState!.getProgramCounter().toString(16)})`);
        this.emit(EventsMessages.stateUpdated, currentState);
        if (currentState?.hasException()) {
            this.emit(EventsMessages.exceptionOccurred, this, currentState);
        }
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

    async updateArgument(argument: VariableInfo): Promise<void> {
        await this.updateLocal(argument);
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

    private onPushedEvents(line: string) {
        const rs = this.getCurrentState();
        const evts = JSON.parse(line).events;
        if (!!rs && !!evts) {
            rs.setEvents(evts.map((obj: EventItem) => (new EventItem(obj.topic, obj.payload))));
            this.emitNewStateEvent();
        }
    }

    private onNotifyNewEvent(line: string) {
        return line === "new pushed event";
    }

    private async refreshEvents() {
        const req = new StateRequest();
        req.includeEvents();
        this.sendData(req.generateInterrupt(), (err: any) => {
            if (err) {
                console.error(`Request eventdump failed reason: ${err}`);
            }
        })
    }

    private registerAtBPCallback() {
        this.client?.addCallback(
            (line: string) => !!line.match(/AT ([0-9]+)!/),
            (line: string) => {
                this.onBreakpointReached(line);
            }
        );
    }

    private registerOnNewPushedEventCallback() {
        //callback that requests the new events
        this.client?.addCallback(
            (line: string) => {
                return this.onNotifyNewEvent(line);
            },
            (line: string) => {
                this.refreshEvents();
            }
        );

        //callback that handles the requested events
        this.client?.addCallback(
            (line: string) => {
                try {
                    return line.startsWith("{\"events") && !!JSON.parse(line);
                }
                catch (err) {
                    return false;
                }
            },
            (line: string) => {
                this.onPushedEvents(line);
            }
        );
    }

    private registerOnExceptionCallback() {
        this.client?.addCallback(
            (line: string) => {
                if (!line.startsWith('{"')) {
                    return false;
                }
                try {
                    const parsed: WOODDumpResponse = JSON.parse(line);
                    return parsed.pc_error !== undefined && parsed.exception_msg !== undefined;
                }
                catch (err) {
                    return false;
                }
            },
            (line: string) => {
                this.onExceptionCallback(line);
            }
        );
    }

    private onExceptionCallback(line: string) {
        const runtimeState: RuntimeState = new RuntimeState(line, this.sourceMap);
        this.updateRuntimeState(runtimeState);
    }
}