/**
 * Specification test suite for WebAssembly.
 */
import {Expected, TestDescription} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge} from './warduino.bridge';
import {encode, returnParser} from './spec.util';

const SPEC: string = 'src/test/suite/spec/';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests');

const f32: TestDescription = {
    title: 'Test: f32 operations',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        // (assert_return (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))
        title: 'ASSERT: (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 0} as Expected<number>
        }]
    }, {
        title: 'ASSERT: (invoke "add" (f32.const -0x12p+0) (f32.const 0x8p+0)) (f32.const -0x4p+0)',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [-12, 8]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: -4} as Expected<number>
        }]
    }]
};

framework.test(f32);

const brIf: TestDescription = {
    // (assert_return (invoke "as-global.set-value" (i32.const 0)) (i32.const -1))
    title: 'Test: br_if instruction',
    program: `${SPEC}br_if.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: (invoke "as-global.set-value" (i32.const 0)) (i32.const -1)',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}br_if.wast`, 'as-global.set-value', [0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: -1} as Expected<number>
        }]
    }]
};

framework.test(brIf);

const f64: TestDescription = {
    // (assert_return (invoke "add" (f64.const 0x0p+0) (f64.const 0x0p+0)) (f64.const 0x0p+0))
    title: 'Test: f64 operations',
    program: `${SPEC}f64.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: (invoke "add" (f64.const 0x0p+0) (f64.const 0x0p+0)) (f64.const 0x0p+0)',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f64.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 0} as Expected<number>
        }]
    }]
};

framework.test(f64);

framework.run();
