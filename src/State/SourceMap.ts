import {LineInfoPairs} from "./LineInfoPairs";
import {FunctionInfo} from "./FunctionInfo";
import {VariableInfo} from "./VariableInfo";
import { TypeInfo } from "./TypeInfo";

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