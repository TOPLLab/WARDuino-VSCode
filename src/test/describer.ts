import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {InterruptTypes} from '../DebugBridges/InterruptTypes';
import {Readable} from 'stream';
import {ReadlineParser} from 'serialport';
import {expect} from 'chai';
import 'mocha';

export enum Description {
    /** required properties */
    defined,
    notDefined,
}

export enum Comparison {
    /** compare with a previous state: */
    lessThan,
    equal,
    greaterThan,
}

export enum Behaviour {
    /** check over time (test will request 2 state dumps): */
    unchanged,
    changed,
    increasing,
    decreasing
}

export type Expected<T> =
    | { kind: 'primitive'; value: T }
    | { kind: 'description'; value: Description }
    | { kind: 'comparison'; value: Comparison }
    | { kind: 'behaviour'; value: Behaviour };

export interface Instruction {
    name: string;

    /** Type of the instruction */
    type: InterruptTypes;

    /** Optional delay before checking result of instruction */
    delay?: number;

    /** Expected state after instruction */
    expected: Expectation[];
}

export interface Expectation {
    [key: string]: Expected<any>;

    // ...
}

export interface TestDescription {
    name: string;

    /** File to load into the interpreter */
    program: string;

    /** Arguments for the interpreter */
    args?: string[];

    instructions?: Instruction[];

    skip?: boolean;
}

export interface WARDuinoInstance {
    process: ChildProcess;
    interface: net.Socket;
}

export class Describer {
    private port: number;
    private readonly interpreter: string;

    constructor(interpreter: string, initialPort: number = 8192) {
        this.interpreter = interpreter;
        this.port = initialPort;
    }

    public describeTest(desc: TestDescription) {
        describe(desc.name, () => {
            let instance: WARDuinoInstance;

            before('before', async () => {
                instance = await connectToDebugger(this.interpreter, desc.program, this.port++, desc.args ?? []);
            });

            let previous: any = undefined;
            for (const instruction of desc.instructions ?? []) {
                it(instruction.name, async () => {
                    const actual: any = await sendInstruction(instance.interface, instruction.type, instruction.delay ?? 0);

                    for (const expectation of instruction.expected) {
                        for (const [field, entry] of Object.entries(expectation)) {
                            if (entry.kind === 'primitive') {
                                expect(actual[field]).to.deep.equal(expectation[field].value);
                            }

                            if (entry.kind === 'description') {
                                switch (entry.value) {
                                case Description.defined:
                                    expect(actual[field]).to.exist;
                                    break;
                                case Description.notDefined:
                                    expect(actual[field]).to.be.undefined;
                                    break;
                                }
                            }

                            if (entry.kind === 'comparison') {
                                if (previous) {
                                    switch (entry.value) {
                                    case Comparison.lessThan:
                                        expect(actual[field]).to.be.lessThan(previous[field]);
                                        break;
                                    case Comparison.equal:
                                        expect(actual[field]).to.be.equal(previous[field]);
                                        break;
                                    case Comparison.greaterThan:
                                        expect(actual[field]).to.be.greaterThan(previous[field]);
                                        break;
                                    }
                                }
                            }

                            if (entry.kind === 'behaviour') {
                                const after: any = await sendInstruction(instance.interface, undefined);
                                switch (entry.value) {
                                case Behaviour.unchanged:
                                    expect(after[field]).to.be.equal(actual[field]);
                                    break;
                                case Behaviour.changed:
                                    expect(after[field]).to.not.equal(actual[field]);
                                    break;
                                case Behaviour.increasing:
                                    expect(after[field]).to.be.greaterThan(actual[field]);
                                    break;
                                case Behaviour.decreasing:
                                    expect(after[field]).to.be.lessThan(actual[field]);
                                    break;
                                }
                            }
                        }
                    }
                    previous = actual;
                });
            }

            after('after', () => {
                // TODO stop debugger
            });
        });

    }
}

export function isReadable(x: Readable | null): x is Readable {
    return x !== null;
}

export function startDebugger(interpreter: string, program: string, port: number = 8192, args: string[] = []): ChildProcess {
    const _args: string[] = ['--socket', (port).toString(), '--file', program].concat(args);
    return spawn(interpreter, _args);

}

export function connectToDebugger(interpreter: string, program: string, port: number = 8192, args: string[] = []): Promise<WARDuinoInstance> {
    const address = {port: port, host: '127.0.0.1'};
    const process = startDebugger(interpreter, program, port, args);

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

export function sendInstruction(socket: net.Socket, instruction?: InterruptTypes, timeout: number = 0): Promise<any> {
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

        if (instruction) {
            socket.write(`${instruction} \n`);
        }

        // send dump command (optionally wait briefly for the operation to take effect)
        setTimeout(function () {
            socket.write(`${InterruptTypes.interruptDUMPFull} \n`);
        }, timeout);
    });
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