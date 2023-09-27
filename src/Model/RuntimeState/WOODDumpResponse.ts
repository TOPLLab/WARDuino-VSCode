import { StackValue } from './StackValue';
import { CallbackMapping } from './CallbackMapping';
import { InterruptEvent } from './InterruptEvent';
import { Frame } from './Frame';
import { Table } from './Table';
import { Memory } from './Memory';
import { BRTable } from './BRTable';


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

class SnapshotError {
    private _pc_error!: number;
    private _exception_msg!: string;

    constructor(pc_error: number, exception_msg: string) {
        this.pc_error = pc_error;
        this.exception_msg = exception_msg;
    }

    //Getters and Setters
    public get pc_error(): number {
        return this._pc_error;
    }

    private set pc_error(value: number) {
        this._pc_error = value;
    }

    public get exception_msg(): string {
        return this._exception_msg;
    }

    private set exception_msg(value: string) {
        this._exception_msg = value;
    }

}

class Store {
    private _globals!: StackValue[];
    private _table!: Table;
    private _memory!: Memory;
}

class Snapshot {
    private _pc!: number;

    // StateFlow
    private _stack!: StackValue[];
    private _callstack!: Frame[];
    private _br_table!: BRTable;

    // Store
    private _store!: Store;

    // Debug State 
    private _breakpoints!: number[];
}


class OutOfPlaceSnapshot extends Snapshot {
    // Out of Place State
    private callbacks!: CallbackMapping[];
    private events!: InterruptEvent[];
}