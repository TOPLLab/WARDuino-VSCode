// Temporary interfaces will gradually dissapear and/or moved to comms library

// import { Instruction, Request } from "warduino-comms";
import { Instruction } from "../lib/src/debug/Instructions";
import { Request } from "../lib/src/parse/Requests";
import { WOODDumpResponse } from "./WOODState";

export interface Frame {
    type: number;
    fidx: string;
    sp: number;
    fp: number;
    start: string,
    ra: string;
    callsite: string;
}

export interface Local {
    type: string;
    value: number;
    index: number;
}

export interface Event {
    topic: string;
    payload: string;
}

export interface Locals {
    count: number;
    locals: Local[];
}

export interface CallbackMapping {
    topic: string,
    callbacks: number[]
}

export interface DumpAllStateResponse {
    pc: string;
    breakpoints: string[];
    start: string[];
    callstack: Frame[];
    locals: Locals;
    events: Event[];
}

export interface DumpAllEventsResponse {
    events: Event[];
}

export interface OffsetResponse {
    offset: string
}

export interface DumpCallbackMappingResponse {
    callbacks: CallbackMapping[];
}


export const DumpAllStateRequest: Request<DumpAllStateResponse> = {
    instruction: Instruction.dumpAll,
    parser: (input: string) => {
        return JSON.parse(input);
    }
};


function breakpointRequest(inst: Instruction, addr: string): Request<string> {
    const payload = `0${(addr.length / 2).toString(16)}${addr}`;
    const req: Request<string> = {
        instruction: inst,
        payload: payload,
        parser: (line: string) => {
            if (line !== `BP 0x${addr}!`) {
                throw Error("invalid ack for bp request");
            }
            return addr;
        }
    };
    return req;
}

export function buildAddBreakpointRequest(addr: string): Request<string> {
    return breakpointRequest(Instruction.addBreakpoint, addr);
}

export function buildRemoveBreakpointRequest(addr: string): Request<string> {
    return breakpointRequest(Instruction.removeBreakpoint, addr);
}


export const DumpAllEventsRequest: Request<DumpAllEventsResponse> = {
    instruction: Instruction.dumpAllEvents,
    parser: (line: string) => {
        return JSON.parse(line);
    }
};

export const PopEventRequest: Request<void> = {
    instruction: Instruction.popEvent,
    parser: (input: string) => {
        // Normally no ack is send by VM for this request besides the confirmation that the interrupt `popEvent` is received
        // The parser will for now succeed only if the interrupt is succesfully received
        // todo add ack on the VM to confirm completion of this interrupt
        if (input !== `interrupt ${Instruction.popEvent}`) {
            throw Error("invalid ack for popEvent request");
        }
        return;
    }
}

export function buildUpdateModuleRequest(payload: string): Request<string> {
    const req: Request<string> = {
        instruction: Instruction.updateModule,
        payload: payload,
        parser: (input: string) => {
            if (input === "CHANGE Module!") {
                throw Error("invalid ack for update module request");
            }
            return input;
        }
    }
    return req;
}


export const OffsetRequest: Request<OffsetResponse> = {
    instruction: Instruction.offset,
    parser: (input: string) => {
        return JSON.parse(input)
    }
}

export function buildLoadSnapshotRequest(stateToSend: string[]): Request<void>[] {
    const lastStateIdx = stateToSend.length - 1;
    return stateToSend.map((state, stateIdx) => {
        return {
            instruction: Instruction.loadSnapshot,
            payload: state,
            parser: (input: string) => {
                const expectedAck = lastStateIdx === stateIdx ? "done!" : "ack!";
                if (input !== expectedAck) {
                    throw Error("invalid ack for loadSnapshot request")
                }
            }
        }
    });
}

export const DumpCallbackMappingRequest: Request<string> = {
    instruction: Instruction.dumpCallbackmapping,
    parser: (input: string) => {
        if (!input.startsWith('{"callbacks": ')) {
            throw Error("invalid ack for dumpcallbackmapping request")
        }
        return input;
    }
}

export function buildUpdateCallbackMapping(mapping: string): Request<void> {
    return {
        instruction: Instruction.updateCallbackmapping,
        payload: mapping,
        parser: (input: string) => {
            // Normally no ack is send by VM for this request besides the confirmation that the interrupt `updateCallbackmapping` is received
            // The parser will for now succeed only if the interrupt is succesfully received
            // todo add ack on the VM to confirm completion of this interrupt
            if (input !== `interrupt ${Instruction.updateCallbackmapping}`) {
                throw Error("invalid ack for updateCallbackmapping request")
            }
            return;
        }
    }
}


export function buildUpdateProxiesRequest(primitives: number[]): Request<void> {
    function encode(i: number, byteLength: number, byteorder = 'big'): string {
        const result: Buffer = Buffer.alloc(byteLength);
        result.writeIntBE(i, 0, byteLength);
        return result.toString('hex');
    }

    const payload = encode(primitives.length, 4) + primitives.map(p => encode(p, 4)).join("");
    payload.toUpperCase();

    return {
        instruction: Instruction.updateProxies,
        payload: payload,
        parser: (input: string) => {
            if (input !== "done!") {
                throw Error("invalid ack for update proxies request")
            }
        }
    }
}


export const SnapshotRequest: Request<WOODDumpResponse> = {
    instruction: Instruction.snapshot,
    parser: (input: string) => {
        return JSON.parse(input);
    }
}

export const ProxifyRequest: Request<void> = {
    instruction: Instruction.proxify,
    parser: (input: string) => {
        // Normally no ack is send by VM for this request besides the confirmation that the interrupt `proxifiy` is received
        // The parser will for now succeed only if the interrupt is succesfully received
        // todo add ack on the VM to confirm completion of this interrupt
        if (input !== `interrupt ${Instruction.proxify}`) {
            throw Error("invalid ack for proxify request");
        }
    }
}

export function buildSetVariableRequest(payload: string): Request<void> {
    return {
        instruction: Instruction.updateLocal,
        payload: payload,
        parser: (input: string) => {
            if (input.startsWith("Local") && input.includes("changed to")) {
                return;
            }
            throw Error("invalid ack for updatelocal request");
        }
    };
}