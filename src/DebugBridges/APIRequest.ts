import { ExecutionStateType, WOODDumpResponse, numberExecutionStateTypes } from '../State/WOODState';
import { HexaEncoder } from '../Util/hexaEncoding';
import { InterruptTypes } from './InterruptTypes';

export type Request = {
    dataToSend: string;
    expectedResponse: (line: string) => boolean;
};

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
        while (idx <= numberExecutionStateTypes) {
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
        const stateToReq = this.state.join('');
        return `${InterruptTypes.interruptInspect}${numberBytes}${stateToReq}`;
    }

    public generateRequest(): Request {
        return {
            dataToSend: this.generateInterrupt() + '\n',
            expectedResponse: (line: string) => {
                return this.isExpectedState(line);
            }
        };
    }

    private isExpectedState(line: string): boolean {
        try {
            const response: WOODDumpResponse = JSON.parse(line);
            for (let i = 0; i < this.state.length; i++) {
                const s = this.state[i];
                if (s === ExecutionStateType.pcState && response.pc === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.breakpointState && response.breakpoints === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.callstackState && response.callstack === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.globalsState && response.globals === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.tableState && response.table === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.memState && response.memory === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.branchingTableState && response.br_table === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.stackState && response.stack === undefined) {
                    return false;
                }
                else if (s === ExecutionStateType.callbacksState && response.callbacks === undefined) {
                    return false;
                }

                else if (s === ExecutionStateType.eventsState && response.events === undefined) {
                    return false;
                }
            }
            return true;
        }
        catch (err) {
            return false;
        }
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
        });
        return request;
    }
}

export const RunRequest: Request = {
    dataToSend: InterruptTypes.interruptRUN + '\n',
    expectedResponse: (line: string) => {
        return line === 'GO!';
    }
};

export const PauseRequest: Request = {
    dataToSend: InterruptTypes.interruptPAUSE + '\n',
    expectedResponse: (line: string) => {
        return line === 'PAUSE!';
    }
};

export function UpdateGlobalRequest(globalIdx: number, dataToSend: string) {
    // because of issue https://github.com/TOPLLab/WARDuino/issues/187
    // we will resolve update request based on substring match
    return {
        dataToSend: dataToSend + '\n',
        expectedResponse: (line: string) => {
            return line.includes(`Global ${globalIdx} changed to`);
        }
    };
}

export function StackValueUpdateRequest(stackValueIdx: number, dataToSend: string) {
    return {
        dataToSend: dataToSend + '\n',
        expectedResponse: (line: string) => {
            return line === `Updated StackValue ${stackValueIdx}`;
        }
    };
}

export function UpdateStateRequest(stateToSend: string[]): Request[] {
    const finalStateIdx = stateToSend.length - 1;
    return stateToSend.map((state, stateIdx) => {
        return {
            dataToSend: state + '\n',
            expectedResponse: (line: string) => {
                if (finalStateIdx === stateIdx) {
                    return line === 'done!';
                }
                else {
                    return line === 'ack!';
                }
            }
        };
    });
}

export function UpdateModuleRequest(wasm: Buffer): Request {
    const w = new Uint8Array(wasm);
    const sizeHex = HexaEncoder.convertToLEB128(w.length);
    const sizeBuffer = Buffer.allocUnsafe(4);
    sizeBuffer.writeUint32BE(w.length);
    const wasmHex = Buffer.from(w).toString('hex');
    const dataToSend = `${InterruptTypes.interruptUPDATEModule}${sizeHex}${wasmHex}`;
    return {
        dataToSend: dataToSend + '\n',
        expectedResponse: (line: string) => {
            return line === 'CHANGE Module!';
        }
    };
}

export const ProxifyRequest: Request =  {
    dataToSend: `${InterruptTypes.interruptProxify}\n`,
    expectedResponse: (line: string) => {
        return line === 'Interrupt: 65';
    }
};