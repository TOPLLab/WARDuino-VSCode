import {VariableInfo} from "../State/VariableInfo";
import {Frame} from "../Parsers/Frame";
import {WOODState} from "../State/WOODState";
import {EventItem} from "../Views/EventsProvider";
import {ProxyCallItem} from "../Views/ProxyCallsProvider";
import {RuntimeState} from "../State/RuntimeState";

export interface DebugBridge {
    setStartAddress(startAddress: number): void;

    connect(): Promise<string>;

    updateRuntimeState(runtimeState: RuntimeState): void;

    getProgramCounter(): number;

    setProgramCounter(pc: number): void;

    getBreakpointPossibilities(): Breakpoint[];

    getLocals(fidx: number): VariableInfo[];

    setLocals(fidx: number, locals: VariableInfo[]): void;

    getCallstack(): Frame[];

    setCallstack(callstack: Frame[]): void;

    getCurrentFunctionIndex(): number;

    step(): void;

    stepBack(): void;

    run(): void;

    pause(): void;

    hitBreakpoint(): void;

    pullSession(): void;

    pushSession(woodState: WOODState): void;

    refreshEvents(events: EventItem[]): void;

    popEvent(): void;

    // Adds or removes the current callback depending on whether is selected or not respectively
    updateSelectedProxies(proxy: ProxyCallItem): void;

    setSelectedProxies(proxies: Set<ProxyCallItem>): void;

    getSelectedProxies(): Set<ProxyCallItem>;

    setBreakPoints(lines: number[]): Breakpoint[];

    refresh(): void;

    notifyNewEvent(): void;

    disconnect(): void;

    setVariable(name: string, value: number): Promise<string>;

    upload(): void;
}

abstract class Comparable {
    public abstract equals(other: Comparable): boolean;
}

export class Breakpoint extends Comparable {
    id: number;  // address
    verified: boolean = true;
    line: number;
    column?: number;

    constructor(id: number, line: number) {
        super();
        this.id = id;
        this.line = line;
    }

    public equals(other: Breakpoint): boolean {
        return other.id === this.id;
    }
}

export class UniqueSet<T extends Comparable> extends Set {
    private content: Array<T>;
    constructor() {
        super();
        this.content = new Array<T>();
    }

    add(value: T): this {
        if (this.content.find(element => element.equals(value))) {
            this.content.push(value);
        }
        return this;
    }

    clear() {
        this.content = new Array<T>();
    }

    delete(value: T): boolean {
        const included: boolean = this.has(value);
        this.content = this.content.filter(element => !element.equals(value));
        return included;
    }

    has(value: T): boolean {
        return this.content.find(element => element.equals(value)) !== undefined;
    }

    values(): IterableIterator<T> {
        return new Set<T>(this.content).values();
    }
}
