import {ProcessBridge} from './Describer';

export enum Interrupt {
    run = '01',
    halt = '02',
    pause = '03',
    step = '04',
    addBreakpoint = '06',
    removeBreakpoint = '07',
    dump = '10',
    dumpLocals = '11',
    dumpAll = '12',
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
