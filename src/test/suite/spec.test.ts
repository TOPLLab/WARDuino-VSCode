import {Description, Expected, Step} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge} from './warduino.bridge';
import {encode, parseArguments, parseAsserts, parseResult, returnParser} from './spec.util';
import {readdirSync} from 'fs';
import {find} from '../framework/Parsers';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests');

const files: string[] = readdirSync('/home/tom/Arduino/libraries/WARDuino/core');

const promises: Promise<void>[] = [];
for (const file of files) {
    if (!file.endsWith('.asserts.wast')) {
        // only look at assert files
        continue;
    }

    promises.push(new Promise((resolve) => {
        const module: string = file.replace('.asserts.wast', '.wast');

        parseAsserts(file).then((asserts: string[]) => {
            createTest(module, asserts);
            resolve();
        });
    }));
}
Promise.all([]).then(() => {
    framework.run();
});


function createTest(module: string, asserts: string[]) {
    const steps: Step[] = [];

    for (const assert of asserts) {
        const cursor = {value: 0};
        const fidx: string = find(/invoke "([^"]+)"/, assert);
        const args: number[] = parseArguments(assert.replace(`(invoke "${fidx} " `, ''), cursor);
        const result: number | undefined = parseResult(assert.slice(cursor.value));  // todo parse

        let expectation: Expected<number> = (result === undefined) ?
            {kind: 'description', value: Description.notDefined} as Expected<number> :
            {kind: 'primitive', value: result} as Expected<number>;

        steps.push({
            // (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)
            title: assert,
            instruction: Interrupt.invoke,
            payload: encode(module, fidx, args),
            parser: returnParser,
            expected: [{
                'value': expectation
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