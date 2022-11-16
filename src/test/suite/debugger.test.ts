/**
 * This file contains test suites of the WARDuino VM and debugger.
 *
 * These tests are independent of the plugin and uses the emulator version of the VM (wdcli).
 */

/* eslint-disable @typescript-eslint/naming-convention */

import 'mocha';
import {InterruptTypes} from '../../DebugBridges/InterruptTypes';
import {
    Behaviour,
    Describer,
    Description,
    Emulator,
    Expectation,
    Expected,
    getValue,
    Instance,
    ProcessBridge,
    SerialInstance,
    Step,
    TestDescription
} from '../framework/describer';
import {assert, expect} from 'chai';
import {ChildProcess, spawn} from 'child_process';
import {ReadlineParser} from 'serialport';
import * as net from 'net';
import {Duplex, Readable} from 'stream';
import {afterEach} from 'mocha';
import {WatCompiler} from '../framework/Compiler';
import {ArduinoUploader} from '../framework/Uploader';

const EMULATOR: string = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const ARDUINO: string = `${require('os').homedir()}/Arduino/libraries/WARDuino/platforms/Arduino/`;
const WABT: string = process.env.WABT ?? '';
const EXAMPLES: string = 'src/test/suite/examples/';
let INITIAL_PORT: number = 7900;

/**
 * Test Suite of the WARDuino CLI
 */

describe('WARDuino CLI: test exit codes', () => {
    let process: ChildProcess;

    /**
     * Tests to see if VM and debugger start properly
     */

    it('Test: exit code (0)', function (done) {
        process = spawn(EMULATOR, ['--no-debug', '--file', `${EXAMPLES}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            done();
        });
    });

    it('Test: exit code (1)', function (done) {
        process = spawn(EMULATOR, ['--socket', (INITIAL_PORT++).toString(), '--file', `${EXAMPLES}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    afterEach('Shutdown CLI', function () {
        process.removeAllListeners('exit');
        process.kill('SIGKILL');
    });
});

describe('WARDuino CLI: test debugging socket', () => {

    it('Test: start websocket', function (done) {
        let succeeded = false;

        const process: ChildProcess = startWARDuino(EMULATOR, `${EXAMPLES}blink.wasm`, INITIAL_PORT++);
        process.on('exit', function (code) {
            assert.isTrue(succeeded, `Interpreter should not exit (${code}).`);
            done();
        });

        while (process.stdout === undefined) {
        }

        if (isReadable(process.stdout)) {
            const reader = new ReadlineParser();
            process.stdout.pipe(reader);

            reader.on('data', (data) => {
                if (data.includes('Listening')) {
                    succeeded = true;
                    process.kill('SIGKILL');
                }
            });
        }
    });

    it('Test: connect to websocket', async function () {
        const instance: Emulator = await connectSocket(EMULATOR, `${EXAMPLES}blink.wasm`, INITIAL_PORT++);
        instance.interface.destroy();
        instance.process.kill('SIGKILL');
    });
});

describe.skip('WARDuino CLI: test proxy connection', () => {
    it('Test: --proxy flag', function (done) {
        const address = {port: INITIAL_PORT, host: '127.0.0.1'};
        const proxy: net.Server = new net.Server();
        proxy.listen(INITIAL_PORT++);
        proxy.on('connection', () => {
            done();
        });

        connectSocket(EMULATOR, `${EXAMPLES}blink.wasm`, INITIAL_PORT++, ['--proxy', address.port.toString()]).then((instance: Emulator) => {
            instance.process.on('exit', function (code) {
                assert.fail(`Interpreter should not exit. (code: ${code})`);
                done();
            });
        }).catch(function (message) {
            assert.fail(message);
            done();
        });
    });
});

/**
 * Functions and classes to bridge communication with WARDuino vm and debugger.
 */

function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

function startWARDuino(interpreter: string, program: string, port: number, args: string[] = []): ChildProcess {
    const _args: string[] = ['--socket', (port).toString(), '--file', program].concat(args);
    return spawn(interpreter, _args);
}

function connectSocket(interpreter: string, program: string, port: number, args: string[] = []): Promise<Emulator> {
    const address = {port: port, host: '127.0.0.1'};
    const process = startWARDuino(interpreter, program, port, args);

    return new Promise(function (resolve, reject) {
        if (process === undefined) {
            reject('Failed to start process.');
        }

        while (process.stdout === undefined) {
        }

        if (isReadable(process.stdout)) {
            const reader = new ReadlineParser();
            process.stdout.pipe(reader);

            reader.on('data', (data) => {
                if (data.includes('Listening')) {
                    const client = new net.Socket();
                    client.connect(address, () => {
                        resolve({process: process, interface: client});
                    });
                }
            });

            reader.on('close', () => {
                reject('Could not connect. Emulator closed down immediately.');
            });
        } else {
            reject();
        }
    });
}

abstract class WARDuinoBridge extends ProcessBridge {
    sendInstruction(socket: Duplex, chunk: any, expectResponse: boolean, parser: (text: string) => Object): Promise<Object | void> {
        const stack: MessageStack = new MessageStack('\n');

        return new Promise(function (resolve) {
            socket.on('data', (data: Buffer) => {
                stack.push(data.toString());
                stack.tryParser(parser, resolve);
            });

            if (chunk) {
                socket.write(`${chunk} \n`);
            }

            if (!expectResponse) {
                resolve(undefined);
            }
        });
    }

    disconnect(instance: Instance | void): Promise<void> {
        instance?.interface.destroy();
        return Promise.resolve();
    }
}

class EmulatorBridge extends WARDuinoBridge {
    public readonly name: string = 'Emulator';
    public readonly connectionTimeout: number = 8000;

    protected readonly interpreter: string;
    protected port: number;

    constructor(interpreter: string, port: number = 8200) {
        super();
        this.interpreter = interpreter;
        this.port = port;
    }

    connect(program: string, args: string[] = []): Promise<Instance> {
        return new WatCompiler(program, WABT).compile().then((output) => {
            return connectSocket(this.interpreter, output.file, this.port++, args);
        });
    }

    disconnect(instance: Emulator | void): Promise<void> {
        instance?.interface.destroy();
        instance?.process.kill('SIGKILL');
        return Promise.resolve();
    }
}

class HardwareBridge extends WARDuinoBridge {
    public readonly name: string = 'Hardware';
    public readonly instructionTimeout: number = 5000;
    public readonly connectionTimeout: number = 50000;

    protected readonly interpreter: string;
    protected readonly port: string;

    constructor(interpreter: string, port: string = '/dev/ttyUSB0') {
        super();
        this.interpreter = interpreter;
        this.port = port;
    }

    connect(program: string, args: string[] = []): Promise<Instance> {
        const bridge = this;

        // TODO wabt + sdkpath
        return new WatCompiler(program, WABT).compile().then((output) => {
            return new ArduinoUploader(output.file, this.interpreter, {path: bridge.port}).upload();
        }).then((connection) => Promise.resolve({interface: connection}));
    }

    disconnect(instance: SerialInstance | void): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            instance?.interface.close((err) => {
                if (err) {
                    reject(err.message);
                    return;
                }
                instance.interface.destroy();
                resolve();
            });
        });
    }
}

class EDWARDBridge extends EmulatorBridge {
    public name: string = 'EDWARD bridge';

    private readonly proxy: string;

    constructor(interpreter: string, port: number = 8200, proxy: string = '/dev/ttyUSB0') {
        super(interpreter, port);
        this.proxy = proxy;
    }

    connect(program: string, args: string[] = []): Promise<Instance> {
        // TODO start proxy and supervisor. connect to both.
        // TODO which connection to return?
        args.concat(['--proxy', this.proxy]);
        return connectSocket(this.interpreter, program, this.port, args);
    }
}

class MessageStack {
    private readonly delimiter: string;
    private stack: string[];

    constructor(delimiter: string) {
        this.delimiter = delimiter;
        this.stack = [];
    }

    public push(data: string): void {
        const messages: string[] = this.split(data);
        if (this.lastMessageIncomplete()) {
            this.stack[this.stack.length - 1] += messages.shift();
        }
        this.stack = this.stack.concat(messages);
    }

    public pop(): string | undefined {
        if (this.hasCompleteMessage()) {
            return this.stack.shift();
        }
    }

    public tryParser(parser: (text: string) => Object, resolver: (value: Object) => void): void {
        let message = this.pop();
        while (message !== undefined) {
            try {
                const parsed = parser(message);
                resolver(parsed);
            } catch (e) {
                // do nothing
            } finally {
                message = this.pop();
            }
        }
    }

    private split(text: string): string[] {
        return text.split(new RegExp(`(.*?${this.delimiter})`, 'g')).filter(s => {
            return s.length > 0;
        });
    }

    private lastMessageIncomplete(): boolean {
        const last: string | undefined = this.stack[this.stack.length - 1];
        return last !== undefined && !last.includes(this.delimiter);
    }

    private hasCompleteMessage(): boolean {
        return !this.lastMessageIncomplete() || this.stack.length > 1;
    }
}

/**
 * Tests of the Remote Debugger API
 */

function stateParser(text: string): Object {
    const message = JSON.parse(text);
    message['pc'] = parseInt(message['pc']);
    return message;
}

const cli: Describer = new Describer(new EmulatorBridge(EMULATOR)).skipall();
const mcu: Describer = new Describer(new HardwareBridge(ARDUINO)).skipall();

const expectDUMP: Expectation[] = [
    {'pc': {kind: 'description', value: Description.defined} as Expected<string>},
    {
        'breakpoints': {
            kind: 'comparison', value: (state: Object, value: Array<any>) => {
                return value.length === 0;
            }, message: 'list of breakpoints should be empty'
        } as Expected<Array<any>>
    },
    {'callstack[0].sp': {kind: 'primitive', value: -1} as Expected<number>},
    {'callstack[0].fp': {kind: 'primitive', value: -1} as Expected<number>}];

const expectDUMPLocals: Expectation[] = [
    {'locals': {kind: 'description', value: Description.defined} as Expected<string>},
    {
        'locals.count': {
            kind: 'comparison', value: (state: Object, value: number) => {
                return value === getValue(state, 'locals.locals').length;
            }, message: 'locals.count should equal length of locals array'
        } as Expected<number>
    }];

const DUMP: Step = {
    title: 'Send DUMP command',
    instruction: InterruptTypes.interruptDUMP,
    parser: stateParser,
    expected: expectDUMP
};

const dumpTest: TestDescription = {
    title: 'Test DUMP',
    program: `${EXAMPLES}blink.wast`,
    steps: [DUMP]
};

cli.describeTest(dumpTest);
mcu.describeTest(dumpTest);

const dumpLocalsTest: TestDescription = {
    title: 'Test DUMPLocals',
    program: `${EXAMPLES}blink.wast`,
    steps: [{
        title: 'Send DUMPLocals command',
        instruction: InterruptTypes.interruptDUMPLocals,
        parser: stateParser,
        expected: expectDUMPLocals
    }],
    skip: true
};

cli.describeTest(dumpLocalsTest);
mcu.describeTest(dumpLocalsTest);

const dumpFullTest: TestDescription = {
    title: 'Test DUMPFull',
    program: `${EXAMPLES}blink.wast`,
    steps: [{
        title: 'Send DUMPFull command',
        instruction: InterruptTypes.interruptDUMPFull,
        parser: stateParser,
        expected: expectDUMP.concat(expectDUMPLocals)
    }],
    skip: true
};

cli.describeTest(dumpFullTest);
mcu.describeTest(dumpFullTest);

const pauseTest: TestDescription = {
    title: 'Test PAUSE',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'Send DUMP command',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }]
    }, {
        title: 'CHECK: execution is stopped',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>
        }]
    }]
};

cli.describeTest(pauseTest);
mcu.describeTest(pauseTest);

const stepTest: TestDescription = {
    title: 'Test STEP',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        parser: stateParser,
        expectResponse: false
    }, DUMP, {
        title: 'Send STEP command',
        instruction: InterruptTypes.interruptSTEP,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'CHECK: execution took one step',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.decreased} as Expected<string>
        }]
    }]
};

cli.describeTest(stepTest);
mcu.describeTest(stepTest);

const runTest: TestDescription = {
    title: 'Test RUN',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        parser: stateParser,
        expectResponse: false
    }, DUMP, {
        title: 'CHECK: execution is stopped',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>
        }]
    }, {
        title: 'Send RUN command',
        instruction: InterruptTypes.interruptRUN,
        parser: stateParser,
        delay: 100,
        expectResponse: false
    }, {
        title: 'CHECK: execution continues',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.changed} as Expected<string>
        }]
    }]
};

cli.describeTest(runTest);
mcu.describeTest(runTest);

// EDWARD tests with mock proxy

function encodeEvent(topic: string, payload: string): string {
    return `{topic: '${topic}', payload: '${payload}'}`;
}

function ackParser(text: string): Object {
    return {'ack': text};
}

const eventNotificationTest: TestDescription = {
    title: 'Test "pushed event" Notification',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Push mock event',
        instruction: InterruptTypes.interruptPUSHEvent,
        payload: encodeEvent('interrupt', ''),
        parser: ackParser,
        expected: [{
            'ack': {
                kind: 'comparison',
                value: (state: string, value: string) => value.includes('Interrupt: 73'),
                message: 'no acknowledge received from runtime'
            } as Expected<string>
        }]
    }]
};

cli.describeTest(eventNotificationTest);

const dumpEventsTest: TestDescription = {
    title: 'Test DUMPEvents',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'CHECK: event queue',
        instruction: InterruptTypes.interruptDUMPEvents,
        parser: stateParser,
        expected: [{
            'events': {
                kind: 'comparison',
                value: (state: string, value: Array<any>) => value.length === 0,
                message: 'events queue is should be empty'
            } as Expected<Array<any>>
        }]
    }]
};

cli.describeTest(dumpEventsTest);
mcu.describeTest(dumpEventsTest);

const receiveEventTest: TestDescription = {
    title: 'Test Event Transfer (supervisor side)',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        expectResponse: false
    }, {
        title: 'Push mock event',
        instruction: InterruptTypes.interruptPUSHEvent,
        payload: encodeEvent('interrupt', ''),
        expectResponse: false
    }, {
        title: 'CHECK: event queue',
        instruction: InterruptTypes.interruptDUMPEvents,
        parser: stateParser,
        expected: [{
            'events': {
                kind: 'comparison',
                value: (state: string, value: Array<any>) => value.length === 1,
                message: 'events queue should include 1 event'
            } as Expected<Array<any>>
        }]
    }]
};

cli.describeTest(receiveEventTest);

const dumpCallbackMappingTest: TestDescription = {
    title: 'Test DUMPCallbackmapping',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'CHECK: callbackmapping',
        instruction: InterruptTypes.interruptDUMPCallbackmapping,
        parser: stateParser,
        expected: [{
            'callbacks': {
                kind: 'comparison',
                value: (state: string, value: Array<any>) => value.length === 1,
                message: 'callbackmapping should contain one callback'
            } as Expected<Array<any>>
        }]
    }]
};

cli.describeTest(dumpCallbackMappingTest);
mcu.describeTest(dumpCallbackMappingTest);
