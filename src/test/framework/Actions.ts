import {ProcessBridge} from './Describer';
import {SourceMap} from '../../State/SourceMap';
import {FunctionInfo} from '../../State/FunctionInfo';
import * as ieee754 from 'ieee754';
import {Type, typing, Value} from '../suite/spec.util';

function convertToLEB128(a: number): string { // TODO can only handle 32 bit
    a |= 0;
    const result = [];
    while (true) {
        const byte_ = a & 0x7f;
        a >>= 7;
        if (
            (a === 0 && (byte_ & 0x40) === 0) ||
            (a === -1 && (byte_ & 0x40) !== 0)
        ) {
            result.push(byte_.toString(16).padStart(2, '0'));
            return result.join('').toUpperCase();
        }
        result.push((byte_ | 0x80).toString(16).padStart(2, '0'));
    }
}

export enum Instruction {
    run = '01',
    halt = '02',
    pause = '03',
    step = '04',
    addBreakpoint = '06',
    removeBreakpoint = '07',
    dump = '10',
    dumpLocals = '11',
    dumpAll = '12',
    reset = '13',
    updateFunction = '20',
    updateModule = '22',
    invoke = '40',
    // Pull debugging messages
    snapshot = '60',
    offset = '61',
    loadSnapshot = '62', // WOOD Change state
    updateProxies = '63',
    proxyCall = '64',
    proxify = '65',
    // Push debugging messages
    dumpAllEvents = '70',
    dumpEvents = '71',
    popEvent = '72',
    pushEvent = '73',
    dumpCallbackmapping = '74',
    updateCallbackmapping = '75'
}

export class Action {
    private act: (bridge: ProcessBridge) => Promise<string>;

    constructor(act: (bridge: ProcessBridge) => Promise<string>) {
        this.act = act;
    }

    public perform(bridge: ProcessBridge, parser: (text: string) => Object): Promise<Object> {
        return new Promise<Object>((resolve, reject) => {
            this.act(bridge).then((data: string) => {
                resolve(parser(data));
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

}

export const parserTable: Map<Instruction | Action, (input: string) => Object> = new Map([
    [Instruction.run, stateParser],
    [Instruction.pause, stateParser],
    [Instruction.step, stateParser],
    [Instruction.dump, stateParser],
    [Instruction.dumpLocals, stateParser],
    [Instruction.dumpAll, stateParser],
    [Instruction.dumpEvents, stateParser],
    [Instruction.dumpCallbackmapping, stateParser],
    [Instruction.pushEvent, stateParser],
    [Instruction.invoke, returnParser],
    [Instruction.reset, resetParser],
]);

export const encoderTable: Map<Instruction | Action, (map: SourceMap, input: any) => string | undefined> = new Map([
    [Instruction.invoke, encode]
]);

function resetParser(text: string): Object {
    if (!text.toLowerCase().includes('reset')) {
        throw new Error();
    }

    return ackParser(text);
}

function ackParser(text: string): Object {
    return {'ack': text};
}

function returnParser(text: string): Object {
    const object = JSON.parse(text);
    if (object.stack.length === 0) {
        return object;
    }

    const result = object.stack[0];
    const type: Type = typing.get(result.type.toLowerCase()) ?? Type.unknown;
    if (type === Type.f32 || type === Type.f64) {
        const buff = Buffer.from(result.value, 'hex');
        result.value = ieee754.read(buff, 0, false, 23, buff.length);
    }

    return result;
}

function stateParser(text: string): Object {
    const message = JSON.parse(text);
    message['pc'] = parseInt(message['pc']);
    return message;
}

function encode(map: SourceMap, input: any): string | undefined {
    const name: string = input.name;
    const args: Value[] = input.args;
    const func = map.functionInfos.find((func: FunctionInfo) => func.name === name);

    if (func === undefined) {
        return;
    }

    let result: string = convertToLEB128(func.index);
    args.forEach((arg: Value) => {
        if (arg.type === Type.i32 || arg.type === Type.i64) {
            result += convertToLEB128(arg.value);  // todo support i64
        } else {
            const buff = Buffer.alloc(arg.type === Type.f32 ? 4 : 8);
            ieee754.write(buff, arg.value, 0, true, 23, buff.length);
            result += buff.toString('hex');
        }
    });
    return result;
}