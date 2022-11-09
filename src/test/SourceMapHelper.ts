import { SourceMap } from '../State/SourceMap';
import { InterruptTypes } from '../DebugBridges/InterruptTypes';
import { Maybe, Just, Nothing } from 'purify-ts/Maybe';

export class SourceMapHelper {

    private sourceMap: SourceMap;
    private startAddress: Maybe<number> = Nothing;

    constructor(sourceMap: SourceMap) {
        this.sourceMap = sourceMap;
    }

    public setStartAddress(address: number) {
        this.startAddress = Just(address);
    }

    public lineToVirtualAddress(line: number): Maybe<number> {
        const addr: string | undefined =
            this.sourceMap.lineInfoPairs.find(p => { return p.lineInfo.line === line; })?.lineAddress;
        return addr ? Just(Number(`0x${addr}`)) : Nothing;
    }

    public lineToAddress(line: number): Maybe<number> {
        const seq = Maybe.sequence([this.lineToVirtualAddress(line), this.startAddress]);
        return seq.map(([v1, v2]: Array<number>) => { return v1 + v2; });
    }

    public hasLine(line: number): boolean {
        return this.lineToAddress(line).isJust();
    }

    public addBpCommand(line: number): Maybe<string> {
        const payload = this.bpPayloadFromLine(line);
        return payload.map(pl => `${InterruptTypes.interruptBPAdd}${pl}`);
    }

    public removeBpCommand(line: number): Maybe<string> {
        const payload = this.bpPayloadFromLine(line);
        return payload.map(pl => `${InterruptTypes.interruptBPRem}${pl}`);
    }

    private bpPayloadFromLine(line: number): Maybe<string> {
        return this.lineToAddress(line).map(addr => this.bpPayloadFromAddr(addr));
    }

    private bpPayloadFromAddr(addr: number): string {
        console.error('FIX BP length cause floating point based payload');
        const bpAddr = addr.toString(16).toUpperCase();
        return `${(bpAddr.length / 2).toString(16)}${bpAddr}`;
    }

}