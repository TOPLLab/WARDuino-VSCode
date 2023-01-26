import {Expected, Step} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge} from './warduino.bridge';
import {encode, returnParser} from './spec.util';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests');

const files: string[] = [];

for (const file of files) {
    const module: string = '';

    // for each module

    const asserts: string[] = [];

    const steps: Step[] = [];

    for (const assert of asserts) {
        steps.push({
            // (assert_return (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0))
            title: assert,
            instruction: Interrupt.invoke,
            payload: encode(module, 'add', [0, 0]),
            parser: returnParser,
            expected: [{
                'value': {kind: 'primitive', value: 0} as Expected<number>
            }]
        });
    }

    framework.test({
        title: `Test: ${module}`,
        program: module,
        dependencies: [],
        steps: steps
    });
}