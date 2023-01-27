/**
 * This file contains test suites of the WARDuino VM and debugger.
 *
 * These tests are independent of the plugin and uses the emulator version of the VM (wdcli).
 */

/* eslint-disable @typescript-eslint/naming-convention */

import 'mocha';
import {
    Behaviour,
    Description,
    Emulator,
    Expectation,
    Expected,
    getValue,
    Step,
    TestDescription
} from '../framework/Describer';
import {assert, expect} from 'chai';
import {ChildProcess, spawn} from 'child_process';
import {ReadlineParser} from 'serialport';
import * as net from 'net';
import {afterEach} from 'mocha';
import {Framework} from '../framework/Framework';
import {DependenceScheduler} from '../framework/Scheduler';
import {
    ARDUINO,
    connectSocket,
    EMULATOR,
    EmulatorBridge,
    HardwareBridge,
    isReadable,
    startWARDuino
} from './warduino.bridge';
import {Action, Interrupt} from '../framework/Actions';

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
        this.timeout(3500);
        process = spawn(EMULATOR, [`${EXAMPLES}hello.wasm`, '--no-debug']).on('exit', function (code) {
            expect(code).to.equal(0);
            done();
        });
    });

    it('Test: exit code (1)', function (done) {
        process = spawn(EMULATOR, [`${EXAMPLES}nonexistent.wasm`, '--socket', (INITIAL_PORT++).toString()]).on('exit', function (code) {
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
 * Tests of the Remote Debugger API
 */

function stateParser(text: string): Object {
    const message = JSON.parse(text);
    message['pc'] = parseInt(message['pc']);
    return message;
}

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));
framework.platform(new HardwareBridge(ARDUINO), new DependenceScheduler(), true);

framework.suite('Integration tests: Debugger');

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
        'count': {
            kind: 'comparison', value: (state: Object, value: number) => {
                return value === getValue(state, 'locals').length;
            }, message: 'count should equal length of locals array'
        } as Expected<number>
    }];

const DUMP: Step = {
    title: 'Send DUMP command',
    instruction: Interrupt.dump,
    parser: stateParser,
    expected: expectDUMP
};

const dumpTest: TestDescription = {
    title: 'Test DUMP',
    program: `${EXAMPLES}blink.wast`,
    steps: [DUMP]
};

framework.test(dumpTest);

const dumpLocalsTest: TestDescription = {
    title: 'Test DUMPLocals',
    program: `${EXAMPLES}blink.wast`,
    steps: [{
        title: 'Send DUMPLocals command',
        instruction: Interrupt.dumpLocals,
        parser: stateParser,
        expected: expectDUMPLocals
    }]
};

framework.test(dumpLocalsTest);

const dumpFullTest: TestDescription = {
    title: 'Test DUMPFull',
    program: `${EXAMPLES}blink.wast`,
    steps: [{
        title: 'Send DUMPFull command',
        instruction: Interrupt.dumpAll,
        parser: stateParser,
        expected: expectDUMP.concat([{
            'locals.count': {
                kind: 'comparison', value: (state: Object, value: number) => {
                    return value === getValue(state, 'locals.locals').length;
                }, message: 'locals.count should equal length of locals array'
            } as Expected<number>
        }])
    }]
};

framework.test(dumpFullTest);

const pauseTest: TestDescription = {
    title: 'Test PAUSE',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: Interrupt.pause,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'Send DUMP command',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }]
    }, {
        title: 'CHECK: execution is stopped',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>
        }]
    }]
};

framework.test(pauseTest);

const stepTest: TestDescription = {
    title: 'Test STEP',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: Interrupt.pause,
        parser: stateParser,
        expectResponse: false
    }, DUMP, {
        title: 'Send STEP command',
        instruction: Interrupt.step,
        parser: stateParser,
        expectResponse: false
    }, {
        title: 'CHECK: execution took one step',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.decreased} as Expected<string>
        }]
    }]
};

framework.test(stepTest);

const runTest: TestDescription = {
    title: 'Test RUN',
    program: `${EXAMPLES}blink.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: Interrupt.pause,
        parser: stateParser,
        expectResponse: false
    }, DUMP, {
        title: 'CHECK: execution is stopped',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.unchanged} as Expected<string>
        }]
    }, {
        title: 'Send RUN command',
        instruction: Interrupt.run,
        parser: stateParser,
        delay: 100,
        expectResponse: false
    }, {
        title: 'CHECK: execution continues',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'pc': {kind: 'description', value: Description.defined} as Expected<string>
        }, {
            'pc': {kind: 'behaviour', value: Behaviour.changed} as Expected<string>
        }]
    }]
};

framework.test(runTest);

// EDWARD tests with mock proxy

function encodeEvent(topic: string, payload: string): Promise<string> {
    return Promise.resolve(`{topic: '${topic}', payload: '${payload}'}`);
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
        instruction: Interrupt.pushEvent,
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

framework.test(eventNotificationTest);

const dumpEventsTest: TestDescription = {
    title: 'Test DUMPEvents',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'CHECK: event queue',
        instruction: Interrupt.dumpEvents,
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

framework.test(dumpEventsTest);

const receiveEventTest: TestDescription = {
    title: 'Test Event Transfer (supervisor side)',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'Send PAUSE command',
        instruction: Interrupt.pause,
        expectResponse: false
    }, {
        title: 'Push mock event',
        instruction: Interrupt.pushEvent,
        payload: encodeEvent('interrupt', ''),
        expectResponse: false
    }, {
        title: 'CHECK: event queue',
        instruction: Interrupt.dumpEvents,
        parser: stateParser,
        expected: [{
            'events': {
                kind: 'comparison',
                value: (state: string, value: Array<any>) => value.length === 1,
                message: 'events queue should include 1 event'
            } as Expected<Array<any>>
        }]
    }],
    skip: true
};

framework.test(receiveEventTest);

const dumpCallbackMappingTest: TestDescription = {
    title: 'Test DUMPCallbackmapping',
    program: `${EXAMPLES}button.wast`,
    dependencies: [dumpTest],
    steps: [{
        title: 'CHECK: callbackmapping',
        instruction: Interrupt.dumpCallbackmapping,
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

framework.test(dumpCallbackMappingTest);

function mqtt(): Promise<string> {
    // await breakpoint hit

    // send mqtt message

    return Promise.resolve('ok');
}

const scenario: TestDescription = { // MQTT test scenario
    title: 'Test MQTT primitives',
    program: `${EXAMPLES}program.ts`,
    dependencies: [],
    initialBreakpoints: [{line: 8, column: 1}, {line: 11, column: 55}],
    steps: [{
        title: 'Continue',
        instruction: Interrupt.run,
        expectResponse: false
    }, {
        title: 'CHECK: callback function registered',
        instruction: Interrupt.dumpCallbackmapping,
        parser: stateParser,
        expected: [{
            'callbacks': {
                kind: 'comparison',
                value: (state: string, mapping: Array<any>) => mapping.some((map: any) => {
                    return map.hasOwnProperty('parrot') && map['parrot'].length > 0;
                }),
                message: 'callback should be registered for parrot topic'
            } as Expected<Array<any>>
        }]
    }, {
        title: 'Send MQTT message and await breakpoint hit',
        instruction: new Action(mqtt),
        expectResponse: false
    }, {
        title: 'CHECK: entered callback function',
        instruction: Interrupt.dump,
        parser: stateParser,
        expected: [{
            'state': {kind: 'primitive', value: 'paused'} as Expected<string>,
            'line': {kind: 'primitive', value: 11} as Expected<number>,
            'column': {kind: 'primitive', value: 55} as Expected<number>
        }]
    }]
};

framework.test(scenario);

framework.run();
