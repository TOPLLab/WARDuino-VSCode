import {Expected, Step} from '../framework/Describer';
import {Interrupt} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {EMULATOR, EmulatorBridge} from './warduino.bridge';
import {encode, parseFloat, returnParser} from './spec.util';
import {createReadStream, readdirSync} from 'fs';
import * as readline from 'readline';
import {find} from '../framework/Parsers';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR));

framework.suite('WebAssembly Spec tests');

const files: string[] = readdirSync('core');

for (const file of files) {
    if (!file.endsWith('.assert.wast')) {
        // only look at assert files
        break;
    }

    const module: string = file.replace('.asserts.wast', '.wast');

    parseAsserts(file).then((asserts: string[]) => createTest(module, asserts));
}

function createTest(module: string, asserts: string[]) {
    const steps: Step[] = [];

    for (const assert of asserts) {
        const fidx: string = find(/invoke "([^"]+)"/, assert);
        const args: number[] = parseArguments(assert.replace(`(invoke "${fidx} "`, ''));
        const result: number = 0;  // todo parse

        steps.push({
            // (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)
            title: assert,
            instruction: Interrupt.invoke,
            payload: encode(module, fidx, args),
            parser: returnParser,
            expected: [{
                'value': {kind: 'primitive', value: result} as Expected<number>
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

function parseArguments(input: string): number[] {
    const consume = (input: string, cursor: number): number =>
        / /.exec(input.slice(cursor))?.index ?? input.length;
    const args: number[] = [];

    let stack: number = 1;
    let cursor: number = 0;
    while (cursor < input.length && 0 < stack) {
        if (input[cursor] !== '(') {
            break;
        }

        stack += 1;
        cursor = consume(input, cursor);
        args.push(parseFloat(input.slice(cursor)));

        if (input[cursor] !== ')') {
            break;
        }

        stack -= 1;
        cursor = consume(input, cursor);
    }

    return args;
}

function parseAsserts(file: string): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
        const asserts: string[] = [];
        const reader = readline.createInterface(createReadStream(file));

        reader.on('line', (line) => {
            asserts.push(line.replace('(assert_return', '('));
        });

        reader.on('close', () => {
            resolve(asserts);
        });
    });
}