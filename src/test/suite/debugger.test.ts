// Tests specific to the debugger
import "mocha";

import {ChildProcess, spawn} from "child_process";
import {Readable} from "stream";
import {assert, expect} from "chai";
import {ReadlineParser} from "serialport";
import * as net from 'net';
import {InterruptTypes} from "../../DebugBridges/InterruptTypes";

/**
 * This file contains test suites of the WARDuino VM and debugger.
 *
 * These tests are independent of the plugin and uses the emulator version of the VM (wdcli).
 */
const interpreter = `${require('os').homedir()}/Arduino/libraries/WARDuino/build-emu/wdcli`;
const examples = 'src/test/suite/examples/';

let port: number = 8192;

function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

function startDebugger(program: string, args: string[] = []): ChildProcess {
    const _args: string[] = ['--socket', (port++).toString(), '--file', program].concat(args);
    return spawn(interpreter, _args);

}

interface WARDuinoInstance {
    process: ChildProcess;
    interface: net.Socket;
}

function connectToDebugger(program: string, args: string[] = []): Promise<WARDuinoInstance> {
    const address = {port: port, host: "127.0.0.1"};
    const process = startDebugger(program, args);

    return new Promise(function (resolve, reject) {
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

function sendInstruction(socket: net.Socket, instruction: InterruptTypes | undefined, timeout: number = 0): Promise<any> {
    const stack: MessageStack = new MessageStack('\n');

    return new Promise(function (resolve, reject) {
        socket.on('data', (data: Buffer) => {
            stack.push(data.toString());
            let message = stack.pop();
            while (message !== undefined) {
                try {
                    const parsed = JSON.parse(message);
                    resolve(parsed);
                } catch (e) {
                    // do nothing
                } finally {
                    message = stack.pop();
                }
            }
        });

        if (instruction !== undefined) {
            socket.write(`${instruction} \n`);
        }
        // wait briefly for the operation to take effect
        // send dump command
        setTimeout(function () {
            socket.write(`${InterruptTypes.interruptDUMP} \n`);
        }, timeout);
    });
}

/**
 * Test Suite of the WARDuino CLI
 */
suite('WARDuino CLI Test Suite', () => {

    /**
     * Tests to see if VM and debugger start properly
     */

    test('Test: exitcode (0)', function (done) {
        spawn(interpreter, ['--no-debug', '--file', `${examples}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            done();
        });
    });

    test('Test: exitcode (-1)', function (done) {
        spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    test('Test: start websocket', function (done) {
        let succeeded = false;

        const process: ChildProcess = startDebugger(`${examples}blink.wasm`);
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
                    process.kill("SIGKILL");
                }
            });
        }
    });

    test('Test: connect to websocket', async function () {
        await connectToDebugger(`${examples}blink.wasm`);
    });

    test('Test: --proxy flag', function (done) {
        const address = {port: port, host: '127.0.0.1'};
        const proxy: net.Server = new net.Server();
        proxy.listen(port++);
        proxy.on('connection', function (socket: net.Socket) {
            done();
        });

        connectToDebugger(`${examples}blink.wasm`, ['--proxy', address.port.toString()]).then((instance: WARDuinoInstance) => {
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
 * Tests of the Remote Debugger API
 */
suite('Remote Debugger API Test Suite', () => {
    test('Test DUMP: valid json', function (done) {
        connectToDebugger(`${examples}blink.wasm`).then((instance: WARDuinoInstance) => {
            // check if debugger returns valid json
            sendInstruction(instance.interface, undefined).then(() => {
                done();
            }).catch(() => {
                assert.fail();
            });
        });
    });

    test('Test DUMP: check fields', async function () {
        const instance: WARDuinoInstance = await connectToDebugger(`${examples}blink.wasm`);
        // get dump
        const dump = await sendInstruction(instance.interface, undefined);

        // extract information
        const functions = dump.functions.map((entry: any) => {
            return entry.fidx;
        });
        const callstack = dump.callstack.filter((entry: any) => {
            return entry.type === 0;
        }).map((entry: any) => {
            return entry.fidx;
        });

        // perform checks
        expect(parseInt(dump.start[0])).to.lessThanOrEqual(parseInt(dump.pc));
        callstack.forEach((entry: string) => {
            expect(functions).to.contain(entry);
        });
        expect(dump.callstack[0].sp).to.equal(-1);
        expect(dump.callstack[0].fp).to.equal(-1);
        expect(dump.breakpoints.length).to.equal(0);
    });

    test('Test PAUSE: execution is stopped', async function () {
        const instance: WARDuinoInstance = await connectToDebugger(`${examples}blink.wasm`);

        // run test
        const dump = await sendInstruction(instance.interface, InterruptTypes.interruptPAUSE);
        const check = await sendInstruction(instance.interface, undefined);

        // perform checks
        expect(dump.pc).to.equal(check.pc);
        expect(dump.callstack.length).to.equal(check.callstack.length);
    });

    test('Test STEP: program counter changes correctly', async function () {
        const instance: WARDuinoInstance = await connectToDebugger(`${examples}blink.wasm`);

        // run test
        const before = await sendInstruction(instance.interface, InterruptTypes.interruptPAUSE);
        const after = await sendInstruction(instance.interface, InterruptTypes.interruptSTEP, 100);

        // perform checks
        expect(parseInt(before.pc)).to.be.greaterThan(parseInt(after.pc));
    });

    test('Test BREAKPOINTS: add breakpoint', async function () {
        const instance: WARDuinoInstance = await connectToDebugger(`${examples}blink.wasm`);

        // run tests and checks
        const before = await sendInstruction(instance.interface, InterruptTypes.interruptPAUSE);
        expect(before.breakpoints.length).to.equal(0);
        const after = await sendInstruction(instance.interface, InterruptTypes.interruptBPAdd);
        expect(after.breakpoints.length).to.equal(1);
    });
});

/**
 * Test of the Out-of-place Debugger API
 */
suite('Out-of-place Debugger API Test Suite', () => {
    // TODO
});

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