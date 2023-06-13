import { prototype } from 'events';
import { InterruptTypes } from '../DebugBridges/InterruptTypes';
import { HexaEncoder } from '../Util/hexaEncoding';

export enum ExecutionStateType {
    pcState = '01',
    breakpointState = '02',
    callstackState = '03',
    globalsState = '04',
    tableState = '05',
    memState = '06',
    branchingTableState = '07',
    stackState = '08',
    callbacksState = '09',
    eventsState = '0a',
    errorState = '0b',
}

export const numberExecutionStateTypes = 11;

export interface StackValue {
    idx: number,
    type: string;
    value: number | bigint;
}

export const FRAME_FUNC_TYPE = 0;
export const FRAME_INITEXPR_TYPE = 1;
export const FRAME_BLOCK_TYPE = 2;
export const FRAME_LOOP_TYPE = 3;
export const FRAME_IF_TYPE = 4;
export const FRAME_PROXY_GUARD_TYPE = 254;
export const FRAME_CALLBACK_GUARD_TYPE = 255;

export interface CallbackMapping {
    callbackid: string;
    tableIndexes: number[]
}

export interface InterruptEvent {
    topic: string;
    payload: string;
}

export interface Frame {
    type: number;
    fidx: string;
    sp: number;
    fp: number;
    block_key: number;
    ra: number;
    idx: number;
}

export interface Table {
    max: number;
    init: number;
    elements: number[];
}

export interface Memory {
    pages: number;
    max: number;
    init: number;
    bytes: Uint8Array;
}

export interface BRTable {
    size: string;
    labels: number[];
}

export interface WOODDumpResponse {
    pc?: number;
    pc_error?: number;
    exception_msg?: string;
    breakpoints?: number[];
    stack?: StackValue[];
    callstack?: Frame[];
    globals?: StackValue[];
    table?: Table;
    memory?: Memory;
    br_table?: BRTable;
    callbacks?: CallbackMapping[];
    events?: InterruptEvent[];
}




class HexaStateMessages {

    private maxMessageSize: number;
    private messages: string[];
    private maxPayloadSize: number;
    private currentMsg: string;

    // Header data
    private nrBytesForPayloadSize = 4 * 2; // tells how big the payload is. Times 2 for hexa
    private nrBytesForInterruptKind = InterruptTypes.interruptLoadSnapshot.length; // already in hexa
    private headerSize: number;

    // Footer data
    private nrBytesForContinuation = 1 * 2; // 1 byte to tell whether all state is transferred. Times 2 for hexa
    private terminatorChar = ' \n';
    private footerSize: number;

    constructor(messageSize: number) {
        this.maxMessageSize = messageSize;
        this.messages = [];
        this.currentMsg = '';
        this.headerSize = this.nrBytesForInterruptKind + this.nrBytesForPayloadSize;
        this.footerSize = this.nrBytesForContinuation + this.terminatorChar.length;
        this.maxPayloadSize = this.maxMessageSize - this.headerSize - this.footerSize;
    }

    public enoughSpace(spaceNeeded: number): boolean {
        return this.getFreeSpace() >= spaceNeeded;
    }

    public howManyFit(headerSize: number, payloads: string[]): number {
        let amount = 0;
        let payload: string = '';
        for (let i = 0; i < payloads.length; i++) {
            payload += payloads[i];
            if (!this.enoughSpace(payload.length + headerSize)) {
                break;
            }
            amount++;
        }
        return amount;
    }

    private validatePayload(payload: string): void {
        if (this.maxPayloadSize < payload.length) {
            let errmsg = `Payload size exceeds maxPayload Size of ${this.maxPayloadSize}`;
            errmsg += `(= maxMessageSize ${this.maxMessageSize} - header/footer ${this.headerSize + this.footerSize}).`;
            errmsg += 'Either increase maxMessageSize or split payload.';
            throw (new Error(errmsg));
        }
        if (payload.length % 2 !== 0) {
            throw (new Error(`Payload is not even. Got length ${this.currentMsg.length}`));
        }
        const regexHexa = /[0-9A-Fa-f]{6}/g;
        if (!payload.match(regexHexa)) {
            throw (new Error('Payload should only contain hexa chars'));
        }

    }

    public getFreeSpace(): number {
        return this.maxPayloadSize - this.currentMsg.length;
    }

    public addPayload(payload: string): void {
        this.validatePayload(payload);
        if (!this.enoughSpace(payload.length)) {
            this.forceNewMessage();
        }
        this.currentMsg = `${this.currentMsg}${payload}`;
        const s = this.currentMsg.length + this.headerSize + this.footerSize;
        if (s > this.maxMessageSize) {
            throw (new Error(`Exceeded max size is ${s} > ${this.maxMessageSize}`));
        }
    }

    public forceNewMessage(): void {
        this.messages.push(this.currentMsg);
        this.currentMsg = '';
    }

    public getMessages(): string[] {
        if (this.currentMsg !== '') {
            this.messages = this.messages.concat(this.currentMsg);
            this.currentMsg = '';
        }

        const amountMessages = this.messages.length;
        const lastChar = this.terminatorChar;
        return this.messages.map((payload, msgIdx) => {
            const size = Math.floor(payload.length / 2);
            const sizeHexa = HexaEncoder.serializeUInt32BE(size);
            const done = (msgIdx + 1) === amountMessages ? '01' : '00';
            const msg = `${InterruptTypes.interruptLoadSnapshot}${sizeHexa}${payload}${done}${lastChar}`;
            if (msg.length % 2 !== 0) {
                throw (new Error('WoodState: Hexa message not even'));
            }
            if (msg.length > this.maxMessageSize) {
                throw (new Error(`msg ${msgIdx} is ${msg.length} > ${this.maxMessageSize}`));
            }
            return msg;
        });
    }
}

export class WOODState {
    private unparsedJSON = '';
    public callbacks = '';
    private woodResponse: WOODDumpResponse;
    public sourceState = '';

    constructor(state: string, woodResponse: WOODDumpResponse) {
        this.sourceState = state;
        this.woodResponse = woodResponse;
    }

    getState(): WOODDumpResponse {
        return this.woodResponse;
    }

    toBinary(maxInterruptSize: number = 1024): string[] {

        const stateMessages = new HexaStateMessages(maxInterruptSize);

        // Allocation Message
        this.serialiseAllocationMessage(stateMessages);
        stateMessages.forceNewMessage();

        // State Messages
        this.serializePC(stateMessages);
        this.serializeException(stateMessages);
        this.serializeBPs(stateMessages);
        this.serializeStack(stateMessages);
        this.serializeTable(stateMessages);
        this.serializeCallstack(stateMessages);
        this.serializeGlobals(stateMessages);
        this.serializeCallbacksMapping(stateMessages);
        this.serializeMemory(stateMessages);
        this.serializeBrTable(stateMessages);

        return stateMessages.getMessages();
    }

    // Helper methods

    private serializeBPs(stateMsgs: HexaStateMessages): void {
        // |      Header       |        Breakpoints
        // | BPState  | Nr BPS |     BP1          | BP2 | ...
        // |  2 bytes |   1*2  | serializePointer |
        if (!!!this.woodResponse.breakpoints) {
            return;
        }
        console.log('==============');
        console.log('Breakpoints');
        console.log('--------------');
        const ws = this;
        const nrBytesUsedForAmountBPs = 1 * 2;
        const headerSize = ExecutionStateType.breakpointState.length + nrBytesUsedForAmountBPs;
        let breakpoints = this.woodResponse.breakpoints.map(bp => { return ws.serializePointer(bp); });
        while (breakpoints.length !== 0) {
            const fits = stateMsgs.howManyFit(headerSize, breakpoints);
            if (fits === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            const bps = breakpoints.slice(0, fits).join('');
            const amountBPs = HexaEncoder.serializeUInt8(fits);
            console.log(`Breakpoints: amount=${breakpoints.length}`);
            const payload = `${ExecutionStateType.breakpointState}${amountBPs}${bps}`;
            stateMsgs.addPayload(payload);
            breakpoints = breakpoints.slice(fits, breakpoints.length);
        }

    }

    private serializeStack(stateMsgs: HexaStateMessages): void {
        // |          Header           |       StackValues
        // | StackState | Nr StackVals |     V1         | V2 | ...
        // |  2 bytes   |      2*2     | serializeValue |   
        if (!!!this.woodResponse.stack) {
            return;
        }
        console.log('==============');
        console.log('STACK');
        console.log('--------------');
        console.log(`Total Stack length ${this.woodResponse.stack.length}`);

        const ws = this;
        let stack = this.woodResponse.stack.map(v => WOODState.serializeValue(v));
        const nrBytesUsedForAmountVals = 2 * 2;
        const headerSize = ExecutionStateType.stackState.length + nrBytesUsedForAmountVals;
        while (stack.length !== 0) {
            const fit = stateMsgs.howManyFit(headerSize, stack);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
            }
            const amountVals = HexaEncoder.serializeUInt16BE(fit);
            const vals = stack.slice(0, fit).join('');
            const payload = `${ExecutionStateType.stackState}${amountVals}${vals}`;
            stateMsgs.addPayload(payload);
            stack = stack.slice(fit, stack.length);
            console.log(`msg: AmountStackValues ${fit}`);
        }
    }

    private serializeTable(stateMsgs: HexaStateMessages): void {
        // |          Header          |       Elements
        // | TableState | Nr Elements |    elem  1  | elem 2 | ...
        // |  2 bytes   |   4*2       |  4*2 bytes  |  
        if (!!!this.woodResponse.table) {
            return;
        }
        console.log('==============');
        console.log('TABLE');
        console.log('--------------');
        let elements = this.woodResponse.table.elements.map(HexaEncoder.serializeUInt32BE);
        console.log(`Total Elements ${this.woodResponse.table.elements.length}`);
        const nrBytesUsedForAmountElements = 4 * 2;
        const headerSize = ExecutionStateType.tableState.length + nrBytesUsedForAmountElements;
        while (elements.length !== 0) {
            const fit = stateMsgs.howManyFit(headerSize, elements);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountElements = HexaEncoder.serializeUInt32BE(fit);
            const elems = elements.slice(0, fit).join('');
            const el_str = this.woodResponse.table.elements.slice(0, fit).map(e => e.toString()).join(', ');
            console.log(`msg: amountElements ${fit} elements ${el_str}`);
            const payload = `${ExecutionStateType.tableState}${amountElements}${elems}`;
            stateMsgs.addPayload(payload);
            elements = elements.slice(fit, elements.length);
        }
    }

    private serializeCallstack(stateMsgs: HexaStateMessages): void {
        // |           Header           |              Frames
        // | CallstackState | Nr Frames |   Frame 1      | Frame 2 | ...
        // |    2 bytes     |  2*2bytes | serializeFrame | 
        if (!!!this.woodResponse.callstack) {
            return;
        }
        console.log('==============');
        console.log('CallStack');
        console.log('--------------');
        console.log(`Total Frames ${this.woodResponse.callstack.length}`);

        const ws = this;
        let frames = this.woodResponse.callstack.map(f => ws.serializeFrame(f));
        const nrBytesUsedForAmountFrames = 2 * 2;
        const headerSize = ExecutionStateType.callstackState.length + nrBytesUsedForAmountFrames;
        while (frames.length !== 0) {
            const fit = stateMsgs.howManyFit(headerSize, frames);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountFrames = HexaEncoder.serializeUInt16BE(fit);
            const fms = frames.slice(0, fit).join('');
            console.log(`msg: amountFrames=${fit}`);
            const payload = `${ExecutionStateType.callstackState}${amountFrames}${fms}`;
            stateMsgs.addPayload(payload);
            frames = frames.slice(fit, frames.length);
        }
    }

    private serializeGlobals(stateMsgs: HexaStateMessages): void {
        // |        Header          |       Globals
        // | GlobalState |  Nr Vals |     V1         | V2 | ...
        // |  2 bytes    | 4*2bytes | serializeValue |   
        if (!!!this.woodResponse.globals) {
            return;
        }
        console.log('==============');
        console.log('GLOBALS');
        console.log('--------------');

        console.log(`Total Globals ${this.woodResponse.globals.length}`);
        const ws = this;
        let globals = this.woodResponse.globals.map(v => WOODState.serializeValue(v));
        const nrBytesNeededForAmountGlbs = 4 * 2;
        const headerSize = ExecutionStateType.globalsState.length + nrBytesNeededForAmountGlbs;
        while (globals.length !== 0) {
            const fit = stateMsgs.howManyFit(headerSize, globals);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountGlobals = HexaEncoder.serializeUInt32BE(fit);
            const glbs = globals.slice(0, fit).join('');
            const payload = `${ExecutionStateType.globalsState}${amountGlobals}${glbs}`;
            stateMsgs.addPayload(payload);
            globals = globals.slice(fit, globals.length);
            console.log(`msg: AmountGlobals ${fit}`);
        }
    }

    private serializeMemory(stateMsgs: HexaStateMessages): void {
        // |        Header                          | Memory Bytes
        // | MemState | Mem Start Idx | Mem End Idx |  byte 1   | byte 2| 
        // |  2 bytes |    4*2 bytes  |  4*2 bytes  | 1*2 bytes | .... 
        if (!!!this.woodResponse.memory) {
            return;
        }
        console.log('==============');
        console.log('Memory');
        console.log('--------------');
        const sizeHeader = ExecutionStateType.memState.length + 4 * 2 + 4 * 2;
        let bytes = Array.from(this.woodResponse.memory.bytes).map(b => b.toString(16).padStart(2, '0'));
        console.log(`Total Memory Bytes ${this.woodResponse.memory.bytes.length}`);
        let startMemIdx = 0;
        let endMemIdx = 0;
        while (bytes.length !== 0) {
            let fit = stateMsgs.howManyFit(sizeHeader, bytes);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            endMemIdx = startMemIdx + fit - 1;
            const bytesHexa = bytes.slice(0, fit).join('');
            const startMemIdxHexa = HexaEncoder.serializeUInt32BE(startMemIdx);
            const endMemIdxHexa = HexaEncoder.serializeUInt32BE(endMemIdx);
            const payload = `${ExecutionStateType.memState}${startMemIdxHexa}${endMemIdxHexa}${bytesHexa}`;
            stateMsgs.addPayload(payload);
            startMemIdx = endMemIdx + 1;

            bytes = bytes.slice(fit, bytes.length);
        }
    }

    private serializeBrTable(stateMsgs: HexaStateMessages): void {
        // |                    Header           |        Labels 
        // | BR_TblState |  StartIdx |  EndIdx   | label 1   | label 2| 
        // |  2 bytes    | 2*2 bytes | 2*2 bytes | 4*2 bytes | .... 
        if (!!!this.woodResponse.br_table) {
            return;
        }
        console.log('==============');
        console.log('BRTable');
        console.log('--------------');
        console.log(`Total Labels ${this.woodResponse.br_table.labels.length}`);

        let elements = this.woodResponse.br_table.labels.map(HexaEncoder.serializeUInt32BE);
        const sizeHeader = ExecutionStateType.branchingTableState.length + 2 * 2 + 2 * 2;
        let startTblIdx = 0;
        let endTblIdx = 0;
        while (startTblIdx < this.woodResponse.br_table.labels.length) {
            let fit = stateMsgs.howManyFit(sizeHeader, elements);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            endTblIdx = startTblIdx + fit - 1;
            const elems = elements.slice(0, fit).join('');
            const startTblIdxHexa = HexaEncoder.serializeUInt16BE(startTblIdx);
            const endTblIdxHexa = HexaEncoder.serializeUInt16BE(endTblIdx);
            const payload = `${ExecutionStateType.branchingTableState}${startTblIdxHexa}${endTblIdxHexa}${elems}`;
            stateMsgs.addPayload(payload);
            console.log(`msg: startTblIdx=${startTblIdx} endTblIdx=${endTblIdx}`);
            startTblIdx = endTblIdx + 1;

            elements = elements.slice(fit, elements.length);
        }
    }

    private serializePC(stateMsgs: HexaStateMessages): void {
        // |  PCState Header | PC
        // |     2 bytes     | serializePointer 
        if (!!!this.woodResponse.pc) {
            return;
        }
        console.log('==========');
        console.log('PC');
        console.log('----------');
        const ser = this.serializePointer(this.woodResponse.pc);
        console.log(`PC: pc=${this.woodResponse.pc}`);
        const payload = `${ExecutionStateType.pcState}${ser}`;
        stateMsgs.addPayload(payload);
    }

    private serialiseAllocationMessage(stateMsgs: HexaStateMessages): void {
        const wr = this.woodResponse;
        if (!!!wr.globals || !!!wr.table || !!!wr.memory) {
            throw (new Error('cannot serialise Allocaton Message when state is missing'));
            return;
        }

        console.log('==============');
        console.log('Allocate MSG');
        console.log('--------------');

        // Globals

        const gblsAmountHex = HexaEncoder.serializeUInt32BE(wr.globals.length);
        console.log(`Globals: total=${wr.globals.length}`);
        const globals = `${ExecutionStateType.globalsState}${gblsAmountHex}`;

        // Table
        const tblInitHex = HexaEncoder.serializeUInt32BE(wr.table.init);
        const tblMaxHex = HexaEncoder.serializeUInt32BE(wr.table.max);
        const tblSizeHex = HexaEncoder.serializeUInt32BE(wr.table.elements.length);
        const tbl = `${ExecutionStateType.tableState}${tblInitHex}${tblMaxHex}${tblSizeHex}`;

        console.log(`Table:  init=${wr.table.init} max=${wr.table.max} size=${wr.table.elements.length}`);
        // Memory
        const memInitHex = HexaEncoder.serializeUInt32BE(wr.memory.init);
        const memMaxHex = HexaEncoder.serializeUInt32BE(wr.memory.max);
        const memPagesHex = HexaEncoder.serializeUInt32BE(wr.memory.pages);
        const mem = `${ExecutionStateType.memState}${memMaxHex}${memInitHex}${memPagesHex}`;
        console.log(`Mem: max=${wr.memory.max} init=${wr.memory.init}  pages=${wr.memory.pages}`);
        const payload = `${globals}${tbl}${mem}`;

        stateMsgs.addPayload(payload);
    }

    private serializePointer(addr: number) {
        // | Pointer   |
        // | 4*2 bytes |
        return HexaEncoder.serializeUInt32BE(addr);
    }

    static serializeValue(val: StackValue, includeType: boolean = true) {
        // |   Type      |       value       |
        // | 1 * 2 bytes |  4*2 or 8*2 bytes |
        let type = -1;
        let v = '';
        let type_str = '';

        if (val.type === 'i32' || val.type === 'I32') {
            if (val.value < 0) {
                v = HexaEncoder.serializeInt32LE(val.value as number);
            }
            else {
                v = HexaEncoder.serializeUInt32LE(val.value as number);
            }
            type = 0;
            type_str = 'i32';
        }
        else if (val.type === 'i64' || val.type === 'I64') {
            if (val.value < 0) {
                v = HexaEncoder.serializeBigUInt64LE(val.value as bigint);
            }
            else {
                v = HexaEncoder.serializeBigUInt64LE(val.value as bigint);
            }
            type = 1;
            type_str = 'i64';
        }
        else if (val.type === 'f32' || val.type === 'F32') {
            v = HexaEncoder.serializeFloatLE(val.value as number);
            type = 2;
            type_str = 'f32';
        }
        else if (val.type === 'f64' || val.type === 'F64') {
            v = HexaEncoder.serializeDoubleLE(val.value as number);
            type = 3;
            type_str = 'f64';
        }
        else {
            throw (new Error(`Got unexisting stack Value type ${val.type} value ${val.value}`));
        }
        console.log(`Value: type=${type_str}(idx ${type}) val=${val.value}`);
        if (includeType) {
            const typeHex = HexaEncoder.serializeUInt8(type);
            return `${typeHex}${v}`;
        }
        else {
            return v;
        }
    }

    private serializeFrame(frame: Frame): string {
        // | Frame type | StackPointer | FramePointer |   Return Adress  | FID or Block ID
        // |  1*2 bytes |   4*2bytes   |   4*2bytes   | serializePointer | 4*2bytes or serializePointer
        const validTypes = [FRAME_FUNC_TYPE, FRAME_INITEXPR_TYPE, FRAME_BLOCK_TYPE, FRAME_LOOP_TYPE, FRAME_IF_TYPE, FRAME_PROXY_GUARD_TYPE, FRAME_CALLBACK_GUARD_TYPE];

        if (validTypes.indexOf(frame.type) === -1) {
            throw (new Error(`received unknow frame type ${frame.type}`));
        }
        const type = HexaEncoder.serializeUInt8(frame.type);
        const bigEndian = true;
        const sp = HexaEncoder.serializeInt32(frame.sp, bigEndian);
        const fp = HexaEncoder.serializeInt32(frame.fp, bigEndian);
        const ra = this.serializePointer(frame.ra);
        let rest = '';
        let res_str = ''; //TODO remove
        if (frame.type === FRAME_FUNC_TYPE) {
            rest = HexaEncoder.serializeUInt32BE(Number(frame.fidx));
            res_str = `fun_idx=${Number(frame.fidx)}`;
        }
        else if (frame.type === FRAME_PROXY_GUARD_TYPE || frame.type === FRAME_CALLBACK_GUARD_TYPE) {
            // Nothing has to happen
        }
        else {
            rest = this.serializePointer(frame.block_key);
            res_str = `block_key=${frame.block_key}`;
        }
        console.log(`Frame: type=${frame.type} sp=${frame.sp} fp=${frame.fp} ra=${frame.ra} ${res_str}`);
        return `${type}${sp}${fp}${ra}${rest}`;
    }

    private serializeException(stateMsgs: HexaStateMessages) {
        if (!!!this.woodResponse.pc_error) {
            return;
        }
        console.log('==========');
        console.log('PC_ERROR');
        console.log('----------');
        const pcError = this.serializePointer(this.woodResponse.pc_error);
        let exceptionMsg = '';
        let exceptionMsgSize = 0;
        if (!!this.woodResponse.exception_msg && this.woodResponse.exception_msg !== '') {
            exceptionMsg = this.woodResponse.exception_msg;
            exceptionMsgSize = exceptionMsg.length;
        }
        console.log(`PC_ERROR: pc_error=${this.woodResponse.pc_error} exception_msg(#${exceptionMsgSize} chars)=${exceptionMsg}`);
        const sizeInHexa = HexaEncoder.serializeUInt32BE(exceptionMsgSize);
        const msgInHexa = HexaEncoder.serializeString(exceptionMsg);
        const payload = `${ExecutionStateType.errorState}${pcError}${sizeInHexa}${msgInHexa}`;
        stateMsgs.addPayload(payload);
    }

    private serializeCallbacksMapping(stateMsgs: HexaStateMessages) {
        // | Mappings type | amountMapings | CallbackMapping |   Return Adress  | FID or Block ID
        // |  1*2 bytes |   4*2bytes   |   4*2bytes   | serializePointer | 4*2bytes or serializePointer
        // callbacks": [{"interrupt_37": [1]}, {"interrupt_39": [2]}]

        if (!!!this.woodResponse.callbacks) {
            return;
        }
        console.log('==============');
        console.log('CallbackMapping');
        console.log('--------------');
        console.log(`Total Mappings ${this.woodResponse.callbacks.length}`);

        const ws = this;
        let mappings = this.woodResponse.callbacks.map(f => ws.serializeCallbackMapping(f));
        const nrBytesUsedForAmountMappings = 2 * 2;
        const headerSize = ExecutionStateType.callbacksState.length + nrBytesUsedForAmountMappings;
        while (mappings.length !== 0) {
            const fit = stateMsgs.howManyFit(headerSize, mappings);
            if (fit === 0) {
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountMappings = HexaEncoder.serializeUInt32BE(fit);
            const fms = mappings.slice(0, fit).join('');
            console.log(`msg: amountMappings=${fit}`);
            const payload = `${ExecutionStateType.callbacksState}${amountMappings}${fms}`;
            stateMsgs.addPayload(payload);
            mappings = mappings.slice(fit, mappings.length);
        }
    }

    private serializeCallbackMapping(mapping: CallbackMapping): string {
        // | size CallbackID | CallbackID | Number TableIndeces | TableIndex | TableIndex | ....
        // |  4 * 2 bytes    |   ....     |   4*2bytes          | 4*2bytes   |
        const sizeCallbackID = HexaEncoder.serializeUInt32BE(mapping.callbackid.length);
        const callbackIDInHexa = HexaEncoder.serializeString(mapping.callbackid);
        const tableIndeces = mapping.tableIndexes.map(tidx => HexaEncoder.serializeUInt32BE(tidx));
        const tableIndecesSize = HexaEncoder.serializeUInt32BE(tableIndeces.length);
        return `${sizeCallbackID}${callbackIDInHexa}${tableIndecesSize}${tableIndeces}`;
    }


    public serializeRFCall(functionId: number, args: StackValue[]): string {
        const ws = this;
        const ignoreType = false;
        const fidxHex = HexaEncoder.serializeUInt32BE(functionId);
        const argsHex = args.map(v => WOODState.serializeValue(v, ignoreType)).join('');
        return `${InterruptTypes.interruptProxyCall}${fidxHex}${argsHex}`;
    }

    static serializeStackValueUpdate(value: StackValue): string {
        const stackIDx = HexaEncoder.serializeUInt32BE(value.idx);
        const valueHex = this.serializeValue(value);
        return `${InterruptTypes.interruptUPDATEStackValue}${stackIDx}${valueHex}`;
    }

    static serializeGlobalValueUpdate(value: StackValue): string {
        const stackIDx = HexaEncoder.convertToLEB128(value.idx);
        const valueHex = HexaEncoder.convertToLEB128(value.value as number);
        return `${InterruptTypes.interruptUPDATEGlobal}${stackIDx}${valueHex}`;
    }

    static fromLine(line: string) {
        const trimmed = line.trimEnd();
        const wr: WOODDumpResponse = JSON.parse(trimmed);
        return new WOODState(trimmed, wr);
    }
}