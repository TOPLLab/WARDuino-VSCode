/**
 * Specification test suite for WebAssembly.
 */
import {Expected, TestDescription} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge, WABT} from './warduino.bridge';
import {WatCompiler} from '../framework/Compiler';
import {SourceMap} from '../../State/SourceMap';
import {FunctionInfo} from '../../State/FunctionInfo';

const SPEC: string = 'src/test/suite/spec/';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests: f32 operations');

function returnParser(text: string): Object {
    return JSON.parse(text).stack[0];
}

async function encode(program: string, name: string, args: number[]): Promise<string> {
    const map: SourceMap = await new WatCompiler(program, WABT).map();

    return new Promise((resolve, reject) => {
        const func = map.functionInfos.find((func: FunctionInfo) => func.name === name);

        if (func === undefined) {
            reject('cannot find fidx');
        } else {
            let result: string = EmulatorBridge.convertToLEB128(func.index);
            args.forEach((arg: number) => {
                result += EmulatorBridge.convertToLEB128(arg);
            });
            resolve(result);
        }
    });
}

const f32: TestDescription[] = [{
    // (assert_return (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))
    title: 'Test: (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: returns f32.const 0x0p+0',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 0} as Expected<number>
        }]
    }]
}, {
    // (assert_return (invoke "add" (f32.const -0x0p+0) (f32.const -0x1p-149)) (f32.const -0x1p-149))
    title: 'Test: (invoke "add" (f32.const -0xcp+0) (f32.const 0x08p+0)) (f32.const -0x4p+0)',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: returns f32.const -0x4p+0',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [-12, 8]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 252} as Expected<number>
        }]
    }]
}];

framework.tests(f32);

framework.suite('WebAssembly Spec tests: f64 operations');

const brIf: TestDescription[] = [{
    // (assert_return (invoke "as-global.set-value" (i32.const 0)) (i32.const -1))
    title: 'Test: (invoke "as-global.set-value" (i32.const 0)) (i32.const -1)',
    program: `${SPEC}br_if.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: returns i32.const -1',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}br_if.wast`, 'as-global.set-value', [0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: -1} as Expected<number>
        }]
    }]
}];

framework.tests(brIf);

framework.suite('WebAssembly Spec tests: f64 operations');

const f64: TestDescription[] = [{
    // (assert_return (invoke "add" (f64.const 0x0p+0) (f64.const 0x0p+0)) (f64.const 0x0p+0))
    title: 'Test: (invoke "add" (f64.const 0x0p+0) (f64.const 0x0p+0)) (f64.const 0x0p+0)',
    program: `${SPEC}f64.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: returns f64.const 0x0p+0',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f64.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 0} as Expected<number>
        }]
    }]
}];

framework.tests(f64);

framework.run();
