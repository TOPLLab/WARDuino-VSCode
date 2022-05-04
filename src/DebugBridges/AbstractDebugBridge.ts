import {DebugBridge} from "./DebugBridge";
import {Frame} from "../Parsers/Frame";
import {VariableInfo} from "../State/VariableInfo";
import {SourceMap} from "../State/SourceMap";
import {DebugBridgeListener} from "./DebugBridgeListener";
import {WOODState} from "../State/WOODState";
import {InterruptTypes} from "./InterruptTypes";
import {Writable} from "stream";
import {EventItem, EventsProvider} from "../Views/EventsProvider";

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
    protected sourceMap: SourceMap | void;
    protected listener: DebugBridgeListener;
    protected pc: number = 0;
    protected callstack: Frame[] = [];
    protected abstract port: Writable | undefined;

    private eventsProvider: EventsProvider | void;

    protected constructor(sourceMap: SourceMap | void, eventsProvider: EventsProvider | void, listener: DebugBridgeListener) {
        this.sourceMap = sourceMap;
        this.eventsProvider = eventsProvider;
        this.listener = listener;
    }

    // General Bridge functionality

    abstract connect(): Promise<string>;

    abstract disconnect(): void;

    abstract upload(): void;

    // Debug API

    run(): void {
        this.sendInterrupt(InterruptTypes.interruptRUN);
    }

    pause(): void {
        this.sendInterrupt(InterruptTypes.interruptPAUSE);
        this.listener.notifyPaused();
    }

    abstract step(): void;

    abstract refresh(): void;

    abstract getCurrentFunctionIndex(): number;

    abstract setBreakPoint(x: number): void;

    abstract setStartAddress(startAddress: number): void;

    abstract setVariable(name: string, value: number): Promise<string>;

    abstract pullSession(): void;

    abstract pushSession(woodState: WOODState): void;

    refreshEvents(events: EventItem[]) {
        this.eventsProvider?.setEvents(events);
    }

    popEvent(): void {
        this.sendInterrupt(InterruptTypes.interruptPOPEvent);
    }

    // Helper functions

    protected sendInterrupt(i: InterruptTypes, callback?: (error: Error | null | undefined) => void) {
        return this.port?.write(`${i} \n`, callback);
    }

    protected getVariableCommand(name: string, value: number): string {
        let local = this.getLocals(this.getCurrentFunctionIndex()).find(o => o.name === name);
        if (local) {
            return `21${convertToLEB128(local.index)}${convertToLEB128(value)} \n`;
        } else {
            throw new Error("Failed to set variables.");
        }
    }

    // Getters and Setters

    getProgramCounter(): number {
        return this.pc;
    }

    setProgramCounter(pc: number) {
        this.pc = pc;
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
