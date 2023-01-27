import {Description, Expected, Step} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge} from './warduino.bridge';
import {encode, parseArguments, parseAsserts, parseResult, returnParser} from './spec.util';
import {readdirSync} from 'fs';
import {find} from '../framework/Parsers';

export const CORESUITE: string = process.env.CORESUITE ?? '.';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests');

process.stdout.write(`> Scanning suite: ${CORESUITE}\n\n`);

const files: string[] = readdirSync(CORESUITE).filter((file) => file.endsWith('.asserts.wast'));

let count = 0;
let tally: string = ` [${count++}/${files.length}]`;
process.stdout.write(`> Building scenarios${tally}`);
for (const file of files) {
    const module: string = file.replace('.asserts.wast', '.wast');
    const asserts: string[] = parseAsserts(CORESUITE + file);
    createTest(CORESUITE + module, asserts);

    tally = ` [${count++}/${files.length}]`;
    process.stdout.moveCursor(-tally.length, 0);
    process.stdout.write(tally);
}

process.stdout.write('\n\n> Starting framework');
framework.run();

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