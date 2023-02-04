import {ProcessBridge} from './Describer';

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

function resetParser(text: string): Object {
    if (!text.toLowerCase().includes('reset')) {
        throw new Error();
    }

    return {'ack': text};
}

function returnParser(text: string): Object {
    const object = JSON.parse(text);
    return object.stack.length > 0 ? object.stack[0] : object;
}

function stateParser(text: string): Object {
    const message = JSON.parse(text);
    message['pc'] = parseInt(message['pc']);
    return message;
}
