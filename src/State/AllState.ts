import { SourceMap } from "../State/SourceMap";
import { FunctionInfo } from "./FunctionInfo";
import { VariableInfo } from "./VariableInfo";
import { WOODDumpResponse, WOODState, Frame, FRAME_FUNC_TYPE } from "./WOODState";


export class WasmState {

    private state: WOODDumpResponse;
    private sourceMap: SourceMap;

    constructor(state: WOODDumpResponse, sourceMap: SourceMap) {
        this.state = state;
        this.sourceMap = sourceMap;
    }

    // State getters
    getCurrentFunction(): FunctionInfo | undefined {
        const frame = this.getCurrentFunctionFrame();
        let func = undefined;
        if (!!frame) {
            this.sourceMap.functionInfos.find((func) => {
                return func.index === Number(frame.fidx);
            });
        }
        return func;
    }

    getArguments(): VariableInfo[]{
        const frame = this.getCurrentFunctionFrame();
        const func = this.getCurrentFunction();
        const stack = this.state.stack;
        const type = this.sourceMap.typeInfos.get(func?.type ?? -1);
        const argsAmount = type?.parameters.length;
        const argStartIndex = !!frame && !!argsAmount && frame.fp - argsAmount;
        let args = [];
        if(!!argStartIndex){
            const withIndexes = stack.map((sv, index)=>{
                return {index: index, value: sv};
            });
            args = withIndexes.slice(argStartIndex, argStartIndex + argsAmount).map((val, argIndex)=>{
                const sv = val.value;
                return {index: val.index, name: `arg${argIndex}`, type: sv.type, mutable: true, value: `${sv.value}`};
            });
        }
        else {
            return [];
        }
        return args;
    }

    getLocals(): VariableInfo[] {
        const frame = this.getCurrentFunctionFrame();
        if (!!!frame) {
            return [];
        }
        const func = this.getCurrentFunction();
        if (!!!func) {
            return [];
        }
        const stack = this.state.stack;
        return func.locals.map((local, idx)=>{
            const sv = stack[frame.fp + 1 + idx];
            return {index: local.index, name: local.name, type: local.type, mutable: local.mutable, value: `${sv.value}`};
        });
    }

    getGlobals(): VariableInfo[]{
        return this.state.globals.map((gb, idx) =>{
            const globalInfo = this.sourceMap.globalInfos[idx];
            const r = Object.assign({}, globalInfo);
            r.value = gb.value.toString();
            return r;
        });
    }

    getFunction(funcId: number): FunctionInfo | undefined {
        return this.sourceMap.functionInfos.find(f=>f.index===funcId);
    }

    getPC(): number {
        return this.state.pc;
    }

    getCallStack(): Frame[] {
        return this.state.callstack.filter(frame=> frame.type === FRAME_FUNC_TYPE);
    }

    getStack(): VariableInfo[]{
        const frame =this.getCurrentFunctionFrame();
        if(!!!frame){
            return this.getAllStack();
        }
        const func = this.sourceMap.functionInfos.find(f=>f.index===Number(frame.fidx));
        if(!!!func){
            return this.getAllStack();
        }

        const type = this.sourceMap.typeInfos.get(func.type);
        if(!!!type){
            throw (new Error(`Invalid function type index ${func.type}`));
        }
        const argsAmount = type.parameters.length;
        const stack = this.state.stack.slice(0, frame.fp - argsAmount);
        return stack.map((sv, idx)=>{
            return {index: idx, name: "", type: sv.type, mutable: true, value: sv.value.toString()};
        });
    }

    getAllStack(): VariableInfo[]{
        return this.state.stack.map((sv, idx)=>{
            return {index: idx, name: "", type: sv.type, mutable: true, value: sv.value.toString()};
        });
    }

    private getCurrentFunctionFrame(): Frame | undefined {
        let index = this.state.callstack.length - 1;
        let frame = undefined;
        while (index >= 0 && this.state.callstack[index].type !== FRAME_FUNC_TYPE) {
            index--;
        }
        if (index >= 0) {
            frame = this.state.callstack[index];
        }
        return frame;
    }

    static fromLine(line: string, sourceMap: SourceMap): WasmState {
        const ws = new WOODState(line);
        return new WasmState(ws.getState(), sourceMap);
    }
}


