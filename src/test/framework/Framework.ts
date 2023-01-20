import {Describer, ProcessBridge, TestDescription} from './Describer';
import {HybridScheduler, Scheduler} from './Scheduler';

export interface Platform {
    name: string;
    bridge: ProcessBridge;
    describer: Describer;

    scheduler: Scheduler;

    disabled: boolean;
}

export interface Suite {
    title: string;
    tests: TestDescription[];
}

interface DependenceTree {
    test: TestDescription;
    children: DependenceTree[];
}

export class Framework {
    private static implementation: Framework;

    private bases: Platform[] = [];
    private suites: Suite[] = [];

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

    public test(test: TestDescription) {
        this.currentSuite().tests.push(test);
    }

    public tests(tests: TestDescription[]) {
        tests.forEach(test => this.currentSuite().tests.push(test));
    }

    public run(cores: number = 1) {
        this.suites.forEach((suite: Suite) => {
            this.bases.forEach((base: Platform) => {
                const order: TestDescription[] = base.scheduler.schedule(suite);
                order.forEach((test: TestDescription) => {
                    base.describer.describeTest(test);
                });
            });
        });
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}