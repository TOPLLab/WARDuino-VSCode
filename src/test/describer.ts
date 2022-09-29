import {ChildProcess, spawn} from 'child_process';
import * as net from 'net';
import {InterruptTypes} from '../DebugBridges/InterruptTypes';
import {Readable} from 'stream';
import {ReadlineParser} from 'serialport';
import {assert, expect} from 'chai';
import 'mocha';
import {after} from 'mocha';

export enum Description {
    /** required properties */
    defined,
    notDefined
}

export enum Behaviour {
    /** compare with a previous state (always fails if no previous state): */
    unchanged,
    changed,
    increased,
    decreased
}

export type Expected<T> =
/** discrimination union */
    | { kind: 'primitive'; value: T }
    | { kind: 'description'; value: Description }
    | { kind: 'comparison'; value: (value: T) => boolean }
    | { kind: 'behaviour'; value: Behaviour };

export interface Breakpoint {

}

export interface Step {
    /** Name of the test */
    title: string;

    /** Type of the instruction */
    instruction: InterruptTypes;

    /** Whether the instruction is expected to return data */
    expectResponse?: boolean;

    /** Optional delay before checking result of instruction */
    delay?: number;

    /** Parser to use on the result. */
    parser?: (input: string) => Object;

    /** Checks to run against the result. */
    expected?: Expectation[];

    /** Command to use to retrieve the result of the vm */
    inspector?: InterruptTypes;
}

export interface Expectation {
    [key: string]: Expected<any>;

    // ...
}

/** A series of tests to perform on a single instance of the vm */
export interface TestDescription {
    title: string;

    /** File to load into the interpreter */
    program: string;

    /** Initial breakpoints */
    initialBreakpoints?: Breakpoint[];

    /** Arguments for the interpreter */
    args?: string[];

    tests?: Step[];

    skip?: boolean;
}

export interface WARDuinoInstance {
    process: ChildProcess;
    interface: net.Socket;
}

export class Describer {
    private readonly interpreter: string;
    private port: number;

    constructor(interpreter: string, initialPort: number = 8192) {
        this.interpreter = interpreter;
        this.port = initialPort;
    }

    public describeTest(description: TestDescription) {
        describe(description.title, () => {
            const describer = this;
            let instance: WARDuinoInstance | void;

            /** Each test requires some housekeeping before and after */

            before('Connect to debugger', async function () {
                instance = await connectToDebugger(describer.interpreter, description.program, describer.port++, description.args ?? []).catch((message: string) => {
                    console.error(message);
                });
            });

            afterEach('Clear listeners on interface', () => {
                // after each step: remove the installed listeners
                instance?.interface.removeAllListeners('data');
            });

            after('Shutdown debugger', () => {
                instance?.interface.destroy();
                instance?.process.kill('SIGKILL');
            });

            /** Each test is made of one or more steps */

            let previous: any = undefined;
            for (const step of description.tests ?? []) {

                /** Perform the step and check if expectations were met */
                it(step.title, async () => {
                    if (instance === undefined) {
                        assert.fail('Cannot run test: no debugger connection.');
                        return;
                    }

                    const actual: any = await sendInstruction(instance.interface, step.instruction, step.expectResponse ?? true, step.parser ?? JSON.parse);

                    for (const expectation of step.expected ?? []) {
                        this.expect(expectation, actual, previous);
                    }

                    if (actual) {
                        previous = actual;
                    }
                });
            }
        });
    }

    private expect(expectation: Expectation, actual: any, previous: any): void {
        for (const [field, entry] of Object.entries(expectation)) {
            if (entry.kind === 'primitive') {
                this.expectPrimitive(actual[field], entry.value);
            } else if (entry.kind === 'description') {
                this.expectDescription(actual[field], entry.value);
            } else if (entry.kind === 'comparison') {
                this.expectComparison(actual[field], entry.value);
            } else if (entry.kind === 'behaviour') {
                if (!previous) {
                    assert.fail('Invalid test: no [previous] to compare behaviour to.');
                    return;
                }
                this.expectBehaviour(actual[field], previous[field], entry.value);
            }
        }
    }

    private expectPrimitive<T>(actual: T, expected: T): void {
        expect(actual).to.deep.equal(expected);
    }

    private expectDescription<T>(actual: T, value: Description): void {
        switch (value) {
            case Description.defined:
                expect(actual).to.exist;
                break;
            case Description.notDefined:
                expect(actual).to.be.undefined;
                break;
        }
    }

    private expectComparison<T>(actual: T, comparator: (value: T) => boolean): void {
        expect(comparator(actual)).to.be.true;
    }

    private expectBehaviour(actual: any, previous: any, behaviour: Behaviour): void {
        switch (behaviour) {
            case Behaviour.unchanged:
                expect(actual).to.be.equal(previous);
                break;
            case Behaviour.changed:
                expect(actual).to.not.equal(previous);
                break;
            case Behaviour.increased:
                expect(actual).to.be.greaterThan(previous);
                break;
            case Behaviour.decreased:
                expect(actual).to.be.lessThan(previous);
                break;
        }
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

export function sendInstruction(socket: net.Socket,
                                instruction?: InterruptTypes,
                                expectResponse: boolean = true,
                                parser: (text: string) => Object = JSON.parse): Promise<any> {
    const stack: MessageStack = new MessageStack('\n');

    return new Promise(function (resolve) {
        socket.on('data', (data: Buffer) => {
            stack.push(data.toString());
            stack.tryParser(parser, resolve);
        });

        if (instruction) {
            socket.write(`${instruction} \n`);
        }

        if (!expectResponse) {
            resolve(null);
        }
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