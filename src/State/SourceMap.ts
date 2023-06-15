import { LineInfoPairs } from './LineInfoPairs';
import { FunctionInfo } from './FunctionInfo';
import { VariableInfo } from './VariableInfo';
import { TypeInfo } from './TypeInfo';

export interface SourceMap {
    lineInfoPairs: LineInfoPairs[];
    functionInfos: FunctionInfo[];
    globalInfos: VariableInfo[];
    importInfos: FunctionInfo[];
    typeInfos: Map<number, TypeInfo>;
}


export function EmptySourceMap(): SourceMap {
    return {
        lineInfoPairs: [],
        functionInfos: [],
        globalInfos: [],
        importInfos: [],
        typeInfos: new Map<number, TypeInfo>()
    };
}

export function getLineNumberForAddress(sourceMap: SourceMap, address: number, includeMinusOne = true): number {
    let line = 0;
    sourceMap.lineInfoPairs.forEach((info) => {
        const candidate = parseInt('0x' + info.lineAddress);
        if (Math.abs(address - candidate) === 0) {
            line = info.lineInfo.line;
            if (includeMinusOne) {
                line = line - 1; // todo fix need for -1
            }
        }
    });
    return line;
}
