import {Describer, ProcessBridge, TestScenario} from './Describer';
import {HybridScheduler, Scheduler} from './Scheduler';
import {after} from 'mocha';

export interface Platform {
    name: string;
    bridge: ProcessBridge;
    describer: Describer;

    scheduler: Scheduler;

    disabled: boolean;
}

export interface Suite {
    title: string;
    tests: TestScenario[];
}

interface DependenceTree {
    test: TestScenario;
    children: DependenceTree[];
}

export class Framework {
    private static implementation: Framework;

    private bases: Platform[] = [];
    private suites: Suite[] = [];

    public runs: number = 1;

    private constructor() {
    }

    private currentSuite(): Suite {
        return this.suites[this.suites.length - 1];
    }

    public platform(bridge: ProcessBridge, scheduler: Scheduler = new HybridScheduler(), disabled: boolean = false) {
        const describer = new Describer(bridge);
        if (disabled) {
            describer.skipall();
        }

        this.bases.push({
            name: bridge.name,
            bridge: bridge,
            describer: describer,
            disabled: disabled,
            scheduler: scheduler
        });
    }

    public platforms(): Platform[] {
        return this.bases;
    }

    public suite(title: string) {
        this.suites.push({title: title, tests: []});
    }

    public test(test: TestScenario) {
        this.currentSuite().tests.push(test);
    }

    public tests(tests: TestScenario[]) {
        tests.forEach(test => this.currentSuite().tests.push(test));
    }

    public run(cores: number = 1) {   // todo remove cores
        this.suites.forEach((suite: Suite) => {
            this.bases.forEach((base: Platform) => {
                describe('', () => {
                    // todo add parallelism
                    const order: TestScenario[] = base.scheduler.schedule(suite);

                    if (!base.disabled) {
                        before('Connect to debugger', async function () {
                            this.timeout(base.describer.bridge.connectionTimeout * 1.1);

                            base.describer.instance = await base.describer.createInstance(order[0]);  // todo move createInstance to Framework?
                        });

                        after('Shutdown debugger', async function () {
                            await base.describer.bridge.disconnect(base.describer.instance);
                        });
                    }

                    order.forEach((test: TestScenario) => {
                        base.describer.describeTest(test, this.runs);
                    });
                });
            });
        });
    }

    // Analyse flakiness
    public analyse(runs: number = 3, cores: number = 1) {
        this.runs = runs;
        this.run(cores);
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}