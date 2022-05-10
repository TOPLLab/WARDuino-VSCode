import {VariableInfo} from "../State/VariableInfo";
import {Frame} from "../Parsers/Frame";
import {WOODState} from "../State/WOODState";
import {EventItem} from "../Views/EventsProvider";
import {ProxyItem} from "../Views/ProxiesProvider";
import {RuntimeState} from "../State/RuntimeState";

export interface DebugBridge {
    setStartAddress(startAddress: number): void;

    connect(): Promise<string>;

    updateRuntimeState(runtimeState: RuntimeState): void;

    getProgramCounter(): number;

    setProgramCounter(pc: number): void;

    getLocals(fidx: number): VariableInfo[];

    setLocals(fidx: number, locals: VariableInfo[]): void;

    getCallstack(): Frame[];

    setCallstack(callstack: Frame[]): void;

    getCurrentFunctionIndex(): number;

    step(): void;

    run(): void;

    pause(): void;

    hitBreakpoint(): void;

    pullSession(): void;

    pushSession(woodState: WOODState): void;

    refreshEvents(events: EventItem[]): void;

    popEvent(): void;

    // Adds or removes the current callback depending on whether is selected or not respectively
    updateSelectedProxies(callback: ProxyItem): void;

    setBreakPoint(x: number): void;

    refresh(): void;

    notifyNewEvent(): void;

    disconnect(): void;

    setVariable(name: string, value: number): Promise<string>;

    upload(): void;
}
