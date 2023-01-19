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
    return JSON.parse(text);
}

async function encode(program: string, name: string, args: number[]): Promise<string> {
    const map: SourceMap = await new WatCompiler(program, WABT).map();

    return new Promise((resolve, reject) => {
        const func = map.functionInfos.find((func: FunctionInfo) => func.name === name);

        if (func === undefined) {
            reject('cannot find fidx');
        } else {
            let result: string = func.index.toString() ?? '';
            args.forEach((arg: number) => {result += EmulatorBridge.convertToLEB128(arg);});
            resolve(result);
        }
    });
}

// (assert_return (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))
const f32: TestDescription = {
    title: 'Test f32 operations',
    program: `${SPEC}f32.wast`,
    dependencies: [],
    steps: [{
        title: 'ASSERT: (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))',
        instruction: Interrupt.invoke,
        payload: encode(`${SPEC}f32.wast`, 'add', [0, 0]),
        parser: returnParser,
        expected: [{
            'stack': {kind: 'description', value: Description.defined} as Expected<Array<number>>
        }]
    }]
};

framework.test(f32);

framework.run();
