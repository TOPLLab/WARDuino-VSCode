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
