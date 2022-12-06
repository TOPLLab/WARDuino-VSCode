import {Describer, ProcessBridge, TestDescription} from './Describer';

export interface Platform {
    name: string;
    bridge: ProcessBridge;
    describer: Describer;
    disabled: boolean;
}

interface Suite {
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

    public platform(bridge: ProcessBridge, disabled: boolean = false) {
        const describer = new Describer(bridge);
        if (disabled) {
            describer.skipall();
        }

        this.bases.push({
            name: bridge.name,
            bridge: bridge,
            describer: describer,
            disabled: disabled
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

    public run(cores: number = 1) {
        this.suites.forEach((suite: Suite) => {
            const order: TestDescription[] = this.schedule(suite);

            this.bases.forEach((base: Platform) => {
                order.forEach((test: TestDescription) => {
                    base.describer.describeTest(test);
                });
            });
        });
    }

    private schedule(suite: Suite): TestDescription[] {
        // sort the tests into an efficient schedule
        const schedule: TestDescription[][] = this.levels(suite);
        schedule.forEach(level => level.sort((a: TestDescription, b: TestDescription) => {
            // aggregate tests with the same program
            return a.title.localeCompare(b.title);
        }));
        return schedule.flat(2);

    }

    private levels(suite: Suite): TestDescription[][] {
        // input
        const queue: TestDescription[] = suite.tests;
        queue.sort((a: TestDescription, b: TestDescription) => (a.dependencies ?? []).length - (b.dependencies ?? []).length);
        // output
        const levels: TestDescription[][] = [];

        // while more input remains
        while (queue.length > 0) {
            // @ts-ignore
            const test: TestDescription = queue.shift();

            // skip any test with unresolved dependencies
            let skip: boolean = (test.dependencies ?? []).some((dependence: TestDescription) => queue.includes(dependence));

            if (skip) {
                queue.push(test);
                break;
            }

            // add to level below
            const level: number = this.lowest(test, levels) + 1;
            if (levels[level] === undefined) {
                levels[level] = [];
            }
            levels[level].push(test);
        }

        return levels;
    }

    private lowest(test: TestDescription, levels: TestDescription[][]): number {
        for (let i = levels.length - 1; i >= 0; i--) {
            for (let j = levels.length - 1; j >= 0; j--) {
                if (test.dependencies?.includes(levels[i][j])) {
                    return i;
                }
            }
        }
        return 0;
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}