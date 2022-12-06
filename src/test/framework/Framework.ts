import {Describer, ProcessBridge, TestDescription} from './Describer';

interface Suite {
    title: string;
    tests: TestDescription[];
}

export class Framework {
    private static implementation: Framework;

    private platforms: Describer[] = [];
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
        this.platforms.push(describer);
    }

    public suite(title: string) {
        this.suites.push({title: title, tests: []});
    }

    public test(test: TestDescription) {
        this.currentSuite().tests.push(test);
        this.platforms.forEach(describer => {
            describer.describeTest(test);
        });
    }

    public static getImplementation() {
        if (!Framework.implementation) {
            Framework.implementation = new Framework();
        }

        return Framework.implementation;
    }
}