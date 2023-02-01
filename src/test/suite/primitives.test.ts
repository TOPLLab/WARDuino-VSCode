import {Expected, ProcessBridge, TestDescription} from '../framework/Describer';
import {Action, Interrupt} from '../framework/Actions';
import {encode} from './spec.util';
import {Framework} from '../framework/Framework';
import {ARDUINO, EMULATOR, EmulatorBridge, HardwareBridge} from './warduino.bridge';
import {DependenceScheduler} from '../framework/Scheduler';
import * as mqtt from 'mqtt';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));
framework.platform(new HardwareBridge(ARDUINO), new DependenceScheduler());

framework.suite('Integration tests: basic primitives');

function identity(text: string): Object {
    return {output: text};
}

const serial: TestDescription = {
    title: 'Test serial bus primitives',
    program: 'serial.ts',
    dependencies: [],
    steps: [{
        title: 'Check: print_int primitive',
        instruction: Interrupt.invoke,
        parser: identity,
        expected: [{
            'output': {kind: 'primitive', value: '42\n'},
        }]
    }, {
        title: 'Check: print_string primitive with constant string',
        instruction: Interrupt.invoke,
        parser: identity,
        expected: [{
            'output': {kind: 'primitive', value: 'What is the answer to life, the universe, and everything?\n'},
        }]
    }, {
        title: 'Check: print_string primitive with formatted string',
        instruction: Interrupt.invoke,
        parser: identity,
        expected: [{
            'output': {kind: 'primitive', value: 'What do you get if you multiply six by nine? 42\n'},
        }]
    }]
};

framework.test(serial);

const io: TestDescription = {
    title: 'Test digital I/O primitives',
    program: 'io.ts',
    dependencies: [],
    steps: [{
        title: 'Check: read LOW sensor value',
        instruction: Interrupt.invoke,
        payload: encode('io.ts', 'digital.read', [12]),
        expected: [{'value': {kind: 'comparison', value: (state, value: string) => parseInt(value) === 0}}]
    }, {
        title: 'Drop stack value',
        instruction: Interrupt.invoke,
        payload: encode('io.ts', 'drop', []),
        expected: [{
            'stack': {
                kind: 'comparison', value: (state: Object, value: Array<any>) => {
                    return value.length === 0;
                }, message: 'stack should be empty'
            }
        }]
    }, {
        title: 'Check: write HIGH to pin',
        instruction: Interrupt.invoke,
        payload: encode('io.ts', 'digital.write', [36]),
        expected: [{
            'stack': {
                kind: 'comparison', value: (state: Object, value: Array<any>) => {
                    return value.length === 0;
                }, message: 'stack should be empty'
            }
        }]
    }, {
        title: 'Check: read HIGH from pin',
        instruction: Interrupt.invoke,
        payload: encode('io.ts', 'digital.read', [36]),
        expected: [{'value': {kind: 'comparison', value: (state, value: string) => parseInt(value) === 1}}]
    }]
};

framework.test(io);

const interrupts: TestDescription = {
    title: 'Test hardware interrupt primitives',
    program: 'interrupts.ts',
    steps: [{
        title: 'Subscribe to falling interrupt on pin 36',
        instruction: Interrupt.invoke,
        payload: encode('interrupts.ts', 'interrupts.subscribe', [36, 0, 2]),
        expected: [{
            'stack': {
                kind: 'comparison', value: (state: Object, value: Array<any>) => {
                    return value.length === 0;
                }, message: 'stack should be empty'
            }
        }]
    }, {
        title: 'CHECK: callback function registered for pin 36',
        instruction: Interrupt.dumpCallbackmapping,
        expected: [{
            'callbacks': {
                kind: 'comparison',
                value: (state: Object, mapping: Array<any>) => mapping.some((map: any) => {
                    return map.hasOwnProperty('interrupt_36') && map['interrupt_36'].length > 0 && map['interrupt_36'].includes(0);
                }),
                message: 'callback should be registered for parrot topic'
            } as Expected<Array<any>>
        }]
    }]
};

framework.test(interrupts);

framework.suite('Integration tests: Wi-Fi and MQTT primitives');

function awaitBreakpoint(bridge: ProcessBridge): Promise<string> {
    return new Promise<string>((resolve) => {
        // await breakpoint hit
        bridge.addListener((data: string) => {
            bridge.clearListeners();
            resolve(data);
        });

        // send mqtt message
        let client : mqtt.MqttClient = mqtt.connect('mqtt://test.mosquitto.org');
        client.publish('parrot', 'This is an ex-parrot!');
    });
}

const scenario: TestDescription = { // MQTT test scenario
    title: 'Test MQTT primitives',
    program: 'program.ts',
    dependencies: [],
    initialBreakpoints: [{line: 8, column: 1}, {line: 11, column: 55}],
    steps: [{
        title: 'Continue',
        instruction: Interrupt.run,
        expectResponse: false
    }, {
        title: 'CHECK: callback function registered',
        instruction: Interrupt.dumpCallbackmapping,
        expected: [{
            'callbacks': {
                kind: 'comparison',
                value: (state: Object, mapping: Array<any>) => mapping.some((map: any) => {
                    return map.hasOwnProperty('parrot') && map['parrot'].length > 0;
                }),
                message: 'callback should be registered for parrot topic'
            } as Expected<Array<any>>
        }]
    }, {
        title: 'Send MQTT message and await breakpoint hit',
        instruction: new Action(awaitBreakpoint)
    }, {
        title: 'CHECK: entered callback function',
        instruction: Interrupt.dump,
        expected: [{
            'state': {kind: 'primitive', value: 'paused'},
            'line': {kind: 'primitive', value: 11},
            'column': {kind: 'primitive', value: 55}
        }]
    }]
};

framework.test(scenario);

framework.run();
