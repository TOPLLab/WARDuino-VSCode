/**
 * Specification test suite for WebAssembly.
 */
import {Description, Expected, TestDescription} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge, WABT} from './warduino.bridge';
import {WatCompiler} from '../framework/Compiler';
import {SourceMap} from '../../State/SourceMap';
import {FunctionInfo} from '../../State/FunctionInfo';

const SPEC: string = 'src/test/suite/spec/';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('Integration tests: WebAssembly Spec');

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
    title: 'Test f32 operations',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: 0} as Expected<number>
        }]
    }]
}, {
    // (assert_return (invoke "add" (f32.const -0x0p+0) (f32.const -0x1p-149)) (f32.const -0x1p-149))
    title: 'Test f32 operations',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: (invoke "add" (f32.const -0xcp+0) (f32.const 0x08p+0)) (f32.const -0x4p+0))',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [-12, 8]),
        parser: returnParser,
        expected: [{
            'value': {kind: 'primitive', value: -4} as Expected<number>
        }]
    }]
}];

framework.tests(f32);

framework.run();
