/**
 * This file contains test suites of the WARDuino VM and debugger.
 *
 * These tests are independent of the plugin and uses the emulator version of the VM (wdcli).
 */
import 'mocha';
import {InterruptTypes} from '../../DebugBridges/InterruptTypes';
import {Behaviour, Describer, Description, Expected, Instance, ProcessBridge, TestDescription} from '../describer';
import {assert, expect} from 'chai';
import {ChildProcess, spawn} from 'child_process';
import {ReadlineParser} from 'serialport';
import * as net from 'net';
import {Duplex, Readable} from 'stream';

const interpreter: string = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const examples: string = 'src/test/suite/examples/';
let port: number = 8200;

function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

/**
 * Test Suite of the WARDuino CLI
 */
describe('WARDuino CLI Test Suite', () => {

    /**
     * Tests to see if VM and debugger start properly
     */

    it('Test: exitcode (0)', function (done) {
        spawn(interpreter, ['--no-debug', '--file', `${examples}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            done();
        });
    });

    it('Test: exitcode (1)', function (done) {
        spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    it('Test: start websocket', function (done) {
        let succeeded = false;

        const process: ChildProcess = startWARDuino(interpreter, `${examples}blink.wasm`, port++);
        process.on('exit', function () {
            assert.isTrue(succeeded, 'Interpreter should not exit.');
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
        await connectWARDuino(interpreter, `${examples}blink.wasm`, port++);
    });

    it('Test: --proxy flag', function (done) {
        const address = {port: port, host: '127.0.0.1'};
        const proxy: net.Server = new net.Server();
        proxy.listen(port++);
        proxy.on('connection', function (socket: net.Socket) {
            done();
        });

        connectWARDuino(interpreter, `${examples}blink.wasm`, port++, ['--proxy', address.port.toString()]).then((instance: Instance) => {
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

function startWARDuino(interpreter: string, program: string, port: number, args: string[] = []): ChildProcess {
    const _args: string[] = ['--socket', (port).toString(), '--file', program].concat(args);
    return spawn(interpreter, _args);
}

function connectWARDuino(interpreter: string, program: string, port: number, args: string[] = []): Promise<Instance> {
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
        } else {
            reject();
        }
    });
}

class WARDuinoBridge extends ProcessBridge {
    protected readonly interpreter: string;
    private readonly port: number;

    constructor(interpreter: string, port: number = 8200) {
        super();
        this.interpreter = interpreter;
        this.port = port;
    }

    connect(program: string, args: string[] = []): Promise<Instance> {
        return connectWARDuino(this.interpreter, program, this.port, args);
    }

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

const describer: Describer = new Describer();

const jsonTest: TestDescription = {
    title: 'Test valid JSON',
    program: `${examples}blink.wasm`,
    bridge: new WARDuinoBridge(interpreter, port++),
    tests: [{
        title: 'DUMP',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [
            {'pc': {kind: 'description', value: Description.defined} as Expected<string>}
        ]
    }, {
        title: 'DUMPFull',
        instruction: InterruptTypes.interruptDUMPFull,
        parser: stateParser,
        expected: [
            {'pc': {kind: 'description', value: Description.defined} as Expected<string>},
            {'locals': {kind: 'description', value: Description.defined} as Expected<string>}
        ]
    }, {
        title: 'DUMPLocals',
        instruction: InterruptTypes.interruptDUMPLocals,
        parser: stateParser,
        expected: [{
            'locals': {kind: 'description', value: Description.defined} as Expected<string>
        }]
    }]
};

describer.describeTest(jsonTest);

const pauseTest: TestDescription = {
    title: 'Test PAUSE',
    program: `${examples}blink.wasm`,
    bridge: new WARDuinoBridge(interpreter, port++),
    tests: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'Get state of VM',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }]
    }, {
        title: 'Execution is stopped',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>
        }]
    }]
};

describer.describeTest(pauseTest);

const stepTest: TestDescription = {
    title: 'Test STEP',
    program: `${examples}blink.wasm`,
    bridge: new WARDuinoBridge(interpreter, port++),
    tests: [{
        title: 'Send PAUSE command',
        instruction: InterruptTypes.interruptPAUSE,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'Get state of VM',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }]
    }, {
        title: 'Send STEP command',
        instruction: InterruptTypes.interruptSTEP,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'Execution took one step',
        instruction: InterruptTypes.interruptDUMP,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.decreased} as Expected<string>
        }]
    }]
};

describer.describeTest(stepTest);

function stateParser(text: string): Object {
    const message = JSON.parse(text);
    message['pc'] = parseInt(message['pc']);
    return message;
}
