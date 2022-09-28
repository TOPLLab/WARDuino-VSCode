import {EventItem} from '../Views/EventsProvider';
import {Frame} from '../Parsers/Frame';
import {VariableInfo} from './VariableInfo';

function hash(s: string) {
    let h: number = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h;
}

export class RuntimeState {
    private id: number = 0;
    private programCounter: number = 0;
    public startAddress: number = 0;
    public callstack: Frame[] = [];
    public locals: VariableInfo[] = [];
    public events: EventItem[] = [];

    constructor(source?: string) {
        this.id = hash(source ?? '');
    }

    public getId(): number {
        return this.id;
    }

    public getRawProgramCounter(): number {
        return this.programCounter;
    }

    public setRawProgramCounter(raw: number) {
        this.programCounter = raw;
    }

    public getAdjustedProgramCounter(): number {
        return this.programCounter - this.startAddress;
    }

    public currentFunction(): number {
        if (this.callstack.length === 0) {
            return -1;
        }
        return this.callstack[this.callstack.length - 1].index;
    }

    public deepcopy(): RuntimeState {
        const copy = new RuntimeState(undefined);
        copy.id = this.id;
        copy.programCounter = this.programCounter;
        copy.startAddress = this.startAddress;
        copy.callstack = this.callstack.map(obj => Object.assign({}, obj));
        copy.locals = this.locals.map(obj => Object.assign({}, obj));
        copy.events = this.events.map(obj => new EventItem(obj.topic, obj.payload, obj.collapsibleState));
        return copy;
    }
}
