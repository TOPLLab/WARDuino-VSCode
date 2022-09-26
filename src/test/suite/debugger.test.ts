// Tests specific to the debugger
import "mocha";

import {ChildProcess, spawn} from "child_process";
import {Readable} from "stream";
import {assert, expect} from "chai";
import {ReadlineParser} from "serialport";
import * as net from 'net';
import {InterruptTypes} from "../../DebugBridges/InterruptTypes";

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

function connectToDebugger(program: string, args: string[] = []): Promise<net.Socket> {
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
                        resolve(client);
                    });
                }
            });
        } else {
            reject();
        }
    });
}

suite('Debugger Test Suite', () => {

    test('Test exitcode (0)', function (done) {
        const process = spawn(interpreter, ['--no-debug', '--file', `${examples}hello.wasm`]).on('exit', function (code) {
            expect(code).to.equal(0);
            process.kill("SIGKILL");
            done();
        });
    });

    test('Test exitcode (-1)', function (done) {
        spawn(interpreter, ['--socket', (port++).toString(), '--file', `${examples}nonexistent.wasm`]).on('exit', function (code) {
            expect(code).to.equal(1);
            done();
        });
    });

    test('Start websocket', function (done) {
        this.timeout(5000);

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

    test('Connect to websocket', async function () {
        await connectToDebugger(`${examples}blink.wasm`);
    });

    test('Test pause', async function () {
        this.timeout(5000);
        const socket: net.Socket = await connectToDebugger(`${examples}blink.wasm`);

        // save returned program counters
        const counters: number[] = [];
        const stack: MessageStack = new MessageStack('\n');
        socket.on('data', (data: Buffer) => {
            stack.push(data.toString());
            let message = stack.pop();
            while (message !== undefined) {
                try {
                    const parsed = JSON.parse(message);
                    counters.push(parseInt(parsed.pc));
                } catch (e) {
                    // do nothing
                } finally {
                    message = stack.pop();
                }
            }
        });

        // run test
        socket.write(`${InterruptTypes.interruptPAUSE} \n`);
        setTimeout(() => {
            socket.write(`${InterruptTypes.interruptDUMP} \n`);
        }, 1000);
        setTimeout(() => {
            socket.write(`${InterruptTypes.interruptDUMP} \n`);
        }, 1000);


        // perform checks
        setTimeout(() => {
            expect(counters.length).to.equal(2);
            expect(counters[0]).to.equal(counters[1]);
        }, 2000);
    });
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
        if (this.incomplete()) {
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
        return text.split(new RegExp(`(.*?${this.delimiter})`, 'g')).filter(s => {return s.length > 0; });
    }

    private incomplete(): boolean {
        const last: string | undefined = this.stack[this.stack.length - 1];
        return last !== undefined && !last.includes(this.delimiter);
    }

    private hasCompleteMessage(): boolean {
        return !this.incomplete() || this.stack.length > 1;
    }
}