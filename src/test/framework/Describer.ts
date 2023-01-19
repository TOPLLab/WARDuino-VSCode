import {ChildProcess} from 'child_process';
import {InterruptTypes} from '../../DebugBridges/InterruptTypes';
import {Duplex} from 'stream';
import {assert, expect} from 'chai';
import 'mocha';
import {after, describe, PendingSuiteFunction, SuiteFunction} from 'mocha';
import {SerialPort} from 'serialport';
import {Framework} from './Framework';
import {Action, Interrupt} from './Actions';

function timeout<T>(label: string, time: number, promise: Promise<T>): Promise<T> {
    return Promise.race([promise, new Promise<T>((resolve, reject) => setTimeout(() => reject(`timeout when ${label}`), time))]);
}

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
    | { kind: 'comparison'; value: (state: Object, value: T) => boolean; message?: string }
    | { kind: 'behaviour'; value: Behaviour };

export interface Breakpoint {
    line: number;
    column?: number;
}

export interface Step {
    /** Name of the test */
    title: string;

    /** Type of the instruction */
    instruction: Interrupt | Action;

    /* Optional payload of the instruction */
    payload?: Promise<string>;

    /** Whether the instruction is expected to return data */
    expectResponse?: boolean;

    /** Optional delay after sending instruction */
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

/**
 * @param object object to retrieve value from
 * @param field dot string describing the field of the value (or path)
 */
export function getValue(object: any, field: string): any {
    // convert indexes to properties + remove leading dots
    field = field.replace(/\[(\w+)]/g, '.$1');
    field = field.replace(/^\.?/, '');

    for (const accessor of field.split('.')) {
        if (accessor in object) {
            object = object[accessor];
        } else {
            // specified field does not exist
            return undefined;
        }
    }
    return object;
}

export interface Instance {
    interface: Duplex;
}

export interface SerialInstance extends Instance {
    interface: SerialPort;
}

export interface Emulator extends Instance {
    process: ChildProcess;
}

export abstract class ProcessBridge {
    public readonly instructionTimeout: number = 2000;
    public readonly connectionTimeout: number = 2000;

    abstract readonly name: string;

    abstract connect(program: string, args: string[]): Promise<Instance>;

    abstract sendInstruction(socket: Duplex, chunk: any, expectResponse: boolean, parser: (text: string) => Object): Promise<Object | void>;

    abstract setProgram(socket: Duplex, program: string): Promise<Object | void>;

    abstract disconnect(instance: Instance | void): Promise<void>;
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

    steps?: Step[];

    skip?: boolean;

    dependencies?: TestDescription[];
}

export class Describer {

    /** The current state for each described test */
    private states: Map<string, string> = new Map<string, string>();

    /** A communication bridge to talk to the vm */
    public readonly bridge: ProcessBridge;

    private framework: Framework;

    private suiteFunction: SuiteFunction | PendingSuiteFunction = describe;

    constructor(bridge: ProcessBridge) {
        this.bridge = bridge;
        this.framework = Framework.getImplementation();
    }

    public describeTest(description: TestDescription) {
        const describer = this;
        const call: SuiteFunction | PendingSuiteFunction = description.skip ? describe.skip : this.suiteFunction;

        call(this.formatTitle(description.title), function () {
            this.timeout(describer.bridge.instructionTimeout * 1.1);  // must be larger than own timeout

            let instance: Instance | void;

            /** Each test requires some housekeeping before and after */

            before('Connect to debugger', async function () {
                this.timeout(describer.bridge.connectionTimeout * 1.1);

                const failedDependencies: TestDescription[] = describer.failedDependencies(description);
                if (failedDependencies.length > 0) {
                    instance = undefined;
                    throw new Error(`Skipped: failed dependent tests: ${failedDependencies.map(dependence => dependence.title)}`);
                }

                instance = await timeout<Instance>(`connecting with ${describer.bridge.name}`, describer.bridge.connectionTimeout,
                    describer.bridge.connect(description.program, description.args ?? []));
            });

            afterEach('Clear listeners on interface', function () {
                // after each step: remove the installed listeners
                instance?.interface.removeAllListeners('data');
            });

            after('Shutdown debugger', async function () {
                describer.states.set(description.title, this.currentTest?.state ?? 'unknown');
                if (instance) {
                    await describer.bridge.disconnect(instance);
                }
            });

            /** Each test is made of one or more steps */

            let previous: any = undefined;
            for (const step of description.steps ?? []) {

                /** Perform the step and check if expectations were met */

                it(step.title, async function () {
                    if (instance === undefined) {
                        assert.fail('Cannot run test: no debugger connection.');
                        return;
                    }

                    let actual: Object | void;
                    if (step.instruction instanceof Action) {
                        actual = await step.instruction.perform(step.parser ?? (() => Object()));
                    } else {
                        let payload: string = '';
                        if (step.payload !== undefined) {
                            payload = await timeout<string | void>(`encoding payload ${step.instruction}`, describer.bridge.instructionTimeout, step.payload) ?? '';
                        }
                        actual = await timeout<Object | void>(`sending instruction ${step.instruction}`, describer.bridge.instructionTimeout,
                            describer.bridge.sendInstruction(instance.interface, `${step.instruction}${payload}`, step.expectResponse ?? true, step.parser ?? JSON.parse));
                    }

                    await new Promise(f => setTimeout(f, step.delay ?? 0));

                    for (const expectation of step.expected ?? []) {
                        describer.expect(expectation, actual, previous);
                    }

                    if (actual !== undefined) {
                        previous = actual;
                    }
                });
            }
        });
    }

    public skipall(): Describer {
        this.suiteFunction = describe.skip;
        return this;
    };

    private formatTitle(title: string): string {
        return `${this.bridge.name}: ${title}`;
    }

    private failedDependencies(description: TestDescription): TestDescription[] {
        return (description?.dependencies ?? []).filter(dependence => this.states.get(dependence.title) !== 'passed');
    }

    private expect(expectation: Expectation, actual: any, previous: any): void {
        for (const [field, entry] of Object.entries(expectation)) {
            const value = getValue(actual, field);
            if (value === undefined) {
                assert.fail(`Failure: [actual] state does not contain '${field}'.`);
                return;
            }

            if (entry.kind === 'primitive') {
                this.expectPrimitive(value, entry.value);
            } else if (entry.kind === 'description') {
                this.expectDescription(value, entry.value);
            } else if (entry.kind === 'comparison') {
                this.expectComparison(actual, value, entry.value, entry.message);
            } else if (entry.kind === 'behaviour') {
                if (previous === undefined) {
                    assert.fail('Invalid test: no [previous] to compare behaviour to.');
                    return;
                }
                this.expectBehaviour(value, getValue(previous, field), entry.value);
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

    private expectComparison<T>(state: Object, actual: T, comparator: (state: Object, value: T) => boolean, message?: string): void {
        expect(comparator(state, actual), `compare ${actual} with ${comparator}`).to.equal(true, message ?? 'custom comparator failed');
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
