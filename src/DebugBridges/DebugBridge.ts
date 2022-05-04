import {VariableInfo} from "../State/VariableInfo";
import {Frame} from "../Parsers/Frame";
import {WOODState} from "../State/WOODState";
import {EventItem} from "../Views/EventsProvider";

export interface DebugBridge {
    setStartAddress(startAddress: number): void;

    connect(): Promise<string>;

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

    pullSession(): void;

    pushSession(woodState: WOODState): void;

    refreshEvents(events: EventItem[]): void;

    popEvent(): void;

    setBreakPoint(x: number): void;

    refresh(): void;

    disconnect(): void;

    setVariable(name: string, value: number): Promise<string>;

    upload(): void;
}
