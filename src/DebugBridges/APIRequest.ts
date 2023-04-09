import { ExecutionStateType, numberExecutionStateTypes } from "../State/WOODState";
import { HexaEncoder } from "../Util/hexaEncoding";
import { InterruptTypes } from "./InterruptTypes";

export type Request = {
    dataToSend: string;
    responseMatchCheck: (line: string) => boolean;
}

export class StateRequest {

    private state: string[] = [];

    public isRequestEmpty(): boolean {
        return this.state.length === 0;
    }

    public includePC() {
        this.pushState(ExecutionStateType.pcState);
    }

    public includeStack() {
        this.pushState(ExecutionStateType.stackState);
    }

    public includeCallstack() {
        this.pushState(ExecutionStateType.callstackState);
    }

    public includeGlobals() {
        this.pushState(ExecutionStateType.globalsState);
    }

    public includeMemory() {
        this.pushState(ExecutionStateType.memState);
    }

    public includeTable() {
        this.pushState(ExecutionStateType.tableState);
    }

    public includeBranchingTable() {
        this.pushState(ExecutionStateType.branchingTableState);
    }

    public includeBreakpoints() {
        this.pushState(ExecutionStateType.breakpointState);
    }

    public includeError() {
        this.pushState(ExecutionStateType.errorState);
    }

    public includeCallbackMappings() {
        this.pushState(ExecutionStateType.callbacksState);
    }

    public includeEvents() {
        this.pushState(ExecutionStateType.eventsState);
    }

    public includeAll() {
        let idx = 1;
        while (idx < numberExecutionStateTypes) {
            let s = idx.toString(16);
            // pad with zero
            if (s.length <= 1) {
                s = '0' + s;
            }
            this.pushState(s);
            idx++;
        }
    }


    public generateInterrupt(): string {
        this.state.sort();
        const numberBytes = HexaEncoder.serializeUInt16BE(this.state.length);
        const stateToReq = this.state.join("");
        return `${InterruptTypes.interruptDumpExecutionState}${numberBytes}${stateToReq}`;
    }


    private pushState(s: string): void {
        const present = this.state.find(s2 => s === s2);
        if (!!!present) {
            this.state.push(s);
        }
    }

    static fromList(states: ExecutionStateType[]): StateRequest {
        const request = new StateRequest();
        states.forEach(s => {
            request.pushState(s);
        })
        return request;
    }
}

export const RunRequest: Request = {
    dataToSend: InterruptTypes.interruptRUN + "\n",
    responseMatchCheck: (line: string) => {
        return line === "GO!";
    }
}