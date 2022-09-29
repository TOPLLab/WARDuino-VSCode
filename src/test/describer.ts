import {ChildProcess} from 'child_process';
import {InterruptTypes} from '../DebugBridges/InterruptTypes';
import {Duplex} from 'stream';
import {assert, expect} from 'chai';
import 'mocha';
import {after} from 'mocha';

const TIMEOUT = 2000;

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
}

export interface Instance {
    process: ChildProcess;
    interface: Duplex;
}

export abstract class ProcessBridge {
    protected abstract readonly interpreter: string;

    abstract connect(program: string, args: string[]): Promise<Instance>;

    abstract sendInstruction(socket: Duplex, chunk: any, expectResponse: boolean, parser: (text: string) => Object): Promise<Object | void>;
}

/** A series of tests to perform on a single instance of the vm */
export interface TestDescription {
    title: string;

    /** File to load into the interpreter */
    program: string;

    /** A communication bridge to talk to the vm */
    bridge: ProcessBridge;

    /** Initial breakpoints */
    initialBreakpoints?: Breakpoint[];

    /** Arguments for the interpreter */
    args?: string[];

    tests?: Step[];

    skip?: boolean;
}

export class Describer {

    public describeTest(description: TestDescription) {
        const describer = this;

        describe(description.title, function () {
            this.timeout(TIMEOUT);

            let instance: Instance | void;

            /** Each test requires some housekeeping before and after */

            before('Connect to debugger', async function () {
                instance = await description.bridge.connect(description.program, description.args ?? []).catch((message: string) => {
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

                    const actual: any = await description.bridge.sendInstruction(instance.interface, step.instruction, step.expectResponse ?? true, step.parser ?? JSON.parse);

                    for (const expectation of step.expected ?? []) {
                        describer.expect(expectation, actual, previous);
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
            const value = actual[field];
            if (value === undefined) {
                assert.fail(`Failure: [actual] state does not contain '${field}'.`);
                return;
            }

            if (entry.kind === 'primitive') {
                this.expectPrimitive(value, entry.value);
            } else if (entry.kind === 'description') {
                this.expectDescription(value, entry.value);
            } else if (entry.kind === 'comparison') {
                this.expectComparison(value, entry.value);
            } else if (entry.kind === 'behaviour') {
                if (previous === undefined) {
                    assert.fail('Invalid test: no [previous] to compare behaviour to.');
                    return;
                }
                this.expectBehaviour(value, previous[field], entry.value);
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
