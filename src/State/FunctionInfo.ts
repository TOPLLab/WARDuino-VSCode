import {VariableInfo} from './VariableInfo';

export interface FunctionInfo {
    index: number;
    type: number;
    name: string;
    locals: VariableInfo[];
}