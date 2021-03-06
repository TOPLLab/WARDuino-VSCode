import {DebugBridge} from "./DebugBridge";
import {Frame} from "../Parsers/Frame";
import {VariableInfo} from "../State/VariableInfo";
import {SourceMap} from "../State/SourceMap";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {Writable} from "stream";
import {EventItem, EventsProvider} from "../Views/EventsProvider";
import {FunctionInfo} from "../State/FunctionInfo";
import {ProxyCallItem} from "../Views/ProxyCallsProvider";
import {RuntimeState} from "../State/RuntimeState";
import {Breakpoint, UniqueSet} from "../State/Breakpoint";

export class Messages {
    public static readonly compiling: string = "Compiling the code";
    public static readonly compiled: string = "Compiled Code";
    public static readonly reset: string = "Press reset button";
    public static readonly uploading: string = "Uploading to board";
    public static readonly connecting: string = "Connecting to board";
    public static readonly connected: string = "Connected to board";
    public static readonly disconnected: string = "Disconnected board";
    public static readonly initialisationFailure: string = "Failed to initialise";
    public static readonly connectionFailure: string = "Failed to connect device";
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
            result.push(byte_.toString(16).padStart(2, "0"));
            return result.join("").toUpperCase();
        }
        result.push((byte_ | 0x80).toString(16).padStart(2, "0"));
    }
}

export abstract class AbstractDebugBridge implements DebugBridge {
    // State
    protected sourceMap: SourceMap | void;
    protected startAddress: number = 0;
    protected pc: number = 0;
    protected callstack: Frame[] = [];
    protected selectedProxies: Set<ProxyCallItem> = new Set<ProxyCallItem>();
    protected breakpoints: UniqueSet<Breakpoint> = new UniqueSet<Breakpoint>();

    // Interfaces
    protected listener: DebugBridgeListener;
    protected abstract client: Writable | undefined;
    private eventsProvider: EventsProvider | void;

    // History (time-travel)
    private history: RuntimeState[] = [];
    private present = -1;

    protected constructor(sourceMap: SourceMap | void, eventsProvider: EventsProvider | void, listener: DebugBridgeListener) {
        this.sourceMap = sourceMap;
        const callbacks = sourceMap?.importInfos ?? [];
        this.selectedProxies = new Set<ProxyCallItem>(callbacks.map((primitive: FunctionInfo) => (new ProxyCallItem(primitive))))
            ?? new Set<ProxyCallItem>();
        this.eventsProvider = eventsProvider;
        this.listener = listener;
    }

    // General Bridge functionality

    abstract connect(): Promise<string>;

    abstract disconnect(): void;

    abstract upload(): void;

    // Debug API

    public run(): void {
        this.resetHistory();
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
        if (this.present + 1 < this.history.length) {
            // Time travel forward
            this.present++;
            this.updateRuntimeState(this.history[this.present]);
        } else {
            // Normal step forward
            this.sendInterrupt(InterruptTypes.interruptSTEP, function (err: any) {
                console.log("Plugin: Step");
                if (err) {
                    return console.log("Error on write: ", err.message);
                }
            });
        }
    }

    public stepBack() {
        // Time travel backward
        this.present = this.present > 0 ? this.present - 1 : 0;
        this.updateRuntimeState(this.history[this.present]);
    }

    abstract refresh(): void;

    abstract getCurrentFunctionIndex(): number;

    private unsetBreakPoint(breakpoint: Breakpoint) {
        let breakPointAddress: string = (this.startAddress + breakpoint.id).toString(16).toUpperCase();
        let command = `${InterruptTypes.interruptBPRem}0${(breakPointAddress.length / 2).toString(16)}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        this.client?.write(command);
        this.breakpoints.delete(breakpoint);
    }

    private setBreakPoint(breakpoint: Breakpoint) {
        this.breakpoints.add(breakpoint);
        let breakPointAddress: string = (this.startAddress + breakpoint.id).toString(16).toUpperCase();
        let command = `${InterruptTypes.interruptBPAdd}0${(breakPointAddress.length / 2).toString(16)}${breakPointAddress} \n`;
        console.log(`Plugin: sent ${command}`);
        this.client?.write(command);
    }

    public setBreakPoints(lines: number[]): Breakpoint[] {
        if (this.sourceMap === undefined) {
            console.log("setBreakPointsRequest: no source map");
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
        return parseInt("0x" + lineInfoPair?.lineAddress ?? "");
    }

    abstract setStartAddress(startAddress: number): void;

    public setVariable(name: string, value: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            console.log(`setting ${name} ${value}`);
            try {
                let command = this.getVariableCommand(name, value);
                this.client?.write(command, err => {
                    resolve("Interrupt send.");
                });
            } catch {
                reject("Local not found.");
            }
        });
    }

    abstract pullSession(): void;

    abstract pushSession(woodState: WOODState): void;

    public refreshEvents(events: EventItem[]) {
        this.eventsProvider?.setEvents(events);
    }

    public notifyNewEvent(): void {
        this.sendInterrupt(InterruptTypes.interruptDUMPAllEvents);
    }

    public popEvent(): void {
        this.sendInterrupt(InterruptTypes.interruptPOPEvent);
    }

    // Helper functions

    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        return this.client?.write(`${i} \n`, callback);
    }

    protected getVariableCommand(name: string, value: number): string {
        let local = this.getLocals(this.getCurrentFunctionIndex()).find(o => o.name === name);
        if (local) {
            return `21${convertToLEB128(local.index)}${convertToLEB128(value)} \n`;
        } else {
            throw new Error("Failed to set variables.");
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
        console.warn("Only WOOD Emulator Debug Bridge needs proxies");
    }

    private inHistory() {
        return this.present + 1 < this.history.length;
    }

    private resetHistory() {
        this.present = -1;
        this.history = [];
    }

    // Getters and Setters

    updateRuntimeState(runtimeState: RuntimeState) {
        if (!this.inHistory()) {
            this.present++;
            this.history.push(runtimeState.deepcopy());
        }

        this.setProgramCounter(runtimeState.getAdjustedProgramCounter());
        this.setStartAddress(runtimeState.startAddress);
        this.refreshEvents(runtimeState.events);
        this.setCallstack(runtimeState.callstack);
        this.setLocals(runtimeState.currentFunction(), runtimeState.locals);
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

    getLocals(fidx: number): VariableInfo[] {
        if (this.sourceMap === undefined || fidx >= this.sourceMap.functionInfos.length || fidx < 0) {
            return [];
        }
        return this.sourceMap.functionInfos[fidx].locals;
    }

    setLocals(fidx: number, locals: VariableInfo[]) {
        if (this.sourceMap === undefined) {
            return;
        }
        if (fidx >= this.sourceMap.functionInfos.length) {
            console.log(`warning setting locals for new function with index: ${fidx}`);
            this.sourceMap.functionInfos[fidx] = {index: fidx, name: "<anonymous>", locals: []};
        }
        this.sourceMap.functionInfos[fidx].locals = locals;
    }

    getCallstack(): Frame[] {
        return this.callstack;
    }

    setCallstack(callstack: Frame[]): void {
        this.callstack = callstack;
        this.listener.notifyStateUpdate();
    }
}
