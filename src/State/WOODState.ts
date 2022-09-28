import { InterruptTypes } from '../DebugBridges/InterruptTypes';
import {HexaEncoder} from '../Util/hexaEncoding';

export enum RecvStateType {
    pcState = '01',
    bpsState = '02',
    callstackState = '03',
    globalsState = '04',
    tblState = '05',
    memState = '06',
    brtblState = '07',
    stackvalsState = '08'
}

interface StackValue {
    type: string;
    value: number | bigint;
}

interface Frame {
    type: number;
    fidx: string;
    sp: number;
    fp: number;
    block_key: string;
    ra: string;
    idx: number;
}

interface Table {
    max: number;
    init: number;
    elements: number[];
}

interface Memory {
    pages: number;
    max: number;
    init: number;
    bytes: Uint8Array;
}

interface BRTable {
    size: string;
    labels: number[];
}

interface WOODDumpResponse {
    pc: string;
    start: string[];
    breakpoints: string[];
    stack: StackValue[];
    callstack: Frame[];
    globals: StackValue[];
    table: Table;
    memory: Memory;
    br_table: BRTable;
}




class HexaStateMessages {

    private maxMessageSize: number;
    private messages: string[];
    private maxPayloadSize: number;
    private currentMsg: string;

    // Header data
    private nrBytesForPayloadSize = 4 * 2; // tells how big the payload is. Times 2 for hexa
    private nrBytesForInterruptKind = InterruptTypes.interruptWOODRecvState.length; // already in hexa
    private headerSize: number; 
        
    // Footer data
    private nrBytesForContinuation = 1 * 2; // 1 byte to tell whether all state is transferred. Times 2 for hexa
    private terminatorChar = ' \n';
    private footerSize: number;

    constructor(messageSize: number){
        this.maxMessageSize = messageSize;
        this.messages = [];
        this.currentMsg = '';
        this.headerSize = this.nrBytesForInterruptKind + this.nrBytesForPayloadSize;
        this.footerSize = this.nrBytesForContinuation + this.terminatorChar.length;
        this.maxPayloadSize = this.maxMessageSize - this.headerSize - this.footerSize;
    }

    public enoughSpace(spaceNeeded: number): boolean {
        return this.getFreeSpace() >=  spaceNeeded;
    }

    public howManyFit(headerSize: number, payloads: string[]): number {
        let amount = 0;
        let payload: string = '';
        for (let i = 0; i < payloads.length; i++) {
            payload += payloads[i];
            if(!this.enoughSpace(payload.length + headerSize)){
                break;
            }
            amount++;
        }
        return amount;
    }

    private validatePayload(payload: string): void{
        if(this.maxPayloadSize < payload.length){
            let errmsg = `Payload size exceeds maxPayload Size of ${this.maxPayloadSize}`;
            errmsg += `(= maxMessageSize ${this.maxMessageSize} - header/footer ${this.headerSize + this.footerSize}).`;
            errmsg += 'Either increase maxMessageSize or split payload.';
            throw (new Error(errmsg));
        }
        if(payload.length % 2 !== 0){
            throw (new Error(`Payload is not even. Got length ${this.currentMsg.length}`));
        }
        const regexHexa = /[0-9A-Fa-f]{6}/g;
        if(!payload.match(regexHexa)){
            throw (new Error('Payload should only contain hexa chars'));
        }

    }

    public getFreeSpace(): number {
        return this.maxPayloadSize - this.currentMsg.length;
    }

    public addPayload(payload: string): void {
        this.validatePayload(payload);
        if(!this.enoughSpace(payload.length)){
            this.forceNewMessage();
        }
        this.currentMsg = `${this.currentMsg}${payload}`;
        const s = this.currentMsg.length + this.headerSize + this.footerSize ;
        if(s > this.maxMessageSize){
            throw (new Error(`Exceeded max size is ${s} > ${this.maxMessageSize}`));
        }
    }

    public forceNewMessage(): void {
        this.messages.push(this.currentMsg);
        this.currentMsg = '';
    }

    public getMessages(): string[] {
        if(this.currentMsg !== ''){
            this.messages = this.messages.concat(this.currentMsg);
            this.currentMsg = '';
        }

        const amountMessages = this.messages.length;
        const lastChar = this.terminatorChar;
        return this.messages.map((payload, msgIdx) => {
            const size = Math.floor(payload.length / 2);
            const sizeHexa = HexaEncoder.serializeUInt32BE(size);
            const done = (msgIdx + 1) === amountMessages ? '01' : '00';
            const msg = `${InterruptTypes.interruptWOODRecvState}${sizeHexa}${payload}${done}${lastChar}`;
            if (msg.length % 2 !== 0) {
                throw (new Error('WoodState: Hexa message not even'));
            }
            if(msg.length > this.maxMessageSize){
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

    constructor(state: string) {
        this.unparsedJSON = state.trimEnd();
        this.woodResponse = JSON.parse(this.unparsedJSON);
    }

    toBinary(offset: string, maxInterruptSize: number = 1024): string[] {

        // rebase all addresses to target VM
        this.rebaseState(offset);

        const stateMessages = new HexaStateMessages(maxInterruptSize);
        
        // Allocation Message
        this.serialiseAllocationMessage(stateMessages);
        stateMessages.forceNewMessage();
        
        // State Messages
        this.serializePC(stateMessages);
        this.serializeBPs(stateMessages);
        this.serializeStack(stateMessages);
        this.serializeTable(stateMessages);
        this.serializeCallstack(stateMessages);
        this.serializeGlobals(stateMessages);
        this.serializeMemory(stateMessages);
        this.serializeBrTable(stateMessages);
        return stateMessages.getMessages();
    }

    // Helper methods

    private rebaseState(targetOffset: string): void {
        const oldOffset = Number(this.woodResponse.start[0]);
        const newOffset = Number(targetOffset);

        const rebase = (addr: string) => {
            const newAddr = Number(addr) - oldOffset + newOffset;
            return newAddr.toString(16);
        };

        this.woodResponse.pc = rebase(this.woodResponse.pc);
        this.woodResponse.breakpoints = this.woodResponse.breakpoints.map(rebase);

        this.woodResponse.callstack.forEach(frame => {
            frame.ra = rebase(frame.ra);
            if(frame.type !== 0){
                frame.block_key = rebase(frame.block_key);
            }
        });
    }

    private serializeBPs(stateMsgs: HexaStateMessages): void {
        // |      Header       |        Breakpoints
        // | BPState  | Nr BPS |     BP1          | BP2 | ...
        // |  2 bytes |   1*2  | serializePointer |
        console.log('==============');
        console.log('Breakpoints');
        console.log('--------------');
        const ws = this;
        const nrBytesUsedForAmountBPs = 1 * 2;
        const headerSize = RecvStateType.bpsState.length + nrBytesUsedForAmountBPs;
        let breakpoints = this.woodResponse.breakpoints.map(bp=>{return ws.serializePointer(bp);});
        while (breakpoints.length !== 0 ){
            const fits = stateMsgs.howManyFit(headerSize, breakpoints);
            if(fits === 0 ){
                stateMsgs.forceNewMessage();
                continue;
            }
            const bps = breakpoints.slice(0, fits).join('');
            const amountBPs = HexaEncoder.serializeUInt8(fits);
            console.log(`Breakpoints: amount=${breakpoints.length}`);
            const payload = `${RecvStateType.bpsState}${amountBPs}${bps}`;
            stateMsgs.addPayload(payload);
            breakpoints = breakpoints.slice(fits, breakpoints.length);
        }

    }

    private serializeStack(stateMsgs: HexaStateMessages): void {
        // |          Header           |       StackValues
        // | StackState | Nr StackVals |     V1         | V2 | ...
        // |  2 bytes   |      2*2     | serializeValue |   
        console.log('==============');
        console.log('STACK');
        console.log('--------------');
        console.log(`Total Stack length ${this.woodResponse.stack.length}`);

        const ws = this;
        let stack = this.woodResponse.stack.map(v=>ws.serializeValue(v));
        const nrBytesUsedForAmountVals = 2 * 2;
        const headerSize = RecvStateType.stackvalsState.length + nrBytesUsedForAmountVals;
        while (stack.length !== 0 ){
            const fit = stateMsgs.howManyFit(headerSize, stack);
            if(fit === 0){
                stateMsgs.forceNewMessage();
            }
            const amountVals = HexaEncoder.serializeUInt16BE(fit);
            const vals = stack.slice(0, fit).join('');
            const payload = `${RecvStateType.stackvalsState}${amountVals}${vals}`;
            stateMsgs.addPayload(payload);
            stack = stack.slice(fit, stack.length);
            console.log(`msg: AmountStackValues ${fit}`);
        }
    }

    private serializeTable(stateMsgs: HexaStateMessages): void {
        // |          Header          |       Elements
        // | TableState | Nr Elements |    elem  1  | elem 2 | ...
        // |  2 bytes   |   4*2       |  4*2 bytes  |  
        console.log('==============');
        console.log('TABLE');
        console.log('--------------');
        let elements = this.woodResponse.table.elements.map(HexaEncoder.serializeUInt32BE);
        console.log(`Total Elements ${this.woodResponse.table.elements.length}`);
        const nrBytesUsedForAmountElements = 4*2;
        const headerSize = RecvStateType.tblState.length + nrBytesUsedForAmountElements;
        while (elements.length !== 0 ){
            const fit = stateMsgs.howManyFit(headerSize, elements);
            if (fit === 0 ){
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountElements = HexaEncoder.serializeUInt32BE(fit);
            const elems = elements.slice(0, fit).join('');
            const el_str = this.woodResponse.table.elements.slice(0,fit).map(e=>e.toString()).join(', ');
            console.log(`msg: amountElements ${fit} elements ${el_str}`);
            const payload = `${RecvStateType.tblState}${amountElements}${elems}`;
            stateMsgs.addPayload(payload);
            elements = elements.slice(fit, elements.length);
        }
    }

    private serializeCallstack(stateMsgs: HexaStateMessages): void {
        // |           Header           |              Frames
        // | CallstackState | Nr Frames |   Frame 1      | Frame 2 | ...
        // |    2 bytes     |  2*2bytes | serializeFrame | 
        console.log('==============');
        console.log('CallStack');
        console.log('--------------');
        console.log(`Total Frames ${this.woodResponse.callstack.length}`);

        const ws = this;
        let frames = this.woodResponse.callstack.map(f=>ws.serializeFrame(f));
        const nrBytesUsedForAmountFrames = 2* 2;
        const headerSize = RecvStateType.callstackState.length + nrBytesUsedForAmountFrames;
        while (frames.length !==0 ){
            const fit = stateMsgs.howManyFit(headerSize, frames);
            if(fit === 0 ){
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountFrames = HexaEncoder.serializeUInt16BE(fit);
            const fms = frames.slice(0, fit).join('');
            console.log(`msg: amountFrames=${fit}`);
            const payload =  `${RecvStateType.callstackState}${amountFrames}${fms}`;
            stateMsgs.addPayload(payload);
            frames = frames.slice(fit, frames.length);
        }
    }

    private serializeGlobals(stateMsgs: HexaStateMessages): void {
        // |        Header          |       Globals
        // | GlobalState |  Nr Vals |     V1         | V2 | ...
        // |  2 bytes    | 4*2bytes | serializeValue |   
        console.log('==============');
        console.log('GLOBALS');
        console.log('--------------');

        console.log(`Total Globals ${this.woodResponse.globals.length}`);
        const ws = this;
        let globals = this.woodResponse.globals.map(v=>ws.serializeValue(v));
        const nrBytesNeededForAmountGlbs = 4*2;
        const headerSize = RecvStateType.globalsState.length + nrBytesNeededForAmountGlbs;
        while( globals.length !== 0 ){
            const fit = stateMsgs.howManyFit(headerSize, globals);
            if(fit === 0 ){
                stateMsgs.forceNewMessage();
                continue;
            }
            const amountGlobals = HexaEncoder.serializeUInt32BE(fit);
            const glbs = globals.slice(0, fit).join('');
            const payload = `${RecvStateType.globalsState}${amountGlobals}${glbs}`;
            stateMsgs.addPayload(payload);
            globals = globals.slice(fit, globals.length);
            console.log(`msg: AmountGlobals ${fit}`);
        }
    }

    private serializeMemory(stateMsgs: HexaStateMessages): void {
        // |        Header                          | Memory Bytes
        // | MemState | Mem Start Idx | Mem End Idx |  byte 1   | byte 2| 
        // |  2 bytes |    4*2 bytes  |  4*2 bytes  | 1*2 bytes | .... 
        console.log('==============');
        console.log('Memory');
        console.log('--------------');
        const sizeHeader = RecvStateType.memState.length + 4 * 2 + 4 * 2 ;
        let bytes = Array.from(this.woodResponse.memory.bytes).map (b => b.toString (16).padStart (2, '0'));
        console.log(`Total Memory Bytes ${this.woodResponse.memory.bytes.length}`);
        let startMemIdx = 0;
        let endMemIdx = 0;
        while (bytes.length !== 0){
            let fit = stateMsgs.howManyFit(sizeHeader, bytes);
            if (fit === 0){
                stateMsgs.forceNewMessage();
                continue;
            }
            endMemIdx = startMemIdx + fit - 1;
            const bytesHexa = bytes.slice(0, fit).join('');
            const startMemIdxHexa = HexaEncoder.serializeUInt32BE(startMemIdx);
            const endMemIdxHexa = HexaEncoder.serializeUInt32BE(endMemIdx);
            const payload = `${RecvStateType.memState}${startMemIdxHexa}${endMemIdxHexa}${bytesHexa}`;
            stateMsgs.addPayload(payload);
            startMemIdx = endMemIdx + 1;

            bytes = bytes.slice(fit, bytes.length);
        }
    }

    private serializeBrTable(stateMsgs: HexaStateMessages): void {
        // |                    Header           |        Labels 
        // | BR_TblState |  StartIdx |  EndIdx   | label 1   | label 2| 
        // |  2 bytes    | 2*2 bytes | 2*2 bytes | 4*2 bytes | .... 
        console.log('==============');
        console.log('BRTable');
        console.log('--------------');
        console.log(`Total Labels ${this.woodResponse.br_table.labels.length}`);

        let elements = this.woodResponse.br_table.labels.map(HexaEncoder.serializeUInt32BE);
        const sizeHeader = RecvStateType.brtblState.length + 2 * 2 + 2 * 2 ;
        let startTblIdx = 0;
        let endTblIdx = 0;
        while ( startTblIdx < this.woodResponse.br_table.labels.length){
            let fit = stateMsgs.howManyFit(sizeHeader, elements);
            if (fit === 0){
                stateMsgs.forceNewMessage();
                continue;
            }
            endTblIdx = startTblIdx + fit - 1;
            const elems = elements.slice(0, fit).join('');
            const startTblIdxHexa = HexaEncoder.serializeUInt16BE(startTblIdx);
            const endTblIdxHexa = HexaEncoder.serializeUInt16BE(endTblIdx);
            const payload = `${RecvStateType.brtblState}${startTblIdxHexa}${endTblIdxHexa}${elems}`;
            stateMsgs.addPayload(payload);
            console.log(`msg: startTblIdx=${startTblIdx} endTblIdx=${endTblIdx}`);
            startTblIdx = endTblIdx + 1;

            elements = elements.slice(fit, elements.length);
        }
    }

    private serializePC(stateMsgs: HexaStateMessages): void {
        // |  PCState Header | NrBytes PC | PC
        // |     2 bytes     |   1 * 2    |  hexa address 
        console.log('==========');
        console.log('PC');
        console.log('----------');
        const ser = this.serializePointer(this.woodResponse.pc);
        console.log(`PC: pc=${this.woodResponse.pc}`);
        const payload = `${RecvStateType.pcState}${ser}`;
        stateMsgs.addPayload(payload);
    }

    private serialiseAllocationMessage(stateMsgs: HexaStateMessages): void {
        console.log('==============');
        console.log('Allocate MSG');
        console.log('--------------');

        // Globals
        const wr = this.woodResponse;
        const gblsAmountHex = HexaEncoder.serializeUInt32BE(wr.globals.length);
        console.log(`Globals: total=${wr.globals.length}`);
        const globals = `${RecvStateType.globalsState}${gblsAmountHex}`;

        // Table
        const tblInitHex = HexaEncoder.serializeUInt32BE(wr.table.init);
        const tblMaxHex = HexaEncoder.serializeUInt32BE(wr.table.max);
        const tblSizeHex = HexaEncoder.serializeUInt32BE(wr.table.elements.length);
        const tbl = `${RecvStateType.tblState}${tblInitHex}${tblMaxHex}${tblSizeHex}`;

        console.log(`Table:  init=${wr.table.init} max=${wr.table.max} size=${wr.table.elements.length}`);
        // Memory
        const memInitHex = HexaEncoder.serializeUInt32BE(wr.memory.init);
        const memMaxHex = HexaEncoder.serializeUInt32BE(wr.memory.max);
        const memPagesHex = HexaEncoder.serializeUInt32BE(wr.memory.pages);
        const mem = `${RecvStateType.memState}${memMaxHex}${memInitHex}${memPagesHex}`;
        console.log(`Mem: max=${wr.memory.max} init=${wr.memory.init}  pages=${wr.memory.pages}`);
        const payload = `${globals}${tbl}${mem}`;

        stateMsgs.addPayload(payload);
    }

    private serializePointer(addr: string) {
        // | Address   |
        // | 4*2 bytes |
        const cleanedAddr = this.makeAddressEven(addr);
        const pointerSize = HexaEncoder.serializeUInt8(Math.floor(cleanedAddr.length / 2)); // div by 2 since addr is hexa
        return `${pointerSize}${cleanedAddr}`;
    }

    private serializeValue(val: StackValue, includeType: boolean = true) {
        // |   Type      |       value       |
        // | 1 * 2 bytes |  4*2 or 8*2 bytes |
        let type = -1;
        let v = '';
        let type_str='';

        if (val.type === 'i32') {
            if (val.value < 0) {
                v = HexaEncoder.serializeInt32LE(val.value as number);
            }
            else {
                v = HexaEncoder.serializeUInt32LE(val.value as number);
            }
            type = 0;
            type_str = 'i32';
        }
        else if (val.type === 'i64') {
            if (val.value < 0) {
                v = HexaEncoder.serializeBigUInt64LE(val.value as bigint);
            }
            else {
                v = HexaEncoder.serializeBigUInt64LE(val.value as bigint);
            }
            type = 1;
            type_str = 'i64';
        }
        else if (val.type === 'f32') {
            v = HexaEncoder.serializeFloatLE(val.value as number);
            type = 2;
            type_str = 'f32';
        }
        else if (val.type === 'f64') {
            v = HexaEncoder.serializeDoubleLE(val.value as number);
            type = 3;
            type_str = 'f64';
        }
        else {
            throw (new Error(`Got unexisting stack Value type ${val.type} value ${val.value}`));
        }
        console.log(`Value: type=${type_str}(idx ${type}) val=${val.value}`);
        if(includeType){
            const typeHex = HexaEncoder.serializeUInt8(type);
            return `${typeHex}${v}`;
        }
        else{
            return v;
        }
    }

    private serializeFrame(frame: Frame): string {
        // | Frame type | StackPointer | FramePointer |   Return Adress  | FID or Block ID
        // |  1*2 bytes |   4*2bytes   |   4*2bytes   | serializePointer | 4*2bytes or serializePointer
        const funcType = 0;
        const initExprType = 1;
        const blockType = 2;
        const loopType = 3;
        const ifType = 4;
        const validTypes = [funcType, initExprType, blockType, loopType, ifType];

        if (validTypes.indexOf(frame.type) === -1) {
            throw (new Error(`received unknow frame type ${frame.type}`));
        }
        const type = HexaEncoder.serializeUInt8(frame.type);
        const sp = HexaEncoder.serializeInt32(frame.sp, true);
        const fp = HexaEncoder.serializeInt32(frame.fp, true);
        const ra = this.serializePointer(frame.ra);
        let rest = '';
        let res_str = ''; //TODO remove
        if (frame.type === funcType) {
            rest = HexaEncoder.serializeUInt32BE(Number(frame.fidx));
            res_str = `fun_idx=${Number(frame.fidx)}`;
        }
        else {
            rest = this.serializePointer(frame.block_key);
            res_str = `block_key=${frame.block_key}`;
        }
        console.log(`Frame: type=${frame.type} sp=${frame.sp} fp=${frame.fp} ra=${frame.ra} ${res_str}`);
        return `${type}${sp}${fp}${ra}${rest}`;
    }

    private makeAddressEven(addr: string): string {
        const noHexAddr = addr.startsWith('0x') ? addr.slice(2,addr.length): addr;
        const charsMissing = noHexAddr.length % 2;
        return `${'0'.repeat(charsMissing)}${noHexAddr}`;
    }

    public serializeRFCall(functionId: number, args: StackValue[]): string {
        const ws = this;
        const ignoreType = false;
        const fidxHex = HexaEncoder.serializeUInt32BE(functionId);
        const argsHex = args.map(v=>ws.serializeValue(v, ignoreType)).join(''); 
        return `${InterruptTypes.interruptProxyCall}${fidxHex}${argsHex}`;
    }
}