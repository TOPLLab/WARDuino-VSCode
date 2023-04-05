import { SourceMap } from "../State/SourceMap";
import { FunctionInfo } from "./FunctionInfo";
import { VariableInfo } from "./VariableInfo";
import { WOODDumpResponse, WOODState, Frame, FRAME_FUNC_TYPE, InterruptEvent, ExecutionStateType } from "./WOODState";


export class WasmState {

    private state: WOODDumpResponse;
    private sourceMap: SourceMap;

    constructor(state: WOODDumpResponse, sourceMap: SourceMap) {
        this.state = state;
        this.sourceMap = sourceMap;
    }

    // State getters
    getCurrentFunction(): FunctionInfo | undefined {
        return this.getCurrentFunctionAndFrame()?.[1];
    }

    getEvents(): InterruptEvent[] {
        return this.state.events ?? [];
    }

    getMissingState(): ExecutionStateType[] {
        const missings = [];
        if (this.state.pc === undefined) {
            missings.push(ExecutionStateType.pcState);
        }

        if (this.state.breakpoints === undefined) {
            missings.push(ExecutionStateType.breakpointState);
        }

        if (this.state.callstack === undefined) {
            missings.push(ExecutionStateType.callstackState);
        }

        if (this.state.globals === undefined) {
            missings.push(ExecutionStateType.globalsState);
        }

        if (this.state.table === undefined) {
            missings.push(ExecutionStateType.tableState);
        }

        if (this.state.memory === undefined) {
            missings.push(ExecutionStateType.memState);
        }

        if (this.state.br_table === undefined) {
            missings.push(ExecutionStateType.branchingTableState);
        }


        if (this.state.stack === undefined) {
            missings.push(ExecutionStateType.stackState);
        }

        if (this.state.pc_error === undefined || this.state.exception_msg === undefined) {
            missings.push(ExecutionStateType.errorState);
        }

        if (this.state.callbacks === undefined) {
            missings.push(ExecutionStateType.callbacksState);
        }

        if (this.state.events === undefined) {
            missings.push(ExecutionStateType.eventsState);
        }
        return missings;
    }

    getArguments(): VariableInfo[] {
        const r = this.getCurrentFunctionAndFrame();
        if (!!!r || !!!this.state.stack) {
            return [];
        }
        const [frame, func] = r;
        const type = this.sourceMap.typeInfos.get(func.type);
        const argsAmount = type?.parameters.length;
        if (!!!argsAmount || argsAmount === 0) {
            return [];
        }
        const argStartIndex = frame.sp + 1;
        const args = this.state.stack.slice(argStartIndex, argStartIndex + argsAmount).map((sv, argIndex) => {
            return { index: sv.idx, name: `arg${argIndex}`, type: sv.type, mutable: true, value: `${sv.value}` };
        });
        return args;
    }

    getLocals(): VariableInfo[] {
        const r = this.getCurrentFunctionAndFrame();
        if (!!!r) {
            return [];
        }
        const [frame, func] = r;
        const stack = this.state.stack;
        if (!!!stack) {
            return [];
        }
        return func.locals.map((local, idx) => {
            const sv = stack[frame.fp + 1 + idx];
            return { index: local.index, name: local.name, type: local.type, mutable: local.mutable, value: `${sv.value}` };
        });
    }

    getGlobals(): VariableInfo[] {
        return this.state.globals?.map((gb, idx) => {
            const globalInfo = this.sourceMap.globalInfos[idx];
            const r = Object.assign({}, globalInfo);
            r.value = gb.value.toString();
            return r;
        }) ?? [];
    }

    getFunction(funcId: number): FunctionInfo | undefined {
        return this.sourceMap.functionInfos.find(f => f.index === funcId);
    }

    getPC(): number {
        if (!!this.state.pc) {
            return this.state.pc;
        }
        return 0;
    }

    hasException() {
        return !!this.state.pc_error || (!!this.state.exception_msg && this.state.exception_msg !== "");
    }

    getPCError(): number {
        if (!!this.state.pc_error) {
            return this.state.pc_error;
        }
        return -1;
    }

    getExceptionMsg(): string {
        if (!!this.state.exception_msg) {
            return this.state.exception_msg;
        }
        return "";
    }

    getCallStack(): Frame[] {
        return this.state.callstack?.filter(frame => frame.type === FRAME_FUNC_TYPE) ?? [];
    }

    getStack(): VariableInfo[] {
        return this.getAllStack();
        // const frame =this.getCurrentFunctionFrame();
        // if(!!!frame){
        //     return this.getAllStack();
        // }
        // const func = this.sourceMap.functionInfos.find(f=>f.index===Number(frame.fidx));
        // if(!!!func){
        //     return this.getAllStack();
        // }

        // const type = this.sourceMap.typeInfos.get(func.type);
        // if(!!!type){
        //     throw (new Error(`Invalid function type index ${func.type}`));
        // }
        // const argsAmount = type.parameters.length;
        // const stack = this.state.stack.slice(0, frame.fp - argsAmount);
        // return stack.map((sv, idx)=>{
        //     return {index: idx, name: "", type: sv.type, mutable: true, value: sv.value.toString()};
        // });
    }

    getAllStack(): VariableInfo[] {
        return this.state.stack?.map((sv, idx) => {
            return { index: idx, name: "", type: sv.type, mutable: true, value: sv.value.toString() };
        }) ?? [];
    }

    private getCurrentFunctionAndFrame(): [Frame, FunctionInfo] | undefined {
        if (!!!this.state.callstack) {
            return undefined;
        }

        let index = this.state.callstack.length - 1;
        while (index >= 0 && this.state.callstack[index].type !== FRAME_FUNC_TYPE) {
            index--;
        }
        if (index < 0) {
            return undefined;
        }
        const frame = this.state.callstack[index];
        const func = this.sourceMap.functionInfos.find((f) => {
            return f.index === Number(frame.fidx);
        });
        if (!!!func) {
            return undefined;
        }
        return [frame, func];
    }

    public updateStackValue(index: number, newvalue: number): void {
        const stack = this.state.stack ?? [];
        if (index >= stack.length) {
            return undefined;
        }
        const sv = stack[index];
        sv.value = newvalue;
    }

    public updateGlobalValue(index: number, newvalue: number): void {
        const gbls = this.state.globals ?? [];
        if (index >= gbls.length) {
            return undefined;
        }
        const g = gbls[index];
        g.value = newvalue;
    }


    public serializeStackValueUpdate(index: number): string | undefined {
        if (!!!this.state.stack || index >= this.state.stack.length) {
            return undefined;
        }
        const sv = this.state.stack[index];
        return WOODState.serializeStackValueUpdate(sv);
    }

    public serializeGlobalValueUpdate(index: number): string | undefined {
        if (!!!this.state.globals || index >= this.state.globals.length) {
            return undefined;
        }
        const sv = this.state.globals[index];
        return WOODState.serializeGlobalValueUpdate(sv);
    }

    static fromLine(line: string, sourceMap: SourceMap): WasmState {
        const ws = new WOODState(line);
        return new WasmState(ws.getState(), sourceMap);
    }
}


