import {Expectation, Expected, Step} from '../framework/Describer';
import {Instruction} from '../framework/Actions';
import {Framework} from '../framework/Framework';
import {ARDUINO, EMULATOR, EmulatorBridge, HardwareBridge} from './warduino.bridge';
import {parseArguments, parseAsserts, parseResult, Value} from './spec.util';
import {readdirSync, writeFileSync} from 'fs';
import {find} from '../framework/Parsers';
import {HybridScheduler} from '../framework/Scheduler';
import {basename} from 'path';

export const CORESUITE: string = process.env.CORESUITE ?? './';

const TESTFILE: string = process.env.TESTFILE ?? '';

const framework = Framework.getImplementation();

framework.platform(new EmulatorBridge(EMULATOR), new HybridScheduler());
// framework.platform(new HardwareBridge(ARDUINO), new HybridScheduler());

framework.suite('WebAssembly Spec tests');

if (TESTFILE.length > 0) {
    const module: string = TESTFILE.replace('.asserts.wast', '.wast');
    const asserts: string[] = parseAsserts(CORESUITE + TESTFILE);
    createTest(CORESUITE + module, asserts);
    framework.run();
} else {
    process.stdout.write(`> Scanning suite: ${CORESUITE}\n\n`);

    const files: string[] = readdirSync(CORESUITE).filter((file) => file.endsWith('.asserts.wast'));

    let count = 0;
    let tally: string = ` [${count++}/${files.length}]`;
    process.stdout.write(`> Building scenarios${tally}`);
    for (const file of files) {
        const module: string = file.replace('.asserts.wast', '.wast');
        const asserts: string[] = parseAsserts(CORESUITE + file);
        createTest(CORESUITE + module, asserts);

        if (process.stdout.moveCursor !== undefined) {
            process.stdout.moveCursor(-tally.length, 0);
        }
        tally = ` [${count++}/${files.length}]`;
        process.stdout.write(tally);
    }

    process.stdout.write('\n\n> Starting framework (this may take a while)\n\n');

    framework.run();

}

function createTest(module: string, asserts: string[]) {
    const steps: Step[] = [];

    for (const assert of asserts) {
        const cursor = {value: 0};
        const fidx: string = find(/invoke "([^"]+)"/, assert);
        const args: Value[] = parseArguments(assert.replace(`(invoke "${fidx} "`, ''), cursor);
        const result: Value | undefined = parseResult(assert.slice(cursor.value));

        let expectation: Expectation = (result === undefined) ?
            {
                'stack': {
                    kind: 'comparison', value: (state: Object, value: Array<any>) => {
                        return value.length === 0;
                    }, message: 'stack should be empty'
                } as Expected<Array<any>>
            } :
            {'value': {kind: 'primitive', value: result.value} as Expected<number>};

        steps.push({
            // (invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)
            title: assert,
            instruction: Instruction.invoke,
            payload: {name: fidx, args: args},
            expected: [expectation]
        });
    }

    framework.test({
        title: `Test: ${basename(module)}`,
        program: module,
        dependencies: [],
        steps: steps
    });
}